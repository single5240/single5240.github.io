---
layout: skill
title: 串口 DMA 环形接收与协议帧拆包状态机 (serial-dma-frame-parser)
skill_id: serial-dma-frame-parser
description: UART/RS-485/DMX512/Modbus RTU 串口 IDLE+DMA 环形缓冲区接收、带帧内超时的状态机拆包、短帧/断帧/粘包防御与半双工 DE/RE 方向切换时序。
category: protocols-debug
category_label: 通信协议与硬件联调
scope: global
target: UART / RS-232 / RS-485 / Modbus RTU / DMX512
order: 15
tags:
  - UART-DMA
  - RS-485
  - DMX512
  - 状态机拆包
---

## SKILL.md 元数据

```yaml
---
name: serial-dma-frame-parser
description: >-
  [Scope: global] UART/RS-485/DMX512/Modbus RTU 串口 IDLE+DMA 环形缓冲区接收、表驱动/状态机拆包、短帧/断帧/粘包防御与半双工 DE/RE 方向切换时序。
  当用户需要编写或调试串口自定义协议、Modbus RTU、DMX512 灯光协议、解决 RS-485 尾字节截断、DMA 缓冲回绕丢包或粘包错位问题时使用此技能。
---
```

## 1. 适用范围与背景 (Metadata)

- **技术方向**：`protocols-debug`
- **使用范围 (Scope)**：`global`（全平台 MCU 通用，涵盖 UART / RS-232 / RS-485 / Modbus RTU / DMX512）
- **核心设计目标**：ISR 零协议解析负担、零动态内存、天然免疫粘包（Back-to-Back Frames）/ 断帧（Fragmented Bytes）/ 伪帧头（False Header Inside Payload）与半双工尾字节截断。

## 2. 四大核心场景架构准则

### 2.1 `UART IDLE + DMA Circular` 双游标搬运模型

- DMA RX 配置为**循环模式（Circular Mode）**写入静态数组 `s_dmaRxBuf[N]`。
- 在 **UART 空闲中断（IDLE ISR）**、**DMA 半传输中断（HT ISR）** 和 **DMA 传输完成中断（TC ISR）** 中调用同一个搬运函数：
  - 计算 `writePos = N - DMA_GetCurrDataCounter()`；
  - 将 `[lastPos, writePos)` 新增字节（含回绕段）压入软件无锁环形队列 `RingBuffer`，仅更新 `lastPos = writePos`。
- **禁止在每次 IDLE 中断里暴停 DMA 重装 `CNDTR`**：停 DMA 重装期间到达的高速串口字节会直接丢失或触发 `ORE`（Overrun Error）。

### 2.2 状态机拆包与“伪帧头回退扫描”机制

- 主循环从 `RingBuffer` 逐字节喂入拆包状态机（`SYNC_HEAD -> LEN -> PAYLOAD -> CRC -> PUBLISH`）。
- **关键防死锁设计**：
  1. **帧内字节超时（Inter-Byte Timeout）**：若状态机停留在非 `SYNC_HEAD` 状态且超过 `T_timeout`（如 `20 ms`）未收齐剩余字节，自动复位状态机并丢弃残帧，防止断帧导致下一帧合法报文被吞。
  2. **CRC 失败滑动重同步**：若帧头命中但最终 CRC 校验失败（说明帧头字节恰好是上一帧残片里的载荷数据），不要整包丢弃全部已收字节，应从帧头下一字节重新扫描 `SYNC_HEAD`。

### 2.3 DMX512 协议接收与短帧安全发布法则

- **Break + MAB 帧同步**：利用 UART 帧错误标志（`FE` Framing Error + 接收数据为 `0x00`）识别 `>= 88 μs` 的 `BREAK` 低电平脉冲，随后第 1 个正常字节为 `Start Code`（标准调光帧为 `0x00`），后续为 `Slot 1..512`（250 kbps, 8N2）。
- **短帧发布铁律**：DMX 控台允许发送少于 512 通道的短帧（Short Frame）。**不得要求必须收满 513 字节才发布数据**；当检测到下一个 `BREAK` 或帧空闲超时，只要已收到合法 `Start Code == 0x00` 且已接收通道数 ≥ 本灯具所需的目标起始通道范围，即刻将双缓冲中的完整快照原子发布给调光层；若在中途发生 `ORE/NE` 错误或不足本设备通道数，则丢弃本帧保持上一帧输出，绝不把半帧残缺数据直接写向 PWM！

### 2.4 半双工 RS-485 `DE/RE` 方向切换与 Modbus 3.5T 边界

- **发送切接收铁律（等待 `TC` 而非 `TXE`）**：
  - `TXE=1`（或 DMA TX 完成）仅代表最后一个字节刚送入移位寄存器，此时停止位尚未从引脚发出！
  - **必须在 `USART_FLAG_TC`（Transmission Complete）置位后**，才可将 RS-485 `DE/RE` 引脚拉低切回接收态，否则最后一个字节（通常是 CRC 高字节）会被物理截断。
- **硬件异常自愈（`ORE / FE / NE`）**：
  - 在 UART ISR 中必须同时检查并清除 `ORE`（过载）、`FE`（帧错误）、`NE`（噪声错误）标志（在 STM32/N32G45x 上需先读 `STS/SR` 再读 `DAT/DR` 清除），否则 `ORE` 置位后会永久锁死后续接收中断。

> 可直接复用的无锁 `RingBuffer` + 带超时状态机拆包 C99 源码模板见 [examples/serial_ring_frame_parser.c](#example-serial-parser)。

## 3. 关键安全与并发约束检查清单

- [ ] **单生产者/单消费者无锁队列**：`RingBuffer` 的 `head`（ISR 写）与 `tail`（主循环读）各自只由单一上下文修改，无需关中断即可保证线程安全。
- [ ] **长度字段防缓冲区溢出**：状态机解析出 `LEN` 字段后，必须立即校验 `LEN >= MIN_LEN && LEN <= MAX_PAYLOAD_SIZE`；越界立即拒绝并退回 `SYNC_HEAD`，严禁按未校验的 `LEN` 继续向 `payload[]` 写入。
- [ ] **上电 `DE/RE` 默认接收态**：RS-485 控制脚初始化时先写低电平（接收态）再配输出模式，防止多机总线上电瞬间同时抢占驱动器拉死总线。

## 4. 验证与调试方法 (Verification)

1. **粘包与断帧压力测试**：
   - 上位机一次发送 3 帧首尾相连的合法报文（粘包），验证解析计数 `+3`；
   - 先发送半截伪造帧头，间隔 `50 ms`（超过帧内超时）后再发 1 帧合法报文，验证合法报文不被吞没。
2. **示波器/逻辑分析仪 RS-485 波形核查**：
   - 测量 `TX` 最后一个停止位结束边沿到 `DE` 变低的延迟：确认 `DE` 在停止位完整发出后 `5~50 μs` 内拉低，既无尾字节截断，也不影响从机最快响应。

<h2 id="example-serial-parser">代码范例：examples/serial_ring_frame_parser.c</h2>

```c
/**
 * @file serial_ring_frame_parser.c
 * @brief Lock-free SPSC RingBuffer + Timeout-protected Frame Parser (C99).
 *
 * Frame Format Example:
 *   [0xAA] [0x55] [CMD:1B] [LEN:1B] [PAYLOAD:0..64B] [CRC16_LE:2B]
 */
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#define SERIAL_RING_CAPACITY    (256U) /* Must be power of 2 */
#define SERIAL_RING_MASK        (SERIAL_RING_CAPACITY - 1U)
#define FRAME_MAX_PAYLOAD       (64U)
#define FRAME_INTERBYTE_TIMEOUT (20U)  /* ms */

typedef struct
{
    uint8_t           buf[SERIAL_RING_CAPACITY];
    volatile uint16_t head; /* Written only by producer (ISR) */
    volatile uint16_t tail; /* Written only by consumer (Main loop) */
    volatile uint32_t dropCount;
} SerialRingBuffer;

typedef enum
{
    PARSE_SYNC_AA = 0,
    PARSE_SYNC_55,
    PARSE_CMD,
    PARSE_LEN,
    PARSE_PAYLOAD,
    PARSE_CRC_LO,
    PARSE_CRC_HI
} ParseState;

typedef struct
{
    ParseState state;
    uint8_t    cmd;
    uint8_t    len;
    uint8_t    payIdx;
    uint8_t    payload[FRAME_MAX_PAYLOAD];
    uint16_t   rxCrc;
    uint32_t   lastByteTick;
    uint32_t   validFrameCount;
    uint32_t   crcErrorCount;
    uint32_t   timeoutErrorCount;
} FrameParserCtx;

/* ---- Lock-Free SPSC Ring Buffer ---- */

void SerialRing_Init(SerialRingBuffer *rb)
{
    memset(rb, 0, sizeof(*rb));
}

/* Call from UART IDLE / DMA HT / DMA TC ISR */
void SerialRing_PushFromIsr(SerialRingBuffer *rb, const uint8_t *data, uint16_t len)
{
    uint16_t h = rb->head;
    uint16_t t = rb->tail;

    for (uint16_t i = 0U; i < len; i++)
    {
        uint16_t next = (uint16_t)((h + 1U) & SERIAL_RING_MASK);
        if (next == t)
        {
            rb->dropCount++;
            break;
        }
        rb->buf[h] = data[i];
        h = next;
    }
    rb->head = h;
}

/* Call from Main Loop */
bool SerialRing_Pop(SerialRingBuffer *rb, uint8_t *outByte)
{
    uint16_t t = rb->tail;
    if (t == rb->head)
    {
        return false;
    }
    *outByte = rb->buf[t];
    rb->tail = (uint16_t)((t + 1U) & SERIAL_RING_MASK);
    return true;
}

/* ---- CRC-16/MODBUS ---- */

static uint16_t CalcCrc16Modbus(const uint8_t *data, uint16_t len, uint16_t initCrc)
{
    uint16_t crc = initCrc;
    for (uint16_t i = 0U; i < len; i++)
    {
        crc ^= (uint16_t)data[i];
        for (uint8_t b = 0U; b < 8U; b++)
        {
            if ((crc & 0x0001U) != 0U)
            {
                crc = (uint16_t)((crc >> 1U) ^ 0xA001U);
            }
            else
            {
                crc >>= 1U;
            }
        }
    }
    return crc;
}

/* ---- Non-Blocking Frame Parser with Inter-Byte Timeout ---- */

void FrameParser_Init(FrameParserCtx *ctx)
{
    memset(ctx, 0, sizeof(*ctx));
    ctx->state = PARSE_SYNC_AA;
}

void FrameParser_Process(FrameParserCtx *ctx,
                         SerialRingBuffer *rb,
                         uint32_t currentTickMs,
                         void (*onFrame)(uint8_t cmd, const uint8_t *payload, uint8_t len))
{
    uint8_t byte = 0U;

    /* Check inter-byte timeout when mid-frame */
    if ((ctx->state != PARSE_SYNC_AA) &&
        ((uint32_t)(currentTickMs - ctx->lastByteTick) >= FRAME_INTERBYTE_TIMEOUT))
    {
        ctx->state = PARSE_SYNC_AA;
        ctx->timeoutErrorCount++;
    }

    while (SerialRing_Pop(rb, &byte))
    {
        ctx->lastByteTick = currentTickMs;

        switch (ctx->state)
        {
        case PARSE_SYNC_AA:
            if (byte == 0xAAU) { ctx->state = PARSE_SYNC_55; }
            break;

        case PARSE_SYNC_55:
            if (byte == 0x55U)      { ctx->state = PARSE_CMD; }
            else if (byte == 0xAAU) { ctx->state = PARSE_SYNC_55; } /* Consecutive 0xAA */
            else                    { ctx->state = PARSE_SYNC_AA; }
            break;

        case PARSE_CMD:
            ctx->cmd   = byte;
            ctx->state = PARSE_LEN;
            break;

        case PARSE_LEN:
            if (byte > FRAME_MAX_PAYLOAD)
            {
                ctx->state = PARSE_SYNC_AA;
                ctx->crcErrorCount++;
            }
            else
            {
                ctx->len    = byte;
                ctx->payIdx = 0U;
                ctx->state  = (byte == 0U) ? PARSE_CRC_LO : PARSE_PAYLOAD;
            }
            break;

        case PARSE_PAYLOAD:
            ctx->payload[ctx->payIdx++] = byte;
            if (ctx->payIdx >= ctx->len)
            {
                ctx->state = PARSE_CRC_LO;
            }
            break;

        case PARSE_CRC_LO:
            ctx->rxCrc = (uint16_t)byte;
            ctx->state = PARSE_CRC_HI;
            break;

        case PARSE_CRC_HI:
        {
            ctx->rxCrc |= (uint16_t)((uint16_t)byte << 8U);
            uint8_t hdr[4] = { 0xAAU, 0x55U, ctx->cmd, ctx->len };
            uint16_t calc  = CalcCrc16Modbus(hdr, 4U, 0xFFFFU);
            calc           = CalcCrc16Modbus(ctx->payload, ctx->len, calc);

            if (calc == ctx->rxCrc)
            {
                ctx->validFrameCount++;
                if (onFrame != NULL)
                {
                    onFrame(ctx->cmd, ctx->payload, ctx->len);
                }
            }
            else
            {
                ctx->crcErrorCount++;
            }
            ctx->state = PARSE_SYNC_AA;
            break;
        }

        default:
            ctx->state = PARSE_SYNC_AA;
            break;
        }
    }
}
```
