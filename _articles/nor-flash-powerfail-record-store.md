---
layout: article
title: NOR Flash 掉电安全定长记录存储与 RTT 故障注入验证
description: 基于 W25Q128 SPI NOR Flash 的裸机掉电安全定长记录存储架构，详解 64B 槽两阶段提交、三扇区世代控制环、原位生命周期码单条删除、稀疏扇区非阻塞迁移与 J-Link RTT 故障注入验证。
date: 2026-10-16
category: 嵌入式
tags:
  - NOR Flash
  - W25Q128
  - 掉电安全
  - RTT
  - N32G455
---

数显式拉力计 HW1.4 用 W25Q128 保存测试记录，代码位于 `APP/app_record_store.c/.h`。扇区擦除需要 45～400 ms，页编程只能把位从 `1` 改为 `0`，写入还可能被断电打断。存储层因此采用定长槽、两阶段提交和后台擦除。下面记录存储格式、恢复规则及实板 RTT 故障注入结果。底层 SPI3 非阻塞驱动见 [N32G455 W25Q128 SPI NOR Flash 驱动与非阻塞擦写实践]({{ '/articles/w25q128-spi-flash-driver-guide.html' | relative_url }})。

## 设计目标与物理约束

这套记录存储需要满足以下要求：

1. **掉电原子性**：在记录写入、单条删除、整表清空或扇区整理的任意字节/指令边界断电，重启后不得出现半写脏数据被误判为有效记录、已有有效记录丢失或显示序号错乱。
2. **硬实时与看门狗安全**：主循环运行 AD7190 约 2.4 kHz 连续采样与 8 行条带 LCD 刷新，独立看门狗（IWDG）超时窗口约 1 s。任何保存、删除、清空确认或后台擦除都严禁在主循环中原地阻塞等待 Flash 内部耗时。
3. **支持 O(1) 整表清空与单条原位删除**：
   - 用户执行“清空全部”时必须立即生效，不能在按键确认路径中同步擦除数十个 4 KiB 扇区；
   - 用户执行“单条删除”后，列表显示序号动态重排为连续的 `1..N`，但不能为了顺延序号而重写 Flash 中后续数百条记录。
4. **受控的稀疏扇区空间回收**：单条删除积累到一定程度后，按需把稀疏扇区中仅存的有效记录安全迁移到追加扇区并擦除回收源扇区，且避免通用 KV 文件系统的高 RAM 开销与写放大。

## 分区规划与容量预算

系统选用 W25Q128（16 MiB）顶部的 **156 KiB（`0xFD9000`～`0xFFFFFF`）** 作为记录专用分区，共包含 **39 个 4 KiB 物理扇区**：

| 分区区域 | 物理地址范围 | 扇区数 | 核心用途 |
| --- | --- | ---: | --- |
| 控制环扇区 0 | `0xFD9000`～`0xFD9FFF` | 1 | 世代控制记录（Generation）与迁移事务日志（`MIGRATE_BEGIN/COMMIT`） |
| 控制环扇区 1 | `0xFDA000`～`0xFDAFFF` | 1 | 同上，三扇区顺序轮转备用 |
| 控制环扇区 2 | `0xFDB000`～`0xFDBFFF` | 1 | 同上，三扇区顺序轮转备用 |
| 动态数据扇区池 | `0xFDC000`～`0xFFFFFF` | 36 | 扇区头、64B 数据记录槽、稀疏迁移目标及至少 2 个经校验全空扇区 |

### 容量与余量计算

- **扇区内部结构**：每个 4 KiB（4,096 B）数据扇区划分为 64 个固定 64 字节槽位——槽 0 固定为 **64B 数据扇区头**，槽 1～63 为 **63 个数据记录槽**。
- **产品上限与物理预留**：
  - 当前产品可见记录上限设为 **1,000 条**，最多占用 `ceil(1000 / 63) = 16` 个数据扇区；
  - 物理分区一次规划支持 **2,000 条**（需 `ceil(2000 / 63) = 32` 个数据扇区）；
  - 36 个数据扇区共提供 `36 × 63 = 2,268` 个物理记录槽；扣除强制保留的 **至少 2 个经整扇区验证为 `0xFF` 的全空扇区（`EMPTY`）** 后，仍开放 `34 × 63 = 2,142` 个槽位，足以容纳 2,000 条有效记录及 142 个过渡/掉电脏槽。

## 64 字节定长槽编码与两阶段提交

为消除编译器结构体对齐与填充差异，所有记录槽固定为 **64 字节**，统一使用显式小端函数（`PutU16/PutU32`、`GetU16/GetU32`）序列化。

### 数据记录槽布局（Format V3）

| 字节偏移 | 长度 | 字段名称 | 约束与含义 |
| ---: | ---: | --- | --- |
| `0..3` | 4 B | `magic` | 固定 4 字节 ASCII 魔数标识 |
| `4` | 1 B | `version` | 格式版本号（当前为 `3`） |
| `5` | 1 B | `recordType` | `1` = 数据记录，`2` = 世代/迁移控制记录 |
| `6..7` | 2 B | `recordLen` | 固定为 `64` |
| `8..11` | 4 B | `generation` | 世代号（无符号 32 位回绕序号，清空全部时递增） |
| `12..15` | 4 B | `recordId` | 当前世代内单调递增的内部稳定主键（`1..N`，删除后不重排） |
| `16..22` | 7 B | `completedAt` | 完成绝对时间：`uint16_t` 年 + 月、日、时、分、秒 |
| `23..27` | 5 B | `meta` | 测试动作（压缩/拉伸/插拔/接点/破断/按键）、有效位掩码、单位、量程、公差判定 |
| `28..43` | 16 B | `values` | `result1`、`result2`、公差下限、公差上限（有符号 32 位 `mN`） |
| `44..49` | 6 B | `buttonExt` | 按键测试扩展字段（`Fr`、结果组合选择、算法版本；非按键动作保持 `0xFF`） |
| `50..58` | 9 B | `reserved` | 预留扩展，固定保持擦除态 `0xFF` |
| `59..60` | 2 B | `lifecycle` | **原位生命周期码**（小端，不参与正文 CRC，支持单向 `1 → 0` 编程） |
| `61..62` | 2 B | `crc16` | **CRC-16/MODBUS**，仅覆盖不可变正文偏移 `0..58` |
| `63` | 1 B | `commitFlag` | **独立提交标志**：首阶段保持 `0xFF`，校验通过后单独编程为 `0x00` |

### 两阶段提交（Two-Phase Commit）写流程

NOR Flash 页编程如果在写正文中途断电，会留下部分字节已写、部分字节仍为 `0xFF` 的半写槽。为此，所有数据记录、扇区头和控制记录均严格执行两阶段提交：

```text
阶段 1（写正文与 CRC）：
  ├─ 目标槽 64 字节必须处于全 0xFF 擦除态（ERASED）
  ├─ 序列化偏移 0..58 正文与 61..62 的 CRC-16
  ├─ 偏移 59..60 (lifecycle) 保持 0xFFFF，偏移 63 (commitFlag) 保持 0xFF
  ├─ 启动单页非阻塞编程并轮询 BUSY 清零
  └─ 整槽 64 字节读回，逐字节比对正文、CRC 及 commitFlag == 0xFF

阶段 2（单独写提交字节）：
  ├─ 仅对偏移 63 发起 1 字节页编程：0xFF → 0x00
  ├─ 轮询 BUSY 清零后读回确认 commitFlag == 0x00
  └─ 更新 RAM 中的可见记录数、下一内部 ID 与扇区有效计数
```

启动扫描时，每个 64 字节槽被严格归为三类：

- **`ERASED`（全 `0xFF`）**：干净空槽，仅当前追加扇区尾部的连续 `ERASED` 槽可用于分配新记录；
- **`VALID`（`commitFlag == 0x00` 且版本、长度、CRC-16 全部正确）**：有效已提交记录；
- **`DIRTY`（任何非全 `0xFF` 但未提交或 CRC 错误的槽）**：掉电残槽，扫描时直接跳过、绝不原地覆写，留待整扇区回收时一并擦除。

### 交互式在线演示：两阶段提交与掉电故障注入模拟

下面的模拟器按 64 字节槽展示写入、提交、删除和逻辑清空。可以在阶段 1 中途模拟断电，再执行上电扫描，查看哪些槽会被识别为有效记录。它只演示恢复规则，实际 Flash 的时序和掉电行为仍需上板验证。

<div class="article-interactive-widget" id="flash-demo-app" aria-label="NOR Flash 掉电安全存储交互演示">
  <div class="aiw-header">
    <span class="aiw-badge">INTERACTIVE WIDGET · 硬件物理层仿真</span>
    <h3 class="aiw-title">NOR Flash 掉电安全两阶段提交与世代控制环模拟器</h3>
    <p class="aiw-desc">仿真外部 SPI NOR Flash（W25Q128）物理约束：仅能 1→0 编程、64B 两阶段原子提交、原位墓碑生命周期码（0xFFFF ➔ 0x0000）与世代控制环逻辑秒级清空。</p>
  </div>
  <div class="aiw-body">
    <div class="aiw-stats" aria-label="Flash 存储引擎状态">
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">控制环世代 (Generation)</span>
        <span class="aiw-stat-value accent" id="flash-stat-gen">Gen 1</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">有效提交记录</span>
        <span class="aiw-stat-value" id="flash-stat-count">0 条有效记录</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">下一追加写槽位</span>
        <span class="aiw-stat-value warn" id="flash-stat-next">Slot 1</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">Flash 硬件状态</span>
        <span class="aiw-stat-value" id="flash-stat-status">就绪 (IDLE)</span>
      </div>
    </div>

    <div>
      <div class="aiw-section-title">
        <span id="flash-sector-addr">数据扇区 0xFDC000 (4 KiB) 物理槽位视图</span>
        <span class="aiw-hint">点击任意槽位可在下方检视 64 字节二进制结构</span>
      </div>
      <div class="flash-slots-grid" id="flash-slots-grid"></div>
    </div>

    <div>
      <div class="aiw-section-title">
        <span>两阶段写入、紧缩迁移与故障注入操作</span>
        <span class="aiw-hint">演示两阶段原子性、墓碑删除、稀疏扇区紧缩回收与掉电防护</span>
      </div>
      <div class="aiw-controls">
        <button type="button" class="aiw-btn primary" id="flash-btn-write">两阶段正常写入 (2PC Write)</button>
        <button type="button" class="aiw-btn danger" id="flash-btn-fail">故障注入: 阶段1中断电</button>
        <button type="button" class="aiw-btn warn" id="flash-btn-del">原位墓碑单条删除 (1→0)</button>
        <button type="button" class="aiw-btn" id="flash-btn-migrate">紧缩迁移回收 (Sector GC)</button>
        <button type="button" class="aiw-btn" id="flash-btn-clear">世代控制环逻辑清空 (Clear All)</button>
        <button type="button" class="aiw-btn" id="flash-btn-scan">模拟上电扫描 (Boot Scan)</button>
        <button type="button" class="aiw-btn" id="flash-btn-erase">整扇区擦除 4KB</button>
      </div>
    </div>

    <div class="flash-inspector">
      <div class="aiw-section-title">
        <span>当前选定槽 64 字节结构体物理字段剖析</span>
        <span class="aiw-hint">注意观察 commitFlag (偏移63) 与 lifecycle (偏移59..60) 的单向编程变化</span>
      </div>
      <table class="flash-fields-table">
        <thead>
          <tr>
            <th style="width: 130px;">字节偏移与字段</th>
            <th style="width: 140px;">物理存储值</th>
            <th>工程约束与防掉电语义</th>
          </tr>
        </thead>
        <tbody id="flash-inspector-body"></tbody>
      </table>
    </div>

    <div class="aiw-log-panel">
      <div class="aiw-section-title">
        <span>SPI Flash 硬件层事务与验证日志</span>
        <span class="aiw-hint">展示两阶段写入时序与安全校验</span>
      </div>
      <div class="aiw-log" id="flash-log" aria-live="polite"></div>
    </div>
  </div>
</div>

## 三扇区世代控制环与逻辑清空

### 为什么“清空全部”不擦除数据扇区

若在用户确认清空时同步擦除全部数据扇区，耗时可达数秒并触发看门狗复位。本架构引入 32 位 **`generation`（世代号）**：

1. **三扇区控制环轮转**：3 个控制扇区（每个可顺序追加 64 条 64B 控制记录）保持“1 个当前追加 + 1 个全 `0xFF` 备用空扇区 + 1 个空或待后台补擦扇区”的稳态。
2. **确认路径只追加 1 条世代记录**：用户长按 5 秒并确认清空后，仅在控制环尾部按两阶段提交写入 1 条新 `generation` 记录（耗时 `< 10 ms`）。提交成功的瞬间，RAM 中可见记录数立即归零、`nextRecordId` 重置为 `1`，旧世代记录因 `record.generation != currentGeneration` 自动在逻辑上不可见。
3. **跨世代共用当前追加扇区**：逻辑清空**不会**封闭当前正在追加的数据扇区。只要该数据扇区尾部仍有 `ERASED` 空槽，新世代记录会继续紧接着旧世代记录往后追加，直到写满 63 槽才启用下一个全空扇区。这样不必在每次“保存几条就清空”后立即擦除数据扇区。
4. **控制环后台擦除**：仅当活动控制扇区写满 64 条切换到备用空扇区后，后台状态机才对已退役的旧控制扇区发起非阻塞 4 KiB 擦除并逐页验证回填为全 `0xFF`（约每 64 次清空才触发 1 次控制扇区擦除）。

## 原位生命周期码与单条删除

### 稳定主键与动态显示序号分离

每条记录拥有不可变的内部主键 `{generation, recordId}`，而 UI 列表展示的序号 `1..N` 是按当前可见记录顺序实时计算的索引：

- 删除请求通过 `{generation, recordId}` 精确定位目标槽，拒绝跨世代、不存在或已删除目标；
- 删除中间某条记录后，其余记录的 `recordId` 保持不变，列表显示序号自然顺延为连续的 `1..(N-1)`，无需改写其他记录。

### 利用 NOR Flash 特性的单向生命周期码

偏移 `59..60` 的 16 位 `lifecycle` 字段独立于正文 CRC 之外，利用 NOR Flash 允许将 `1` 编程为 `0` 的特性实现三次状态跃迁：

```text
0xFFFF (ACTIVE：正常可见记录)
  │
  ├── 用户单条删除 (1 → 0 页编程) ──► 0xA55A (DELETED：逻辑已删除，不可见、不迁移)
  │
  └── 稀疏迁移复制完成 (1 → 0)   ──► 0x5AA5 (MIGRATED：目标副本已提交，等待源扇区擦除)
```

- `0xA55A` 与 `0x5AA5` 均只能从 `0xFFFF` 单向写入，互不转换；
- 单条删除只需对目标槽偏移 `59..60` 执行 2 字节页编程（`0xFFFF → 0xA55A`）并读回验证，耗时仅约 **4 ms**；
- 一旦 `0xA55A` 读回确认成功，逻辑删除立即生效，后续即便稀疏整理因空间或异常延后，已删除记录也绝不会在重启后“复活”。

## 稀疏扇区非阻塞迁移与掉电续作

### 触发条件与目标扇区选择

每次单条删除提交成功后，检查目标记录所在的 4 KiB 数据扇区：

- 一个数据扇区共有 63 个数据槽，当其中属于当前世代的 `ACTIVE` 记录数 **`> 21` 条**时，不触发整理，直接结束；
- 当 `ACTIVE` 记录数降至 **`≤ 21` 条（即逻辑空闲达到 2/3）** 时，触发稀疏扇区非阻塞整理：
  1. **优先复用当前追加扇区（`fit` 路径）**：若源扇区不是当前追加扇区，且当前追加扇区尾部剩余连续 `ERASED` 空槽数 `>= 源扇区 ACTIVE 记录数`，直接将有效记录迁移到当前追加扇区尾部；
  2. **按需启用全空扇区（`new` 路径）**：若当前追加扇区尾部空间不足，或源扇区本身就是当前追加扇区，则从数据池中挑选 1 个经校验全为 `0xFF` 的 `EMPTY` 扇区（启用后仍必须至少保留 2 个 `EMPTY` 扇区），先两阶段提交新扇区头，再将其作为迁移目标。

### 掉电安全的五步迁移协议

为防止迁移中途断电导致记录丢失或出现双份重复记录，控制环引入 `MIGRATE_BEGIN` 与 `MIGRATE_COMMIT` 事务日志，按以下状态机分步推进：

```text
1. 写 MIGRATE_BEGIN 控制记录（两阶段提交）
   └─ 持久化冻结 {事务序号, 源扇区索引/分配序号, 目标扇区索引/分配序号}

2. 逐槽扫描源扇区，对每条当前世代 ACTIVE 记录执行：
   ├─ (a) 在目标扇区尾部两阶段提交完整副本（保留原 generation 与 recordId）
   └─ (b) 目标副本读回确认后，将源记录 lifecycle 从 0xFFFF 编程为 0x5AA5 (MIGRATED)

3. 源扇区全部 ACTIVE 记录复制并标记完毕后：
   └─ 写 MIGRATE_COMMIT 控制记录（两阶段提交），宣告数据所有权正式移交目标扇区

4. 对源扇区发起非阻塞 4 KiB 擦除 (SectorEraseStart + PollOperation)

5. 按 256B 页逐页读回校验源扇区 4,096 字节全为 0xFF：
   └─ 校验通过后将源扇区重新登记为 EMPTY 空扇区，释放迁移事务锁
```

### 四个持久化边界断电/复位自愈规则

| 断电/复位发生边界 | 上电扫描与自动续作行为 |
| --- | --- |
| **边界 1：`MIGRATE_BEGIN` 提交后，尚未复制完** | 识别未完成的 `MIGRATE_BEGIN`，逐槽比对源与目标，从未完成的那条记录继续复制 |
| **边界 2：目标副本已提交，源记录尚未标为 `0x5AA5`** | 允许该迁移事务指定的源、目标扇区间存在一对正文完全一致的相同 `{generation, recordId}`，以目标副本为准并补标源记录为 `0x5AA5` |
| **边界 3：源记录已全部标为 `0x5AA5`，`MIGRATE_COMMIT` 未提交** | 核对目标副本数量与身份无误后，补写 `MIGRATE_COMMIT` 并继续擦除源扇区 |
| **边界 4：`MIGRATE_COMMIT` 已提交，源扇区尚未擦除或擦除中断** | 目标副本已生效；忽略源扇区残留内容，直接重新对源扇区执行 4 KiB 擦除与全 `0xFF` 逐页校验 |

## 基于 J-Link RTT 的板级故障注入与 HIL 验收

为在不破坏量产固件安全性的前提下验证上述状态机，工程通过默认关闭的编译开关 `APP_RECORD_STORE_VALIDATION_ENABLE` 隔离测试状态机，在 J-Link RTT Channel 0 上提供非阻塞验证指令集。

### 核心 RTT 验证指令与注入点

```text
record_status                      # 查看记录服务只读状态 (generation/count/next/empty)
record_test codec                  # 运行 64B 槽固定向量与异常分支纯 RAM 自检
record_test cleanup                # 擦除并逐页校验 39 个扇区 (0xFD9000..0xFFFFFF)
record_test append <N>             # 非阻塞批量追加 N 条测试记录
record_test delete_pos first|middle|last  # 删除首/中/末条可见记录并自动验证重复删除拒绝
record_test full_probe             # 满容量时探测第 1001 条返回 FULL 且介质零改动
record_test list_check             # 正序/倒序遍历全部页面，校验连续显示序号 1..N
record_test migrate_probe fit|new  # 自动触发 22→21 条稀疏扇区迁移（复用追加扇区 / 启用新扇区）
record_test inject migrate_begin|migrate_copy|migrate_mark|migrate_commit # 4 个持久化边界复位注入
record_test inject erase_start|erase_timeout|erase_verify                 # 3 种擦除故障边界注入
```

### 实机目标板（N32G455 + W25Q128）验证结果汇总

在数显式拉力计 HW1.4 实板上，使用 ARMCC V5.06 update 6 构建并执行全套 RTT 验证，关键实测数据如下：

| 验证场景 | 实测表现与介质复查结论 |
| --- | --- |
| **39 扇区清理与自动建代** | 39 个 4 KiB 扇区擦除并逐页校验 `0xFF` 耗时约 `6.1 s`，复位后自动建立 `generation=1`、`count=0`、`data_empty=36` |
| **1,000 条满容量追加与满盘拦截** | 批量两阶段提交 1,000 条耗时 `17.92 s`（平均 `17.9 ms/条`，单次页编程峰值 `4 ms`），启用数据扇区 `0..15`；随后 `full_probe` 同步返回 `FULL`，介质零改动 |
| **删除首/中/末条与补存回归** | 删除第 500 条后 `count=999`，正反序 200 页（共 400 页）连续序号检查通过；再补存 1 条分配 `recordId=1001`（不复用已删 ID 500），复位后状态完全一致 |
| **稀疏迁移阈值（22 条 vs 21 条）** | 追加 84 条后依次删除 ID `1..41`（源扇区剩 22 条）不触发迁移；删除第 42 条（剩 21 条）立即启动迁移，无论 `fit` 还是 `new` 路径均完整迁移 21 条并擦除回收源扇区 |
| **4 个持久化边界复位注入** | `migrate_begin`、`migrate_copy`、`migrate_mark`、`migrate_commit` 触发软件复位后，启动扫描均准确识别未完成事务并自动续作完成，最终 `count=42`、`next=85`、`corrupt=0`，无记录丢失或重复 |
| **3 种擦除故障注入** | `erase_start`、`erase_timeout`、`erase_verify` 注入后准确报告错误且拒绝将未验证扇区标空；状态机重扫后自动恢复为 `ready` |
| **硬实时并发与资源水位** | 全程无 IWDG 复位（`iwdg=0`）；AD7190 维持 `2,414～2,420 Hz` 连续采样（`dma_err=0, overrun=0`）；主循环最大单圈耗时约 `6～7 ms`，主栈涂漆（`0xA5A5A5A5`）最低剩余水位 **584 B** |

> 验证收尾规范：全部破坏性测试结束后，再次执行 `record_test cleanup` 将 39 个扇区恢复为空白世代 1，随后将 `APP_RECORD_STORE_VALIDATION_ENABLE` 恢复为 `0` 重新编译量产固件，确保生产镜像中输入 `record_test` 仅返回 `no support now`。
