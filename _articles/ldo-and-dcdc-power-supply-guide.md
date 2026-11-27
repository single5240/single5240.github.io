---
layout: article
title: 嵌入式电源拓扑一次理清：LDO、Buck、Boost 与四开关 Buck-Boost
description: 从 12V→3.3V 热耗算账、退耦电容贴脚布局，到 Buck 开关降压、Boost 升压、四开关 Buck-Boost 跨压拐点平滑过渡与电感饱和电流选型，结合实时拓扑与波形交互仿真器理清板级供电架构。
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

做硬件板子时，电源部分最容易出几类让人摸不着头脑的毛病：12 V 降 3.3 V 用一颗 LDO，空载测着电压稳稳当当，一接上主控和外设不到十秒芯片就烫手重启；单节锂电池 4.2 V 掉到 3.0 V，板子还没耗尽电量单片机却先欠压复位；换上开关电源降了温，结果 ADC 采样底噪莫名抬高；甚至把 Boost 升压芯片的使能脚 `EN` 拉低想关机，后端电路照样亮着灯漏电。

这些现象背后对应的正是板级最常用的四种电源拓扑：**LDO（低压差线性稳压器）**、**Buck（开关降压）**、**Boost（开关升压）**与**四开关 Buck-Boost（升降压）**。把每一级的能量账本、电感两拍行为和边界陷阱理顺，选型和画板就不必靠猜。

下文以常见嵌入式供电场景（如 `12 V → 3.3 V`、`5 V → 3.3 V`、单节锂电池 `3.7 V → 5 V` 与 `4.2 V ~ 3.0 V → 3.3 V`）及典型器件（如 `AMS1117-3.3`、`TPS63020` 等）为例。文中的功率、电流和纹波数值均为工程数量级算例，实际温升、效率和环路稳定性取决于具体芯片手册、封装热阻、PCB 敷铜面积及电感直流电阻（DCR）。

## 1. LDO 线性稳压：为什么会发烫，退耦电容又稳住了什么

LDO（Low-Dropout Regulator）结构极简，只需要输入、输出两颗电容就能输出极干净的直流电压，但它在高压差或大电流场景下极易变成“板载电暖器”。

### 1.1 本质是受控串联阀门，压差全部变成热

把 LDO 内部抽象成一个受反馈环路实时控制的**串联可变电阻（调整管）**就能立刻看懂它的热账本。电流几乎原封不动地从输入端流过调整管再到负载（`I_in = I_load + I_q`，静态电流 `I_q` 在大负载时可忽略），多余的压差全靠调整管自身硬磨掉：

```text
P_loss = (Vin - Vout) × I_load + Vin × I_q
```

代入三组板级最常见的算例，差距非常直观：

| 工况算例 | 压差 `Vin - Vout` | 输出功率 `P_out` | LDO 自身热耗 `P_loss` | 转换效率 `η ≈ Vout/Vin` | 实板体感与风险 |
| --- | --- | --- | --- | --- | --- |
| `5 V → 3.3 V @ 50 mA` | `1.7 V` | `0.165 W` | `0.085 W` | `66.0%` | 微温，小封装 SOT-23-5 也能轻松扛住 |
| `5 V → 3.3 V @ 500 mA` | `1.7 V` | `1.65 W` | `0.85 W` | `66.0%` | 明显发烫，SOT-223 需足够敷铜散热 |
| `12 V → 3.3 V @ 1.0 A` | `8.7 V` | `3.30 W` | `8.70 W` | `27.5%` | **严重过热**，无散热片数秒即触发热关断保护 |

此外，LDO 存在**最小压差（Dropout Voltage，`V_dropout`）**门槛，输入电压必须始终满足 `Vin ≥ Vout + V_dropout` 才能稳住输出。传统双极型/准 LDO（如 `AMS1117-3.3`）在满载时压差高达 `1.1 V ~ 1.3 V`（输入低于 `4.4 V` 就会掉出稳压区），根本不适合 `3.7 V` 锂电池转 `3.3 V`；电池供电必须换用压差在 `100 ~ 300 mV` 级别的 CMOS 低压差 LDO。

### 1.2 为什么挂了 LDO 电压还会抖：大小电容分工与贴脚铁律

即便平均功耗不高，单靠 LDO 也很难稳住高速数字芯片。当 MCU 内部门电路同步翻转、无线模组发射或 GPIO 驱动重载瞬间，负载电流会在纳秒到微秒级突然拉升。LDO 内部误差放大器的响应带宽有限，反应会慢半拍，此时供电轨会出现瞬间跌落，轻则触发逻辑误判，重则直接引起欠压复位（BOR）。

工程上常在电源轨采用**一大一小电容并联**的分工接力策略：

- **大容量电容（如 `10 μF ~ 22 μF`）**：像稳压水池，负责在 LDO 环路反应过来之前的微秒～毫秒级时间窗内补足能量，压住中低频电压跌落；但大电容物理尺寸大，等效串联电感（ESL）较高，对几十兆赫兹的高频瞬态阻抗反而偏高。
- **小容量陶瓷电容（如 `100 nF / 0.1 μF`）**：等效串联电感小、自谐振频率高，专治芯片引脚处的高频快尖峰毛刺，在纳秒级就近把电流回路闭合掉。

```text
正确布线：电源走线 ──> [10 μF 储能] ──> [100 nF 紧贴引脚焊盘] ──> [MCU VDD]
                                                 │
                                                GND（就近打过孔回地平面）

错误布线：电源走线 ──────────> [MCU VDD] ──(长走线含寄生电感)──> [100 nF]
```

画板必须守住两条细节：
1. **`100 nF` 退耦电容紧贴芯片电源引脚**，电流路径**先经过电容焊盘再进入引脚**，接地端就近打孔到完整地平面；如果放远了，几厘米细走线自带的数十纳亨寄生电感会把高频补电通路挡死，等于白焊。
2. **老型号 LDO 留意输出电容 ESR 窗口**：类似 `AMS1117` 等早期稳压器依赖输出电容的一定等效串联电阻（ESR）来维持环路相位裕度，如果全部换成超低 ESR 的陶瓷电容（MLCC）有时反而诱发自激振荡；画原理图前务必核对数据手册对输出电容材质与 ESR 的要求。

---

## 2. Buck 开关降压：为什么同样 12V→3.3V @ 1A 发热差二十倍

既然 LDO 发烫的根源是让调整管一直停在“半导通高阻区”硬磨压差，开关电源（SMPS）的思路非常干脆：**彻底避开半开状态**。

### 2.1 只全通或全断，电感与电容联手把方波揉平

Buck 降压芯片内部的核心开关是一颗纯电控功率 MOSFET（无机械磨损，典型开关频率 `300 kHz ~ 2.2 MHz`，每秒通断几十万到上百万次）：
- **全导通时**：导通电阻 `R_DS(on)` 只有几十毫欧，压降极小，导通损耗极低；
- **全关断时**：电流为零，功率几乎为零。

如果在 `12 V` 输入下只让开关导通约 `27.5%` 的时间（占空比 `D ≈ Vout / Vin = 3.3 / 12`），这段方波的时间平均值确实是 `3.3 V`。但开关节点 `SW` 实际上在 `0 V` 和 `12 V` 之间猛跳，直接接给 `3.3 V` 芯片会瞬间击穿。把方波“揉平”靠的是**功率电感 + 续流回路 + 输出电容**组成的两拍储能接力：

```text
       Q1 (上管 MOS)           L (功率电感)
Vin ──────[ 开关 ]──────┬───────UUUUUU───────┬────> Vout (3.3 V)
                        │ SW                 │
                   [ D / Q2 ]             [ Cout ]  [ 负载 ]
                   续流二极管或              滤波电容   (1 A)
                   同步下管 MOS              │         │
GND ────────────────────┴────────────────────┴─────────┘
```

- **拍① 开关导通（`Ton`）**：上管 `Q1` 闭合，`12 V` 施加到电感左端。电感天生像一只沉重的飞轮，最怕电流突变，它一边托着电流缓慢爬升（`di/dt = (Vin - Vout) / L`）流向负载，一边把多余压差的能量存进自身磁场（此时电感呈现**左正右负**）。
- **拍② 开关关断（`Toff`）**：`Q1` 突然断开，但电感磁场刹不住车，强行维持电流继续向右流。为了寻找回路，电感左端电压瞬间反转拉低（**左负右正**），顶开下方的续流二极管（或由控制器打开同步下管 `Q2`），把地线接通补成闭合环路，释放刚才存下的磁场能量继续供给负载。
- **电容削峰与反馈闭环**：一充一放的电感电流是连续锯齿波，输出电容 `Cout` 负责吸收峰顶、补齐谷底，把输出稳成一条平稳的 `3.3 V` 直流；同时 `FB` 反馈分压网络持续盯紧输出电压，负载变重一掉压就自动拉宽 `Ton` 占空比。

> **同步整流 vs 异步续流**：异步 Buck 下路用肖特基二极管续流，导通时仍有 `0.3 V ~ 0.5 V` 正向压降，在 `3.3 V` 以下低电压大电流时这部分损耗占比很高；现代主流芯片大多采用**同步 Buck（Synchronous Buck）**，用低阻 N-MOS `Q2` 替代二极管，在 `Q1` 关断时精确导通（中间留出纳秒级死区防直通），效率可轻松做到 `88% ~ 95%`。

### 2.2 能量账本对比与 “Buck + LDO 黄金搭档”

回头再算 `12 V → 3.3 V @ 1 A`（输出功率 `3.3 W`）的账：
- **LDO**：输入和输出全程串联，输出 `1 A` 就必须从 `12 V` 电源抽 `1 A`（输入 `12 W`），白白烧掉 `8.7 W`。
- **Buck**：只在 `27.5%` 的时间里向 `12 V` 抽电，其余 `72.5%` 的时间靠电感借地线续流释能。按 `90%` 综合效率估算，输入总功率仅 `3.3 W / 0.90 ≈ 3.67 W`，从 `12 V` 端拉取的平均电流仅约 **`0.31 A`**，整套电路发热只有 **`0.37 W`**——发热量比 LDO 骤降 **20 多倍**。

Buck 的物理本质是**高压小电流换低压大电流**。但高频开关也有明确代价：
1. 输出端总会残留几毫伏到几十毫伏的开关纹波，且高速跳变的 `SW` 节点和功率热回路会产生电磁干扰（EMI）；
2. 必须外挂功率电感和输入/输出大容量陶瓷电容，占板面积和 BOM 成本都高于 LDO。

因此板级供电最经典的组合是 **Buck + LDO 黄金搭档**：前级用 Buck 高效扛下大压差（例如 `12 V → 3.8 V` 或 `5 V`），把绝大部分温升降下来；再给需要极低噪声的模拟前端、24 位 ADC 参考源、音频或射频模块单独接一颗高 PSRR（电源抑制比）的 LDO 降到 `3.3 V`，兼顾低温升与低底噪。

---

## 3. Boost 开关升压：3.7V 锂电池怎么顶出 5V

单节锂电池标称 `3.7 V`，但 USB 外设、某些传感器或充电宝对外输出需要 `5 V`。电阻分压和 LDO 都只能往下耗电压，想要把电压顶高，得借用生活中“两节电池首尾串联电压叠加”的思路——只不过**第二块临时电池由电感来客串**。

### 3.1 电感断电反转串联顶高，二极管防倒灌

回顾电感的磁场特性：通电建磁储能，一旦突然断路，电流刹不住，电感立刻反转极性变成**左负右正**，拼命把电流往前顶。把开关管改接到电感右端对地，就搭出了 Boost 升压拓扑：

```text
             L (功率电感)       D / Q2 (单向阀/同步管)
Vin (3.7V) ────UUUUUU────┬─────────|>|────────┬────> Vout (5.0 V)
                         │ SW                 │
                     [ Q1 开关 ]           [ Cout ]  [ 负载 ]
                     (接地 MOS)            蓄水池    (1 A)
                         │                    │         │
GND ─────────────────────┴────────────────────┴─────────┘
```

- **拍① 接地开关 `Q1` 导通（`Ton`）**：`Q1` 直接把电感右端拉到地。新手常担心“这不把电池短路了吗？”——并不会：一方面电感限制了电流爬升速率（`di/dt = Vin / L`），另一方面 `Q1` 在一两微秒内就会关断。这拍唯一任务是**让电池专心给电感攒磁场能量**；与此同时，二极管 `D` 处于反偏截止状态，把右侧已经充到 `5 V` 的输出电容牢牢锁住，防止高压倒灌回地，负载暂由 `Cout` 支撑。
- **拍② 接地开关 `Q1` 关断（`Toff`）**：`Q1` 突然切断去地之路，电感电流刹不住，右端电压迅速飙升（反转成**左负右正**），与前面的 `3.7 V` 锂电池**首尾串联叠加**，总电压瞬间顶过 `5 V`，冲开二极管单向阀把能量泵进 `Cout` 和负载。

理想连续导通模式（CCM）下，输入与输出满足：

```text
Vout = Vin / (1 - D)      ⇒      D = 1 - Vin / Vout
```

随着锂电池从满电 `4.2 V` 一路掉到 `3.2 V`，反馈脚 `FB` 监测到输出略有下降，就会自动拉宽 `Q1` 的闭合占空比 `D`（从约 `16%` 拉宽到 `36%`），每拍多攒一点磁场能量，死死稳住 `5.0 V`。

### 3.2 镜像能量账本与原理直推的两大画板坑

升压同样遵循能量守恒，不是凭空造电。输出 `5 V / 1 A`（`5 W`），按 `90%` 效率反推，输入功率约 `5.56 W`，在 `3.7 V` 时电池平均要被抽走约 **`1.50 A`**（掉到 `3.2 V` 时平均输入电流更是飙升到 **`1.74 A`**）。与 Buck 恰好镜像，Boost 的本质是**低压大电流换高压小电流**。

光吃透这一条原理，就能直接避开新手画 Boost 板最常炸机的两个坑：

1. **坑①：按输出电流 `1 A` 选电感，一上电就磁饱和烧管**
   Boost 的电感串联在**输入侧**，它扛的不是输出 `1 A`，而是更高的输入平均电流再加上半个三角波纹波峰值：
   ```text
   I_in_avg ≈ (Vout × I_load) / (Vin × η)
   I_L_peak = I_in_avg + ΔI_L / 2
   ```
   以 `3.2 V → 5 V @ 1 A` 为例，电感峰值电流轻松超过 `2.1 ~ 2.4 A`。电感选型必须按**最低输入电压下的峰值电流**再留至少 `30%` 余量核对**饱和电流 `I_sat`**；磁芯一旦被电流塞满饱和，感值瞬间跌穿退化成普通铜线，限流保护来不及反应就会烧毁开关管。
2. **坑②：关断直通隐患（漏电与短路切不断）**
   看一眼上面的拓扑图就会发现一条直通路径：`Vin → 电感 L → 二极管 D → Vout`。即使把普通异步 Boost 芯片的 `EN` 脚拉低关死 `Q1`，电池电压依然会减去一个二极管压降直接通到输出端——不仅设备休眠时后级电路照常耗电，而且一旦输出端意外短路，芯片关死 `Q1` 也根本截不断来自电池的短路大电流。电池供电产品选用 Boost IC 时，务必确认手册明确标有 **True Shutdown / Output Disconnect（真关断隔离）**，否则必须在前端另加高边负载开关。

---

## 4. 四开关 Buck-Boost：跨越 3.3V 拐点时怎么做到不抖动

单节锂电池满电 `4.2 V`，放到快没电会跌到 `3.0 V`，而板上绝大多数 MCU、Flash 和传感器偏偏要求 `3.3 V`。此时 `Vin` 一会儿高于 `3.3 V`（需要降压），一会儿又低于 `3.3 V`（需要升压），单用 Buck 在电池低于 `3.4 V` 时就掉压，单用 Boost 在满电 `4.2 V` 时又压不住。

### 4.1 合并共用一颗电感：H 桥夹电感的三态演进

最直觉的办法是“先接一级 Buck 再串一级 Boost”，但这要占两颗功率电感的面积并叠加两级损耗。工程上把中间合并**共用同一颗电感**，并把原本死板的续流二极管全部换成受芯片统一调度的同步 MOS 管（`Q1`、`Q2`、`Q3`、`Q4`），就得到了**四开关 Buck-Boost**——结构上恰好就像把电机驱动的 H 桥中间的电机换成了一颗电感：

```text
Vin ────[ Q1 ]────┬────UUUUUU────┬────[ Q3 ]────> Vout (3.3 V)
                  │ SW1  L   SW2 │        │
                [ Q2 ]         [ Q4 ]   [ Cout ]
                  │              │        │
GND ──────────────┴──────────────┴────────┴──────
```

面对 `4.2 V → 3.0 V` 的全段输入，芯片内部逻辑自动切换三种工作模态：

1. **Buck 降压区（`Vin` 明显高于 `3.3 V`，如 `4.2 V`）**：右侧上管 `Q3` 常通当导线、下管 `Q4` 关死；只靠左侧 `Q1/Q2` 高频交替开关，电路退化为标准的同步 Buck。
2. **Boost 升压区（`Vin` 明显低于 `3.3 V`，如 `3.0 V`）**：左侧上管 `Q1` 常通当导线、下管 `Q2` 关死；只靠右侧 `Q4/Q3` 高频交替攒能顶高，电路退化为标准的同步 Boost。
3. **拐点过渡区（`Vin ≈ 3.3 V` 附近）**：为什么不能在 `3.30 V` 这条线上直接硬切？因为实际电路受最小导通/关断时间限制，纯 Buck 做不到 `100%` 占空比，纯 Boost 也做不到 `0%` 占空比；输入电压只要在 `3.3 V` 附近稍微晃荡，硬切就会引发模式反复跳变和输出剧烈抖动。

### 4.2 拐点破局：“电感水桶”两拍舀水与倒水

为了丝滑跨过 `3.3 V` 拐点，四开关 Buck-Boost 在 `Vin ≈ Vout` 区间启动**四开关同相（或交错）升降压模式**——把电感当成一只不让电池和输出直接碰面的“水桶”：

- **拍① 舀水（储能）**：对角闭合 **`Q1 + Q4`**，断开 `Q2 + Q3`。输出端被 `Q3` 彻底隔离，电池电流穿过电感直通地线，专心把电感磁场充饱。
- **拍② 倒水（释能）**：立刻切断电池，改闭合另一组对角 **`Q2 + Q3`**，断开 `Q1 + Q4`。电感刹不住车，极性反转成左负右正，借着地线把刚舀满的能量整股推给输出电容。

电池和输出从头到尾不碰面，只靠调节“舀水时间占比 `D`”就能连续覆盖降压、等压和升压：

```text
Vout / Vin = D / (1 - D)
```

`D < 50%` 舀少倒多就是降压，`D = 50%` 刚好等压，`D > 50%` 多舀一点就能堆成升压，从而无缝滑过 `3.3 V` 拐点。而且四颗开关管通常全部集成在一颗 `QFN` 小芯片内（如 `TPS63020`、`TPS63802`），画板外围依然只需要配一颗功率电感。

### 4.3 工程大实话：什么项目真需要四开关 Buck-Boost？

不要因为四开关 Buck-Boost “既能升又能降”就盲目全盘采用。从成本和能耗账本看，四开关芯片价格更贵，且由于电流路径始终串联两颗 MOS 管（`Q1` 与 `Q3`）加上拐点区四管全动，轻载效率与静态损耗往往不如简单的 LDO 或单级 Buck。

更重要的是，看看常见三元锂电池的真实放电曲线：从 `4.2 V` 放到 `3.5 V` 已经释放了约 **85% ~ 90%** 的有效容量，`3.5 V` 以下电压会迅速进入陡崖。因此普通小电流单片机设备，往往选一颗压差仅 `100 mV` 的超低压差 LDO（放到 `3.4 V` 关机），或者直接让全板系统运行在 `3.0 V` / `2.8 V` 下，性价比和续航反而更优。

真正**非用四开关 Buck-Boost 不可**的是这四类硬核场景：
- **瞬间大脉冲防拉塌**：Wi-Fi、4G Cat.1、电机或蜂鸣器突发大电流时，电池端电压受内阻压降瞬间跌到 `3.1 V` 甚至更低，需要靠升降压死死托住 `3.3 V` 防止 MCU 复位；
- **3 节干电池或磷酸铁锂供电**：3 节碱性电池满电 `4.5 V`、放空到 `2.7 V`，`3.3 V` 正好落在中段腹地，不用升降压会浪费近一半电量；
- **车载 `12 V` 电源系统**：冷启动瞬间电瓶电压可跌至 `6 V`，正常发电 `14.4 V`，抛负载冲击更高，需要宽范围升降压稳住中间母线；
- **USB PD 快充与双向电源**：面对 `5 V ~ 20 V` 任意档位输入与多串锂电池之间的双向充放电变换。

---

## 5. 交互实验台：电源四件套实时拓扑、热耗与电感波形仿真器

下面的仿真器把 LDO、Buck、Boost 与四开关 Buck-Boost 放进同一个工作台。你可以一键载入文内算例，切换 **拍① 充能 / 拍② 释能** 观察开关通断与电感极性反转，也可以实时拖动输入电压、目标输出、负载电流、电感值与开关频率，直接看到热耗暴涨、电感三角波斜率变化与 `I_sat` 饱和余量告警。

<div class="article-interactive-widget" id="power-topo-demo-app" aria-label="LDO、Buck、Boost 与四开关 Buck-Boost 电源拓扑仿真器">
  <div class="aiw-header">
    <span class="aiw-badge">INTERACTIVE LAB · 电源四件套实时仿真</span>
    <h3 class="aiw-title">LDO / Buck / Boost / 四开关 Buck-Boost 拓扑、热耗与电感波形实验台</h3>
    <p class="aiw-desc">对比线性压差散热与开关两拍储能：切换拓扑和开关拍态，观察 <code>Q1~Q4</code> 通断、电感磁场极性翻转、实时 <code>V_SW</code> / <code>I_L</code> 示波器波形与 <code>I_sat</code> 饱和电流安全红线。</p>
  </div>
  <div class="aiw-body">
    <div class="pwr-top-bar">
      <div class="pwr-switch-box">
        <span class="pwr-switch-label">电源拓扑架构</span>
        <div class="pwr-seg" role="radiogroup" aria-label="电源拓扑选择">
          <button type="button" class="pwr-topo-btn" role="radio" aria-checked="false" data-topo="ldo">LDO 线性降压</button>
          <button type="button" class="pwr-topo-btn is-active" role="radio" aria-checked="true" data-topo="buck">Buck 开关降压</button>
          <button type="button" class="pwr-topo-btn" role="radio" aria-checked="false" data-topo="boost">Boost 开关升压</button>
          <button type="button" class="pwr-topo-btn" role="radio" aria-checked="false" data-topo="buckboost">Buck-Boost 四开关</button>
        </div>
      </div>
      <div class="pwr-switch-box">
        <span class="pwr-switch-label">开关拍态观测</span>
        <div class="pwr-seg" role="group" aria-label="开关拍态切换">
          <button type="button" class="pwr-phase-btn is-active" data-phase="1" aria-pressed="true">拍① 充能 (Ton)</button>
          <button type="button" class="pwr-phase-btn" data-phase="2" aria-pressed="false">拍② 释能 (Toff)</button>
          <button type="button" class="pwr-phase-btn" id="pwr-btn-auto" data-auto="toggle" aria-pressed="false">慢放循环</button>
        </div>
      </div>
    </div>

    <div>
      <div class="aiw-section-title">
        <span>一键载入文内典型工程工况</span>
        <span class="aiw-hint">直接复现 8.7W 热关断、充电宝 1.5A 升压与 3.3V 拐点水桶模式</span>
      </div>
      <div class="pwr-seg">
        <button type="button" class="pwr-preset-btn" data-preset="ldo-hot">LDO 12V→3.3V·1A (8.7W 过热)</button>
        <button type="button" class="pwr-preset-btn" data-preset="buck-cool">Buck 12V→3.3V·1A (0.37W 凉快)</button>
        <button type="button" class="pwr-preset-btn" data-preset="boost-5v">Boost 3.7V→5V·1A (1.5A 输入)</button>
        <button type="button" class="pwr-preset-btn" data-preset="bb-cross">四开关 3.3V→3.3V (拐点水桶)</button>
        <button type="button" class="pwr-preset-btn" data-preset="bb-low">四开关 3.0V→3.3V (低电抬压)</button>
      </div>
    </div>

    <div class="aiw-stats" aria-label="电源实时仿真核心指标">
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">工作模态 / 占空比</span>
        <span class="aiw-stat-value accent" id="pwr-stat-mode">Buck CCM · D = 27.5%</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">输入平均电流 / 效率</span>
        <span class="aiw-stat-value" id="pwr-stat-iin">0.31 A · η 90.0%</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">热损耗估算 P_loss</span>
        <span class="aiw-stat-value" id="pwr-stat-loss">0.37 W</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">电感峰值 / 建议 I_sat</span>
        <span class="aiw-stat-value" id="pwr-stat-peak">1.24 A / ≥1.61 A</span>
      </div>
    </div>

    <div class="pwr-visual-grid">
      <div class="pwr-diagram-card">
        <div class="aiw-section-title">
          <span id="pwr-topo-heading">电路拓扑与当前拍态电流路径</span>
          <span class="aiw-hint" id="pwr-topo-hint">实线高亮 = 当前导通回路 · 虚线 = 关断隔离</span>
        </div>
        <svg class="pwr-diagram-svg" id="pwr-topo-svg" viewBox="0 0 680 236" role="img" aria-label="电源拓扑与开关拍态实时示意图"></svg>
      </div>

      <div class="pwr-diagram-card">
        <div class="aiw-section-title">
          <span id="pwr-scope-heading">双通道示波器：V_SW 与 I_L</span>
          <span class="aiw-hint" id="pwr-scope-hint">蓝=V_SW 方波 · 绿=I_L 三角波 · 红虚线=1.3× I_sat 下限</span>
        </div>
        <svg class="pwr-diagram-svg" id="pwr-scope-svg" viewBox="0 0 680 236" role="img" aria-label="开关节点电压与电感电流锯齿波形图"></svg>
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
          <label for="pwr-input-ind">功率电感感值 L</label>
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
          <label for="pwr-input-grade">器件特性假设</label>
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

## 6. 工程选型全景与 PCB 布局排查清单

### 6.1 电源四件套选型速查表

| 拓扑类型 | 适用电压关系 | 核心转换逻辑 | 典型效率与发热 | 纹波与噪声 | 典型场景与注意事项 |
| --- | --- | --- | --- | --- | --- |
| **LDO 线性** | `Vin ≥ Vout + V_dropout` | 串联调整管硬耗压差 | `η ≈ Vout/Vin`，大压差/大电流极烫 | **极低**（无开关纹波，高 PSRR） | 小压差、小电流 MCU、高精度 ADC / 运放 / 射频后级滤净 |
| **Buck 降压** | `Vin > Vout` | 高频通断 + 电感续流，高压小流换低压大流 | 典型 `85% ~ 95%`，发热量极小 | 中等（需关注开关纹波与 EMI） | `12 V/24 V → 5 V/3.3 V`、大电流主电源轨、电池降压 |
| **Boost 升压** | `Vin < Vout` | 接地攒能 + 断电串联顶高，低压大流换高压小流 | 典型 `85% ~ 93%`，输入峰值电流大 | 较高（输出电流脉动，对 `Cout` 要求高） | `3.7 V → 5 V` 移动电源、背光/传感器升压；盯紧 `I_sat` 与真关断 |
| **四开关 Buck-Boost** | `Vin` 可高、可等、可低于 `Vout` | 四管 H 桥共用电感，拐点水桶两拍过渡 | 典型 `85% ~ 93%`（拐点区略低） | 中等，芯片成本与复杂度最高 | 脉冲负载防拉塌、3 节干电池、`12 V` 车载宽压、USB PD 双向快充 |

### 6.2 功率电感、电容与 PCB 布局 4 条铁律

1. **电感同时核对 `I_sat` 与 `I_rms`**：`I_sat`（饱和电流）决定磁芯会不会在峰值电流瞬间“打回原形变铜线”，至少留出峰值电流 `1.3×` 以上余量；`I_rms`（温升电流）决定铜线长期跑有效值会不会过热烧漆包线。
2. **陶瓷电容算清 DC 偏置降额**：一颗标称 `10 μF / 10 V / 0603` 的 X5R MLCC，在 `5 V` 直流偏置下真实有效容值可能跌掉一半以上。开关电源输入/输出滤波电容耐压一般按工作电压 `1.5× ~ 2×` 选取，并优先选封装更大或 X7R/X5R 曲线明确的型号。
3. **先把高 `di/dt` 功率热回路缩到最小**：
   - Buck 的最热高频脉冲环路是 **输入电容 `Cin` → 上管 `Q1` → 下管 `Q2/D` → `Cin` 地**，必须把 `Cin` 紧贴芯片 `VIN` 和 `PGND` 引脚；
   - Boost 的最热高频脉冲环路是 **低边开关 `Q1` → 续流管 `D/Q2` → 输出电容 `Cout` → `PGND`**，`Cout` 必须紧贴输出与地回流端。
4. **`SW` 紧凑，`FB` 远离干扰源**：`SW` 节点在高压与地之间高频猛跳，铜皮只要够过电流即可，**绝不能铺成大面积“天线”**，且严禁从电感正下方或 `SW` 旁边穿过敏感模拟线与 `FB` 反馈走线；`FB` 分压电阻必须紧贴芯片 `FB` 脚摆放，采样点单点拉自输出电容后端。

### 6.3 板级供电异常排查顺序

| 异常现象 | 优先检查动作 | 典型根因与处理方向 |
| --- | --- | --- |
| **LDO 烫手甚至周期性重启** | 算一遍 `(Vin - Vout) × I_load`，同步测实际负载电流与芯片封装温升 | 压差或电流超标触发热关断；改换前级 Buck 降压，或加大散热铜皮/换封装 |
| **换 Buck 后 ADC 抖动或无线灵敏度下降** | 用示波器 AC 耦合 + 短接地弹簧针测电源轨峰峰值纹波 | 开关纹波或 `SW` 空间辐射耦合进模拟区；改用“Buck + 后级 LDO”隔离，重检热回路与 `FB` 走线 |
| **Boost 带载拉不起电压或瞬间烧管** | 核对最低输入电压下的电感峰值电流与电感手册 `I_sat`，测 `Vin` 引脚线损跌落 | 电感磁芯饱和失感，或电池导线过细导致输入跌破欠压锁存（UVLO） |
| **拉低 `EN` 关机后后级依然有电漏耗** | 断电后量 `Vin` 到 `Vout` 路径是否仍存在二极管直通压降 | 异步/普通 Boost 拓扑固有直通路径；更换支持 True Shutdown（真关断）的升压芯片或增加高边负载开关 |

## 关联阅读

把便携设备的完整供电链路串起来，可以配合阅读同系列另外两篇笔记：
- 输入充电与边充边用路径管理：[单节锂电池充电 IC 基础：CC/CV 流程、发热估算与 Power Path]({{ '/articles/lithium-battery-charger-ic-guide.html' | relative_url }})
- 电池放电侧电量计量与脉冲负载稳健架构：[电量管理可迁移技术详解：架构、库仑账本、状态机与工程难点]({{ '/articles/battery-management-portable-design.html' | relative_url }})

## 参考资料

1. Texas Instruments，《Basic Calculation of a Buck Converter's Power Stage》（SLVA477B）：[TI SLVA477B Application Report](https://www.ti.com/lit/an/slva477b/slva477b.pdf)
2. Texas Instruments，《Basic Calculation of a Boost Converter's Power Stage》（SLVA372D）：[TI SLVA372D Application Report](https://www.ti.com/lit/an/slva372d/slva372d.pdf)
3. Texas Instruments，《Understanding Buck-Boost Power Stages in Switch Mode Power Supplies》（SLVA059B）：[TI SLVA059B Application Report](https://www.ti.com/lit/an/slva059b/slva059b.pdf)
4. Texas Instruments，《TPS63020 High Efficiency Single Inductor Buck-Boost Converter With 4-A Switches Datasheet》（SLVS916）：[TI TPS63020 Datasheet](https://www.ti.com/lit/ds/symlink/tps63020.pdf)
5. Advanced Monolithic Systems，《AMS1117 1A Low Dropout Voltage Regulator Datasheet》：[AMS1117 Datasheet](https://www.advanced-monolithic.com/pdf/ds1117.pdf)
