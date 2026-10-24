---
layout: skill
title: 单片机片内 Flash 掉电安全参数存储 (mcu-flash-param-storage)
skill_id: mcu-flash-param-storage
description: 在片内 Flash 中用双页追加保存参数，检查擦写停顿、掉电恢复和链接脚本中的分区边界。
category: mcu-baremetal
category_label: 单片机裸机开发
scope: global
target: All MCU (STM32 / GD32 / N32G455 / NXP 片内 Flash)
order: 14
tags:
  - 片内Flash
  - 磨损均衡
  - 掉电安全
  - 链接脚本
---

## SKILL.md 元数据

```yaml
---
name: mcu-flash-param-storage
description: >-
  [Scope: global] 单片机片内 Flash（Internal Flash）双页乒乓掉电安全参数存储、页内追加磨损均衡、擦写期间 CPU 取指停顿（Stall）中断评估与链接脚本边界保护。
  当用户需要在无外部 EEPROM 的 MCU（如 STM32/GD32/N32G455/PIC）上使用片内 Flash 保存配置或校准参数、解决片内擦写阻塞实时中断或掉电丢参问题时使用此技能。
---
```

## 1. 适用范围

- **技术方向**：`mcu-baremetal`
- **使用范围 (Scope)**：`global`（适用于 STM32、GD32、N32G455、NXP 等无独立数据 EEPROM 或使用片内 Flash 模拟 EEPROM 的 MCU）
- **核心硬件差异（对比外部 I2C EEPROM / SPI NOR）**：
  1. **同体取指停顿（Bus Stall）**：当 CPU 从同一片内 Flash Bank 执行代码并对其发起页擦除（`20~40 ms`）或字编程（`20~50 μs`）时，**总线会挂起 CPU 取指（包括中断向量表读取和 ISR 执行）**，直到该次物理操作完成！
  2. **擦除粒度大、寿命较短**：片内 Flash 最小擦除单元通常为 `1 KiB / 2 KiB / 4 KiB`（或大扇区 `16~128 KiB`），擦写寿命多为 `10,000 ~ 100,000` 次。

## 2. 实现方式

1. **链接脚本（`.sct` / `.ld`）硬隔离防代码覆盖**：
   - 将片内 Flash 末尾的 **2 个独立最小擦除页（Page A 与 Page B）** 划为参数专用区，并**同步从工程 `IROM1` Size（或 `.ld` 的 `FLASH LENGTH`）中扣除**，防止固件膨胀后静默覆盖参数区或烧录时误擦除。
2. **双页乒乓（Ping-Pong）+ 页内定长槽顺序追加（Wear Leveling）**：
   - 为避免每次改参数都擦除整页（耗尽 1 万次寿命且每次阻塞 `30 ms`），在 2 KiB 页内按 **定长槽（如 64B，4 字节对齐）顺序追加**。
   - 2 KiB 页可连续追加 `31` 次（仅需百微秒级字编程），直到当前活动页写满后，才将最新有效记录复制到备用空白页、两阶段提交新页头，再擦除旧页。擦写寿命提升 **30 倍以上**。
3. **两阶段提交与 `4-Byte / Half-Word` 对齐写入**：
   - 遵循片内 Flash 最小编程位宽（如 N32G455/STM32F4 为 32-bit Word，STM32F1 为 16-bit Half-Word）。
   - 先编程 `Magic + Version + Sequence + Payload + CRC32`（保持最后一个 32-bit `CommitWord` 为 `0xFFFFFFFF`）并读回内存地址比对；校验无误后再单独将 `CommitWord` 编程为 `0x00000000`。
4. **擦写期间的硬实时中断与看门狗安全门禁**：
   - **禁止在高频采集中途擦除片内页**：页擦除会冻结同 Bank 中断响应长达 `20~40 ms`（例如 2402 Hz 的 AD7190 会丢失约 50~90 个 RDY 中断！）。
   - 片内 Flash 擦写**只允许在非测量空闲态（如退出设置菜单、校准确认页）触发**；擦写前暂停高频外部中断或 DMA，完成后恢复，并在擦除前后确保主循环看门狗余量充足。

> 双页乒乓追加布局、状态转移与片内 Flash 编程加锁模板详见 [references/internal-flash-ab-layout.md](#ref-internal-flash)。

## 3. 操作步骤

1. **核查芯片手册 Flash 物理参数**：
   - 确认片内 Flash 页/扇区大小、擦除态值（通常 `0xFF`）、最小编程位宽（16-bit / 32-bit / 64-bit）、单页擦除最大耗时 `t_ERASE`、以及编程前是否要求 `HSI` 开启。
2. **修改分散加载/链接配置并加编译期静态断言**：
   - 定义 `PARAM_FLASH_PAGE_A_ADDR` 与 `PARAM_FLASH_PAGE_B_ADDR`，断言地址按页边界对齐且 `sizeof(ParamSlot) % 4U == 0U`。
3. **实现带硬件锁与标志清理的底层写接口**：
   - 擦写前执行：检查电源电压正常（无欠压告警） → `FLASH_Unlock()` → **清除所有历史残留错误标志（`PGERR / WRPRTERR / EOP`）** → 执行按字编程/页擦除 → **无论成功或失败均在出口调用 `FLASH_Lock()`**。
4. **实现上电双页扫描与恢复 (`FlashParam_Init`)**：
   - 直接通过指针解引用读取片内映射地址，扫描 Page A 与 Page B 中最后一个 `CommitWord == 0` 且 CRC 正确的有效槽。
   - 若双页同时有效（说明上次换页擦除旧页前掉电），保留含最新 `Sequence` 的新页，并在启动期将旧页补擦为全 `0xFFFFFFFF`。

## 4. 关键安全与并发约束检查清单

- [ ] **禁止指针直接强转未对齐结构体**：按 32-bit Word 编程源缓冲时，源 RAM 缓冲区必须使用 `__align(4)` 或 `uint32_t` 数组承载，防止 Cortex-M0 或编译优化产生非对齐访存异常。
- [ ] **擦写前清除状态标志**：STM32/N32G45x 的 Flash 控制器若残留上一次的 `PGERR`（对非 `0xFFFF` 地址编程触发），后续所有编程指令都会静默失败，每次 `Unlock` 后必须先清除全部状态位。
- [ ] **函数防跑飞保护**：永远不要在正常代码流中裸留 `FLASH_Unlock()`；低压掉电瞬间 CPU PC 指针可能跑飞，保持 `FLASH_Lock()` 是防止片内程序区被意外改写的最后防线。

## 5. 验证方法

1. **链接边界核对**：编译后打开 `.map` 文件，确认 `Execution Region ER_IROM1` 的最高使用地址小于 `PARAM_FLASH_PAGE_A_ADDR`。
2. **换页与掉电恢复验证**：
   - 连续保存 35 次跨越单页 31 槽上限，验证自动触发 Page A → Page B 乒乓切换与旧页擦除；
   - 在换页完成、旧页擦除前注入软复位，验证重启后能识别最新 `Sequence` 并自动补擦旧页。

<h2 id="ref-internal-flash">参考文档：片内 Flash 双页乒乓 + 页内追加存储规范与代码模板 (references/internal-flash-ab-layout.md)</h2>

### 1. 2 KiB 双页乒乓 + 64B 槽追加物理布局

以单页 `2048 B`（如 N32G455 / STM32F103 大容量型）、定长槽 `64 B` 为例：

```text
+-------------------------------------------------------------------+
| Page A (2048 B, e.g. 0x0807F000 ~ 0x0807F7FF)                     |
|  [Slot 0: PageHeader 64B] (Magic, Version, PageEpoch, CommitWord) |
|  [Slot 1: ParamRecord #1] (Seq=1, Payload, CRC32, CommitWord=0)   |
|  [Slot 2: ParamRecord #2] (Seq=2, Payload, CRC32, CommitWord=0)   |
|  ...                                                              |
|  [Slot 31: Erased 0xFFFFFFFF...]                                  |
+-------------------------------------------------------------------+
| Page B (2048 B, e.g. 0x0807F800 ~ 0x0807FFFF)                     |
|  [Entire 2048 B Verified as 0xFFFFFFFF (Standby Blank Page)]      |
+-------------------------------------------------------------------+
```

单个 64 字节参数槽布局（32-bit Word 对齐）：

| 字节偏移 | 长度 | 字段名 | 编程阶段 |
| ---: | ---: | :--- | :--- |
| `0` | 4 B | `magic` (`0x5041524D` `'PARM'`) | 阶段一写入 |
| `4` | 2 B | `version` | 阶段一写入 |
| `6` | 2 B | `payloadLen` | 阶段一写入 |
| `8` | 4 B | `sequence` (单调递增序号) | 阶段一写入 |
| `12` | 44 B | `payload` (设置与校准参数) | 阶段一写入 |
| `56` | 4 B | `crc32` (覆盖偏移 `0 ~ 55`) | 阶段一写入 |
| `60` | 4 B | `commitWord` | 阶段一保持 `0xFFFFFFFF`；阶段二单独编程为 `0x00000000` |

### 2. 换页（Page Transfer）与上电恢复真值表

| Page A 状态 | Page B 状态 | 上电恢复行为 |
| :--- | :--- | :--- |
| `ACTIVE`（含有效槽） | `ERASED`（全 `0xFF`） | 正常态：从 Page A 最后一个已提交有效槽加载参数 |
| `ERASED`（全 `0xFF`） | `ACTIVE`（含有效槽） | 正常态：从 Page B 最后一个已提交有效槽加载参数 |
| `ACTIVE` | `ACTIVE`（换页擦旧页前断电） | 比较两页最后一条有效槽的 `sequence`（无符号半量程差值），以最新页为准，并**立即擦除较旧页**恢复 `ERASED` 备用态 |
| `ACTIVE` | `DIRTY`（换页新页未提交完成即断电） | 以 Page A 旧有效槽为准，擦除 Page B 脏数据恢复 `ERASED` |
| 全空或均无效 | 全空或均无效 | 擦除并初始化 Page A 页头，写入编译期默认参数（`Seq = 1`） |

### 3. 片内 Flash 安全编程包装函数范式

```c
bool InternalFlash_ProgramWords(uint32_t flashAddr, const uint32_t *words, uint32_t wordCount)
{
    bool ok = true;

    /* 1. 对齐与地址范围门禁 */
    if (((flashAddr & 0x03UL) != 0UL) || (words == NULL) ||
        (flashAddr < PARAM_FLASH_START_ADDR) ||
        ((flashAddr + (wordCount * 4UL)) > PARAM_FLASH_END_ADDR))
    {
        return false;
    }

    /* 2. 解锁并清除历史错误标志 */
    FLASH_Unlock();
    FLASH_ClearFlag(FLASH_FLAG_EOP | FLASH_FLAG_PGERR | FLASH_FLAG_WRPRTERR);

    /* 3. 逐字编程并立即读回校验 */
    for (uint32_t i = 0UL; i < wordCount; i++)
    {
        uint32_t targetAddr = flashAddr + (i * 4UL);
        if (FLASH_ProgramWord(targetAddr, words[i]) != FLASH_COMPLETE)
        {
            ok = false;
            break;
        }
        if (*(const volatile uint32_t *)targetAddr != words[i])
        {
            ok = false;
            break;
        }
    }

    /* 4. 任何路径均强制重新上锁 */
    FLASH_Lock();
    return ok;
}
```
