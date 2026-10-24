---
layout: skill
title: 裸机表驱动状态机与主循环四级分频调度架构 (baremetal-table-fsm-and-scheduler)
skill_id: baremetal-table-fsm-and-scheduler
description: 用 C99 转移表组织状态机，按 1 ms、10 ms、100 ms 和空闲时间调度任务，通过队列传递事件。
category: mcu-baremetal
category_label: 单片机裸机开发
scope: global
target: All MCU (C99 Bare-Metal, ARMCC 5 / ARMClang / GCC / XC8)
order: 13
tags:
  - 有限状态机
  - 协作调度器
  - C99
  - 零动态内存
---

## SKILL.md 元数据

```yaml
---
name: baremetal-table-fsm-and-scheduler
description: >-
  [Scope: global] 零动态内存 C99 表驱动有限状态机（FSM）、主循环四级时间片协作调度器、静态环形事件总线与条带 UI 页面路由解耦架构。
  当用户需要设计或重构裸机主循环（Super-Loop）、消除 while(1) 周期抖动、将数千行巨石 UI/控制代码拆分为表驱动状态机与页面契约时使用此技能。
---
```

## 1. 适用范围

- **技术方向**：`mcu-baremetal`
- **使用范围 (Scope)**：`global`（全平台 C99 裸机通用，提炼自 N32G455 量产架构与重构方案）
- **适用硬件与场景**：无 RTOS 的单片机前后台工程（ARMCC 5 / ARMClang / GCC / XC8），严格禁止 `malloc/free` 动态内存，要求主循环单圈耗时确定（如 `< 2 ms`）且安全维护独立看门狗（IWDG）。

## 2. 状态机、调度与页面接口

### 2.1 零动态内存表驱动状态机 (`state_machine.c/.h`)

- **四元组转移表**：`{ event, currentState, action, nextState }` 作为 `const` 数据放入 Flash。
- **静态 FIFO 事件队列 + 空闲循环事件 (`loopEvents`)**：
  - 调用方提供静态数组作为事件队列；每次 `StateMachine_Process()` 最多消费 **1 个事件**；动作函数也需要及时返回。
  - 当事件队列为空时，自动取当前状态绑定的 `loopEvents[currentState]` 触发周期性背景动作，无需高频向队列塞入 Tick 事件。
  - **动作先于状态更新**：`action(machine, userContext)` 在 `currentState = nextState` 之前执行，便于动作函数读取转移前状态或投递后续事件。
- **初始化期全表自检 (`StateMachine_IsConfigValid`)**：
  - `StateMachine_Init()` 自动校验：状态/事件越界、重复的 `(currentState, event)` 转移项、以及每个状态是否都定义了合法的 `loopEvents` 转移。

> C99 状态机参考代码见 [examples/state_machine.h](#example-fsm-h) 与 [examples/state_machine.c](#example-fsm-c)。

### 2.2 主循环四级分频时间片调度器（防回绕）

将平铺在 `main.c` `while(1)` 中的十几个 `*_Process()` 按周期分为 4 组，使用**无符号 32 位差值 `(uint32_t)(now - last) >= period`** 处理约 49.7 天后的计数器回绕；两次检查之间不能跨过完整计数周期：

| 调度等级 | 周期 | 典型模块 | 单次耗时预算与约束 |
| :--- | :---: | :--- | :--- |
| **Level 0: 硬实时输入** | **1 ms** | 按键扫描消抖 (`MultiButton`)、急停/接点检测 | `< 50 μs`，消除消抖累积误差 |
| **Level 1: 测控与算法** | **10 ms** | 传感器 FIFO 排空、峰值/破断状态机、蜂鸣器节拍 | `< 200 μs`，确定性控制步长 |
| **Level 2: 慢速状态量** | **100 ms** | 电池 ADC、方向 ADC、软件日历推进、PD0 心跳灯 | `< 100 μs`，低频轮询降噪 |
| **Level 3: 空闲分片任务** | **每轮 1 步** | LCD 8 行条带 DMA 渲染、Flash 非阻塞擦写轮询、RTT CLI | 每次调用仅推进 1 个状态步或 1 个条带 |

### 2.3 静态环形事件总线 (`AppEventQueue`)

- 开辟固定 16 槽（约 128B SRAM）的无锁环形队列 `{ AppEventId id; uint16_t param1; uint32_t param2; }`。
- 按键、超载保护、存储完成等生产者仅调用 `AppEvent_Post()`，由顶层 UI 路由器或业务控制器统一 `AppEvent_Poll()` 消费，减少模块间直接调用和共享全局状态。

### 2.4 UI 文件拆分与页面接口 (`UiPageInterface`)

当单一 UI 文件超过 1,000 行时，按 **`Engine`（条带画布与图元） + `Router`（顶层状态机与公共状态栏） + `Page_*`（独立页面）** 拆分，所有页面实现统一契约：

```c
typedef struct {
    void (*OnEnter)(void);
    bool (*OnEvent)(AppUiEventType event);
    void (*OnDrawStrip)(uint16_t stripY, uint16_t stripHeight);
    void (*OnExit)(void);
} UiPageInterface;
```

## 3. 操作步骤

1. **上电初始化顺序门禁**：
   - 严格遵循：`系统时钟/NVIC` → `无阻塞基础外设 Init` → `含长阻塞的 LCD Init / Flash 上电扫描` → `高频连续采样 DMA Start (如 AD7190)` → **最后启动 `Iwdg_Init()`**。
2. **接入表驱动状态机**：
   - 将复杂的 `switch-case` 嵌套业务改写为 `const StateMachineTransition` 表；在模块初始化时断言 `StateMachine_Init(...) == true`。
3. **收敛唯一安全喂狗点**：
   - 全工程仅在 `main.c` 主循环末尾调用一次 `Iwdg_Feed()`；严禁在定时器 ISR、外设驱动死等循环或 UI 绘制中途喂狗。

## 4. 关键安全与并发约束检查清单

- [ ] **单上下文约定**：`StateMachine_PostEvent()` 默认在主循环同一执行上下文调用；若需从 ISR 投递事件，必须在 `PostEvent` 与 `TakeEvent` 的 `eventCount` 读改写处加极短关中断临界区。
- [ ] **禁止长阻塞潜入分片任务**：Level 3 空闲分片任务（如 Flash 擦除或列表扫描）单次 `Process()` 严禁包含 `while(busy)`，必须拆成 `START -> POLL -> VERIFY` 状态步。

## 5. 验证方法

1. **状态机配置自检**：验证 `StateMachine_Init()` 对故意构造的重复转移或缺失 `loopEvents` 返回 `false`。
2. **主循环周期抖动实测**：通过 RTT `stat` 命令（或翻转测试 GPIO）观测高负载（边刷屏边写 Flash）下的主循环最大周期，确认远低于看门狗超时阈值。

<h2 id="example-fsm-h">代码范例：examples/state_machine.h</h2>

```c
/**
 * @file state_machine.h
 * @brief Generic table-driven state machine without dynamic allocation.
 */
#ifndef STATE_MACHINE_H
#define STATE_MACHINE_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stdbool.h>
#include <stdint.h>

typedef uint16_t StateMachineState;
typedef uint16_t StateMachineEvent;

struct StateMachine;

typedef void (*StateMachineAction)(struct StateMachine *machine, void *userContext);

typedef struct
{
    StateMachineEvent  event;
    StateMachineState  currentState;
    StateMachineAction action;
    StateMachineState  nextState;
} StateMachineTransition;

typedef struct
{
    const StateMachineTransition *transitions;
    const StateMachineEvent      *loopEvents;
    uint16_t                      transitionCount;
    uint16_t                      stateCount;
    uint16_t                      eventCount;
} StateMachineConfig;

typedef enum
{
    STATE_MACHINE_PROCESS_HANDLED = 0,
    STATE_MACHINE_PROCESS_IGNORED,
    STATE_MACHINE_PROCESS_INVALID
} StateMachineProcessResult;

typedef struct StateMachine
{
    const StateMachineConfig *config;
    StateMachineEvent        *eventQueue;
    void                     *userContext;
    StateMachineState         currentState;
    uint16_t                  queueCapacity;
    uint16_t                  eventReadIndex;
    uint16_t                  eventWriteIndex;
    uint16_t                  eventCount;
} StateMachine;

/* Config tables and queue storage must outlive machine. Single-context by default. */
bool StateMachine_Init(StateMachine *machine,
                       const StateMachineConfig *config,
                       StateMachineState initialState,
                       StateMachineEvent *eventQueue,
                       uint16_t queueCapacity,
                       void *userContext);
void StateMachine_Reset(StateMachine *machine, StateMachineState initialState);
StateMachineProcessResult StateMachine_Process(StateMachine *machine);
bool StateMachine_PostEvent(StateMachine *machine, StateMachineEvent event);
void StateMachine_ClearEvents(StateMachine *machine);
StateMachineState StateMachine_GetState(const StateMachine *machine);

#ifdef __cplusplus
}
#endif

#endif /* STATE_MACHINE_H */
```

<h2 id="example-fsm-c">代码范例：examples/state_machine.c</h2>

```c
/**
 * @file state_machine.c
 * @brief Generic table-driven state machine without dynamic allocation.
 */
#include "state_machine.h"

#include <stddef.h>

static bool StateMachine_IsConfigValid(const StateMachineConfig *config)
{
    uint16_t index;
    uint16_t otherIndex;
    uint16_t state;
    bool loopTransitionFound;

    if ((config == NULL) || (config->transitions == NULL) ||
        (config->loopEvents == NULL) || (config->transitionCount == 0U) ||
        (config->stateCount == 0U) || (config->eventCount == 0U))
    {
        return false;
    }

    for (index = 0U; index < config->stateCount; index++)
    {
        if (config->loopEvents[index] >= config->eventCount)
        {
            return false;
        }
    }

    for (index = 0U; index < config->transitionCount; index++)
    {
        const StateMachineTransition *transition = &config->transitions[index];

        if ((transition->event >= config->eventCount) ||
            (transition->currentState >= config->stateCount) ||
            (transition->nextState >= config->stateCount))
        {
            return false;
        }

        for (otherIndex = (uint16_t)(index + 1U);
             otherIndex < config->transitionCount;
             otherIndex++)
        {
            const StateMachineTransition *otherTransition = &config->transitions[otherIndex];

            if ((transition->event == otherTransition->event) &&
                (transition->currentState == otherTransition->currentState))
            {
                return false;
            }
        }
    }

    for (state = 0U; state < config->stateCount; state++)
    {
        loopTransitionFound = false;
        for (index = 0U; index < config->transitionCount; index++)
        {
            if ((config->transitions[index].currentState == state) &&
                (config->transitions[index].event == config->loopEvents[state]))
            {
                loopTransitionFound = true;
                break;
            }
        }

        if (!loopTransitionFound)
        {
            return false;
        }
    }

    return true;
}

static bool StateMachine_TakeEvent(StateMachine *machine, StateMachineEvent *event)
{
    if ((machine == NULL) || (event == NULL) || (machine->eventCount == 0U))
    {
        return false;
    }

    *event = machine->eventQueue[machine->eventReadIndex];
    machine->eventReadIndex++;
    if (machine->eventReadIndex >= machine->queueCapacity)
    {
        machine->eventReadIndex = 0U;
    }
    machine->eventCount--;
    return true;
}

bool StateMachine_Init(StateMachine *machine,
                       const StateMachineConfig *config,
                       StateMachineState initialState,
                       StateMachineEvent *eventQueue,
                       uint16_t queueCapacity,
                       void *userContext)
{
    if ((machine == NULL) || (eventQueue == NULL) || (queueCapacity == 0U) ||
        !StateMachine_IsConfigValid(config) || (initialState >= config->stateCount))
    {
        return false;
    }

    machine->config = config;
    machine->eventQueue = eventQueue;
    machine->userContext = userContext;
    machine->queueCapacity = queueCapacity;
    machine->currentState = initialState;
    StateMachine_ClearEvents(machine);
    return true;
}

void StateMachine_Reset(StateMachine *machine, StateMachineState initialState)
{
    if ((machine == NULL) || (machine->config == NULL) ||
        (initialState >= machine->config->stateCount))
    {
        return;
    }

    StateMachine_ClearEvents(machine);
    machine->currentState = initialState;
}

StateMachineProcessResult StateMachine_Process(StateMachine *machine)
{
    StateMachineEvent event;
    uint16_t index;

    if ((machine == NULL) || (machine->config == NULL) ||
        (machine->eventQueue == NULL) ||
        (machine->currentState >= machine->config->stateCount))
    {
        return STATE_MACHINE_PROCESS_INVALID;
    }

    /* Idle processing uses the current state's loop event without queueing it. */
    if (!StateMachine_TakeEvent(machine, &event))
    {
        event = machine->config->loopEvents[machine->currentState];
    }

    for (index = 0U; index < machine->config->transitionCount; index++)
    {
        const StateMachineTransition *transition = &machine->config->transitions[index];

        if ((transition->event == event) &&
            (transition->currentState == machine->currentState))
        {
            if (transition->action != NULL)
            {
                transition->action(machine, machine->userContext);
            }
            machine->currentState = transition->nextState;
            return STATE_MACHINE_PROCESS_HANDLED;
        }
    }

    return STATE_MACHINE_PROCESS_IGNORED;
}

bool StateMachine_PostEvent(StateMachine *machine, StateMachineEvent event)
{
    if ((machine == NULL) || (machine->config == NULL) ||
        (machine->eventQueue == NULL) || (event >= machine->config->eventCount) ||
        (machine->eventCount >= machine->queueCapacity))
    {
        return false;
    }

    machine->eventQueue[machine->eventWriteIndex] = event;
    machine->eventWriteIndex++;
    if (machine->eventWriteIndex >= machine->queueCapacity)
    {
        machine->eventWriteIndex = 0U;
    }
    machine->eventCount++;
    return true;
}

void StateMachine_ClearEvents(StateMachine *machine)
{
    if (machine == NULL)
    {
        return;
    }

    machine->eventReadIndex = 0U;
    machine->eventWriteIndex = 0U;
    machine->eventCount = 0U;
}

StateMachineState StateMachine_GetState(const StateMachine *machine)
{
    if (machine == NULL)
    {
        return 0U;
    }

    return machine->currentState;
}
```
