---
layout: article
title: Cortex-M4 裸机固件分频时间片调度与模块化重构方案
description: 针对嵌入式裸机 Super-Loop 工程常见的巨石文件、周期抖动与 Flash 擦写阻塞问题，设计四级时间片调度器、静态事件总线、页面契约路由与表驱动菜单引擎。
date: 2026-10-14
category: 嵌入式
tags:
  - Cortex-M4
  - N32G455
  - 裸机架构
  - 调度器
  - 重构
---

在基于 Cortex-M4（如 128 MHz、零动态内存 `malloc/free`）的中小型嵌入式设备中，主循环与 UI 逻辑容易随着功能迭代膨胀为数千行的“巨石文件”，引发周期抖动、按键迟滞与显示阻塞。本文提炼一套通用的裸机分频时间片协作调度架构，通过四级周期分频、无锁静态环形事件总线、页面生命周期契约路由以及 Flash 表驱动菜单引擎，实现业务逻辑、高频测控与条带渲染的彻底解耦。底层状态机与外设驱动细节可结合阅读 [裸机 C99 表驱动有限状态机设计与复用指南]({{ '/articles/c99-table-driven-state-machine.html' | relative_url }}) 与 [N32G455 W25Q128 SPI NOR Flash 驱动与非阻塞擦写实践]({{ '/articles/w25q128-spi-flash-driver-guide.html' | relative_url }})。

## 运行环境与现有问题

### 硬件与资源基线

固件运行于裸机环境，SysTick 提供 1 ms 基础时基，主循环通过协作式大循环（Super-Loop）轮询调度各业务与驱动模块：

- **Flash (ROM) / SRAM**：典型配置如 512 KB Flash / 144 KB SRAM，全程禁止动态堆内存分配；
- **显示通路**：240×320 彩屏，采用 8 行条带局部画布（3.84 KB RAM）结合 SPI DMA 异步传输；
- **硬实时传感器**：高精度 ADC 运行于 SPI DMA + 外部引脚中断（高抢占优先级）。

### 常见架构痛点

1. **UI 逻辑过载与巨石文件**：单文件容易达到数千行，页面跳转、测量主页、设置子页、参数校准、字库光栅化与绘图流水线深度耦合，难以维护与独立测试。
2. **主循环周期无序抖动（Cycle Jitter）**：`main.c` 的 `while(1)` 平铺串行调用所有模块的 `Process()`，缺乏执行周期分频与时间片预算。慢速任务（如存储操作或复杂运算）瞬时拉长单圈耗时，导致 1 ms 按键消抖状态机产生迟滞。
3. **外部 NOR Flash 物理擦写阻塞风险**：SPI Flash 扇区擦除耗时数十至数百毫秒，若在主循环中同步等待 `BUSY`，会挤压传感器数据消费与看门狗喂狗窗口。
4. **模块间隐式耦合与硬编码菜单**：各业务模块通过跨层读写全局结构体交互；UI 菜单项的坐标、高亮、步进加减全部硬编码计算，新增参数项需要改动多处绘图代码。

### 重构设计目标

- **行为兼容**：保持既有测量逻辑、按键交互手感与存储二进制格式；
- **零动态内存**：全程禁止 `malloc/free`，所有新增队列、路由表与配置表均驻留静态 SRAM 或 `const` Flash；
- **耗时目标**：主循环常见单圈耗时控制在 `< 2 ms`，减少按键响应抖动，具体耗时需上板测量；
- **职责拆分**：将绘图、页面切换和业务处理拆开，通过接口交互。

## 模块划分

```text
+-------------------------------------------------------------------------+
|                    分频节拍调度器 (main.c / Sched_Run)                   |
|  [1 ms 硬实时]     [10 ms 测控解算]    [100 ms 低频状态]   [Idle 分片]  |
|  按键扫描/消抖     AD7190队列/峰值判定  电池ADC/方向/时钟   UI条带/Flash |
+--------+-------------------+-------------------+----------------+-------+
         |                   |                   |                |
         v                   v                   v                |
+------------------------------------------------------------+    |
|          静态无锁环形事件总线 (app_event / Ring Buffer)      |    |
|    生产者: 按键单击/长按、超载报警、记录保存完成、标定事件     |    |
+----------------------------+-------------------------------+    |
                             | AppEvent_Poll                      |
                             v                                    v
+-------------------------------------------------------------------------+
|                     UI 子系统解耦与表驱动渲染管线                         |
|  app_ui_router (顶层页面路由 + 顶栏/底栏公共区绘制)                      |
|    ├─► app_ui_page_main   (测量主页: 40px 读数 + 动态量程波形)           |
|    ├─► app_ui_page_menu   (通用表驱动菜单引擎 + Flash const 配置表)      |
|    ├─► app_ui_page_calib  (传感器六点标定向导)                           |
|    └─► app_ui_page_record (测试记录分页浏览与单条/整表删除)              |
|                             │                                           |
|                             ▼                                           |
|  app_ui_engine (240×8 条带裁剪画布 + 字库光栅化 + 基础图元)               |
+-------------------------------------------------------------------------+
```

## 一、按周期调度主循环任务

### 四级任务时间片模型

将平铺在 `main()` 中的约 20 个 `Process()` 按实时性敏感度划分为 4 个等级：

| 等级 | 调度周期 | 覆盖模块 | 耗时预算与设计约束 |
| --- | :---: | --- | --- |
| **Level 0：硬实时输入** | **1 ms** | `AppButtons_Process()`、`AppController_Process()` | 单次耗时 `< 50 μs`，确保按键消抖与长按计时无累积误差 |
| **Level 1：测控与算法** | **10 ms** | `AppAd7190_Process()`、`AppTest_Process()`、`Buzzer_Process()` | 消费传感器环形队列、力值滤波、峰值/破断判定与蜂鸣器节拍，单次 `< 200 μs` |
| **Level 2：低频状态量** | **100 ms** | `BatteryAdc_Process()`、`DirAdc_Process()`、`AppState_Process()` | 电池电量、方向重力检测、页面 10 Hz 脏检查 |
| **Level 3：空闲分片任务** | **自适应轮询** | `LcdSt7789_Process()`、`AppUi_Process()`、`AppRecordStore_Process()` | 每圈最多推进 1 个 8 行 LCD 条带和 1 次 Flash `BUSY` 状态查询，严禁阻塞 |

### 用无符号差值判断周期

用 `uint32_t` 无符号差值判断周期，可以处理毫秒计数器约 49.7 天后的回绕。这里要求两次检查之间不跨过完整的计数周期；分频本身不能消除任务执行造成的延迟：

```c
static void Sched_Run(void)
{
    uint32_t currentTick = PlatformTime_GetMs();

    /* Level 0: 1 ms 高频输入检测 */
    if ((uint32_t)(currentTick - s_lastTick1ms) >= 1U)
    {
        s_lastTick1ms = currentTick;
        AppButtons_Process();
        AppController_Process();
    }

    /* Level 1: 10 ms 测控解算与报警节拍 */
    if ((uint32_t)(currentTick - s_lastTick10ms) >= 10U)
    {
        s_lastTick10ms = currentTick;
        AppAd7190_Process();
        AppTest_Process();
        Buzzer_Process();
    }

    /* Level 2: 100 ms 慢速状态采集 */
    if ((uint32_t)(currentTick - s_lastTick100ms) >= 100U)
    {
        s_lastTick100ms = currentTick;
        BatteryAdc_Process();
        DirAdc_Process();
        AppState_Process();
    }

    /* Level 3: 非阻塞背景分片推进（LCD 条带 DMA 收尾/提交 + Flash 状态轮询） */
    LcdSt7789_Process();
    AppUi_Process();
    AppRecordStore_Process();

    /* 主循环唯一安全喂狗点 */
    Iwdg_Feed();
}
```

### 交互式在线演示：四级分频协作调度器与无锁环形总线

下面的演示按 1 ms、10 ms、100 ms 推进任务，并在空闲时刷新条带。点击按键或超载按钮可以向队列投递事件，再单步观察任务执行和事件消费。演示用于说明调度顺序，不代表实板耗时。

<div class="article-interactive-widget" id="sched-demo-app" aria-label="四级分频时间片调度器交互演示">
  <div class="aiw-header">
    <span class="aiw-badge">INTERACTIVE WIDGET · 裸机调度沙箱</span>
    <h3 class="aiw-title">四级分频时间片协作调度器与静态环形总线演示</h3>
    <p class="aiw-desc">仿真 <code>Sched_Run()</code> 调度模型：Level 0 (1ms) 消抖、Level 1 (10ms) 测控解算、Level 2 (100ms) 状态量、Level 3 空闲分片 LCD 条带渲染与 10 槽无锁环形事件解耦。</p>
  </div>
  <div class="aiw-body">
    <div class="aiw-stats" aria-label="调度器全局指标">
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">SysTick 时钟基准</span>
        <span class="aiw-stat-value accent" id="sched-stat-tick">0 ms</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">各级任务触发统计</span>
        <span class="aiw-stat-value" id="sched-stat-cycle">L0:0 | L1:0 | L2:0</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">LCD 8行条带分片渲染</span>
        <span class="aiw-stat-value warn" id="sched-stat-strip">条带 1/40 (行 0..7)</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">环形事件总线占用</span>
        <span class="aiw-stat-value" id="sched-stat-q">0 / 10 (空闲)</span>
      </div>
    </div>

    <div>
      <div class="aiw-section-title">
        <span>四级任务分频执行通道 (Task Frequency Levels)</span>
        <span class="aiw-hint">绿色指示灯闪烁表示当前 Tick 满足周期判定并执行</span>
      </div>
      <div class="sched-levels-grid">
        <div class="sched-level-card" id="sched-card-l0">
          <div class="sched-level-top">
            <span class="sched-level-title">Level 0: 1 ms 硬实时</span>
            <span class="sched-level-indicator"></span>
          </div>
          <div class="sched-level-func">AppButtons_Process()</div>
          <div class="sched-level-meta">
            <span>按键消抖/长按</span>
            <span>预算 &lt; 50 μs</span>
          </div>
        </div>

        <div class="sched-level-card" id="sched-card-l1">
          <div class="sched-level-top">
            <span class="sched-level-title">Level 1: 10 ms 测控</span>
            <span class="sched-level-indicator"></span>
          </div>
          <div class="sched-level-func">AppAd7190_Process()</div>
          <div class="sched-level-meta">
            <span>力值滤波/破断判定</span>
            <span>预算 &lt; 200 μs</span>
          </div>
        </div>

        <div class="sched-level-card" id="sched-card-l2">
          <div class="sched-level-top">
            <span class="sched-level-title">Level 2: 100 ms 慢速</span>
            <span class="sched-level-indicator"></span>
          </div>
          <div class="sched-level-func">BatteryAdc_Process()</div>
          <div class="sched-level-meta">
            <span>电量/重力/10Hz脏检查</span>
            <span>预算 &lt; 300 μs</span>
          </div>
        </div>

        <div class="sched-level-card" id="sched-card-l3">
          <div class="sched-level-top">
            <span class="sched-level-title">Level 3: 空闲分片</span>
            <span class="sched-level-indicator"></span>
          </div>
          <div class="sched-level-func">AppUi_Process()</div>
          <div class="sched-level-meta">
            <span>8行条带/Flash查询</span>
            <span>非阻塞背景分片</span>
          </div>
        </div>
      </div>
    </div>

    <div class="sched-strip-box">
      <div class="aiw-section-title">
        <span>240×320 屏幕条带渐进刷新管线 (每圈推进 8 行，40 次完成整帧)</span>
        <span class="aiw-hint">消除整屏 153.6 KB 显存占用，仅用 3.84 KB 局部画布</span>
      </div>
      <div class="sched-strip-bar">
        <div class="sched-strip-fill" id="sched-strip-fill" style="width: 2.5%;"></div>
      </div>
    </div>

    <div class="sched-ring-box">
      <div class="aiw-section-title">
        <span>静态无锁环形事件总线 (app_event / Ring Buffer，容量: 10)</span>
        <span class="aiw-hint">Head: 生产者写入 · Tail: 消费者(UI)读取</span>
      </div>
      <div class="sched-ring-track" id="sched-ring-track"></div>
    </div>

    <div>
      <div class="aiw-section-title">
        <span>事件产生 (模拟物理输入与中断)</span>
        <span class="aiw-hint">将异步事件写入环形缓冲区</span>
      </div>
      <div class="aiw-controls">
        <button type="button" class="aiw-btn primary" id="sched-btn-key-click">产生按键单击 (KEY_CLICK)</button>
        <button type="button" class="aiw-btn" id="sched-btn-key-long">产生按键长按 (KEY_LONG)</button>
        <button type="button" class="aiw-btn danger" id="sched-btn-alarm">产生超载急停 (OVERLOAD)</button>
        <button type="button" class="aiw-btn warn" id="sched-btn-burst">突发并发投递 (测试防溢出)</button>
      </div>
    </div>

    <div>
      <div class="aiw-section-title">
        <span>时基步进控制 (SysTick 时钟推进)</span>
        <span class="aiw-hint">以无符号差值驱动 Sched_Run()</span>
      </div>
      <div class="aiw-controls">
        <button type="button" class="aiw-btn primary" id="sched-btn-step1">单步推进 1 ms</button>
        <button type="button" class="aiw-btn" id="sched-btn-step10">步进 10 ms (触发 L0+L1)</button>
        <button type="button" class="aiw-btn" id="sched-btn-step100">步进 100 ms (全等级协同)</button>
        <button type="button" class="aiw-btn" id="sched-btn-run">连续运行</button>
        <button type="button" class="aiw-btn" id="sched-btn-reset">重置时基</button>
      </div>
    </div>

    <div class="aiw-log-panel">
      <div class="aiw-section-title">
        <span>调度执行流与事件消费追踪 (Scheduler Trace)</span>
        <span class="aiw-hint">展示分频调度与环形总线解耦优势</span>
      </div>
      <div class="aiw-log" id="sched-log" aria-live="polite"></div>
    </div>
  </div>
</div>

## 二、拆分 UI 文件和页面接口

### 模块职责切分

将巨石 UI 模块按“渲染引擎 + 页面路由 + 独立业务页”拆分为分层子系统：

| 模块名称 | 核心职责 | 外部依赖边界 |
| --- | --- | --- |
| `ui_engine` | `240×8` 条带画布管理、1-bit 字库光栅化（16/24/40 px）、折线与矩形条带裁剪 | 仅依赖底层 LCD 驱动与字库常量 |
| `ui_router` | 顶层页面切换状态机、按键事件分发、顶部公共状态栏与底部按键提示栏绘制 | 依赖抽象 `UiPageInterface` |
| `ui_page_main` | 测量主页：大字体实时读数、主/次峰值、公差判定指示、动态量程波形曲线 | 依赖运行时测量与波形数据 |
| `ui_page_menu` | 通用表驱动菜单渲染器与基本设定、系统设定等配置表 | 依赖设置参数管理组件 |
| `ui_page_calib` | 传感器标定向导：密码校验、零点与多段载荷采集、保存回退提示 | 依赖校准算法模块 |
| `ui_page_record` | 测试记录清单：分页浏览、单条选择删除、长按 5 秒整表清空确认 | 依赖历史存储引擎 |

### 页面生命周期契约（`UiPageInterface`）

为消除页面与路由器之间的双向循环依赖，所有业务页面统一实现如下函数指针表：

```c
typedef struct
{
    void (*OnEnter)(void);                                      /* 进入页面时初始化局部状态 */
    bool (*OnEvent)(const AppEvent *event);                     /* 处理按键/系统事件，返回 true 表示已消费 */
    void (*OnDrawStrip)(uint16_t stripY, uint16_t stripHeight); /* 绘制当前 8 行条带内的页面内容 */
    void (*OnExit)(void);                                       /* 离开页面时清理或触发保存 */
} UiPageInterface;
```

顶层路由器调度页面切换与事件分发，并内置“跨页物理释放锁存（Wait-Release Latch）”，防止长按切页误触发新页面的长按操作：

```c
static const UiPageInterface *s_currentPage = NULL;
static bool s_waitReleaseLatch = false;

void UiRouter_Switch(const UiPageInterface *newPage)
{
    if ((newPage == NULL) || (newPage == s_currentPage))
    {
        return;
    }
    if (s_currentPage != NULL && s_currentPage->OnExit != NULL)
    {
        s_currentPage->OnExit();
    }
    s_currentPage = newPage;
    /* 跨页防误触锁存：切页后必须等待所有物理按键松开，才允许新页面响应下一次按键 */
    s_waitReleaseLatch = true;
    if (s_currentPage->OnEnter != NULL)
    {
        s_currentPage->OnEnter();
    }
}
```

当条带渲染管线遍历 40 个条带（`stripY` 从 `0` 到 `312`，步进 `8`）时，由 `ui_router` 统一编排：

1. 绘制全局公共顶部状态栏（`y ∈ [0, 23]`）；
2. 调用当前活动页面的 `OnDrawStrip(stripY, 8)` 绘制中部业务区；
3. 绘制全局公共底部操作提示栏（`y ∈ [296, 319]`）。

## 三、用只读表描述菜单

用 `const MenuItemConfig` 表描述菜单项并放入 Flash，由通用渲染器计算坐标和反色框，减少逐项手写的重复代码：

```c
typedef enum
{
    MENU_TYPE_SUBPAGE = 0,   /* 子菜单跳转入口 */
    MENU_TYPE_INT_RANGE,     /* 整数范围步进调节（如背光亮度、归零时间） */
    MENU_TYPE_ENUM_CYCLE,    /* 枚举列表循环切换（如单位、测试模式、语言） */
    MENU_TYPE_ACTION_CONFIRM /* 动作二次确认弹窗（如恢复默认设置） */
} MenuItemType;

typedef struct
{
    const char   *label;           /* 菜单项标签（或三语词条 ID） */
    MenuItemType  type;            /* 控件类型 */
    void         *boundValue;      /* 绑定的设置变量指针 */
    int32_t       minValue;        /* 最小值 */
    int32_t       maxValue;        /* 最大值 */
    int32_t       stepValue;       /* 步进值 */
    const char  **enumDisplayList; /* 枚举显示文本表 */
    void        (*onChanged)(void);/* 修改即时生效回调 */
} MenuItemConfig;
```

新增或调整一个菜单项只需在 `const MenuItemConfig[]` 数组中添加一行声明；通用的菜单页面渲染器负责焦点移动、视口滚动、编辑态反色高亮、数值边界夹紧与退出保存：

```c
void Menu_DrawStrip(const MenuItemConfig *items, uint8_t count, uint8_t focusIndex,
                    uint16_t stripY, uint16_t stripHeight)
{
    for (uint8_t i = 0; i < count; i++)
    {
        int16_t itemY = (int16_t)(MENU_TOP_OFFSET + i * MENU_ITEM_HEIGHT);
        /* 条带裁剪：仅当菜单项垂直区间落在当前条带内时才执行绘制 */
        if ((itemY + MENU_ITEM_HEIGHT <= (int16_t)stripY) ||
            (itemY >= (int16_t)(stripY + stripHeight)))
        {
            continue;
        }
        bool isFocus = (i == focusIndex);
        /* 在条带画布中渲染菜单文本、反色高亮框与当前绑定数值 */
        Canvas_DrawMenuItem(items[i].label, itemY, isFocus);
    }
}
```

## 四、用静态队列传递事件

为避免按键、采样报警、存储完成等模块直接跨层修改 UI 状态，在 SRAM 中开辟固定 16 槽位的环形事件队列：

```c
typedef enum
{
    EVT_NONE = 0,
    EVT_KEY_CLICK,       /* 参数: KeyID */
    EVT_KEY_LONG_PRESS,  /* 参数: KeyID */
    EVT_KEY_RELEASE_ALL, /* 全部按键物理松开 */
    EVT_DATA_ALARM,      /* 参数: 告警方向与数值 */
    EVT_RECORD_SAVED,    /* 参数: 记录槽位或状态码 */
    EVT_BATTERY_LOW,     /* 参数: 剩余电量百分比 */
    EVT_CALIB_DONE       /* 参数: 标定结果状态码 */
} AppEventId;

typedef struct
{
    AppEventId id;
    uint16_t   param1;
    uint32_t   param2;
} AppEvent;
```

完整的环形队列收发逻辑如下，实现生产者与消费者的零动态内存解耦：

```c
#define EVENT_QUEUE_CAPACITY (16U)

typedef struct
{
    AppEvent buffer[EVENT_QUEUE_CAPACITY];
    uint8_t  head;
    uint8_t  tail;
    uint8_t  count;
} EventQueue;

static EventQueue s_eventQueue;

bool AppEvent_Post(AppEventId id, uint16_t param1, uint32_t param2)
{
    if (s_eventQueue.count >= EVENT_QUEUE_CAPACITY)
    {
        return false; /* 队列满，丢弃并报警 */
    }
    s_eventQueue.buffer[s_eventQueue.tail].id = id;
    s_eventQueue.buffer[s_eventQueue.tail].param1 = param1;
    s_eventQueue.buffer[s_eventQueue.tail].param2 = param2;
    s_eventQueue.tail = (uint8_t)((s_eventQueue.tail + 1U) % EVENT_QUEUE_CAPACITY);
    s_eventQueue.count++;
    return true;
}

bool AppEvent_Poll(AppEvent *outEvent)
{
    if ((s_eventQueue.count == 0U) || (outEvent == NULL))
    {
        return false;
    }
    *outEvent = s_eventQueue.buffer[s_eventQueue.head];
    s_eventQueue.head = (uint8_t)((s_eventQueue.head + 1U) % EVENT_QUEUE_CAPACITY);
    s_eventQueue.count--;
    return true;
}
```

- **发布方（Producers）**：按键模块识别到短按/长按、测控模块识别到超载或完成快照时，仅调用 `AppEvent_Post()` 向队列压入事件；
- **消费方（Dispatcher）**：`UiRouter_Process()` 每轮从队列头取出一个事件，优先交给当前活动页面的 `OnEvent()` 处理；若当前页面未消费，再由顶层路由器兜底处理全局事件（如超载提示或低电告警）。

## 风险防控与工程验收准则

| 风险点 | 防控措施 |
| --- | --- |
| 函数拆分后栈局部变量增大导致栈溢出 | 严禁在函数栈上分配超过 64 字节的局部数组；所有条带画布、帧快照与菜单表统一使用 `static` 或 `const` |
| 长按按键切页后继续误触发新页面长按动作 | 按键状态机在跨页跳转时执行“等待物理释放锁存（Wait-Release Latch）”，必须松手后才允许新页面响应下一次按下 |
| 异步 Flash 擦写期间突发掉电 | 记录存储层采用两阶段提交与世代控制环，未完成整条记录校验前绝不擦除上一代有效索引 |

每次合入重构改动前，检查以下事项：

- [ ] **编译与内存审计**：编译器全量构建达到 `0 Error`，核对 `.map` 文件中 `Code + RO-data` 与 `RW + ZI` 增量符合预算。
- [ ] **时序确定性验证**：在开启高频传感器连续采样（如 2 kHz+）、LCD 连续翻页刷新与外部 Flash 后台扇区擦除并发条件下，按键短按/长按响应无粘滞，看门狗无复位，采样队列无溢出（`overrun == 0`）。
- [ ] **前端演示同步**：涉及可见 UI 布局或交互规则变更时，同步更新网页交互模拟器并运行自检脚本。
