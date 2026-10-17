---
layout: skill
title: J-Link RTT 表驱动 CLI 与板级故障注入自测 (jlink-rtt-cli-hil-validation)
skill_id: jlink-rtt-cli-hil-validation
description: 基于 J-Link SEGGER RTT 的零串口占用表驱动 CLI、DWT 主循环/栈水位性能探针与非阻塞板级故障注入（HIL）自动化验收。
category: protocols-debug
category_label: 通信协议与硬件联调
scope: global
target: ARM Cortex-M0/M3/M4/M7 + J-Link SEGGER RTT + DWT
order: 14
tags:
  - J-Link
  - SEGGER-RTT
  - DWT探针
  - HIL故障注入
---

## SKILL.md 元数据

```yaml
---
name: jlink-rtt-cli-hil-validation
description: >-
  [Scope: global] 基于 J-Link SEGGER RTT 的零串口占用表驱动 CLI、DWT 主循环/栈水位性能探针与非阻塞板级故障注入（HIL）自动化验收。
  当用户需要在 Cortex-M 单片机上通过 RTT 建立交互式调试命令台、测量主循环单圈极值耗时与外设丢包率、或在实板上对 Flash/传感器执行非阻塞故障注入与断电恢复验证时使用此技能。
---
```

## 1. 适用范围与背景 (Metadata)

- **技术方向**：`protocols-debug`
- **使用范围 (Scope)**：`global`（全平台 Cortex-M 通用，提炼自 N32G455 量产验证工程）
- **适用硬件与工具**：ARM Cortex-M0/M3/M4/M7 + J-Link 调试器（SWD 接口）+ SEGGER RTT 组件，无需占用任何硬件 UART 引脚。

## 2. 核心设计模式 (Core Patterns)

1. **零动态内存、单层表驱动 RTT CLI (`app_rtt_cli`)**：
   - 在主循环中非阻塞轮询 `SEGGER_RTT_ReadNoLock(0, ...)`（每次最多读 32 字节），组装以 `\r` 或 `\n` 结尾的命令行（静态缓冲 128B，超长行自动丢弃防溢出）。
   - 切分首词（Token）后在 `const AppRttCliCommand s_commands[]` 静态表中匹配分发，新增/裁剪命令仅需修改一张表。
   - 每次响应前置打印系统运行毫秒时间戳 `[HH:MM:SS.mmm]`，便于上位机日志对齐。
2. **DWT 周期级主循环耗时与硬件健康度探针 (`stat` 命令)**：
   - 在 `main.c` 的 `while(1)` 首尾调用 `AppRttCli_NoteMainLoopStart()` 与 `AppRttCli_NoteMainLoopEnd()`，利用 Cortex-M `DWT->CYCCNT` 硬件周期计数器统计主循环**最小/最大/平均执行耗时与调度周期**。
   - 结合栈涂漆（Stack Painting）水位检测、IWDG 标志以及高频外设（如 AD7190 `rdy/dma/error/overrun/recovery`）快照差值，一键输出压力测试期间的实时性证据。
3. **编译宏隔离的协作式板级故障注入状态机 (`*_VALIDATION_ENABLE`)**：
   - 破坏性或大体积验证代码（批量写入、持久化边界软复位注入、擦除超时/读回错误注入）置于独立模块（如 `app_record_store_test.c`），由 `#define APP_XXX_VALIDATION_ENABLE 0` 默认关闭。
   - **严禁在 RTT 命令回调里用死循环跑完长耗时测试**：RTT 命令仅启动测试状态机并返回 `PENDING`；由主循环每轮推进一小步，完成后打印确定性的 `PASS: <case>` 或 `FAIL: <case> reason=...` 终态日志。

> 可直接复用的表驱动 CLI 与 DWT 探针模板见 [examples/rtt_cli_template.c](#example-rtt-cli)；板级 HIL 验收流程与持久化边界故障注入规范见 [references/hil-validation-protocol.md](#ref-hil-protocol)。

## 3. 核心执行流程 (Step-by-Step Workflow)

1. **接入 SEGGER RTT 与非阻塞 CLI**：
   - 在 `SysTick` 初始化后调用 `SEGGER_RTT_Init()` 与 `AppRttCli_Init()`。
   - 在主循环中调用 `AppRttCli_Process()`；确保所有 RTT 输出均在主循环上下文执行，**禁止在高频 ISR 中调用 `SEGGER_RTT_printf`**。
2. **植入主循环性能探针与安全复位 (`reboot`)**：
   - 在主循环业务开始前记录 `DWT->CYCCNT`，在 `Iwdg_Feed()` 前记录结束周期。
   - 实现 `reboot` 命令：收到命令后设置 `s_rebootPending = 1`，**必须等待 Flash/EEPROM 等持久化外设处于 IDLE 状态且延迟 100 ms 让 RTT 排空输出缓冲后**，再调用 `NVIC_SystemReset()`。
3. **编写分级板级验证状态机**：
   - **Level 1（纯 RAM 无损自检）**：如 `codec` 命令，验证正反序列化固定字节向量、CRC 篡改、越界参数，不触碰真实 Flash。
   - **Level 2（非阻塞功能与压力验证）**：如 `append 1000`、`list_check`、`full_probe`，分步执行并支持 `stop` 在安全边界中止。
   - **Level 3（持久化边界软复位与故障注入）**：在两阶段提交或扇区迁移的精确边界点（如 `MIGRATE_BEGIN` 刚提交、目标槽刚写完、源槽刚标 `MIGRATED`）触发自动软复位，重启后执行 `verify_after_reboot` 校验自动续作结果。

## 4. 关键安全与并发约束检查清单

- [ ] **生产固件零污染**：交付前必须将 `*_VALIDATION_ENABLE` 恢复为 `0` 并重新全量编译，确认 `record_test` 等命令仅返回 `no support now`，且验证代码的 `Code/ZI` 占用已剥离。
- [ ] **破坏性擦写双门禁**：任何会擦除 Flash 分区的测试命令（如 `cleanup`）执行前，必须在文档和交互中确认目标分区无用户生产数据并已获擦写授权。
- [ ] **命令接受 != 测试通过**：上位机或测试人员发送异步验证命令后，必须等待终态日志 `PASS:` / `FAIL:`，且检查 `stat` 中 `iwdg_reset == 0`、`adc_overrun == 0`、`adc_recovery == 0`。

## 5. 验证与调试方法 (Verification)

1. **基线健康检查命令序列**：
   ```text
   ver
   help
   stat reset
   stat
   ```
2. **通过判据**：
   - `ver` 输出正确的编译日期时间与 `SystemCoreClock`（如 `128000000`）。
   - 高负载测试后执行 `stat`：主循环最大耗时远小于看门狗窗口（如 `< 10 ms` vs `1000 ms` IWDG），栈最低剩余水位 `> 512 B`，外设错误/溢出计数为 `0`。

<h2 id="ref-hil-protocol">参考文档：板级 RTT 硬件在环（HIL）验证与故障注入规程 (references/hil-validation-protocol.md)</h2>

### 1. 验证固件制作与双构建对比

1. **开启验证宏**：
   在测试模块头文件（如 `app_record_store_test.h`）中临时开启：
   ```c
   #define APP_RECORD_STORE_VALIDATION_ENABLE 1
   ```
2. **记录双配置资源基线**：
   分别构建默认生产配置（`ENABLE=0`）与验证配置（`ENABLE=1`），记录两者的 `Error / Warning` 数量以及 `Code / RO-data / RW-data / ZI-data` 字节数，确保生产固件不含测试状态机开销。
3. **测试收尾强制还原**：
   实板测试完成并执行 `cleanup` 恢复空白分区后，**必须在同一任务中将验证宏改回 `0`**，避免测试入口或故障注入钩子流入量产包。

### 2. 标准结果码与终态日志契约

所有异步验证命令（由主循环状态机分步推进）必须区分“已接受”与“终态完成”：

| 结果码 | 枚举名 | 语义说明 |
| ---: | :--- | :--- |
| `0` | `NONE` | 空闲无结果 |
| `1` | `PENDING` | 命令已接受，主循环状态机正在分步推进 |
| `2` | `OK` | 终态通过（伴随打印 `PASS: <subcommand> ...`） |
| `3` | `BUSY` | 底层服务正忙 |
| `4` | `NOT_READY` | 服务未初始化或处于恢复中 |
| `5` | `FULL` | 达到产品记录上限（如第 1,001 条拒绝写入验证） |
| `6` | `NO_SPACE` | 物理空扇区不足安全保留阈值 |
| `7~12` | `INVALID / NOT_FOUND / ALREADY_DELETED / PROTECTED / FLASH_ERROR / VERIFY_ERROR` | 精确映射错误分支供负向用例断言 |

### 3. 五阶段板级验证标准步骤

- **阶段一：健康基线与纯 RAM 自检（零擦写）**：
  ```text
  ver
  record_status
  stat reset
  record_test codec
  ```
  判据：`codec` 输出 `PASS: codec`，覆盖正常编解码向量、CRC 错误、未知版本、未提交字节和非法扩展字段。
- **阶段二：边界删除与连续序号一致性**：
  ```text
  record_test append 10
  record_test delete_pos first
  record_test delete_pos middle
  record_test delete_pos last
  record_test list_check
  ```
  判据：正序与倒序分页遍历均连续编号为 `1..7`，重复删除返回 `ALREADY_DELETED` 且不产生额外 Flash 编程。
- **阶段三：满容量边界与删除后补存**：
  ```text
  record_test append 993
  record_test full_probe
  record_test delete_pos middle
  record_test append 1
  ```
  判据：`1000` 条时 `full_probe` 精确返回 `FULL` 且不破坏现有记录；删除 1 条后可正常补存第 1000 条。
- **阶段四：持久化边界软复位注入（模拟关键点掉电）**：
  在稀疏扇区迁移或两阶段提交的 4 个关键持久化边界点埋设单次触发钩子（写入 Flash 刚返回立即调用 `NVIC_SystemReset()`）：
  1. `reset_at migrate_begin`：`MIGRATE_BEGIN` 控制记录刚提交后复位；
  2. `reset_at copy_commit`：第 `k` 条目标副本刚完成两阶段提交、源槽尚未标 `MIGRATED` 时复位；
  3. `reset_at mark_source`：源槽刚标为 `MIGRATED (0x5AA5)`、尚未全部迁完时复位；
  4. `reset_at migrate_commit`：`MIGRATE_COMMIT` 刚提交、源扇区尚未擦除完成时复位。
  判据：每次复位重启后执行 `record_status` 与 `record_test list_check`，记录总数、主键集合与正反序内容 100% 一致，无重复主键、无丢失。
- **阶段五：软件故障注入与并发实时性核查**：
  注入擦除启动失败、擦除 `BUSY` 超时、读回非 `0xFF` 校验失败，确认失败扇区保持隔离而不被误标为 `EMPTY`；执行 `stat` 核查全程实时性：`iwdg_reset=0`，高频 ADC `error=0, timeout=0, overrun=0, recovery=0`，主循环最大周期 `< 10 ms`，栈涂漆最低余量 `> 512 B`。

<h2 id="example-rtt-cli">代码范例：examples/rtt_cli_template.c</h2>

```c
/**
 * @file rtt_cli_template.c
 * @brief Zero-malloc table-driven J-Link RTT CLI with DWT main-loop profiler.
 */
#include "SEGGER_RTT.h"
#include <stdint.h>
#include <string.h>

#define RTT_CLI_CHANNEL        (0U)
#define RTT_CLI_LINE_CAPACITY  (128U)
#define RTT_CLI_READ_CHUNK     (32U)

typedef void (*RttCliHandler)(const char *args);

typedef struct
{
    const char   *name;
    const char   *help;
    RttCliHandler handler;
} RttCliCommand;

typedef struct
{
    uint64_t loopCount;
    uint64_t totalExecCycles;
    uint32_t minExecCycles;
    uint32_t maxExecCycles;
    uint32_t maxPeriodCycles;
    uint32_t loopStartCycle;
    uint32_t prevStartCycle;
    uint8_t  dwtAvailable;
    uint8_t  prevStartValid;
} RttCliRuntimeStats;

static char               s_line[RTT_CLI_LINE_CAPACITY];
static uint16_t           s_lineLen;
static RttCliRuntimeStats s_stats;

/* External platform hooks */
extern uint32_t PlatformTime_GetMs(void);
extern uint32_t SystemCoreClock;
extern uint8_t  FlashService_IsIdle(void);

static void CmdHelp(const char *args);
static void CmdVer(const char *args);
static void CmdStat(const char *args);

static const RttCliCommand s_commands[] =
{
    { "help", "list all commands",                 CmdHelp },
    { "ver",  "print build timestamp and HCLK",    CmdVer  },
    { "stat", "print main-loop DWT stats (reset)", CmdStat },
};

#define RTT_CLI_CMD_COUNT (sizeof(s_commands) / sizeof(s_commands[0]))

static void RttCli_PrintTimestamp(void)
{
    uint32_t ms = PlatformTime_GetMs();
    uint32_t s  = ms / 1000U;
    (void)SEGGER_RTT_printf(RTT_CLI_CHANNEL,
                            "[%02u:%02u:%02u.%03u] ",
                            (unsigned)((s / 3600U) % 24U),
                            (unsigned)((s / 60U) % 60U),
                            (unsigned)(s % 60U),
                            (unsigned)(ms % 1000U));
}

static char *RttCli_SplitCommand(char *line, const char **argsOut)
{
    char *p = line;
    while ((*p == ' ') || (*p == '\t')) { p++; }
    if (*p == '\0') { *argsOut = p; return NULL; }

    char *name = p;
    while ((*p != '\0') && (*p != ' ') && (*p != '\t')) { p++; }
    if (*p != '\0')
    {
        *p++ = '\0';
        while ((*p == ' ') || (*p == '\t')) { p++; }
    }
    *argsOut = p;
    return name;
}

static void RttCli_DispatchLine(char *line)
{
    const char *args = NULL;
    char *name = RttCli_SplitCommand(line, &args);
    if (name == NULL) { return; }

    RttCli_PrintTimestamp();
    for (uint32_t i = 0U; i < RTT_CLI_CMD_COUNT; i++)
    {
        if (strcmp(name, s_commands[i].name) == 0)
        {
            s_commands[i].handler(args);
            return;
        }
    }
    (void)SEGGER_RTT_printf(RTT_CLI_CHANNEL, "ERR: unknown cmd '%s'\r\n", name);
}

void AppRttCli_Init(void)
{
    s_lineLen = 0U;
    memset(&s_stats, 0, sizeof(s_stats));
    s_stats.minExecCycles = 0xFFFFFFFFUL;
    /* Enable Cortex-M DWT CYCCNT if available */
    /* CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk; DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk; */
}

void AppRttCli_NoteMainLoopStart(uint32_t currentDwtCycle)
{
    if (s_stats.prevStartValid != 0U)
    {
        uint32_t period = currentDwtCycle - s_stats.prevStartCycle;
        if (period > s_stats.maxPeriodCycles) { s_stats.maxPeriodCycles = period; }
    }
    s_stats.prevStartCycle = currentDwtCycle;
    s_stats.prevStartValid = 1U;
    s_stats.loopStartCycle = currentDwtCycle;
}

void AppRttCli_NoteMainLoopEnd(uint32_t currentDwtCycle)
{
    uint32_t exec = currentDwtCycle - s_stats.loopStartCycle;
    s_stats.loopCount++;
    s_stats.totalExecCycles += exec;
    if (exec < s_stats.minExecCycles) { s_stats.minExecCycles = exec; }
    if (exec > s_stats.maxExecCycles) { s_stats.maxExecCycles = exec; }
}

void AppRttCli_Process(void)
{
    char chunk[RTT_CLI_READ_CHUNK];
    unsigned numRead = SEGGER_RTT_ReadNoLock(RTT_CLI_CHANNEL, chunk, sizeof(chunk));

    for (unsigned i = 0U; i < numRead; i++)
    {
        char c = chunk[i];
        if ((c == '\r') || (c == '\n'))
        {
            if (s_lineLen > 0U)
            {
                s_line[s_lineLen] = '\0';
                RttCli_DispatchLine(s_line);
                s_lineLen = 0U;
            }
        }
        else if (s_lineLen + 1U < RTT_CLI_LINE_CAPACITY)
        {
            s_line[s_lineLen++] = c;
        }
        else
        {
            /* Overflow protection: drop line until next newline */
            s_lineLen = 0U;
        }
    }
}

static void CmdHelp(const char *args)
{
    (void)args;
    (void)SEGGER_RTT_WriteString(RTT_CLI_CHANNEL, "Commands:\r\n");
    for (uint32_t i = 0U; i < RTT_CLI_CMD_COUNT; i++)
    {
        (void)SEGGER_RTT_printf(RTT_CLI_CHANNEL, "  %-14s - %s\r\n",
                                s_commands[i].name, s_commands[i].help);
    }
}

static void CmdVer(const char *args)
{
    (void)args;
    (void)SEGGER_RTT_printf(RTT_CLI_CHANNEL, "Build: %s %s, HCLK=%u Hz\r\n",
                            __DATE__, __TIME__, (unsigned)SystemCoreClock);
}

static void CmdStat(const char *args)
{
    if ((args != NULL) && (strcmp(args, "reset") == 0))
    {
        s_stats.loopCount       = 0U;
        s_stats.totalExecCycles = 0U;
        s_stats.minExecCycles   = 0xFFFFFFFFUL;
        s_stats.maxExecCycles   = 0U;
        s_stats.maxPeriodCycles = 0U;
        s_stats.prevStartValid  = 0U;
        (void)SEGGER_RTT_WriteString(RTT_CLI_CHANNEL, "OK: stat reset\r\n");
        return;
    }
    uint32_t khz = SystemCoreClock / 1000U;
    uint32_t maxExecUs = (khz > 0U) ? (uint32_t)(((uint64_t)s_stats.maxExecCycles * 1000ULL) / khz) : 0U;
    uint32_t maxPerUs  = (khz > 0U) ? (uint32_t)(((uint64_t)s_stats.maxPeriodCycles * 1000ULL) / khz) : 0U;
    (void)SEGGER_RTT_printf(RTT_CLI_CHANNEL,
                            "loops=%u max_exec=%u us max_period=%u us\r\n",
                            (unsigned)s_stats.loopCount,
                            (unsigned)maxExecUs,
                            (unsigned)maxPerUs);
}
```
