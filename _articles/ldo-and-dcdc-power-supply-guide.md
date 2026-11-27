---
layout: article
title: 嵌入式板级电源拓扑与选型：LDO、Buck、Boost 与四开关 Buck-Boost
description: 面向嵌入式硬件设计的板级电源拓扑分析：从 LDO 压差热耗、结温估算与 PDN 退耦阻抗，到 Buck/Boost 伏秒平衡、电感饱和余量、真关断隔离与四开关 Buck-Boost 跨压过渡，结合实时交互仿真与 PCB 布局排查清单。
date: 2026-11-28
category: 嵌入式
tags:
  - 电源管理
  - LDO
  - Buck
  - Boost
  - Buck-Boost
  - DC-DC
  - 硬件基础
---

在嵌入式硬件的首次上电（Bring-up）与联调阶段，电源轨异常往往表现为几类高度一致的故障现象：`12 V` 转 `3.3 V` 采用线性稳压器时，空载输出正常，接入主控与外设后数秒即触发热关断重启；单节锂电池尚在 `3.3 V ~ 3.4 V` 区间，系统却提前发生欠压复位（BOR）；将线性供电替换为开关电源后温升显著下降，但 ADC 采样底噪或射频底噪明显抬升；拉低 Boost 升压芯片的 `EN` 使能脚执行关机，后级电路仍存在持续漏电。

这些问题的根因，本质上对应着板级最常用的四种电源拓扑：**LDO（低压差线性稳压器）**、**Buck（开关降压）**、**Boost（开关升压）**与**四开关 Buck-Boost（升降压）**。厘清每种拓扑的能量守恒关系、瞬态阻抗特性、电感充放磁规律与失效边界，才能在原理图选型与 PCB 布局阶段将风险前置消除。

下文围绕嵌入式典型供电场景（`12 V → 3.3 V`、`5 V → 3.3 V`、单节锂电池 `3.7 V → 5 V` 及 `4.2 V ~ 3.0 V → 3.3 V`）与常见参考器件（如 `AMS1117-3.3`、`TPS63020` 等）展开分析。文中功耗、电流与纹波均为工程数量级算例，实际结温、转换效率与环路相位裕度需结合具体器件手册、封装热阻、PCB 敷铜面积及电感直流电阻（DCR）核算。

## 1. LDO 线性稳压：热耗边界、压差门槛与 PDN 退耦

LDO（Low-Dropout Regulator）外围仅需少量电容即可输出极低纹波的直流电源，在模拟供电与小功率数字轨中不可替代。但其能量转换方式决定了它在高压差或大电流工况下存在严格的热边界。

### 1.1 串联调整管的热耗模型与结温评估

LDO 的核心是一颗受误差放大器闭环控制的串联功率管（PMOS、NMOS 或双极型晶体管）。输入电流除极小的静态电流 `I_q` 外几乎全部流经调整管到达负载（`I_in = I_load + I_q`），输入与输出之间的压差全部以焦耳热的形式耗散在硅片上：

```text
P_loss = (Vin - Vout) × I_load + Vin × I_q
T_j    = T_a + P_loss × R_θJA
```

工程评估不能只看耗散功率，还必须结合封装热阻 `R_θJA`（例如常见 `SOT-23-5` 约为 `180 ~ 220 °C/W`，带敷铜的 `SOT-223` 约为 `60 ~ 110 °C/W`）与最高环境温度 `T_a`（开放桌面按 `25 °C`，密闭机壳内常需按 `55 ~ 70 °C` 核算），确保结温 `T_j` 留足安全余量（通常低于 `125 °C`）。以下三组典型工况的差距非常直观：

| 工况算例 | 压差 `Vin - Vout` | 输出功率 `P_out` | 耗散功率 `P_loss` | 理论效率 `η ≈ Vout/Vin` | 热设计评估（以典型封装估算） |
| --- | --- | --- | --- | --- | --- |
| `5 V → 3.3 V @ 50 mA` | `1.7 V` | `0.165 W` | `0.085 W` | `66.0%` | `SOT-23-5` 温升约 `15 ~ 19 °C`，热裕量充足 |
| `5 V → 3.3 V @ 500 mA` | `1.7 V` | `1.65 W` | `0.85 W` | `66.0%` | `SOT-223` 温升可达 `50 ~ 90 °C`，需大面积敷铜并核算密闭环境 `T_a` |
| `12 V → 3.3 V @ 1.0 A` | `8.7 V` | `3.30 W` | `8.70 W` | `27.5%` | **超出常规贴片封装散热极限**，无独立散热器数秒即触发热关断 |

除热耗外，LDO 选型还需同时核对两项压差相关约束：

- **最小压差（Dropout Voltage，`V_dropout`）**：输入电压必须始终满足 `Vin ≥ Vout + V_dropout` 才能维持稳压。传统双极型/准 LDO（如 `AMS1117-3.3`）在满载时压差高达 `1.1 V ~ 1.3 V`，输入低于 `4.4 V` 即退出稳压区，无法用于单节锂电池降压；电池供电场景需选用 `V_dropout` 在 `100 ~ 300 mV` 量级的 CMOS LDO。
- **PSRR（电源抑制比）的压差与频率边界**：当 `Vin - Vout` 逼近 `V_dropout` 时，内部调整管进入线性区，环路增益大幅下降，LDO 的 PSRR 会迅速劣化；同时，大多数通用 LDO 的 PSRR 在数百 kHz 以上明显滚降。若用于滤除前级开关电源的纹波，必须同时留足压差裕量（通常建议 `≥ 0.5 V`）并核对开关频率点对应的 PSRR 曲线。

### 1.2 瞬态响应、PDN 阻抗与退耦电容布局

即使平均负载电流很小，仅靠 LDO 自身环路仍无法满足高速数字芯片的瞬态供电需求。当 MCU 内核时钟沿同步翻转、射频发射或 IO 集中切换时，负载电流会在纳秒至微秒级发生阶跃。受限于误差放大器带宽，LDO 环路响应存在微秒级滞后，期间供电轨的压降（`ΔV = L · di/dt`）完全取决于本地电源分配网络（PDN）的阻抗。

工程上通过**大容量储能电容与小容量高频陶瓷电容并联**，在宽频段内压低 PDN 阻抗：

- **大容量电容（如 `10 μF ~ 22 μF`）**：承担微秒至毫秒级的中低频能量缓冲，在 LDO 环路建立前抑制母线跌落；但由于物理封装较大、等效串联电感（ESL）较高，在数十 MHz 以上频段呈现感性阻抗，高频退耦能力有限。
- **小容量陶瓷电容（如 `100 nF / 0.1 μF`）**：封装小、ESL 低、自谐振频率（SRF）高，负责在纳秒级为芯片电源引脚提供最低电感路径的局部高频电流回路。

```text
推荐布线：电源走线 ──> [10 μF 储能] ──> [100 nF 紧贴引脚焊盘] ──> [MCU VDD]
                                                 │
                                                GND（就近打过孔回完整地平面）

错误布线：电源走线 ──────────> [MCU VDD] ──(长走线引入寄生电感)──> [100 nF]
```

原理图与 PCB 阶段需落实两项细节：

1. **最小化高频回路电感**：`100 nF` 退耦电容必须紧贴芯片 `VDD` 引脚摆放，电源路径先经电容焊盘再进入引脚，接地端就近打孔直连完整参考地平面。常规 PCB 细走线每毫米约引入 `0.5 ~ 1 nH` 寄生电感，若退耦电容远离芯片数厘米，高频瞬态补电通路将被串联电感阻断。
2. **核对旧架构 LDO 的输出电容 ESR 窗口**：部分早期双极型稳压器（如 `AMS1117`）依赖输出电容的等效串联电阻（ESR）提供环路补偿零点；若全部替换为超低 ESR 的多层陶瓷电容（MLCC），可能破坏相位裕度并诱发输出振荡。选型时务必确认手册是否标明“支持陶瓷电容稳定（Ceramic Stable）”或明确的 ESR 允许区间。

---

## 2. Buck 开关降压：伏秒平衡、损耗构成与级联滤波

LDO 发热的根源在于调整管持续工作在线性放大区并承担全部压差。开关电源（SMPS）通过让功率器件在极低导通损耗的**饱和导通态**与电流为零的**截止态**之间高速切换，从机理上消除了压差热耗。

### 2.1 开关降压机理与两拍储能循环

Buck 降压变换器的核心由功率 MOSFET、功率电感、续流支路与输出滤波电容组成，典型开关频率在 `300 kHz ~ 2.2 MHz` 之间：

```text
       Q1 (上管 MOS)           L (功率电感)
Vin ──────[ 开关 ]──────┬───────UUUUUU───────┬────> Vout (3.3 V)
                        │ SW                 │
                   [ D / Q2 ]             [ Cout ]  [ 负载 ]
                   续流二极管或              滤波电容   (1 A)
                   同步下管 MOS              │         │
GND ────────────────────┴────────────────────┴─────────┘
```

在连续导通模式（CCM）下，一个开关周期 `T = 1 / f_sw` 分为两个阶段：

- **拍① 导通储能（`Ton`）**：上管 `Q1` 导通，开关节点 `SW` 被拉升至 `Vin`，电感两端承受正向压差 `Vin - Vout`（左正右负）。电感电流以斜率 `di/dt = (Vin - Vout) / L` 线性上升，同时向负载供电并将多余能量储存在磁场中。
- **拍② 关断续流（`Toff`）**：`Q1` 关断，由于电感电流不能突变，电感两端电压极性迅速反转（左负右正），使续流二极管 `D` 正偏导通（或由控制器在死区时间后开启同步下管 `Q2`），通过地回路将磁场储能继续释放给负载，电流以斜率 `di/dt = -Vout / L` 线性下降。

根据稳态下电感两端净伏秒积为零（**伏秒平衡**），`(Vin - Vout) · Ton = Vout · Toff`，可得理想占空比与电感纹波电流关系：

```text
D    = Ton / T = Vout / Vin
ΔI_L = Vout × (1 - D) / (L × f_sw)
```

输出电容 `Cout` 滤除锯齿状电感电流中的交流分量 `ΔI_L`，输出平稳直流；反馈网络 `FB` 持续采样输出电压并动态调整占空比 `D` 以应对输入波动和负载阶跃。工程上通常将额定负载下的 `ΔI_L` 控制在最大输出电流的 `20% ~ 40%` 之间，以平衡电感体积、核心损耗与瞬态响应速度。

> **同步整流与开关损耗权衡**：异步 Buck 采用肖特基二极管续流，其 `0.3 V ~ 0.5 V` 的正向压降在 `3.3 V` 或更低输出电压、大电流工况下会造成显著导通损耗；现代主流芯片普遍采用**同步 Buck（Synchronous Buck）**，以低 `R_DS(on)` 的下管 N-MOSFET 替代二极管（并在上下管切换间插入纳秒级死区以防直通），典型效率可达 `88% ~ 95%`。此外，MOSFET 并非绝对零损耗——其损耗由导通损耗（`I² · R_DS(on)`）、开关交越损耗与栅极驱动损耗共同构成，提高 `f_sw` 可缩小电感和电容体积，但会同步推高开关损耗与 EMI。

### 2.2 功率账本对比与 Buck + LDO 级联架构

重新核算 `12 V → 3.3 V @ 1 A`（输出功率 `3.30 W`）的能量去向：

- **LDO**：输入与输出串联，输出 `1 A` 即从 `12 V` 母线抽取 `1 A`（输入 `12.0 W`），芯片自身耗散 **`8.70 W`**。
- **同步 Buck**：仅在约 `27.5%` 的周期内从 `12 V` 取电，其余时间依靠电感经地回路续流。按 `90%` 综合效率估算，输入总功率约 `3.67 W`，`12 V` 侧平均电流仅 **`0.31 A`**，整套电路热损耗仅 **`0.37 W`**，较 LDO 下降超过 20 倍。

Buck 的物理本质是以**高压小电流换取低压大电流**，其工程代价体现在两方面：一是输出存在毫伏至数十毫伏级开关纹波，且高速切换的 `SW` 节点与功率热回路会带来传导与辐射 EMI；二是需外置功率电感与滤波电容，BOM 成本与占板面积高于 LDO。

在混合信号板卡中，最稳健的架构是 **Buck + LDO 级联供电**：前级用 Buck 高效承担主要压降（例如 `12 V → 3.8 V` 或 `5 V`）以控制整板温升，后级为高精度 ADC 参考源、模拟前端、音频或射频电路独立配置高 PSRR 的 LDO 稳压至 `3.3 V`。设计该级联时需注意留足 LDO 的压差裕量（如 `3.8 V → 3.3 V` 提供 `0.5 V` 余量以维持高 PSRR），若前级开关频率高于 LDO 的有效抑制频段，可在两级之间串入铁氧体磁珠或 LC 滤波器进一步衰减高频谐波。

---

## 3. Boost 开关升压：串联泵升与输入侧电流约束

单节锂电池标称电压为 `3.7 V`，当系统需要为 USB 接口、特定传感器或背光模组提供 `5 V` 或更高电压轨时，线性调节器和 Buck 均无法满足需求，必须采用 Boost 升压拓扑，利用电感断电时的反向电动势与输入源串联叠加来抬升电压。

### 3.1 电感储能与串联泵升机理

将功率开关管移至电感输出侧对地，并串联单向续流支路，即构成 Boost 拓扑：

```text
             L (功率电感)       D / Q2 (单向阀/同步管)
Vin (3.7V) ────UUUUUU────┬─────────|>|────────┬────> Vout (5.0 V)
                         │ SW                 │
                     [ Q1 开关 ]           [ Cout ]  [ 负载 ]
                     (接地 MOS)            滤波电容   (1 A)
                         │                    │         │
GND ─────────────────────┴────────────────────┴─────────┘
```

- **拍① 接地储能（`Ton`）**：低边开关 `Q1` 导通，将电感右端拉至地。由于电感阻碍电流突变，电池并不会形成硬短路，而是以 `di/dt = Vin / L` 的受控斜率向电感充磁；此时续流二极管 `D`（或同步上管 `Q2`）处于反偏关断状态，隔离已充电至 `5 V` 的输出电容 `Cout` 防止倒灌，负载电流暂由 `Cout` 提供。
- **拍② 串联释能（`Toff`）**：`Q1` 关断，电感电流维持原方向并使右端电位迅速抬升（极性反转为左负右正），与输入电源 `Vin` 首尾串联叠加。总电压高于 `Vout` 后导通 `D/Q2`，将磁场能量泵入 `Cout` 与负载。

由 CCM 稳态伏秒平衡 `Vin · Ton = (Vout - Vin) · Toff`，可得理想升压比与占空比关系：

```text
Vout = Vin / (1 - D)      ⇒      D = 1 - Vin / Vout
```

当锂电池电压从满电 `4.2 V` 跌落至 `3.2 V` 时，反馈环路自动将占空比 `D` 从约 `16%` 扩展至 `36%`，维持 `5.0 V` 输出恒定。

> **实际升压比与动态响应约束**：理论公式在 `D → 1` 时趋于无穷大，但实际电路中电感 DCR 与开关 `R_DS(on)` 的寄生损耗会在高占空比下急剧放大，通常不建议单级 Boost 的稳态占空比长期超过 `80% ~ 85%`。此外，CCM 模式的 Boost 在传递函数中天然存在**右半平面零点（RHPZ）**，会限制环路穿越频率，因此其负载瞬态响应速度通常慢于同等规格的 Buck，需配置更充裕的输出电容。

### 3.2 输入侧电流放大与两项高频失效风险

与 Buck 镜像，Boost 的本质是**低压大电流换取高压小电流**。以 `5 V / 1 A`（`5.0 W`）输出、`η = 90%` 估算，输入功率约为 `5.56 W`；在 `3.7 V` 标称电压下输入平均电流达 **`1.50 A`**，电池跌至 `3.2 V` 时输入平均电流进一步升至 **`1.74 A`**。这一特性直接衍生出两项高频失效风险：

1. **按输出电流选型电感导致磁饱和**
   Boost 的功率电感串联在**输入侧**，承受的是更高的输入平均电流叠加半个纹波峰峰值：
   ```text
   I_in_avg ≈ (Vout × I_load) / (Vin × η)
   I_L_peak = I_in_avg + ΔI_L / 2
   ```
   在 `3.2 V → 5 V @ 1 A` 工况下，电感峰值电流轻松达到 `2.1 ~ 2.4 A`。电感选型必须以**最低输入电压、最大负载时的峰值电流**为基准，再留出至少 `30%` 余量校核**饱和电流 `I_sat`**。一旦磁芯饱和，电感量骤降，电流斜率瞬间失控，极易在限流保护动作前击穿内部开关管。
2. **关断直通路径引发休眠漏电与短路失控**
   观察拓扑结构可知，`Vin → L → D（或同步上管体二极管）→ Vout` 是一条天然存在的直流直通路径。普通异步 Boost 芯片即使拉低 `EN` 关断 `Q1`，输入电压仍会经二极管压降后直达输出端——这不仅导致设备待机时后级电路持续耗电，更意味着一旦输出端发生对地短路，芯片无法通过关断 `Q1` 切断故障电流。电池供电产品选用 Boost IC 时，必须确认器件支持 **True Shutdown / Output Disconnect（真关断隔离）**，否则应在输入前端增设高边负载开关。

---

## 4. 四开关 Buck-Boost：跨压过渡模态与选型边界

单节锂电池工作区间为 `4.2 V ~ 3.0 V`，而绝大多数 MCU、Flash 与外设工作在 `3.3 V`。输入电压在放电过程中必然跨越 `3.3 V`：高于 `3.3 V` 时需要降压，低于 `3.3 V` 时需要升压。纯 Buck 在电池低于 `3.4 V` 时即因压差不足掉压，纯 Boost 在满电 `4.2 V` 时则无法将输出压低至 `3.3 V`。

### 4.1 单电感 H 桥结构与三段工作模态

若直接级联一颗 Buck 与一颗 Boost，不仅需要两颗功率电感，还会叠加两级转换损耗。工程上将两级合并共用同一颗电感，并以四颗受控同步 MOSFET（`Q1`、`Q2`、`Q3`、`Q4`）替代续流二极管，构成**四开关 Buck-Boost（4-Switch Buck-Boost）**拓扑：

```text
Vin ────[ Q1 ]────┬────UUUUUU────┬────[ Q3 ]────> Vout (3.3 V)
                  │ SW1  L   SW2 │        │
                [ Q2 ]         [ Q4 ]   [ Cout ]
                  │              │        │
GND ──────────────┴──────────────┴────────┴──────
```

控制器根据 `Vin` 与 `Vout` 的相对关系自动调度三种模态：

1. **Buck 模式（`Vin` 明显高于 `Vout`，如 `4.2 V`）**：右侧上管 `Q3` 常通、下管 `Q4` 关断；左侧 `Q1/Q2` 同步斩波，等效为标准同步 Buck。
2. **Boost 模式（`Vin` 明显低于 `Vout`，如 `3.0 V`）**：左侧上管 `Q1` 常通、下管 `Q2` 关断；右侧 `Q4/Q3` 同步升压，等效为标准同步 Boost。
3. **跨压过渡区（`Vin ≈ Vout` 附近）**：受限于功率管与驱动电路的最小导通时间（`t_on(min)`）与最小关断时间（`t_off(min)`），纯 Buck 无法实现严格 `100%` 占空比，纯 Boost 也无法实现严格 `0%` 占空比。若在 `Vin = 3.30 V` 处直接硬切换模式，微小的输入波动就会引发 Buck 与 Boost 频繁来回跳变，造成输出电压大幅扰动。

### 4.2 四开关过渡控制：平滑跨越 `Vin ≈ Vout`

为消除 `Vin ≈ Vout` 处的控制死区，四开关 Buck-Boost 在跨压区间启用**四开关升降压过渡模态**（或逐周期交替 Buck/Boost 调制），使输入与输出通过电感解耦：

- **拍① 充磁储能**：对角开关 **`Q1 + Q4`** 导通，`Q2 + Q3` 关断。输出端由 `Q3` 隔离、暂由 `Cout` 维持，输入源经 `Q1`、电感与 `Q4` 对地形成回路，向电感储存磁场能量。
- **拍② 释能输出**：切换至另一组对角开关 **`Q2 + Q3`** 导通，`Q1 + Q4` 关断。输入端被 `Q1` 隔离，电感极性反转并借地回路将磁场能量全部推送至 `Cout` 与负载。

该模态下输入与输出的理想传递关系为：

```text
Vout / Vin = D / (1 - D)
```

当 `D < 50%` 时输出低于输入，`D = 50%` 时实现等压输出，`D > 50%` 时输出高于输入，从而在 `Vin` 跨越 `3.3 V` 时实现连续无扰动调节。目前主流方案（如 `TPS63020`、`TPS63802` 等）已将四颗功率管与控制逻辑集成于单颗 `QFN` 封装内，外围仍只需配置一颗功率电感。

### 4.3 工程取舍：四开关 Buck-Boost 的适用边界

尽管四开关 Buck-Boost 覆盖了全压段，但在实际产品中不应盲目作为默认方案。从成本与效率账本来看，四开关架构器件单价更高；由于主电流路径始终串联两颗 MOSFET（`Q1` 与 `Q3`），且在跨压过渡区四管全部参与开关动作，其导通损耗、开关损耗与轻载静态功耗往往劣于同规格的单级 Buck 或超低压差 LDO。

结合常见三元锂电池的放电特性：从 `4.2 V` 放电至 `3.5 V` 通常已释放约 **`85% ~ 90%`** 的有效容量，`3.5 V` 以下电压迅速进入陡降区。因此，对于普通低功耗 MCU 设备，选用 `V_dropout ≈ 100 mV` 的超低压差 LDO（`3.4 V` 关机保护），或直接将系统主供电轨定义为 `3.0 V / 2.8 V` 配合单级 Buck，往往在整机续航与 BOM 成本上更具优势。

真正有必要引入四开关 Buck-Boost 的典型工程场景包括：

- **强脉冲负载防欠压复位**：Wi-Fi、4G Cat.1、电机或蜂鸣器在发射/启动瞬间产生安培级脉冲电流，受电池内阻与保护板阻抗影响，端电压瞬间跌落至 `3.1 V` 以下，需靠升降压维持 `3.3 V` 主控轨不跌落；
- **3 节干电池或磷酸铁锂（LiFePO4）供电**：3 节碱性电池电压范围为 `4.5 V ~ 2.7 V`，`3.3 V` 恰好位于放电平台中段，仅用降压会浪费大量可用电量；
- **车载 `12 V` 供电系统**：冷启动（Cold Crank）瞬间母线可跌至 `6 V` 左右，正常发电约 `14.4 V`，并伴随抛负载冲击，需要宽输入范围升降压稳住中间母线；
- **USB PD 快充与双向能量变换**：需要在 `5 V ~ 20 V` 多档位输入与多串电池组之间实现升降压与双向充放电。

---

## 5. 交互实验台：板级电源拓扑、热耗与电感波形仿真

下方仿真器将 LDO、Buck、Boost、四开关 Buck-Boost 及 Buck+LDO 级联架构整合在同一工作台。可一键加载文内算例，手动切换 **拍① 充能 / 拍② 释能** 观察开关导通回路与电感极性反转，或调节输入电压、目标输出、负载电流、电感值与开关频率，实时验证热耗结温、电感纹波斜率及 `I_sat` 饱和告警。

<div class="article-interactive-widget" id="power-topo-demo-app" aria-label="LDO、Buck、Boost、四开关 Buck-Boost 与 Buck+LDO 级联实时电源实验台">
  <div class="aiw-header">
    <span class="aiw-badge">INTERACTIVE LAB · 板级电源拓扑与波形仿真实验台</span>
    <h3 class="aiw-title">LDO / Buck / Boost / 四开关 Buck-Boost 实时拓扑、热耗与三通道示波器</h3>
    <p class="aiw-desc">支持五种供电架构、<strong>锂电 4.2V→2.8V 放电扫描</strong>、<strong>电感饱和 / 退耦失效 / 关断直通故障注入</strong>与<strong>三通道游标示波器</strong>。静止零后台轮询，切屏或滚出视口自动休眠。</p>
  </div>
  <div class="aiw-body">
    <div class="pwr-top-bar">
      <div class="pwr-switch-box">
        <span class="pwr-switch-label">电源拓扑架构</span>
        <div class="pwr-seg" role="radiogroup" aria-label="电源拓扑选择">
          <button type="button" class="pwr-topo-btn" role="radio" aria-checked="false" data-topo="ldo">LDO 线性</button>
          <button type="button" class="pwr-topo-btn is-active" role="radio" aria-checked="true" data-topo="buck">Buck 降压</button>
          <button type="button" class="pwr-topo-btn" role="radio" aria-checked="false" data-topo="boost">Boost 升压</button>
          <button type="button" class="pwr-topo-btn" role="radio" aria-checked="false" data-topo="buckboost">四开关升降压</button>
          <button type="button" class="pwr-topo-btn" role="radio" aria-checked="false" data-topo="combo">Buck+LDO 级联</button>
        </div>
      </div>
      <div class="pwr-switch-box">
        <span class="pwr-switch-label">开关拍态与扫描控制</span>
        <div class="pwr-seg" role="group" aria-label="拍态与扫描控制">
          <button type="button" class="pwr-phase-btn is-active" data-phase="1" aria-pressed="true">拍① 充能</button>
          <button type="button" class="pwr-phase-btn" data-phase="2" aria-pressed="false">拍② 释能</button>
          <button type="button" class="pwr-phase-btn" id="pwr-btn-auto" data-auto="toggle" aria-pressed="false">慢放</button>
          <button type="button" class="pwr-phase-btn pwr-sweep-btn" id="pwr-btn-sweep" aria-pressed="false">锂电扫描 4.2→2.8V</button>
        </div>
      </div>
    </div>

    <div class="pwr-action-row">
      <div class="pwr-action-group">
        <div class="aiw-section-title">
          <span>典型工程工况预设</span>
          <span class="aiw-hint">一键对照文内核心算例</span>
        </div>
        <div class="pwr-seg">
          <button type="button" class="pwr-preset-btn" data-preset="ldo-hot">LDO 12→3.3V (8.7W 过热)</button>
          <button type="button" class="pwr-preset-btn" data-preset="buck-cool">Buck 12→3.3V (0.37W)</button>
          <button type="button" class="pwr-preset-btn" data-preset="combo-clean">Buck+LDO 级联滤波</button>
          <button type="button" class="pwr-preset-btn" data-preset="boost-5v">Boost 3.7→5V (1.5A)</button>
          <button type="button" class="pwr-preset-btn" data-preset="bb-cross">四开关 3.3V 跨压过渡</button>
          <button type="button" class="pwr-preset-btn" data-preset="bb-low">四开关 3.0V 自动升压</button>
        </div>
      </div>

      <div class="pwr-action-group">
        <div class="aiw-section-title">
          <span>硬件故障注入</span>
          <span class="aiw-hint">复现典型失效与异常波形</span>
        </div>
        <div class="pwr-seg" role="group" aria-label="故障注入实验开关">
          <button type="button" class="pwr-fault-btn" id="pwr-fault-sat" aria-pressed="false">电感磁饱和 (I_sat=1.5A)</button>
          <button type="button" class="pwr-fault-btn" id="pwr-fault-cap" aria-pressed="false">缺失 100nF / 长走线</button>
          <button type="button" class="pwr-fault-btn" id="pwr-fault-en" aria-pressed="false">拉低 EN 关断 (测直通)</button>
        </div>
      </div>
    </div>

    <div class="aiw-stats" aria-label="电源实时仿真核心指标">
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">工作模态 / 占空比</span>
        <span class="aiw-stat-value accent" id="pwr-stat-mode">Buck CCM · D = 27.5%</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">输入电流 / 转换效率</span>
        <span class="aiw-stat-value" id="pwr-stat-iin">0.31 A · η 90.0%</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">热损耗 / 估算结温 Tj</span>
        <span class="aiw-stat-value" id="pwr-stat-loss">0.37 W · ~42 °C</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">电感峰值 / 输出纹波</span>
        <span class="aiw-stat-value" id="pwr-stat-peak">1.24 A / 14 mVpp</span>
      </div>
    </div>

    <div class="pwr-energy-card" aria-label="输入功率去向与温升比例">
      <div class="pwr-energy-head">
        <span id="pwr-energy-title">能量账本：P_in = 3.67 W → 有效输出 3.30 W (90.0%) + 发热损耗 0.37 W (10.0%)</span>
        <span class="pwr-thermal-pill is-ok" id="pwr-thermal-pill">温升安全 · Tj ≈ 42 °C</span>
      </div>
      <div class="pwr-energy-track" role="img" aria-label="有效输出与热损耗占比条">
        <div class="pwr-energy-out" id="pwr-bar-out" style="width:90%"></div>
        <div class="pwr-energy-loss" id="pwr-bar-loss" style="width:10%"></div>
      </div>
      <div class="pwr-energy-foot">
        <span id="pwr-compare-hint">同工况若改用 LDO：热耗将飙升至 8.70 W（约 23.5× 发热）</span>
        <span id="pwr-isat-hint">推荐电感 I_sat ≥ 1.61 A</span>
      </div>
    </div>

    <div class="pwr-visual-grid">
      <div class="pwr-diagram-card">
        <div class="aiw-section-title">
          <span id="pwr-topo-heading">电路拓扑与当前拍态电流回路</span>
          <span class="aiw-hint" id="pwr-topo-hint">流动实线 = 当前导通回路 · 虚线 = 关断隔离</span>
        </div>
        <svg class="pwr-diagram-svg" id="pwr-topo-svg" viewBox="0 0 680 236" role="img" aria-label="电源拓扑与开关拍态实时示意图"></svg>
      </div>

      <div class="pwr-diagram-card">
        <div class="aiw-section-title">
          <span id="pwr-scope-heading">三通道示波器：V_SW · I_L · V_out 纹波</span>
          <span class="aiw-hint" id="pwr-scope-hint">悬停或拖动波形可读取瞬时游标数值</span>
        </div>
        <div class="pwr-scope-readout" id="pwr-scope-readout" aria-live="off">
          <span class="pwr-ch-pill ch1" id="pwr-ro-ch1">CH1 V_SW: 12.0 V</span>
          <span class="pwr-ch-pill ch2" id="pwr-ro-ch2">CH2 I_L: 1.00 A (Δ 0.48 A)</span>
          <span class="pwr-ch-pill ch3" id="pwr-ro-ch3">CH3 V_out AC: ±7.0 mV</span>
          <span class="pwr-ch-pill ch-t" id="pwr-ro-time">周期 T = 2.00 μs</span>
        </div>
        <div class="pwr-canvas-wrap">
          <canvas id="pwr-scope-canvas" width="680" height="252" aria-label="实时三通道数字示波器波形画布"></canvas>
        </div>
      </div>
    </div>

    <div class="pwr-controls-grid">
      <div class="pwr-slider-field">
        <div class="pwr-slider-head">
          <label for="pwr-input-vin">输入电压 Vin</label>
          <strong id="pwr-val-vin">12.0 V</strong>
        </div>
        <input type="range" id="pwr-input-vin" min="2.5" max="24.0" step="0.1" value="12.0">
      </div>
      <div class="pwr-slider-field">
        <div class="pwr-slider-head">
          <label for="pwr-input-vout">目标输出 Vout</label>
          <strong id="pwr-val-vout">3.3 V</strong>
        </div>
        <input type="range" id="pwr-input-vout" min="1.8" max="12.0" step="0.1" value="3.3">
      </div>
      <div class="pwr-slider-field">
        <div class="pwr-slider-head">
          <label for="pwr-input-iload">负载电流 I_load</label>
          <strong id="pwr-val-iload">1.00 A</strong>
        </div>
        <input type="range" id="pwr-input-iload" min="0.05" max="3.00" step="0.05" value="1.00">
      </div>
      <div class="pwr-slider-field" id="pwr-field-ind">
        <div class="pwr-slider-head">
          <label for="pwr-input-ind">功率电感 L</label>
          <strong id="pwr-val-ind">10.0 μH</strong>
        </div>
        <input type="range" id="pwr-input-ind" min="1.0" max="47.0" step="0.5" value="10.0">
      </div>
      <div class="pwr-slider-field" id="pwr-field-fsw">
        <div class="pwr-slider-head">
          <label for="pwr-input-fsw">开关频率 f_sw</label>
          <strong id="pwr-val-fsw">500 kHz</strong>
        </div>
        <input type="range" id="pwr-input-fsw" min="200" max="2000" step="50" value="500">
      </div>
      <div class="pwr-slider-field">
        <div class="pwr-slider-head">
          <label for="pwr-input-grade">器件特性与工艺</label>
        </div>
        <select id="pwr-input-grade" class="pwr-select">
          <option value="sync90" selected>同步开关 (~90%) / CMOS LDO (0.25V 压差)</option>
          <option value="async82">异步肖特基 (~82%) / 常规 1117 LDO (1.1V 压差)</option>
          <option value="high94">高效同步 (~94%) / 超低压差 LDO (0.12V 压差)</option>
        </select>
      </div>
    </div>

    <div class="pwr-diag-box is-ok" id="pwr-diag-box" aria-live="polite"></div>
  </div>
</div>

---

## 6. 拓扑选型矩阵、无源器件降额与 PCB 布局排查

### 6.1 四种电源拓扑选型对比

| 拓扑类型 | 适用电压关系 | 能量变换机制 | 典型效率与热表现 | 纹波与 EMI | 典型应用与工程边界 |
| --- | --- | --- | --- | --- | --- |
| **LDO 线性** | `Vin ≥ Vout + V_dropout` | 串联调整管线性耗散压差 | `η ≈ Vout / Vin`，高压差/大电流热耗高 | **极低**（无开关纹波，中低频高 PSRR） | 小压差低功耗轨、高精度 ADC / 运放 / 射频后级稳压；关注 `R_θJA` 与 `V_dropout` |
| **Buck 降压** | `Vin > Vout` | 高频斩波 + 电感续流，高压小流换低压大流 | 典型 `85% ~ 95%`，温升低 | 中等（存在开关纹波与 `SW` 节点辐射） | `12 V / 24 V → 5 V / 3.3 V`、大电流主电源轨、锂电降压 |
| **Boost 升压** | `Vin < Vout` | 电感储能 + 串联泵升，低压大流换高压小流 | 典型 `85% ~ 93%`，输入侧峰值电流高 | 较高（输出电流脉动，对 `Cout` ESR 敏感） | `3.7 V → 5 V` 接口供电、背光/传感器升压；严控 `I_sat` 与真关断隔离 |
| **四开关 Buck-Boost** | `Vin` 可大于、等于或小于 `Vout` | 单电感 H 桥三模态切换，跨压区四管解耦 | 典型 `85% ~ 93%`（跨压区略低） | 中等，IC 成本与导通损耗高于单级拓扑 | 脉冲负载防掉压、3 节干电池/磷酸铁锂、车载 `12 V` 宽压、USB PD 双向变换 |

### 6.2 无源器件降额与 PCB 布局关键约束

1. **电感同步校核 `I_sat` 与 `I_rms`**：`I_sat`（饱和电流，通常以感值跌落 `20% ~ 30%` 定义）决定磁芯在峰值电流下是否失感，设计时应按最恶劣工况（Boost 取最低 `Vin`、Buck 取最高 `Vin`）的电感峰值电流留出至少 `1.3×` 余量；`I_rms`（温升电流，通常对应 `ΔT = 40 °C`）决定绕组长期通流时的铜损温升，两者不可混用。
2. **MLCC 核算直流偏置（DC-Bias）降额**：高介电常数（Class II，如 X5R/X7R）陶瓷电容在施加直流电压时有效容值会显著衰减——一颗 `10 μF / 10 V / 0603` 的 X5R 电容在 `5 V` 偏置下真实容值可能不足标称值的一半。开关电源输入/输出滤波电容耐压一般按工作电压的 `1.5× ~ 2×` 选取，并结合原厂 DC-Bias 曲线核对工作点有效容值。
3. **压缩高 `di/dt` 功率热回路面积**：
   - **Buck 热回路**：**输入电容 `Cin` → 上管 `Q1` → 下管 `Q2 / D` → `Cin` 地端**。`Cin` 必须紧贴芯片 `VIN` 与 `PGND` 引脚，减小环路寄生电感以抑制 `SW` 节点过冲振铃；
   - **Boost 热回路**：**低边开关 `Q1` → 续流管 `D / Q2` → 输出电容 `Cout` → `PGND`**。`Cout` 必须紧贴输出引脚与功率地回流端，防止输出端出现高频尖峰。
4. **收紧 `SW` 节点面积并隔离 `FB` 反馈走线**：`SW` 节点存在极高的 `dv/dt`，铜皮在满足载流与散热前提下应尽量紧凑，避免形成大面积寄生电容向周边耦合噪声；`FB` 分压电阻需紧贴芯片 `FB` 引脚放置，输出取样走线从输出电容后端单点引出，严禁穿越电感正下方或平行紧贴 `SW` 节点。

### 6.3 板级供电异常排查清单

| 异常现象 | 优先量测与核对动作 | 典型根因与工程对策 |
| --- | --- | --- |
| **LDO 过热或周期性重启** | 核算 `(Vin - Vout) × I_load` 与 `T_j = T_a + P_loss × R_θJA`，实测负载瞬时与稳态电流 | 耗散功率超出封装散热能力触发热关断；前级改用 Buck 预降压，或更换低热阻封装并扩大散热敷铜 |
| **切换 Buck 后 ADC 底噪抬升或射频灵敏度下降** | 示波器开启 `20 MHz` 带宽限制，采用 AC 耦合 + 短接地弹簧针（禁用长鳄鱼夹地线）实测电源轨纹波 | 开关纹波传导或 `SW` 节点辐射耦合；改用“Buck + 高 PSRR LDO”级联供电，整改热回路与 `FB` 走线，必要时加磁珠/LC 滤波 |
| **Boost 带载输出跌落或上电损坏开关管** | 核算最低 `Vin` 下的 `I_L_peak` 并对照电感 `I_sat`，同时用示波器捕捉 `Vin` 引脚瞬态压降 | 电感磁芯饱和失感，或电池导线/保护板阻抗过大导致大电流下 `Vin` 跌破欠压锁存（UVLO）阈值 |
| **拉低 `EN` 后后级电路仍存在残余电压或漏电** | 关断状态下测量 `Vin` 至 `Vout` 压差，核对芯片手册拓扑框图 | 普通异步/非隔离 Boost 存在 `Vin → L → D → Vout` 直通路径；更换具备 True Shutdown（真关断）特性的升压 IC 或增加高边负载开关 |

## 关联阅读

如需将便携设备的完整供电链路贯通，可结合阅读同系列另外两篇技术笔记：
- 输入充电与边充边用路径管理：[单节锂电池充电 IC 基础：CC/CV 流程、发热估算与 Power Path]({{ '/articles/lithium-battery-charger-ic-guide.html' | relative_url }})
- 电池放电侧电量计量与脉冲负载架构：[电量管理可迁移技术详解：架构、库仑账本、状态机与工程难点]({{ '/articles/battery-management-portable-design.html' | relative_url }})

## 参考资料

1. Texas Instruments，《Basic Calculation of a Buck Converter's Power Stage》（SLVA477B）：[TI SLVA477B Application Report](https://www.ti.com/lit/an/slva477b/slva477b.pdf)
2. Texas Instruments，《Basic Calculation of a Boost Converter's Power Stage》（SLVA372D）：[TI SLVA372D Application Report](https://www.ti.com/lit/an/slva372d/slva372d.pdf)
3. Texas Instruments，《Understanding Buck-Boost Power Stages in Switch Mode Power Supplies》（SLVA059B）：[TI SLVA059B Application Report](https://www.ti.com/lit/an/slva059b/slva059b.pdf)
4. Texas Instruments，《TPS63020 High Efficiency Single Inductor Buck-Boost Converter With 4-A Switches Datasheet》（SLVS916）：[TI TPS63020 Datasheet](https://www.ti.com/lit/ds/symlink/tps63020.pdf)
5. Advanced Monolithic Systems，《AMS1117 1A Low Dropout Voltage Regulator Datasheet》：[AMS1117 Datasheet](https://www.advanced-monolithic.com/pdf/ds1117.pdf)
