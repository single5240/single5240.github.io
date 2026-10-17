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

> 本文记录数显式拉力计 HW1.4（N32G455REL7，Cortex-M4 @ 128 MHz，ARMCC 5，零 `malloc/free`）从早期的单文件巨石主循环演进为**四级分频时间片调度 + 页面契约路由 + 表驱动菜单 + 非阻塞存储**的完整架构设计方案。底层状态机与外设驱动细节可结合阅读 [裸机 C99 表驱动有限状态机设计与复用指南]({{ '/articles/c99-table-driven-state-machine.html' | relative_url }}) 与 [N32G455 W25Q128 SPI NOR Flash 驱动与非阻塞擦写实践]({{ '/articles/w25q128-spi-flash-driver-guide.html' | relative_url }})。

## 系统基线与早期架构痛点

### 硬件与编译资源基线

固件运行于裸机环境，SysTick 提供 1 ms 基础时基，主循环通过协作式大循环（Super-Loop）轮询调度约 20 个业务与驱动模块：

- **Flash (ROM)**：已用约 174 KB / 512 KB（利用率约 34%）；
- **SRAM (RAM)**：已用约 29 KB / 144 KB（利用率约 20%）；
- **显示通路**：240×320 彩屏，采用 8 行条带局部画布（3.84 KB RAM）结合 SPI1 DMA 异步传输；
- **硬实时传感器**：AD7190（24-bit 测力 ADC）运行于 SPI2 DMA + EXTI14（抢占优先级 1）。

### 早期核心架构债务

1. **巨石文件聚合度过高**：早期 `app_ui_home.c` 膨胀至 **4,200+ 行（约 140 KB）**，将页面跳转、测量主页、5 个设置子页、标定向导、历史记录浏览、字库光栅化、折线裁剪与条带流水线全部混杂在单一文件中，认知与修改成本极高。
2. **主循环周期无序抖动（Cycle Jitter）**：`main.c` 的 `while(1)` 平铺串行调用所有模块的 `Process()`，缺乏执行周期分频与时间片预算。慢速任务（如复杂页面重算或存储操作）会瞬时拉长单圈耗时，导致 1 ms 按键消抖状态机产生迟滞。
3. **外部 NOR Flash 物理擦写阻塞风险**：W25Q128 扇区擦除耗时 45～400 ms，若在主循环中同步等待 `WIP/BUSY`，会直接挤压采样消费与看门狗喂狗窗口。
4. **模块间隐式耦合与硬编码菜单**：各业务模块通过跨层读写全局结构体交互；UI 菜单项的坐标、高亮、步进加减全部硬编码计算，新增参数项需要改动多处绘图代码。

### 重构设计目标

- **零破坏性**：100% 保持既有测量逻辑、按键交互手感与存储二进制格式；
- **零动态内存**：全程禁止 `malloc/free`，所有新增队列、路由表与配置表均驻留静态 SRAM 或 `const` Flash；
- **确定性时延**：主循环常见单圈耗时控制在 `< 2 ms`，消除按键响应抖动；
- **高内聚低耦合**：拆分巨石文件，建立清晰的模块接口契约。

## 整体重构架构全景

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

## 方案一：分频时间片协作调度器（消除主循环抖动）

### 四级任务时间片模型

将平铺在 `main()` 中的约 20 个 `Process()` 按实时性敏感度划分为 4 个等级：

| 等级 | 调度周期 | 覆盖模块 | 耗时预算与设计约束 |
| --- | :---: | --- | --- |
| **Level 0：硬实时输入** | **1 ms** | `AppButtons_Process()`、`AppController_Process()` | 单次耗时 `< 50 μs`，确保按键消抖与长按计时无累积误差 |
| **Level 1：测控与算法** | **10 ms** | `AppAd7190_Process()`、`AppTest_Process()`、`Buzzer_Process()` | 消费传感器环形队列、力值滤波、峰值/破断判定与蜂鸣器节拍，单次 `< 200 μs` |
| **Level 2：低频状态量** | **100 ms** | `BatteryAdc_Process()`、`DirAdc_Process()`、`AppState_Process()` | 电池电量、方向重力检测、页面 10 Hz 脏检查 |
| **Level 3：空闲分片任务** | **自适应轮询** | `LcdSt7789_Process()`、`AppUi_Process()`、`AppRecordStore_Process()` | 每圈最多推进 1 个 8 行 LCD 条带和 1 次 Flash `BUSY` 状态查询，严禁阻塞 |

### 防回绕无符号差值调度核心

采用 C99 `uint32_t` 无符号减法判断到达周期，天然免疫 `SysTick` 在运行约 49.7 天（`0xFFFFFFFF ms`）后的回绕溢出：

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

## 方案二：UI 巨石文件拆分与页面接口契约

### 模块职责切分

将原 `app_ui_home.c` 按“渲染引擎 + 页面路由 + 独立业务页”拆分为正交模块：

| 模块名称 | 核心职责 | 外部依赖边界 |
| --- | --- | --- |
| `app_ui_engine` | `240×8` 条带画布管理、1-bit 字库光栅化（16/24/40 px）、折线与矩形条带裁剪 | 仅依赖 `drv_lcd_st7789` 与 `font_*` |
| `app_ui_router` | 顶层页面切换状态机、按键事件分发、顶部公共状态栏与底部按键提示栏绘制 | 依赖抽象 `UiPageInterface` |
| `app_ui_page_main` | 测量主页：大字体实时读数、主/次峰值、公差判定指示、动态量程波形曲线 | 依赖 `app_waveform`、`app_runtime_data` |
| `app_ui_page_menu` | 通用表驱动菜单渲染器与基本设定、系统设定等配置表 | 依赖 `app_settings`、`app_param_store` |
| `app_ui_page_calib` | 传感器标定向导：密码校验、零点与多段载荷采集、保存回退提示 | 依赖 `app_calibration` |
| `app_ui_page_record` | 测试记录清单：分页浏览、单条选择删除、长按 5 秒整表清空确认 | 依赖 `app_record_store` |

### 页面生命周期契约（`UiPageInterface`）

为消除页面与路由器之间的双向循环依赖，所有业务页面统一实现如下函数指针表：

```c
typedef struct
{
    void (*OnEnter)(void);                                      /* 进入页面时初始化局部状态 */
    bool (*OnEvent)(AppUiEventType event);                      /* 处理按键/系统事件，返回 true 表示已消费 */
    void (*OnDrawStrip)(uint16_t stripY, uint16_t stripHeight); /* 绘制当前 8 行条带内的页面内容 */
    void (*OnExit)(void);                                       /* 离开页面时清理或触发保存 */
} UiPageInterface;
```

当条带渲染管线遍历 40 个条带（`stripY` 从 `0` 到 `312`，步进 `8`）时，由 `app_ui_router` 统一编排：

1. 绘制全局公共顶部状态栏（`y ∈ [0, 23]`）；
2. 调用当前活动页面的 `OnDrawStrip(stripY, 8)` 绘制中部业务区；
3. 绘制全局公共底部操作提示栏（`y ∈ [296, 319]`）。

## 方案三：Flash 驻留的表驱动菜单引擎

将设置菜单的每一行抽象为只读结构体 `MenuItemConfig` 并加 `const` 放入 Flash，彻底消除每个菜单项手写坐标与反色框的重复代码：

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

新增或调整一个菜单项只需在 `const MenuItemConfig[]` 数组中添加一行声明；通用的菜单页面渲染器仅用约 200 行代码即可自动完成焦点移动、视口滚动、编辑态反色高亮、数值边界夹紧与退出保存。

## 方案四：轻量静态环形事件总线

为避免按键、采样报警、存储完成等模块直接跨层修改 UI 状态，在 SRAM 中开辟固定 16 槽位的环形事件队列：

```c
typedef enum
{
    EVT_NONE = 0,
    EVT_KEY_CLICK,       /* 参数: KeyID */
    EVT_KEY_LONG_PRESS,  /* 参数: KeyID */
    EVT_FORCE_OVERLIMIT, /* 参数: 超载方向与力值 */
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

- **发布方（Producers）**：按键模块识别到短按/长按、测控模块识别到超载或完成快照时，仅调用 `AppEvent_Post()` 向队列压入事件；
- **消费方（Dispatcher）**：`AppUi_Process()` 每轮从队列头取出一个事件，优先交给当前活动页面的 `OnEvent()` 处理；若当前页面未消费，再由顶层路由器兜底处理全局事件（如超载提示或低电告警）。

## 风险防控与工程验收准则

| 风险点 | 防控措施 |
| --- | --- |
| 函数拆分后栈局部变量增大导致栈溢出 | 严禁在函数栈上分配超过 64 字节的局部数组；所有条带画布、帧快照与菜单表统一使用 `static` 或 `const` |
| 长按按键切页后继续误触发新页面长按动作 | 按键状态机在跨页跳转时执行“等待物理释放锁存（Wait-Release Latch）”，必须松手后才允许新页面响应下一次按下 |
| 异步 Flash 擦写期间突发掉电 | 记录存储层采用两阶段提交与世代控制环，未完成整条记录校验前绝不擦除上一代有效索引 |

每次架构演进切片合入前，统一执行以下验证闭环：

- [ ] **编译与内存审计**：Keil MDK-ARM（ARMCC V5.06 update 6）全量 Rebuild 达到 `0 Error`，核对 `.map` 文件中 `Code + RO-data` 与 `RW + ZI` 增量符合预算。
- [ ] **时序确定性验证**：在开启 AD7190 连续采样、LCD 连续翻页刷新与 W25Q128 后台扇区擦除并发条件下，按键短按/长按响应无粘滞，看门狗无复位，AD7190 环形队列 `overrun_count == 0`。
- [ ] **前端演示同步**：涉及可见 UI 布局或交互规则变更时，同步更新网页交互模拟器并运行自检脚本。
