---
layout: article
title: 单节锂电池充电 IC 基础：CC/CV 流程、发热估算与 Power Path
description: 单节 4.2 V 锂电池充电电路笔记：为什么不能 5 V 直充或串二极管、预充/CC/CV/截止流程、线性与 Buck 拓扑选型、PROG/NTC/开漏状态脚常见错误，以及并联负载无法满充截止与 Power Path 处理。
date: 2026-11-15
category: 嵌入式
tags:
  - 电源管理
  - 充电IC
  - 锂电池
  - Power Path
  - 硬件基础
---

做带电池的便携设备时，硬件联调常碰到一个问题：电源已经插上，软件里的 [电量计管理]({{ '/articles/battery-management-portable-design.html' | relative_url }}) 读写也正常，但机器一边开机跑业务一边充电时，充电指示灯却一直不转绿，或者电量停在半路充不满。

这多半不在 MCU 代码里，而是充电 IC（Charger IC）周边电路和电源路径没处理对。充电 IC 在电路里夹在外部电源、系统负载和电芯之间，既要把能量受控地送进电芯，又要避免系统功耗干扰满充判定，还要处理温升与防反灌。

下文以最常见的单节 4.2 V 锂离子电池为例；市面上也有 `4.35 V` 高压电芯，满充电压必须以具体电芯规格书为准。磷酸铁锂（LiFePO4）、镍氢（NiMH）或多串电池包的电压平台和截止策略完全不同，不能直接套用这组参数。文中的功耗和电流数值只作数量级算例，实际温升还要看封装热阻、PCB 敷铜面积和环境散热。

## 为什么 5 V 不能直接给锂电池充电

USB 接口和常见适配器输出 `5 V` 直流电，单节锂离子电池标称电压一般为 `3.6 V` 或 `3.7 V`，满充限制电压通常是 `4.2 V`。直接省掉充电管理芯片的两种接法都有问题：

- **直接用 5 V 给电芯充电**：输入电压高于 `4.2 V` 满充上限，电芯会被持续过压、过流灌入电流，轻则加速容量衰减，重则引起鼓包和热失控。
- **串联一只二极管降压**：硅二极管或肖特基二极管的正向压降不是恒定值，会随电流减小和温度升高而降低。快充满时电流掉到毫安级，二极管压降跟着缩小，电芯两端电压仍然可能接近甚至超过 `4.2 V`；而且二极管无法限制预充和恒流电流，也没有恒压控制、满充截止和温度监测。

因此必须用专门的充电 IC 按电芯特性来控制整段充电过程。

## 充电阶段：预充、恒流、恒压与截止

标准单节锂电池充电 IC（无论是线性芯片 `TP4056` 还是开关型芯片）都要按顺序执行四个阶段：

```text
电压/电流
  ^
4.2 V |----------------------------------+==================  (Vbat)
      |                                 /|
      |              CC 恒流            / |   CV 恒压
      |        +-------------------+   /  |
 I_cc |--------|                   |--/   |
      |        |                   |      |\
      | 预充   |                   |      | \
I_pre |-+------+                   |      |  \___ I_TERM (截止停充)
  0   +--------+-------------------+------+------+---------> 时间
       深度亏电     进入主充电区      到达4.2V  电流回落至阈值
```

1. **预充（Precharge）**：电芯深度亏电、端电压低于预充门限时，内阻高且状态不稳定，不能直接上大电流。充电 IC 先用小电流把电压慢慢抬回安全区间，再切到主充电阶段。
2. **恒流充电（CC，Constant Current）**：电压回到正常区间后，IC 把输出电流限制在设定值（例如 `0.5 A`），电芯电压随着能量积累逐步上升。
3. **恒压充电（CV，Constant Voltage）**：端电压升到目标电压（如 `4.2 V`）后，芯片切到恒压控制，把输出稳定在 `4.2 V` 不再继续抬高。随着电芯内部逐渐接近饱和，压差缩小，电流自然下降。
4. **满充截止（Termination，`I_TERM`）**：锂离子电池不能像铅酸电池那样长期挂在满电压上浮充，长期保持 `4.2 V` 钳位会加速寿命衰减。当恒压阶段电流落到截止阈值 `I_TERM` 以下时，充电 IC 会关断输出结束充电，直到电池电压跌落到再充阈值（Recharge Threshold）以下才重新补电。

概括起来，充电 IC 要完成三件事：按阶段限流（预充和 CC）、恒压稳在 `4.2 V`（CV），以及电流降到 `I_TERM` 后及时停充。

## 拓扑选型：线性充电 vs Buck 开关充电

从 `5 V` 降到电池电压，常用拓扑分为线性调节和开关降压（Buck）两类。

### 线性充电的发热量估算与热调节

`TP4056` 这类线性充电芯片内部相当于一颗串联在输入和电池之间的受控调整管，输入与电池之间的压差会直接变成芯片热损耗：

```text
P_loss = (Vin - Vbat) × Ichg
```

按一个典型算例估算：输入 `5 V`、电池当前 `3.5 V`、设定充电电流 `0.5 A` 时，芯片内部耗散的功率约为：

```text
(5 - 3.5) V × 0.5 A = 0.75 W
```

这里 `0.75 W` 只是损耗功率，不能直接换算成固定温升，具体结温取决于芯片封装热阻、PCB 敷铜面积和空气流动条件。线性芯片通常带有热调节（Thermal Regulation）功能：结温接近上限时会自动压低充电电流，所以实际现象往往是板子烫手的同时充电变慢，而不是直接烧毁。

### 线性充电与 Buck 开关充电对比

Buck 开关充电 IC（如 `BQ25601`）通过高频开关管、功率电感和电容做降压变换，而不是靠调整管硬吃压差，在压差较大或充电电流较高时效率高得多。

| 评估维度 | 线性充电 IC（如 `TP4056`） | Buck 开关充电 IC（如 `BQ25601`） | 选型参考 |
| --- | --- | --- | --- |
| 效率与发热 | 压差全部变成热量，低压大电流段发热明显 | 转换效率高，发热小，适合大电流快充 | 数百 mA 小电流可用线性；`1 A` 以上或散热受限选 Buck |
| PCB 面积与外围 | 只需少量阻容，不需要功率电感 | 需要功率电感和较大输入/输出电容，开关回路布板要求高 | 结构紧凑的小体积设备优先考虑线性 |
| EMI 与电源噪声 | 无开关动作，不引入开关纹波 | 存在开关节点 `dV/dt`、`dI/dt` 和纹波，容易串扰模拟/射频电路 | 音频、高精度 ADC 或无线前端附近优先线性，或做好滤波隔离 |
| BOM 成本 | 芯片与外围器件成本都低 | 芯片加功率电感，整体成本更高 | 成本敏感型小容量电池设备常用线性 |

## 外围引脚和保护芯片常见接法错误

选好拓扑之后，原理图和软件联调阶段最容易出错的主要是下面四个地方。

### 1. `PROG` 电阻：电流设定与跨型号混用

独立型充电 IC 常通过一颗接地的 `PROG` 电阻来设定 CC 电流（有的芯片也会按固定比例联动 `I_TERM`）。常见问题是阻值单位看错（`kΩ` 看成 `Ω`）、焊盘虚焊开路，或者把另一颗芯片的 `PROG` 电阻表直接抄过来。不同系列芯片的 `PROG` 参考电压和倍率系数并不相同，换型时必须按当前器件的数据手册重新套公式计算。

### 2. `NTC` 引脚：测的是电芯温度，不是 IC 结温

有人以为芯片内部已经有了过温保护，外部 `NTC` 就可以悬空不用。实际上两者的检测对象完全不同：芯片内部的热调节看的是硅片自身结温，而 `NTC` 脚通过电芯旁的热敏电阻监测电池本体的温度，防止电芯在低温下析锂或高温下胀气鼓包。

如果项目用的电池确实不带 NTC 热敏电阻，不要把 `NTC` 引脚直接悬空（容易受干扰误判停充），也不要凭经验直接接地或接 `VCC`，必须对照该型号芯片数据手册里的“禁用温度检测（Disable TS/NTC）”标准接法配置上/下拉或分压电阻。

### 3. 状态引脚（`CHRG` / `STDBY` / `STAT`）的开漏与耐压问题

大多数充电 IC 的状态指示引脚是开漏输出（Open-Drain）：有效时内部 MOS 管导通拉低，无效时释放为高阻态，部分芯片在故障态会输出特定频率脉冲。这里有两个常见隐患：

- **漏掉上拉电阻**：MCU 读取状态的 GPIO 配成浮空输入、外面又没焊上拉电阻，引脚高阻时电平不定，读出来的充电状态就会随机跳变。
- **5 V 倒灌进 3.3 V IO**：原理图习惯把 LED 加限流电阻直接挂到 `5 V` `VBUS` 再连到 `STAT`，如果同一个节点又接到不耐 `5 V` 的 MCU `3.3 V` GPIO 上，开漏释放时高于 `3.3 V` 的电压就会通过上拉通路灌入 MCU 引脚。给 MCU 侦测用的上拉要接到 `3.3 V`（同时核对两端芯片的引脚耐压范围），或通过分压/隔离电路接入。

### 4. 电池保护板不能代替充电 IC

锂电池包自带的小保护板上常见 `BQ297xx` 一类的保护 IC 和背靠背 MOSFET，这让人容易误以为有保护板就不需要充电 IC。两者的分工并不一样：

| 对比项 | 电池保护 IC（如 `BQ297xx` 系列） | 充电管理 IC（如 `TP4056` / `BQ24074` / `BQ25601`） |
| --- | --- | --- |
| 角色定位 | 故障发生时的安全关断开关 | 正常充放电过程中的电流与电压控制芯片 |
| 主要职责 | 监测过压、欠压、充/放电过流和短路，越限时切断 MOS 管 | 执行预充、CC 恒流、CV `4.2 V` 稳压、`I_TERM` 截止及热调节 |
| 能否单独完成充电 | 不能。不做 `4.2 V` 稳压、恒流限制和 `I_TERM` 截止，保护点通常已经超出正常充电窗口 | 能。但电池侧仍需要保护 IC 作为底层故障兜底 |

保护 IC 管的是越限保护，充电 IC 管的是正常充电曲线，两者不能互相替代。

## 为什么插着电却充不满，或者反复微充

设备开机插着电，充电指示灯一直不灭，或者充一会儿电压又掉下来，最常见的原因是硬件上把系统负载和电池直接并联在了充电 IC 输出端。

### 并联供电的分流与截止误判（Microchip AN1149）

当系统负载与电池直接并联在充电 IC 输出端时，电流走向如下：

```text
                +-------> I_load (例如 0.2 A) -----> [ 系统负载 / MCU ]
                |
[ 充电 IC ] ----+ (IC 只能测到这里流出的总电流 I_out = I_chg + I_load)
                |
                +-------> I_chg  (例如 0.3 A) -----> [ 锂电池 ]
```

参考 Microchip 应用笔记 `AN1149`，这种直接并接会引起两个问题：

1. **负载分走充电电流**：假设充电 IC 输出限流 `0.5 A`，而系统开机消耗 `0.2 A`，进电池的净电流只剩 `0.5 A - 0.2 A = 0.3 A`，充电时间被拉长；如果系统瞬时功耗超过 `0.5 A`，即便插着外部电源，电池也会反向放电。
2. **`I_TERM` 满充截止失灵**：充电 IC 的电流采样电阻位于它自己的输出端，测到的是 `I_out = I_chg + I_load`。当电池进入 CV 阶段接近充满、实际充电电流 `I_chg` 已经跌破 `I_TERM` 时，只要系统负载 `I_load` 还在（例如持续耗电 `0.2 A`），总输出电流就一直大于 `I_TERM`。芯片分辨不出这部分电流去了哪里，误以为电池还没充满，就不会触发满充截止——电芯要么长期被维持在 `4.2 V`，要么一直等到内置安全定时器（Safety Timer）超时报故障停充。

### 解决办法：带 Power Path 的电源路径管理（如 `BQ24074`）

要解决“边用边充不能截止”以及“电池彻底放空时插电起不来”的问题，规范做法是选用带 Power Path（电源路径管理）的充电 IC，或者按 `AN1149` 搭建外置二极管/MOSFET 负载切换电路。

以集成 Power Path 的 `BQ24074` 为例，芯片内部把系统输出端（`OUT`/`SYS`）和电池端（`BAT`）拆成两条独立受控的路径：

```text
                +----------------------------------> [ OUT / SYS: 系统负载 ]
                |                 ^
[ VBUS 输入 ] --+--> [ 输入开关 / 动态路径 ]           (外部优先直供系统，
                |                 |                   互不干扰 BAT 电流检测)
                +--> [ 独立充放电路径 ] -------------> [ BAT: 锂电池 ]
                                  |
                         (可精确单独检测 I_chg,
                          并在突发重载时 Battery Supplement 补电)
```

这样拆分后有三个直接好处：

- **满充截止不受负载干扰**：外部输入优先供给 `OUT` 端系统，进出电池支路的电流由芯片独立采样。即使整机一直开着运行，只要进电芯的电流降到 `I_TERM` 以下，芯片依然能正常触发截止。
- **深度亏电插电即起**：电池彻底放空被保护板锁死时，只要插上外部电源，`OUT` 端就能直接建立系统电压让 MCU 启动，不用等电池先慢慢预充到开机电压。
- **峰值电流时电池补电（Battery Supplement Mode）**：当射频发射、电机或蜂鸣器出现瞬时大电流，超过了适配器或 USB 口的输入限流上限时，内部连接电池与 `OUT` 的通道会导通，让电池临时和外部电源一起供电，防止系统电压跌落重启。

<div class="article-interactive-widget" id="charger-demo-app" aria-label="单节锂电池充电曲线、热耗与 Power Path 仿真器">
  <div class="aiw-header">
    <span class="aiw-badge">INTERACTIVE LAB · 电源路径与热耗仿真</span>
    <h3 class="aiw-title">CC/CV 充电曲线、热耗与 Power Path 分流模拟器</h3>
    <p class="aiw-desc">对比“负载与电芯直接并联（AN1149 陷阱）”与“Power Path 路径管理（如 BQ24074）”，实时观测电流采样点位置如何决定 <code>I_TERM</code> 满充截止、Battery Supplement 补电以及线性 vs Buck 拓扑的功率损耗量级。</p>
  </div>
  <div class="aiw-body">
    <div class="chg-top-switches">
      <div class="chg-switch-box">
        <span class="chg-switch-label">电源路径架构</span>
        <div class="chg-seg" role="radiogroup" aria-label="电源路径架构选择">
          <button type="button" class="chg-arch-btn is-active" role="radio" aria-checked="true" data-arch="parallel">直接并联负载 (AN1149 陷阱)</button>
          <button type="button" class="chg-arch-btn" role="radio" aria-checked="false" data-arch="powerpath">Power Path (如 BQ24074)</button>
        </div>
      </div>
      <div class="chg-switch-box">
        <span class="chg-switch-label">降压转换拓扑</span>
        <div class="chg-seg" role="radiogroup" aria-label="降压拓扑选择">
          <button type="button" class="chg-topo-btn is-active" role="radio" aria-checked="true" data-topo="linear">线性充电 (TP4056/BQ24074)</button>
          <button type="button" class="chg-topo-btn" role="radio" aria-checked="false" data-topo="buck">Buck 开关 (如 BQ25601)</button>
        </div>
      </div>
    </div>
    <div>
      <div class="aiw-section-title">
        <span>一键切换典型工程工况</span>
        <span class="aiw-hint">覆盖文内 0.75 W 热耗算例与边充边用典型故障</span>
      </div>
      <div class="chg-seg">
        <button type="button" class="chg-preset-btn" data-preset="an1149">边充边用不转灯 (AN1149)</button>
        <button type="button" class="chg-preset-btn" data-preset="thermal">0.75 W 热耗算例 (5V→3.5V)</button>
        <button type="button" class="chg-preset-btn" data-preset="coldstart">深亏电冷启动 (2.60 V)</button>
        <button type="button" class="chg-preset-btn" data-preset="supplement">突发重载补电 (0.70 A)</button>
      </div>
    </div>
    <div class="aiw-stats" aria-label="实时充电仿真指标">
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">当前阶段与状态</span>
        <span class="aiw-stat-value accent" id="chg-stat-stage">恒压充电 (CV)</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">IC 采样判断电流</span>
        <span class="aiw-stat-value" id="chg-stat-sense">0.22 A</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">净入电芯电流 I_chg</span>
        <span class="aiw-stat-value" id="chg-stat-ichg">0.02 A</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">芯片热损耗估算 P_loss</span>
        <span class="aiw-stat-value" id="chg-stat-loss">0.18 W</span>
      </div>
    </div>
    <div class="chg-visual-grid">
      <div class="chg-diagram-card">
        <div class="aiw-section-title">
          <span>电流路径与采样点拓扑</span>
          <span class="aiw-hint">注意电流检测位于总输出端还是 BAT 支路</span>
        </div>
        <svg class="chg-diagram-svg" id="chg-flow-svg" viewBox="0 0 640 220" role="img" aria-label="充电 IC 与负载、电池的电流分流拓扑图">
          <rect x="10" y="72" width="138" height="76" rx="10" fill="var(--subtle-bg)" stroke="var(--line)" stroke-width="1.5"/>
          <text x="79" y="100" text-anchor="middle" font-size="13" font-weight="700" fill="var(--ink)">VBUS 输入</text>
          <text x="79" y="123" text-anchor="middle" font-size="11" fill="var(--muted)" id="chg-svg-vin">5.00V · 限流 1.00A</text>
          <line x1="148" y1="110" x2="174" y2="110" stroke="var(--accent)" stroke-width="2.5"/>
          <polygon points="174,110 165,105 165,115" fill="var(--accent)"/>
          <rect x="176" y="44" width="180" height="132" rx="12" fill="var(--subtle-bg)" stroke="var(--accent)" stroke-width="1.8"/>
          <text x="266" y="68" text-anchor="middle" font-size="13" font-weight="750" fill="var(--ink)" id="chg-svg-ic-title">普通并联充电 IC</text>
          <text x="266" y="86" text-anchor="middle" font-size="10.5" fill="var(--muted)" id="chg-svg-ic-sub">线性调整管</text>
          <g id="chg-svg-parallel-paths">
            <rect x="186" y="98" width="160" height="28" rx="6" fill="var(--soft)" stroke="var(--accent)" stroke-width="1"/>
            <text x="266" y="116" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--accent-dark)" id="chg-svg-par-sense">总采样 I_out = 0.22 A</text>
            <line x1="356" y1="110" x2="372" y2="110" stroke="var(--accent)" stroke-width="2.5"/>
            <circle cx="372" cy="110" r="4" fill="var(--accent)"/>
            <polyline points="372,110 372,56 458,56" fill="none" stroke="var(--warm)" stroke-width="2.2"/>
            <polygon points="458,56 449,51 449,61" fill="var(--warm)"/>
            <polyline points="372,110 372,164 458,164" fill="none" stroke="var(--accent)" stroke-width="2.2"/>
            <polygon points="458,164 449,159 449,169" fill="var(--accent)"/>
            <text x="415" y="150" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--ink)" id="chg-svg-par-bat">I_chg = 0.02 A</text>
          </g>
          <g id="chg-svg-pp-paths" style="display:none">
            <text x="266" y="106" text-anchor="middle" font-size="10.5" fill="var(--ink)" id="chg-svg-pp-vbus-out">I_in = 0.22 A</text>
            <rect x="186" y="118" width="160" height="26" rx="6" fill="var(--soft)" stroke="var(--accent)" stroke-width="1"/>
            <text x="266" y="135" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--accent-dark)" id="chg-svg-pp-sense">BAT 独立采样: 0.02 A</text>
            <line x1="356" y1="56" x2="458" y2="56" stroke="var(--warm)" stroke-width="2.2"/>
            <polygon points="458,56 449,51 449,61" fill="var(--warm)"/>
            <line x1="356" y1="164" x2="458" y2="164" stroke="var(--accent)" stroke-width="2.2"/>
            <polygon points="458,164 449,159 449,169" fill="var(--accent)"/>
            <text x="407" y="150" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--ink)" id="chg-svg-pp-bat">I_chg = 0.02 A</text>
            <g id="chg-svg-pp-supp" style="display:none">
              <line x1="545" y1="130" x2="545" y2="90" stroke="#ef4444" stroke-width="2.4" stroke-dasharray="4 3"/>
              <polygon points="545,90 540,98 550,98" fill="#ef4444"/>
              <rect x="498" y="101" width="94" height="18" rx="4" fill="var(--panel)" stroke="rgba(239,68,68,0.45)" stroke-width="1"/>
              <text x="545" y="114" text-anchor="middle" font-size="10.5" font-weight="700" fill="#ef4444" id="chg-svg-pp-supp-txt">补电 ↑</text>
            </g>
          </g>
          <rect x="460" y="22" width="170" height="68" rx="10" fill="var(--subtle-bg)" stroke="var(--warm)" stroke-width="1.5"/>
          <text x="545" y="48" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--ink)">SYS 系统负载 / MCU</text>
          <text x="545" y="70" text-anchor="middle" font-size="11.5" font-weight="700" fill="var(--warm)" id="chg-svg-isys">I_load = 0.20 A</text>
          <rect x="460" y="130" width="170" height="72" rx="10" fill="var(--subtle-bg)" stroke="var(--accent)" stroke-width="1.5"/>
          <text x="545" y="156" text-anchor="middle" font-size="12.5" font-weight="700" fill="var(--ink)">BAT 单节锂电池</text>
          <text x="545" y="178" text-anchor="middle" font-size="10.5" fill="var(--muted)" id="chg-svg-bat-sub">Vbat = 4.19 V</text>
        </svg>
      </div>
      <div class="chg-diagram-card">
        <div class="aiw-section-title">
          <span>CC/CV 曲线与 I_TERM 截止对照</span>
          <span class="aiw-hint">蓝线=Vbat · 绿线=I_chg · 橙虚线=IC 采样总电流</span>
        </div>
        <svg class="chg-diagram-svg" id="chg-curve-svg" viewBox="0 0 640 220" role="img" aria-label="预充、恒流、恒压与 I_TERM 截止曲线图">
          <rect x="54" y="24" width="64" height="146" fill="var(--alt-bg)"/>
          <rect x="388" y="24" width="170" height="146" fill="var(--alt-bg)"/>
          <text x="86" y="18" text-anchor="middle" font-size="10.5" fill="var(--muted)">预充</text>
          <text x="253" y="18" text-anchor="middle" font-size="10.5" fill="var(--muted)">CC 恒流</text>
          <text x="473" y="18" text-anchor="middle" font-size="10.5" fill="var(--muted)">CV 恒压 (4.2 V)</text>
          <text x="575" y="18" text-anchor="middle" font-size="10.5" fill="var(--muted)">截止</text>
          <line x1="54" y1="170" x2="594" y2="170" stroke="var(--line)" stroke-width="1.5"/>
          <line x1="54" y1="24" x2="54" y2="170" stroke="var(--line)" stroke-width="1.5"/>
          <text x="48" y="34" text-anchor="end" font-size="10" fill="var(--muted)">4.2V</text>
          <text x="48" y="170" text-anchor="end" font-size="10" fill="var(--muted)">2.5V</text>
          <line id="chg-line-iterm" x1="54" y1="156" x2="594" y2="156" stroke="#ef4444" stroke-width="1.2" stroke-dasharray="4 3"/>
          <text id="chg-lbl-iterm" x="590" y="151" text-anchor="end" font-size="10" font-weight="700" fill="#ef4444">I_TERM (0.05 A)</text>
          <path id="chg-path-vbat" d="" fill="none" stroke="var(--accent)" stroke-width="2.4"/>
          <path id="chg-path-ichg" d="" fill="none" stroke="#10b981" stroke-width="2.4"/>
          <path id="chg-path-isense" d="" fill="none" stroke="var(--warm)" stroke-width="2.2" stroke-dasharray="6 4"/>
          <line id="chg-cursor-line" x1="540" y1="24" x2="540" y2="170" stroke="var(--ink)" stroke-width="1.2" stroke-dasharray="3 3" opacity="0.6"/>
          <circle id="chg-cursor-v" cx="540" cy="40" r="4.5" fill="var(--accent)" stroke="var(--panel)" stroke-width="1.5"/>
          <circle id="chg-cursor-i" cx="540" cy="130" r="4.5" fill="var(--warm)" stroke="var(--panel)" stroke-width="1.5"/>
          <text x="64" y="196" font-size="10.5" fill="var(--accent)">━ Vbat 电压</text>
          <text x="165" y="196" font-size="10.5" fill="#10b981">━ 真实进电芯 I_chg</text>
          <text x="305" y="196" font-size="10.5" fill="var(--warm)">┅ IC 采样电流 (并联含 I_load)</text>
        </svg>
      </div>
    </div>
    <div class="chg-controls-grid">
      <div class="chg-slider-field">
        <div class="chg-slider-head">
          <label for="chg-input-vbat">电芯端电压 Vbat</label>
          <strong id="chg-val-vbat">4.19 V</strong>
        </div>
        <input type="range" id="chg-input-vbat" min="2.60" max="4.20" step="0.01" value="4.19">
      </div>
      <div class="chg-slider-field">
        <div class="chg-slider-head">
          <label for="chg-input-iload">系统工作负载 I_load</label>
          <strong id="chg-val-iload">0.20 A</strong>
        </div>
        <input type="range" id="chg-input-iload" min="0.00" max="1.00" step="0.05" value="0.20">
      </div>
      <div class="chg-slider-field">
        <div class="chg-slider-head">
          <label for="chg-input-icc">设定恒流 I_cc (PROG)</label>
          <strong id="chg-val-icc">0.50 A</strong>
        </div>
        <input type="range" id="chg-input-icc" min="0.20" max="1.50" step="0.05" value="0.50">
      </div>
      <div class="chg-slider-field">
        <div class="chg-slider-head">
          <label for="chg-input-vin">输入电压 Vin</label>
          <strong id="chg-val-vin">5.00 V</strong>
        </div>
        <input type="range" id="chg-input-vin" min="4.50" max="5.50" step="0.05" value="5.00">
      </div>
      <div class="chg-slider-field">
        <div class="chg-slider-head">
          <label for="chg-input-iterm">截止阈值 I_TERM</label>
          <strong id="chg-val-iterm">0.05 A</strong>
        </div>
        <input type="range" id="chg-input-iterm" min="0.03" max="0.15" step="0.01" value="0.05">
      </div>
      <div class="chg-slider-field">
        <div class="chg-slider-head">
          <label for="chg-input-iinlim">外部输入限流 I_inlim</label>
        </div>
        <select id="chg-input-iinlim" class="chg-select">
          <option value="0.50">0.50 A (标准 USB 2.0)</option>
          <option value="1.00" selected>1.00 A (普通适配器)</option>
          <option value="1.50">1.50 A (大电流口)</option>
        </select>
      </div>
    </div>
    <div class="chg-diag-box is-danger" id="chg-diag-box" aria-live="polite"></div>
  </div>
</div>

## I²C 可控充电 IC 的固件常见坑

如果方案用了带 I²C 接口的开关充电或路径管理芯片（比如 `BQ25601`），固件写驱动时还要留意三处状态问题：

1. **上电默认值影响冷启动**：MCU 还没跑到 `main()` 之前，充电 IC 完全按照手册定义的硬件默认参数运行（包括默认输入限流、默认充电使能状态）。如果电池亏电到已经带不起 MCU，却指望靠固件初始化去改 I²C 寄存器解除限流，冷启动就会陷入死锁。画原理图前就要查清默认值是否够用。
2. **掉电复位导致寄存器恢复默认**：输入和电池同时掉电，或者芯片触发内部复位之后，之前通过 I²C 改过的充电电流、`VREG`、`I_TERM` 都会回到出厂默认配置。驱动不能只在开机时写一次就不管了，要在电源接入中断或状态轮询发现复位标志时重新校验配置。
3. **内置看门狗超时回退**：不少 I²C 充电 IC（如 `BQ25601`）内部带 Watchdog Timer。只要看门狗处于开启状态，主控就必须在规定周期内通过 I²C 喂狗（或复位看门狗位）。一旦软件忘记喂狗或总线异常卡住，芯片会自动回退到安全默认限流甚至中止异常状态，表现出来很像硬件虚焊或芯片损坏，排查时要注意读相关状态位。

## 选型核对与排查顺序

### 选型核对清单

- [ ] **确认电芯体系与满充电压**：明确电芯是 `4.2 V`、`4.35 V` 还是其他体系，按规格书确认目标电压，不直接套用常见型号参数。
- [ ] **估算最坏压差下的发热**：用 `(Vin - Vbat) × Ichg` 算清楚最大热耗；小电流、重成本或敏感模拟电路附近选线性，大电流或散热受限选 Buck。
- [ ] **确认是否支持边充边用**：只要允许设备在插电开机状态下运行（尤其是整机功耗接近或超过 `I_TERM`），优先选带 Power Path 的芯片或加负载切换电路，不直接并接电池与负载。
- [ ] **核对细节引脚与默认寄存器**：检查 `PROG` 阻值、无热敏电阻时 `NTC` 的手册禁用接法、`STAT` 上拉电源域与 MCU IO 耐压，以及 I²C 芯片上电默认限流和看门狗周期。

### “插电充不满 / 不转灯”排查顺序

| 排查顺序 | 操作方法 | 判断方向 |
| --- | --- | --- |
| 1. 对比待机与开机状态 | 断开外设负载或让整机进低功耗休眠，仅保留充电看能否转灯 | 待机能正常截止、开机一直不停灯，多半是并联负载拉高了总电流，导致 `I_TERM` 误判（AN1149 问题） |
| 2. 实测芯片引脚上的 `VBUS` | 用万用表或示波器直接量充电 IC 输入脚电压，而不是只看适配器标称 `5 V` | 线损过大或触发输入动态电源管理（VINDPM/IINDPM）时，IC 会主动降流，不一定配置有误 |
| 3. 检查 `NTC`、`CE` 与 `PROG` | 测使能脚电平、`NTC` 分压是否在有效窗口、`PROG` 对地阻值是否准确 | `NTC` 悬空、漂移或超温窗会暂停充电，常见表现为状态灯闪烁或电流为 0 |
| 4. 读取 I²C 状态与故障寄存器 | I²C 充电 IC 在异常降流或停充时，读回 `FAULT`、`STAT` 和看门狗状态位 | 区分是热调节降流、输入过流保护，还是看门狗超时重置了配置 |

## 关联阅读

- 板级稳压拓扑（LDO、Buck、Boost 与四开关 Buck-Boost 选型与实时波形仿真）：[嵌入式电源拓扑一次理清：LDO、Buck、Boost 与四开关 Buck-Boost]({{ '/articles/ldo-and-dcdc-power-supply-guide.html' | relative_url }})
- 电池放电侧的库仑计账本、OCV 标定、脉冲负载电压失真与跨复位恢复：[电量管理可迁移技术详解：架构、库仑账本、状态机与工程难点]({{ '/articles/battery-management-portable-design.html' | relative_url }})

## 参考资料

1. 南京拓品微电子，《TP4056 1A 线性锂离子电池充电器数据手册》（REV_2.3）：[TP4056 Datasheet](https://www.toppwr.com/uploadfile/file/20241228/676f612b9f2dd.pdf)
2. Panasonic，《CG-320B Pin-Type Lithium-Ion Battery 官方规格页》：[CG-320B Specifications](https://industry.panasonic.eu/pd-129148/batteries/secondary-batteries/pin-type-lithium-ion-batteries/pin-type-lithium-ion-battery/cg-320b)
3. Texas Instruments，《BQ25601 I²C Controlled Single-Cell 3-A Fast Charger Datasheet》（SLUSCK5A，Rev. A，§9.3.5、§9.3.7、§9.6）：[BQ25601 Datasheet](https://www.ti.com/lit/ds/symlink/bq25601.pdf)
4. Texas Instruments，《BQ297xx Cost-Effective Voltage and Current Protection IC for Single-Cell Li-Ion/Li-Polymer Batteries》（Rev. I，Features、§9）：[BQ297xx Datasheet](https://www.ti.com/lit/ds/symlink/bq2970.pdf)
5. Microchip Technology，《AN1149: Designing a Li-Ion Battery Charger and Load Sharing System With Microchip's Stand-Alone Li-Ion Battery Charge Management Controller》（DS01149C，2008，“Connecting the System Load to the Battery”及 Figure 4）：[Microchip AN1149](https://www.microchip.com/content/dam/mchp/documents/OTH/ApplicationNotes/ApplicationNotes/01149c.pdf)
6. Texas Instruments，《BQ2407x Standalone 1-Cell 1.5-A Linear Battery Charger with Power Path Datasheet》（Rev. N，§9.3.4）：[BQ24074 Datasheet](https://www.ti.com/lit/ds/symlink/bq24074.pdf)
