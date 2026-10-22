---
layout: skill
title: Cortex-M HardFault 栈回溯与 .map 故障定位 (cortex-m-hardfault-map-decoder)
skill_id: cortex-m-hardfault-map-decoder
description: 提取 Cortex-M 异常栈和故障寄存器，结合 Keil .map 与反汇编查找故障指令。
category: protocols-debug
category_label: 通信协议与硬件联调
scope: global
target: ARM Cortex-M0/M3/M4/M7/M33 + Keil .map / fromelf / GCC
order: 16
tags:
  - HardFault
  - Cortex-M
  - 栈回溯
  - 故障诊断
---

## SKILL.md 元数据

```yaml
---
name: cortex-m-hardfault-map-decoder
description: >-
  [Scope: global] ARM Cortex-M0/M3/M4/M7 HardFault 异常栈帧（MSP/PSP PC/LR）提取、SCB 故障状态寄存器（CFSR/HFSR/BFAR/MMFAR）解码与 Keil .map / 反汇编精确定位。
  当用户遇到单片机死机进入 HardFault_Handler、野指针/数组越界/除零/栈溢出崩溃、或需要根据 PC/LR 地址在 .map 文件中反查故障源码行时使用此技能。
---
```

## 1. 适用范围

- **技术方向**：`protocols-debug`
- **使用范围 (Scope)**：`global`（全平台 ARM Cortex-M0/M0+/M3/M4/M7/M33 通用）
- **适用工具链**：Keil MDK (`ARMCC 5` / `ARMClang 6`, `.map` + `fromelf.exe`) 与 GCC (`arm-none-eabi-addr2line` / `objdump`)。

## 2. 核心诊断原理 (Core Diagnostic Flow)

当 Cortex-M 触发异常进入 `HardFault_Handler` 时，硬件已自动将故障现场的 8 个核心寄存器压入故障发生前正在使用的栈（`MSP` 或 `PSP`）：

```text
High Address
  +------------------+
  | xPSR             |  sp[7]  (检查 bit24 Thumb 位是否为 1)
  | PC (Return Addr) |  sp[6]  <-- 触发精确故障的指令地址！
  | LR (R14)         |  sp[5]  <-- 进入当前故障函数前的父函数返回地址！
  | R12              |  sp[4]
  | R3               |  sp[3]
  | R2               |  sp[2]
  | R1               |  sp[1]
  | R0               |  sp[0]  <-- 故障栈顶 (MSP 或 PSP)
Low Address
```

1. **第一步：由进入 Handler 时的 `LR (EXC_RETURN)` 确定栈指针**：
   - 检查 `EXC_RETURN` 的 `Bit 2`：`0` 表示压入主栈 `MSP`，`1` 表示压入线程栈 `PSP`（裸机工程默认全在 `MSP`）。
   - **注意**：若开启了 FPU 且触发前使用了浮点寄存器，`EXC_RETURN` 的 `Bit 4 == 0` 表示栈帧还额外包含 `S0~S15, FPSCR`。
2. **第二步：读取 `SCB` 故障状态寄存器 (`0xE000ED28 ~ 0xE000ED38`)**：
   - **`SCB->HFSR` (`0xE000ED2C`)**：确认是否为 `FORCED (Bit 30)`（由 MemManage/BusFault/UsageFault 升级而来）或 `VECTTBL (Bit 1)`（取向量表故障）。
   - **`SCB->CFSR` (`0xE000ED28`)**：拆分为低 8 位 `MMFSR`（内存管理）、中 8 位 `BFSR`（总线故障）、高 16 位 `UFSR`（用法故障）。
   - **`SCB->MMFAR` (`0xE000ED34`) & `SCB->BFAR` (`0xE000ED38`)**：仅当 `MMARVALID (CFSR[7]) == 1` 或 `BFARVALID (CFSR[15]) == 1` 时，其中保存的才是**触发崩溃的确切非法内存地址**！
3. **第三步：结合 Keil `.map` 与 `fromelf` 还原函数与源码行**：
   - 在 `.map` 的 `Memory Map of the image` 中查找满足 `Symbol_Base <= sp[6] (PC) < Symbol_Base + Size` 的函数；
   - 若 `PC == 0x00000000`（调用了空函数指针），则改查 **`sp[5] (LR) & ~1UL`** 定位是哪个父函数发起了这次非法调用！

> 适配 ARMCC 5 / GCC 的零栈污染 `HardFault_Handler` 汇编+RTT 打印模板见 [examples/hardfault_rtt_dump.c](#example-hardfault-c)；完整 `CFSR` 位域速查表与 `fromelf` 反汇编命令见 [references/cfsr-bitfield-and-map-lookup.md](#ref-cfsr-lookup)。

## 3. 操作步骤

1. **植入汇编级故障栈捕获 (`HardFault_Handler`)**：
   - **严禁直接在 C 函数 `void HardFault_Handler(void)` 开头定义局部变量并读取 `MSP`**：编译器生成的函数序言（`PUSH {r4, lr}`）会先修改 `MSP`，导致读出的 `sp[0..7]` 发生偏移错位！
   - 必须使用裸汇编（ARMCC 5 `__asm` 或 GCC `__attribute__((naked))`）先提取 `MSP/PSP` 作为 `R0` 参数传给 C 函数 `HardFault_DumpC(uint32_t *stackFrame, uint32_t excReturn)`。
2. **解析非精确总线故障 (`IMPRECISERR`, `CFSR[10] == 1`)**：
   - 写缓冲（Write Buffer）导致写非法地址滞后几个周期才报错，此时 `PC` 已滑过真实故障指令且 `BFARVALID == 0`。
   - **调试写缓冲**：在调试初始化时临时置位 `SCB->ACTLR |= (1UL << 1)`（`DISDEFWBUF`，关闭 Cortex-M3/M4 默认写缓冲），再复现故障，观察是否变为**精确总线故障 (`PRECISERR`)**，并检查 `BFARVALID` 和 PC。
3. **开启除零与非对齐陷阱（可选诊断增强）**：
   - 默认 Cortex-M3/M4 除以 0 不会触发异常（结果静默为 0）；排查数学异常时可设置 `SCB->CCR |= SCB_CCR_DIV_0_TRP_Msk`。

## 4. 关键安全检查清单

- [ ] **异常内停用危险输出并安全停机**：进入 `HardFault` 后，先将高危功率/加热/电机 GPIO 置为安全关断电平，打印完 RTT/串口寄存器快照后执行断点 `if (CoreDebug->DHCSR & 1) __breakpoint(0);` 并死循环等待 IWDG 复位。
- [ ] **检查栈溢出破坏 (`MSP < Stack_Bottom`)**：若提取出的 `MSP` 已跌破 `.map` 中的 `STACK` 段起始地址，说明是栈溢出踩坏了上下文，此时应扩大 `startup_*.s` 中的 `Stack_Size` 或排查函数内大局部数组。

## 5. 验证方法

1. **故障注入验证**：
   - 临时写入 `*(volatile uint32_t *)0xCCCCCCCCUL = 1UL;`（触发 `PRECISERR` / `IMPRECISERR`）或调用 `((void (*)(void))0x00000000UL)();`（触发 `INVSTATE`），验证 RTT 准确打印出故障函数地址，且与 `.map` 完全吻合。

<h2 id="ref-cfsr-lookup">参考文档：Cortex-M SCB->CFSR 位域解码表与 .map / fromelf 反查指南 (references/cfsr-bitfield-and-map-lookup.md)</h2>

### 1. `SCB->CFSR` (`0xE000ED28`) 32 位故障位域速查

`CFSR` 由三个子状态寄存器拼接而成：`[31:16] UFSR` | `[15:8] BFSR` | `[7:0] MMFSR`。

| 位号 | 位名称 | 所属子域 | 典型触发根因与排查方向 |
| ---: | :--- | :---: | :--- |
| `Bit 0` | `IACCVIOL` | MMFSR | 指令访问违例：PC 跳到了不可执行区（如 `0xFFFFFFF0` 或 MPU 禁止执行区），常见于**栈溢出覆盖了压栈的 LR** |
| `Bit 1` | `DACCVIOL` | MMFSR | 数据访问违例：读写了 MPU 保护区或非法系统地址，查看 `MMFAR` |
| `Bit 7` | `MMARVALID` | MMFSR | `MMFAR` (`0xE000ED34`) 中的故障地址有效 |
| `Bit 8` | `IBUSERR` | BFSR | 指令预取总线错误：函数指针指向了不存在的物理地址空间 |
| `Bit 9` | `PRECISERR` | BFSR | **精确数据总线错误**：读或写了非法外设/内存地址（如未开 RCC 时钟的外设或越界野指针），此时 **`PC` 即故障指令，且 `BFAR` 保存了确切非法地址** |
| `Bit 10` | `IMPRECISERR` | BFSR | **非精确数据总线错误**：异步写缓冲报错，`PC` 比真实写指令滞后数条。在初始化中设置 `*(volatile uint32_t *)0xE000E008 |= 2UL;`（关闭写缓冲 `DISDEFWBUF`）复现即可转为 `PRECISERR` |
| `Bit 11` | `UNSTKERR` | BFSR | 异常退出出栈时总线错误：`SP` 栈指针已损坏或跌出 SRAM |
| `Bit 12` | `STKERR` | BFSR | 异常进入压栈时总线错误：**典型的 `MSP` 栈下溢（Stack Overflow）跌破 `0x20000000`** |
| `Bit 15` | `BFARVALID` | BFSR | `BFAR` (`0xE000ED38`) 中的故障地址有效 |
| `Bit 16` | `UNDEFINSTR` | UFSR | 执行了未定义指令：代码区被踩坏、Flash 擦写错误或函数指针跳进了数据表 |
| `Bit 17` | `INVSTATE` | UFSR | 非法 EPSR 状态（`xPSR.T == 0`）：**调用了函数指针，但指针值为 `0`（NULL）或最低位未置 1（非 Thumb 地址）**，立即查看 `sp[5] (LR)` 找调用方！ |
| `Bit 18` | `INVPC` | UFSR | 异常返回时 `EXC_RETURN` 值非法：中断栈里的 `LR` 被越界写坏 |
| `Bit 19` | `NOCP` | UFSR | 访问了未使能的协处理器：**工程开启了硬件浮点（FPU），但 `SystemInit()` 未置位 `SCB->CPACR |= (0xFUL << 20)`** |
| `Bit 24` | `UNALIGNED` | UFSR | 非对齐访问故障：使用 `LDRD / STRD / LDM / STM` 访问了非 4 字节对齐的指针（如将 `uint8_t buf[]` 强转为 `uint32_t *` 或 `uint64_t *`） |
| `Bit 25` | `DIVBYZERO` | UFSR | 除以零故障（当 `SCB->CCR.DIV_0_TRP == 1` 时触发） |

### 2. 使用 Keil `.map` 与 `fromelf.exe` 反查源码位置

1. **在 `.map` 中快速定位函数**：
   打开 `Listings/<Target>.map`，搜索 `PC` 的高 20 位（例如 `PC = 0x08004A32`，搜索 `0x08004`），找到基地址小于等于 `0x08004A32` 的最近一行 `Thumb Code` 符号。
2. **使用 Keil `fromelf.exe` 生成带 C 源码交织的反汇编文件**：
   ```powershell
   & "C:\Keil_v5\ARM\ARMCC\bin\fromelf.exe" --text -c -o "Objects\disasm.txt" "Objects\N32G455.axf"
   ```
   打开 `Objects\disasm.txt`，直接搜索 `0x08004a32`（注意区分大小写），即可看到对应的汇编指令及其上方标注的 C 源码函数与语句。

<h2 id="example-hardfault-c">代码范例：examples/hardfault_rtt_dump.c</h2>

```c
/**
 * @file hardfault_rtt_dump.c
 * @brief ARMCC 5 & GCC compatible HardFault stack frame & SCB register dumper.
 */
#include <stdint.h>

/* Replace with SEGGER_RTT_printf(0, ...) or polling UART print */
extern int SEGGER_RTT_printf(unsigned BufferIndex, const char *sFormat, ...);

/* Cortex-M3/M4/M7 System Control Block Fault Registers */
#define SCB_CFSR_REG   (*(volatile uint32_t *)0xE000ED28UL)
#define SCB_HFSR_REG   (*(volatile uint32_t *)0xE000ED2CUL)
#define SCB_DFSR_REG   (*(volatile uint32_t *)0xE000ED30UL)
#define SCB_MMFAR_REG  (*(volatile uint32_t *)0xE000ED34UL)
#define SCB_BFAR_REG   (*(volatile uint32_t *)0xE000ED38UL)
#define DHCSR_REG      (*(volatile uint32_t *)0xE000EDF0UL)

void HardFault_DumpC(const uint32_t *sp, uint32_t excReturn)
{
    uint32_t r0   = sp[0];
    uint32_t r1   = sp[1];
    uint32_t r2   = sp[2];
    uint32_t r3   = sp[3];
    uint32_t r12  = sp[4];
    uint32_t lr   = sp[5];
    uint32_t pc   = sp[6];
    uint32_t xpsr = sp[7];

    uint32_t cfsr  = SCB_CFSR_REG;
    uint32_t hfsr  = SCB_HFSR_REG;
    uint32_t mmfar = SCB_MMFAR_REG;
    uint32_t bfar  = SCB_BFAR_REG;

    (void)SEGGER_RTT_printf(0U, "\r\n=== [HARDFAULT DETECTED] ===\r\n");
    (void)SEGGER_RTT_printf(0U, "SP=%08X EXC_RET=%08X (%s)\r\n",
                            (unsigned)(uintptr_t)sp,
                            (unsigned)excReturn,
                            ((excReturn & 0x04UL) != 0UL) ? "PSP" : "MSP");
    (void)SEGGER_RTT_printf(0U, "PC  = 0x%08X  <-- Fault Instruction\r\n", (unsigned)pc);
    (void)SEGGER_RTT_printf(0U, "LR  = 0x%08X  <-- Caller Return Addr\r\n", (unsigned)lr);
    (void)SEGGER_RTT_printf(0U, "xPSR= 0x%08X  R12 = 0x%08X\r\n", (unsigned)xpsr, (unsigned)r12);
    (void)SEGGER_RTT_printf(0U, "R0  = 0x%08X  R1  = 0x%08X\r\n", (unsigned)r0, (unsigned)r1);
    (void)SEGGER_RTT_printf(0U, "R2  = 0x%08X  R3  = 0x%08X\r\n", (unsigned)r2, (unsigned)r3);
    (void)SEGGER_RTT_printf(0U, "HFSR= 0x%08X  CFSR= 0x%08X\r\n", (unsigned)hfsr, (unsigned)cfsr);

    if ((cfsr & 0x00000080UL) != 0UL)
    {
        (void)SEGGER_RTT_printf(0U, "MMFAR = 0x%08X (Valid)\r\n", (unsigned)mmfar);
    }
    if ((cfsr & 0x00008000UL) != 0UL)
    {
        (void)SEGGER_RTT_printf(0U, "BFAR  = 0x%08X (Valid)\r\n", (unsigned)bfar);
    }

    /* Halt in debugger if SWD debugger is attached */
    if ((DHCSR_REG & 0x01UL) != 0UL)
    {
        __breakpoint(0);
    }

    while (1)
    {
        /* Wait for IWDG reset */
    }
}

#if defined(__CC_ARM)
/* Keil ARMCC 5 naked assembly wrapper */
__asm void HardFault_Handler(void)
{
    TST     lr, #4
    ITE     EQ
    MRSEQ   r0, MSP
    MRSNE   r0, PSP
    MOV     r1, lr
    B       __cpp(HardFault_DumpC)
}
#elif defined(__GNUC__) || defined(__clang__)
/* ARMClang 6 / GCC naked assembly wrapper */
__attribute__((naked)) void HardFault_Handler(void)
{
    __asm volatile(
        "tst lr, #4          \n"
        "ite eq              \n"
        "mrseq r0, msp       \n"
        "mrsne r0, psp       \n"
        "mov r1, lr          \n"
        "b HardFault_DumpC   \n"
    );
}
#endif
```
