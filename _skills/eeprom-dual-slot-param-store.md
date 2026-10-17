---
layout: skill
title: I2C EEPROM 双槽乒乓参数镜像与双层多段校准 (eeprom-dual-slot-param-store)
skill_id: eeprom-dual-slot-param-store
description: I2C EEPROM（如 M24C02/AT24Cxx）A/B 双槽乒乓掉电安全参数存储、16B 页边界拆分、tWR ACK 轮询与传感器大小量程双层 25 细段线性插值标定。
category: mcu-baremetal
category_label: 单片机裸机开发
scope: global
target: All MCU + I2C EEPROM (M24C02 / AT24Cxx)
order: 9
tags:
  - EEPROM
  - M24C02
  - 双槽乒乓
  - 传感器校准
related_demo: /projects/n32g455-tensile/
---

## SKILL.md 元数据

```yaml
---
name: eeprom-dual-slot-param-store
description: >-
  [Scope: global] I2C EEPROM（如 M24C02/AT24Cxx）A/B 双槽乒乓掉电安全参数存储、16B 页边界拆分、tWR ACK 轮询与双层多段传感器标定曲线管理。
  当用户需要设计嵌入式设备设置与校准参数持久化、解决 EEPROM 跨页覆盖或写入掉电损坏量产标定数据、或实现大小量程多段线性插值校准时使用此技能。
---
```

## 1. 适用范围与背景 (Metadata)

- **技术方向**：`mcu-baremetal`
- **使用范围 (Scope)**：`global`（全平台通用，提炼自 N32G455 + M24C02 + 测力标定系统）
- **适用硬件与场景**：I2C 串行 EEPROM（如 ST M24C02 / AT24C02，256B 容量，16B 页写，内部写周期 `tWR <= 5 ms`）及高精度工业传感器多点分段标定。

## 2. 核心设计模式 (Core Patterns)

1. **A/B 双槽乒乓镜像（Dual-Slot Ping-Pong Image）**：
   - 将 256B EEPROM 对半划分为 **Slot 0 (`0x00~0x7F`, 128B)** 与 **Slot 1 (`0x80~0xFF`, 128B)**。
   - 每个槽包含显式小端头部（`Magic` + `Version` + `Sequence`）、**用户设置区（Settings）**、**传感器标定区（Calibration）** 和尾部 **CRC-16**。
   - **原子保存铁律**：每次 `AppParam_Save()` 永远只写入**非活动槽（或较旧槽）** → **整槽 128B 读回并逐字节比对 + CRC 校验** → 验证完全一致后才更新 RAM 中的活动槽索引与 `Sequence`。写中途掉电绝不破坏另一槽中上一份有效的量产标定参数。
2. **EEPROM 16B 页边界自动拆分与 `tWR` ACK 轮询**：
   - EEPROM 页写若跨越 16B 页尾（`0x0F`, `0x1F`...），内部地址会在**当前页首回绕覆盖旧数据**。驱动层 `M24c02_Write()` 必须按 `16 - (addr & 0x0FU)` 自动切分每次 `Page Write` 长度。
   - 每页 `STOP` 后器件进入内部编程（`tWR <= 5 ms`），期间对地址 NACK。驱动通过周期发送 `START + 0xA0` 执行 **ACK 轮询**（带 10 ms 无符号 tick 超时），一旦收到 ACK 立即发 `STOP` 并进入下一页写入。
3. **设置重置与标定数据解耦保护 (`FactoryReset`)**：
   - 恢复出厂设置（`AppParam_FactoryReset()`）只将 RAM 中的用户菜单设置恢复默认值，**必须完整保留 RAM 中已有的传感器标定数据**，再提交到非活动槽；若 EEPROM 提交失败，必须回滚 RAM 中的用户设置。
4. **双层六点五段（25 细段）传感器标定模型**：
   - 每个方向（拉伸/压缩）维护**大量程六点曲线（`0/20/40/60/80/100% FS`）**与**小量程六点曲线（`0/4/8/12/16/20% FS`）**。
   - 小曲线提供相对非线性细分比例 `q_j = (S_j - S_0) / (S_5 - S_0)`，迁移映射到全部 5 个大量程区间，形成每方向 **25 个高精度线性细段**（实现 `±0.2% FS` 精度）。

> 双槽启动恢复真值表、24-bit 紧凑编码与双层 25 段 `int64_t` 定点插值公式详见 [references/dual-slot-and-calibration-math.md](#ref-dual-slot-math)。

## 3. 核心执行流程 (Step-by-Step Workflow)

1. **驱动层 (`drv_m24c02`) 实现与 I2C 保护**：
   - 配置 SCL/SDA 为开漏输出（依赖外部上拉电阻），所有硬件标志等待均带 `10 ms` 超时；超时后发送 `STOP` 并复位 I2C 外设防总线死锁。
   - 在写函数内实现按 16B 页边界循环切分 + `WaitWriteComplete()` ACK 轮询。
2. **参数存储层 (`app_param_store`) 序列化与自检**：
   - 采用显式字节偏移读写，禁止依赖编译器 `struct` 填充对齐；为节省空间，24-bit 原始 ADC 标定点可按 **3 字节无符号小端（U24 LE）** 紧凑打包（4 套 × 6 点 × 3B = 72B，轻松塞入 128B 单槽）。
   - 编写纯 RAM 自检函数 `AppParam_RunSettingsSelfTest()`，校验字段偏移不重叠、CRC 检测有效、跨版本升级（如 V1 → V2）迁移正确。
3. **标定曲线合法性与降级策略**：
   - 提交标定前强制校验 `AppParam_IsCurveDataValid()`：ADC 码在有效物理范围、拉压共用同一大量程零点（更新任一方向大量程时同步更新另一方向第 0 点）、拉伸点严格递增 / 压缩点严格递减、派生内部细段点无重复或反转。
   - **平滑降级**：大+小曲线均有效 → 启用 25 细段插值；仅大量程有效 → 降级为 5 大段插值；未标定 → 使用理论两点斜率默认曲线。

## 4. 关键安全与并发约束检查清单

- [ ] **单上下文访问**：EEPROM 读写全部在主循环执行，禁止在 ISR 中发起 I2C 传输。
- [ ] **写看门狗预算**：128B 槽共 8 页（`8 × 16B`），最坏写入耗时约 `8 × 5 ms = 40 ms`，远小于 1 s IWDG 窗口；若页数更多，必须改为分步状态机。
- [ ] **定点算术防溢出与截断**：25 段派生与力值线性插值必须遵循**先乘后除**并使用 `int64_t` 中间量，商按向远离零的四舍五入（Half-away-from-zero）处理，大段端点 `D[i][0]` 与 `D[i][5]` 直接取锚点 `L[i]`、`L[i+1]` 消除累积舍入误差。

## 5. 验证与调试方法 (Verification)

1. **RAM 自测与单槽破坏恢复验证**：
   - 上电运行 `AppParam_RunSettingsSelfTest()`。
   - 人为破坏 Slot 0 的 CRC 或 Magic，验证 `AppParam_Load()` 自动回退加载 Slot 1；破坏双槽后验证返回 `APP_PARAM_DEFAULTS` 并加载安全默认值。
2. **标定事务回滚验证**：
   - 在校正向导中途取消或模拟写 EEPROM 失败（如拉高 `WC` 写保护脚），验证旧有效校正曲线分毫无损。

<h2 id="ref-dual-slot-math">参考文档：EEPROM A/B 双槽布局与双层 25 段传感器标定数学规范 (references/dual-slot-and-calibration-math.md)</h2>

### 1. 256B EEPROM A/B 双槽 128B 镜像结构

| 区域 | 槽内偏移 | 长度 | 内容说明 |
| :--- | ---: | ---: | :--- |
| **Header** | `0 ~ 7` | 8 B | `magic` (2B) + `version` (1B, V2=2) + `flags` (1B) + `sequence` (4B, LE) |
| **Settings** | `8 ~ 43` | 36 B | 用户菜单配置（单位、公差、自动归零时间、背光档位、重力加速度、通信速率等） |
| **Calibration** | `44 ~ 119` | 76 B | `rangeIndex` (1B) + 4 个有效位 (`tensionLarge/Small`, `compressionLarge/Small`) + 4 套 × 6 点 × 3B (24-bit ADC 小端码) |
| **Reserved** | `120 ~ 125` | 6 B | 预留扩展，填 `0` 或 `0xFF` |
| **CRC** | `126 ~ 127` | 2 B | 覆盖偏移 `0 ~ 125` 的 CRC-16/MODBUS（小端） |

上电双槽仲裁真值表 (`AppParam_Load`)：

| Slot 0 状态 | Slot 1 状态 | 仲裁行为与返回值 |
| :---: | :---: | :--- |
| 有效 | 无效 | 选用 Slot 0，下次 `Save()` 写 Slot 1；返回 `APP_PARAM_OK` |
| 无效 | 有效 | 选用 Slot 1，下次 `Save()` 写 Slot 0；返回 `APP_PARAM_OK` |
| 有效 | 有效 | 使用无符号半量程差值 `(uint32_t)(seq1 - seq0) < 0x80000000UL` 选出较新槽，下次写较旧槽 |
| 无效 | 无效 | 加载编译期默认设置与理论默认标定曲线；返回 `APP_PARAM_DEFAULTS` |
| I2C 读失败 | I2C 读失败 | 保持默认参数；返回 `APP_PARAM_ERR_IO` |

### 2. M24C02 16B 页边界切分算法

M24C02 内部写缓冲为 16 字节页（页掩码 `0x0F`）。任意起始地址 `addr` 与长度 `len` 的安全切分逻辑：

```c
while (remaining > 0U)
{
    uint16_t pageOffset = currentAddr & 0x0FU;
    uint16_t chunkLen   = 16U - pageOffset;
    if (chunkLen > remaining)
    {
        chunkLen = remaining;
    }

    status = M24c02_WritePage(currentAddr, dataPtr, (uint8_t)chunkLen);
    if (status != M24C02_OK) { return status; }

    status = M24c02_WaitWriteComplete(10U); /* 10ms ACK polling */
    if (status != M24C02_OK) { return status; }

    currentAddr += chunkLen;
    dataPtr     += chunkLen;
    remaining   -= chunkLen;
}
```

### 3. 双层六点五段（25 细段）标定派生与定点插值

- **大量程六点 `L[0..5]`**：对应标称载荷 `0%, 20%, 40%, 60%, 80%, 100% FS`（划分为 5 个 20% FS 大段 `i ∈ [0, 4]`）。
- **小量程六点 `S[0..5]`**：对应标称载荷 `0%, 4%, 8%, 12%, 16%, 20% FS`（划分为 5 个 4% FS 细段 `j ∈ [0, 5]`）。

对第 `i` 个大段（`i = 0..4`）内的第 `j` 个细分点（`j = 0..5`）派生 25 个细段锚点 `D[i][j]`：

1. **端点精确锚定**（防止定点舍入破坏 20% 大段连续性）：
   `D[i][0] = L[i]`，`D[i][5] = L[i+1]`
2. **内部点按小曲线相对 ADC 比例派生**（`j = 1..4`）：
   `D[i][j] = L[i] + RoundHalfAwayFromZero(((S[j] - S[0]) * (L[i+1] - L[i])) / (S[5] - S[0]))`

`int64_t` 向远离零舍入除法实现：

```c
static int32_t Calib_DivRoundHalfAway(int64_t num, int64_t den)
{
    if (den == 0) { return 0; }
    if (den < 0)  { num = -num; den = -den; }

    if (num >= 0)
    {
        return (int32_t)((num + (den / 2)) / den);
    }
    else
    {
        return (int32_t)(-(((-num) + (den / 2)) / den));
    }
}
```

- **合法性门禁**：计算完某方向全部 26 个锚点后，必须验证相邻点满足严格单调（拉伸 `D[i][j] < D[i][j+1]`，压缩 `D[i][j] > D[i][j+1]`），否则拒绝保存。
