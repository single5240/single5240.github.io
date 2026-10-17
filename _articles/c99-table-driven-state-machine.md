---
layout: article
title: 裸机 C99 表驱动有限状态机设计与复用指南
description: 零动态内存、不依赖特定 MCU 或 RTOS 的 C99 通用表驱动有限状态机（FSM）实现，内置静态 FIFO 事件队列、状态自环事件与初始化配置合法性自检。
date: 2026-10-08
category: 嵌入式
tags:
  - C99
  - 状态机
  - 裸机架构
  - 嵌入式软件
---

> 本文整理自数显式拉力计 HW1.4 固件中的通用状态机组件（`state_machine.h/.c`）。该模块采用纯静态内存设计，不依赖具体 MCU 外设、RTOS、系统时钟或动态内存（`malloc/free`），可直接复制到任何 C99 嵌入式工程中复用。

## 模块特性与适用场景

在裸机主循环（Super-Loop）中，随着业务状态和异步事件增多，多层嵌套的 `switch-case` 和散落的标志位极易演化为难以维护的状态迷宫。本模块通过轻量表驱动架构提供以下能力：

- **声明式状态转移表**：以静态常量表集中描述“当前状态 + 触发事件 → 动作函数 + 下一状态”；
- **内置静态 FIFO 事件队列**：队列数组由调用方显式提供，零堆内存分配；
- **空闲自环事件（Loop Event）**：当外部事件队列为空时，自动执行当前状态绑定的周期循环事件；
- **有界非阻塞调度**：每次调用 `StateMachine_Process()` 最多消费并执行一个事件，保证主循环单圈耗时可预测；
- **业务上下文解耦**：通过 `void *userContext` 向动作函数传递业务数据，状态机内核不保存任何业务全局变量；
- **初始化期配置自检**：在 `StateMachine_Init()` 阶段自动拦截越界状态、越界事件、重复转移项和缺失的循环转移。

## 运行模型与调度流程

一条状态转移由四元组构成：

```text
{ 触发事件 event, 当前状态 currentState, 动作函数 action, 下一状态 nextState }
```

单次 `StateMachine_Process()` 的执行路径如下：

```text
调用 StateMachine_Process(machine)
  │
  ├─ 1. 检查实例、配置表与当前状态是否有效？
  │      └─ 否 ──► 返回 STATE_MACHINE_PROCESS_INVALID
  │
  ├─ 2. 检查 FIFO 事件队列是否非空？
  │      ├─ 非空 ──► 从队列头部弹出最早到达的外部事件 event
  │      └─ 为空 ──► 取出当前状态对应的循环事件 config->loopEvents[currentState]
  │
  ├─ 3. 按顺序扫描 config->transitions 转移表，匹配 (event, currentState)
  │      ├─ 未找到匹配项 ──► 状态保持不变，返回 STATE_MACHINE_PROCESS_IGNORED
  │      └─ 找到匹配项 ───► (a) 若 action != NULL，调用 action(machine, userContext)
  │                         (b) 将 currentState 更新为 nextState
  │                         (c) 返回 STATE_MACHINE_PROCESS_HANDLED
```

需要注意一个关键语义：**动作函数 `action()` 在 `currentState` 更新之前执行**。因此动作函数内部读取 `StateMachine_GetState()` 得到的是转移前的源状态；动作函数中通过 `StateMachine_PostEvent()` 投递的新事件会进入 FIFO 队列尾部，留待后续的 `Process()` 调用处理，不会在当前调用栈中发生递归重入。

## 交互式内核演示：状态转移与事件调度

为直观理解表驱动状态机在单圈主循环中的流转机制，下方提供了一个可在浏览器中实时交互的内核模拟器。你可以向 8 槽静态 FIFO 队列投递外部事件、单步推进 `StateMachine_Process()`、观察空闲自环（Loop Event）的自动保活机制，以及转移表匹配行的高亮与动作函数执行顺序：

<div class="article-interactive-widget" id="fsm-demo-app" aria-label="C99 表驱动状态机交互演示">
  <div class="aiw-header">
    <span class="aiw-badge">INTERACTIVE WIDGET · 纯前端模拟</span>
    <h3 class="aiw-title">C99 表驱动有限状态机内核交互模拟器</h3>
    <p class="aiw-desc">模拟 <code>StateMachine_Process()</code> 单步调度：FIFO 外部事件出队、无符号自环（Loop Event）保活、静态转移表匹配与动作函数分派。</p>
  </div>
  <div class="aiw-body">
    <div class="aiw-stats" aria-label="状态机运行时状态">
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">当前状态 (State)</span>
        <span class="aiw-stat-value accent" id="fsm-stat-state">IDLE (待机)</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">调度事件 (Event)</span>
        <span class="aiw-stat-value" id="fsm-stat-event">就绪</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">执行动作 (Action)</span>
        <span class="aiw-stat-value" id="fsm-stat-action">无</span>
      </div>
      <div class="aiw-stat-item">
        <span class="aiw-stat-label">FIFO 事件队列堆积</span>
        <span class="aiw-stat-value warn" id="fsm-stat-qcount">0 / 8 (空闲)</span>
      </div>
    </div>

    <div>
      <div class="aiw-section-title">
        <span>状态拓扑节点 (State Nodes)</span>
        <span class="aiw-hint">高亮带光圈者为当前活跃状态</span>
      </div>
      <div class="fsm-states-grid">
        <div class="fsm-state-card is-active" data-state-id="0">
          <div class="fsm-active-tag">ACTIVE</div>
          <div class="fsm-state-name">STATE_IDLE [0]</div>
          <div class="fsm-state-loop">Loop: EVENT_IDLE_LOOP</div>
        </div>
        <div class="fsm-state-card" data-state-id="1">
          <div class="fsm-active-tag">ACTIVE</div>
          <div class="fsm-state-name">STATE_RUNNING [1]</div>
          <div class="fsm-state-loop">Loop: EVENT_RUNNING_LOOP</div>
        </div>
        <div class="fsm-state-card" data-state-id="2">
          <div class="fsm-active-tag">ACTIVE</div>
          <div class="fsm-state-name">STATE_PEAK_HOLD [2]</div>
          <div class="fsm-state-loop">Loop: EVENT_PEAK_LOOP</div>
        </div>
        <div class="fsm-state-card" data-state-id="3">
          <div class="fsm-active-tag">ACTIVE</div>
          <div class="fsm-state-name">STATE_ALARM [3]</div>
          <div class="fsm-state-loop">Loop: EVENT_ALARM_LOOP</div>
        </div>
      </div>
    </div>

    <div class="fsm-queue-box">
      <div class="aiw-section-title">
        <span>静态 FIFO 外部事件队列 (容量: 8，循环数组环形回绕)</span>
        <span class="aiw-hint">H: 写入头指针(Head) · T: 读取尾指针(Tail)</span>
      </div>
      <div class="fsm-queue-slots" id="fsm-queue-slots"></div>
    </div>

    <div>
      <div class="aiw-section-title">
        <span>外部事件投递 (模拟 ISR 中断或按键事件)</span>
        <span class="aiw-hint">调用 StateMachine_PostEvent()</span>
      </div>
      <div class="aiw-controls">
        <button type="button" class="aiw-btn primary" data-fsm-event="EVENT_START">投递 START (启动)</button>
        <button type="button" class="aiw-btn" data-fsm-event="EVENT_STOP">投递 STOP (停止)</button>
        <button type="button" class="aiw-btn" data-fsm-event="EVENT_PEAK">投递 PEAK (捕捉峰值)</button>
        <button type="button" class="aiw-btn danger" data-fsm-event="EVENT_ALARM">投递 ALARM (超载急停)</button>
        <button type="button" class="aiw-btn warn" data-fsm-event="EVENT_RESET">投递 RESET (故障复位)</button>
      </div>
    </div>

    <div>
      <div class="aiw-section-title">
        <span>主循环内核单步推进 (StateMachine_Process)</span>
        <span class="aiw-hint">每次调用最多消费 1 个事件</span>
      </div>
      <div class="aiw-controls">
        <button type="button" class="aiw-btn primary" id="fsm-btn-step">单步调度 Process()</button>
        <button type="button" class="aiw-btn" id="fsm-btn-auto">连续自动运行</button>
        <button type="button" class="aiw-btn" id="fsm-btn-reset">重置状态机</button>
      </div>
    </div>

    <div>
      <div class="aiw-section-title">
        <span>C99 转移表匹配状态 (config->transitions)</span>
        <span class="aiw-hint">绿色行表示当前 Process() 命中的转移项</span>
      </div>
      <div class="fsm-table-container">
        <table class="fsm-table">
          <thead>
            <tr>
              <th>触发事件 (event)</th>
              <th>源状态 (currentState)</th>
              <th>执行动作 (action)</th>
              <th>目标状态 (nextState)</th>
              <th>语义说明</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>EVENT_START</td><td>STATE_IDLE</td><td>Demo_Start</td><td>STATE_RUNNING</td><td>启动测试，清零计数并进入运行态</td></tr>
            <tr><td>EVENT_STOP</td><td>STATE_RUNNING</td><td>Demo_Stop</td><td>STATE_IDLE</td><td>手动停止测试，退出运行并归零</td></tr>
            <tr><td>EVENT_PEAK</td><td>STATE_RUNNING</td><td>Demo_PeakHold</td><td>STATE_PEAK_HOLD</td><td>捕捉到峰值点，锁存当前最大力值</td></tr>
            <tr><td>EVENT_STOP</td><td>STATE_PEAK_HOLD</td><td>Demo_Stop</td><td>STATE_IDLE</td><td>从峰值保持退出，返回空闲待机</td></tr>
            <tr><td>EVENT_ALARM</td><td>STATE_IDLE</td><td>Demo_Alarm</td><td>STATE_ALARM</td><td>待机超载安全报警</td></tr>
            <tr><td>EVENT_ALARM</td><td>STATE_RUNNING</td><td>Demo_Alarm</td><td>STATE_ALARM</td><td>测试超载立即急停并报警</td></tr>
            <tr><td>EVENT_ALARM</td><td>STATE_PEAK_HOLD</td><td>Demo_Alarm</td><td>STATE_ALARM</td><td>保持期超载急停并报警</td></tr>
            <tr><td>EVENT_RESET</td><td>STATE_ALARM</td><td>Demo_Reset</td><td>STATE_IDLE</td><td>操作员清除报警，复位回到待机</td></tr>
            <tr><td>EVENT_IDLE_LOOP</td><td>STATE_IDLE</td><td>NULL</td><td>STATE_IDLE</td><td>空闲状态周期自环保活</td></tr>
            <tr><td>EVENT_RUNNING_LOOP</td><td>STATE_RUNNING</td><td>Demo_RunningLoop</td><td>STATE_RUNNING</td><td>测试采样中自环 (满4次自动报峰值)</td></tr>
            <tr><td>EVENT_PEAK_LOOP</td><td>STATE_PEAK_HOLD</td><td>Demo_PeakLoop</td><td>STATE_PEAK_HOLD</td><td>峰值保持状态维持当前读数</td></tr>
            <tr><td>EVENT_ALARM_LOOP</td><td>STATE_ALARM</td><td>Demo_AlarmLoop</td><td>STATE_ALARM</td><td>声光报警周期自环交替闪烁</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="aiw-log-panel">
      <div class="aiw-section-title">
        <span>内核执行轨迹日志 (Execution Trace)</span>
        <span class="aiw-hint">动作执行发生在状态更新前</span>
      </div>
      <div class="aiw-log" id="fsm-log" aria-live="polite"></div>
    </div>
  </div>
</div>

## 完整源码实现

### 头文件：`state_machine.h`

```c
/**
 * @file state_machine.h
 * @brief 无动态内存依赖的通用表驱动状态机。
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
    StateMachineEvent event;
    StateMachineState currentState;
    StateMachineAction action;
    StateMachineState nextState;
} StateMachineTransition;

typedef struct
{
    const StateMachineTransition *transitions;
    const StateMachineEvent *loopEvents;
    uint16_t transitionCount;
    uint16_t stateCount;
    uint16_t eventCount;
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
    StateMachineEvent *eventQueue;
    void *userContext;
    StateMachineState currentState;
    uint16_t queueCapacity;
    uint16_t eventReadIndex;
    uint16_t eventWriteIndex;
    uint16_t eventCount;
} StateMachine;

/* 配置表和队列存储的生命周期必须长于 machine。接口默认在单执行上下文调用。 */
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

### 源文件：`state_machine.c`

```c
/**
 * @file state_machine.c
 * @brief 无动态内存依赖的通用表驱动状态机。
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

## 最小可运行示例

下面演示一个包含 `IDLE` 和 `RUNNING` 两个状态的最小闭环：收到 `START` 事件后进入 `RUNNING`，执行 3 次循环动作后自动投递 `STOP` 事件切回 `IDLE`。

```c
#include "state_machine.h"
#include <stdio.h>

#define DEMO_QUEUE_SIZE   (4U)
#define ARRAY_SIZE(array) (sizeof(array) / sizeof((array)[0]))

typedef enum
{
    DEMO_STATE_IDLE = 0,
    DEMO_STATE_RUNNING,
    DEMO_STATE_COUNT
} DemoState;

typedef enum
{
    DEMO_EVENT_IDLE_LOOP = 0,
    DEMO_EVENT_RUNNING_LOOP,
    DEMO_EVENT_START,
    DEMO_EVENT_STOP,
    DEMO_EVENT_COUNT
} DemoEvent;

typedef struct
{
    StateMachine machine;
    StateMachineEvent queue[DEMO_QUEUE_SIZE];
    uint32_t runningCount;
} DemoContext;

static void Demo_Start(StateMachine *machine, void *userContext)
{
    DemoContext *context = (DemoContext *)userContext;
    (void)machine;
    context->runningCount = 0U;
    printf("start\n");
}

static void Demo_RunningLoop(StateMachine *machine, void *userContext)
{
    DemoContext *context = (DemoContext *)userContext;
    context->runningCount++;
    printf("running: %lu\n", (unsigned long)context->runningCount);
    if (context->runningCount >= 3U)
    {
        (void)StateMachine_PostEvent(machine, DEMO_EVENT_STOP);
    }
}

static void Demo_Stop(StateMachine *machine, void *userContext)
{
    (void)machine;
    (void)userContext;
    printf("stop\n");
}

static const StateMachineEvent demoLoopEvents[DEMO_STATE_COUNT] =
{
    DEMO_EVENT_IDLE_LOOP,
    DEMO_EVENT_RUNNING_LOOP
};

static const StateMachineTransition demoTransitions[] =
{
    {DEMO_EVENT_IDLE_LOOP,    DEMO_STATE_IDLE,    NULL,             DEMO_STATE_IDLE},
    {DEMO_EVENT_RUNNING_LOOP, DEMO_STATE_RUNNING, Demo_RunningLoop, DEMO_STATE_RUNNING},
    {DEMO_EVENT_START,        DEMO_STATE_IDLE,    Demo_Start,       DEMO_STATE_RUNNING},
    {DEMO_EVENT_STOP,         DEMO_STATE_RUNNING, Demo_Stop,        DEMO_STATE_IDLE}
};

static const StateMachineConfig demoConfig =
{
    demoTransitions,
    demoLoopEvents,
    (uint16_t)ARRAY_SIZE(demoTransitions),
    (uint16_t)DEMO_STATE_COUNT,
    (uint16_t)DEMO_EVENT_COUNT
};

int main(void)
{
    DemoContext context;
    uint32_t index;

    if (!StateMachine_Init(&context.machine,
                           &demoConfig,
                           DEMO_STATE_IDLE,
                           context.queue,
                           DEMO_QUEUE_SIZE,
                           &context))
    {
        return 1;
    }

    (void)StateMachine_PostEvent(&context.machine, DEMO_EVENT_START);

    for (index = 0U; index < 6U; index++)
    {
        (void)StateMachine_Process(&context.machine);
    }

    return 0;
}
```

## 状态表设计准则与工程实践

### 1. 每个状态必须绑定循环事件

即使某个状态在空闲时无事可做，也必须在 `loopEvents` 中指定一个循环事件，并在转移表中配置一条空动作自环：

```c
{EVENT_IDLE_LOOP, STATE_IDLE, NULL, STATE_IDLE}
```

`StateMachine_IsConfigValid()` 会在初始化时强制检查每个状态是否都存在对应的循环转移，防止遗漏状态分支。

### 2. 动作函数保持非阻塞与无符号超时计算

动作函数必须快速返回，任何耗时的外设等待（如 Flash 擦写、传感器稳定等待）都应拆分为循环事件中的非阻塞轮询，并使用无符号差值计算超时以天然兼容 32 位计数器回绕：

```c
static void Action_WaitLoop(StateMachine *machine, void *userContext)
{
    MyContext *ctx = (MyContext *)userContext;

    if (Peripheral_IsDone())
    {
        (void)StateMachine_PostEvent(machine, EVENT_OP_DONE);
    }
    else if ((uint32_t)(PlatformTime_GetMs() - ctx->startTick) >= ctx->timeoutMs)
    {
        (void)StateMachine_PostEvent(machine, EVENT_OP_TIMEOUT);
    }
}
```

### 3. 中断与多线程边界

本模块默认在**单一执行上下文**（如裸机主循环或单个 RTOS 任务）中调用，内部不加锁也不开关中断：

- **裸机环境**：ISR 中只置硬件标志位或写入专用的单生产者无锁环形缓冲，由主循环轮询标志后调用 `StateMachine_PostEvent()` 并推进 `StateMachine_Process()`。
- **RTOS 环境**：由单个专属任务持有状态机实例，其他任务或中断通过 RTOS 消息队列向该任务投递事件。

## 单元测试与集成检查清单

- [ ] 合法配置可正常初始化；空指针、零容量、越界状态/事件、重复 `(currentState, event)` 或缺失循环转移时 `StateMachine_Init()` 返回 `false`。
- [ ] FIFO 队列读写索引跨队尾回绕正确；队列满时拒绝新事件并返回 `false`，不覆盖已有未处理事件。
- [ ] 每次 `StateMachine_Process()` 最多消费一个事件；队列非空时优先消费外部事件，队列为空时才执行当前状态的循环事件。
- [ ] 故障、急停、关机等安全事件在所有可能触发的状态下均配置了转移条目。
