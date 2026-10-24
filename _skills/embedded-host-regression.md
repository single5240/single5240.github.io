---
layout: skill
title: 嵌入式 C/C++ 主机逻辑回归与测试报告 (embedded-host-regression)
skill_id: embedded-host-regression
description: 为状态机、按键、协议、算法和存储建立电脑端回归测试，接入生产源码并输出规范测试报告。
category: common
category_label: 通用与工程基建
scope: global
target: 嵌入式 C/C++ (裸机 / RTOS 可分离逻辑) + GCC / Clang / TinyCC
order: 5
tags:
  - 主机回归
  - 单元测试
  - 故障注入
  - 虚拟时间
  - 测试报告
related_article: c99-table-driven-state-machine
related_demo: /projects/n32g455-tensile/
---

在嵌入式固件开发中，状态机、按键处理、通信协议拆包与组帧、数值计算及掉电存储恢复等纯逻辑模块，往往可以脱离特定 MCU 硬件与漫长的实机烧录周期，在电脑主机（Host PC）侧建立极高执行效率的逻辑回归测试。本技能指导如何安全接入生产源码、利用虚拟时间推进时序、建立双端通信与故障注入模型，并输出符合工程规范的结构化测试报告与执行证据。

## SKILL.md 元数据

```yaml
---
name: embedded-host-regression
description: >-
  [Scope: global] 为嵌入式 C/C++ 的状态机、按键、协议、算法和存储恢复建立、维护或运行电脑端回归测试。
  适用于复现逻辑缺陷、验证边界与错误恢复、联合测试收发两端；不用于替代 MCU 原工具链构建、真实硬件时序或实板验收。
---
```

## 1. 适用范围与判断标准

- **技术方向**：`common`（通用与工程基建）
- **使用范围 (Scope)**：`global`（跨单片机裸机与 RTOS 应用通用）
- **核心定位**：主机回归用于快速复现逻辑缺陷、穷举边界参数与验证错误恢复机制，**绝不能替代** MCU 目标工具链编译（如 Keil/IAR）、真实硬件外设电气时序与实板验收。

### 什么时候引入主机回归？

1. **优先复用既有体系**：修改代码前先查阅项目 `AGENTS.md` 与已有测试入口，优先运行既有回归套件。
2. **适用高收益场景**：
   - 按键短按/长按消抖与跨页锁存状态机；
   - 现场总线（UART/Modbus/CAN/私有协议）解包状态机与双端收发联合验证；
   - 掉电恢复算法与乒乓双槽校验逻辑；
   - 浮点/定点传感器非线性标定与滤波算法。
3. **不适用或需控制边界的场景**：
   - 仅纯文档、代码注释或无逻辑影响的小改，不强制新增测试；
   - 涉及硬件电气时序、DMA 总线竞争、ISR 抢占优先级、时钟树配置或低功耗休眠时，必须以原工具链构建和实板仪器观测为主要证据。
4. **工具链与环境纪律**：
   - 不为跑测试擅自将 MCU 目标编译器迁移至 GCC，不擅自向裸机工程塞入 RTOS 依赖或第三方重型单元测试框架；
   - 测试夹具与测试主程序只留在主机侧，绝不污染量产固件源文件。

---

## 2. 接入当前生产源码原则

1. **直读当前被测源码**：
   - 严禁在测试目录中手抄一份“修正版”业务逻辑副本；
   - 必须直接引入实际生产源码目录中的 `.c` 与 `.h` 文件，通过编译参数配置路径与必要的芯片抽象宏。
2. **轻量链接替身（Link Stubs）**：
   - 剥离硬件依赖时，通过独立实现的替身函数提供时钟（Tick）、GPIO 读写、底层收发与存储介质读写；
   - 严禁为了测试方便而在生产代码中开大口子暴露大批内部私有静态变量。
3. **虚拟时间推进（Virtual Time）**：
   - 丢弃依赖电脑系统 `sleep()` 的脆弱测试方式；
   - 将系统 Tick 作为受控输入传入，或者通过测试框架主动控制节拍累加，并在节拍推进后主动调用轮询服务函数，秒级完成长达数十分钟的超时与回绕边界遍历。
4. **故障注入模型（Fault Injection）**：
   - 模拟介质必须受控注入典型异常：物理丢包、单字节乱序校验错、旧轮次令牌冲突、写入中途截断断电等；
   - 模拟器不能“好心”帮待测代码自动补发漏包或自动猜出 ACK。

---

## 3. 测试设计与故障模型

根据测试对象梳理“前提 → 输入/事件 → 预期状态与输出”，严防设计误区：

| 测试对象 | 必须覆盖的行为 | 常见认知误区 |
| :--- | :--- | :--- |
| **按键状态机** | 短触碰、长按临界点、按键组合顺序、释放隔离、退出后再按 | 仅测试一次静态按压，未测试抖动与释放交接 |
| **状态机与调度** | 合法转移路径、非法事件兜底、重入、在取消瞬间发生完成事件 | 仅测试枚举定义上的标准开心路径（Happy Path） |
| **定时器与超时** | 临界点前 1 Tick、恰好到期、超时后、`uint32_t` 溢出回绕安全 | 在电脑端调用 `sleep()` 假装真实硬件时钟 |
| **通信协议** | 长度边界、校验错误、帧碎片、重复帧、延迟旧包、网络丢包 | 假设信道永远绝对可靠，忽略收发两端状态异步 |
| **持久化存储** | 介质为空、数据损坏校验失败、版本不兼容、两阶段提交中断点 | 模拟存储数组永远成功，甚至自动在后台修复坏块 |
| **算法与换算** | 独立 Golden 向量、极端边界、饱和截断、整型隐式提升截断 | 用被测算法的反向公式去校验正向输出 |

### 虚拟时间回绕设计原则

对 `uint32_t` 无符号差值超时逻辑（如 `(uint32_t)(now - start) >= TIMEOUT`），必须在用例中显式构造接近 `UINT32_MAX` 的初始时间（例如 `UINT32_MAX - 500U`），验证在跨越 `0x00000000` 翻转后的超时判定依然完全成立。

### 双端收发联合测试原则

将真实的发送端组帧逻辑与真实的接收端解析逻辑连通，中间只放可注入故障的虚拟管道。分别验证“发送端发出”、“管道传输状态”、“接收端收到”及“接收端业务提交”四个阶段，严禁在发送端保存成功后，臆断接收端也必然已同步持久化成功。

---

## 4. 验证边界与交付证据

明确各层验证手段所能回答的核心问题：

| 验证层级 | 能够证明什么 | 绝对不能证明什么 |
| :--- | :--- | :--- |
| **主机回归测试** | 在所设定输入、事件序列与故障模型下的 C 纯逻辑正确性 | MCU 真实指令周期、寄存器配置、外设总线时序与物理实时性 |
| **原目标工具链构建** | 在特定编译器（ARMCC 5 等）下的语法合规性、符号链接与内存占用 | 固件在真实硬件上的运行时行为正确无误 |
| **仿真器 / 硬件模拟** | 在指定外设与 CPU 软件模型下的模拟行为 | 未建模的模拟量毛刺、电源抖动及真实电路板电气行为 |
| **实板仪器实测** | 固件在特定硬件版本、特定温湿度与特定连线下的实际观测行为 | 未经实测覆盖的全部极端工况与长周期稳定性 |

### 目标架构差异防御

1. **类型位宽对齐**：核对电脑主机（通常 64 位，`long` / 指针为 8 字节）与目标 MCU（通常 32 位或 8 位，指针为 4/2 字节）在位域、结构体填充与对齐上的差异；协议与存储必须强制按固定字节序序列化，绝不直接将内存结构体强转存盘。
2. **严防编译器方言泄漏**：电脑端 GCC/Clang 宽容支持的 C99/GNU 扩展语法，在嵌入式旧编译器（如 ARMCC 5）中可能会报严重语法错误，因此主机通过后依然必须执行目标工具链编译检查。
3. **并发与中断隔离**：主机上的单线程顺序模拟无法模拟物理 MCU 中断抢占时的数据撕裂，`volatile` 声明并不等于原子操作；DMA 缓冲区的生命周期与 CPU Cache 一致性必须单独由人工架构审查把关。

---

## 5. 教学范例与验证执行

本技能配套提供了状态机超时回绕及双端协议通信两套极简规范范例：

### 1. 运行范例与负向敏感性自检

在安装有 Python 3 与 C 编译器（GCC / Clang / TinyCC）的环境中：

```bash
# 正常运行所有教学示例
python scripts/run_examples.py --cc tcc

# 运行包含故意引错的负向敏感性检查（验证测试框架能否灵敏检出逻辑缺陷）
python scripts/run_examples.py --cc tcc --negative-checks
```

- 脚本在独立的系统临时目录下执行，绝不污染源码树；
- 负向检查仅临时在内存副本中注入错误（如修改超时阈值或校验反转），证明用例具备真实的故障拦截能力。

---

<h2 id="ref-test-reporting">参考文档：测试报告与执行记录规范 (references/test-reporting.md)</h2>

参考 GB/T 38634.3 与 ISO/IEC/IEEE 29119-3 标准裁剪，统一固件逻辑回归的证据交付口径：

### 状态定义与统计纪律

| 状态标记 | 权威含义 |
| :--- | :--- |
| **PASS** | 测试用例已实际执行，实际观察到的状态与输出完全符合预期 |
| **FAIL** | 测试用例已实际执行，实际结果与预期存在偏差（拦截到缺陷） |
| **BLOCKED** | 编译失败、缺少环境依赖或前置夹具异常，阻碍了用例运行 |
| **NOT RUN** | 未执行，或当前记录不足以佐证执行结果（严禁隐瞒） |
| **N/A** | 当前配置或项目类型不适用，附带理由说明 |

- **统计口径严格分离**：用例总数、测试组数、断言数（Assertions）及物理设备数分别列出，不可混为一谈；
- **负向检查不是产品缺陷**：针对测试夹具故意注入的预期失败，若成功触发断言，记为“负向敏感性验证通过”；
- **自动事实与人工结论明确边界**：自动化脚本负责记录开始时间、编译器版本、完整命令行、退出码、源码 SHA256 哈希及原始日志；需求覆盖判定、未测风险说明与最终发布授权由工程师人工确认签名。

---

<h2 id="template-test-report">工程模板：嵌入式逻辑回归测试报告模板 (assets/test-report-template.md)</h2>

以下模板可直接复制至项目的 `docs/test-reports/` 目录下按需裁剪：

```markdown
# 嵌入式主机逻辑回归测试报告

## 1. 身份与测试依据
- **报告编号 / 版本**：TR-20261024-001 / Rev 1.0
- **执行时间与时区**：2026-10-24 10:15:00 UTC+8
- **执行人 / 任务**：自动化 CI 运行器 / 固件工程师
- **被测工程与模块**：N32G455 固件 / APP_StateMachine & ProtoLink
- **源码 Commit / 状态**：`05d55b8` (Clean, 无未提交修改)
- **需求与协议依据**：通信协议规范 V2.4 第 4 节

## 2. 目标与验证范围
- **本次修改内容**：优化状态机超时退出机制，修复在系统 Tick 回绕临界点的卡死 Bug。
- **纳入生产源码**：`APP/session.c`, `APP/link.c`
- **明确未覆盖项**：硬件 SPI DMA 中断抢占、外部 Flash 实际擦除延时。

## 3. 环境与模型配置
- **主机环境 / 编译器**：Windows 11 / GCC 13.2.0 (x86_64-w64-mingw32)
- **目标芯片 / 原工具链**：Nationstech N32G455 / Keil MDK ARMCC 5.06 update 7
- **硬件替身说明**：使用 32 位虚拟 Tick 发生器与内存 FIFO 模拟通信管道。
- **故障模型注入**：注入 1 次 CRC 校验反转、1 次双端令牌不同步。

## 4. 测试用例执行矩阵

| 用例 ID | 测试场景与目标 | 前置条件与输入 | 预期结果 | 实际观察 | 状态 | 关联日志证据 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `TC-SM-01` | 正常运行至 12s 超时退出 | 启动会话，Tick=100 | Tick=12100 时 active=0 | 完全符合 | **PASS** | `log.txt#L14` |
| `TC-SM-02` | `UINT32_MAX` 回绕点超时 | start=0xFFFFFE0C | 12000 Tick 后正确关闭 | 完全符合 | **PASS** | `log.txt#L28` |
| `TC-PK-01` | 损坏帧与未知令牌拒收 | 注入破坏 CRC 的 5 字节帧 | 接收端保持初始状态 | 拦截成功 | **PASS** | `log.txt#L45` |
| `TC-PK-02` | 漏收切换通知后的保存隔离 | 发送端已换信道，接收端漏收 | 接收端拒绝盲目写入 | 写入次数=0 | **PASS** | `log.txt#L62` |

**统计汇总**：计划 4 项，执行 4 项；**PASS: 4**, FAIL: 0, BLOCKED: 0, NOT RUN: 0。

## 5. 执行证据与归档
- **执行命令**：`gcc -Wall -Wextra -I./APP session.c test_session.c -o test_sm && ./test_sm`
- **返回代码**：`0`
- **原始证据留存**：`artifacts/logs/regression_summary.json`

## 6. 原目标工具链与实板验证对比

| 验证层级 | 执行状态 | 实际结果与证据 |
| :--- | :--- | :--- |
| **Keil 原工程无头构建** | **PASS** | UV4.exe 编译 0 错误 0 警告，Flash 增量 +12 字节 |
| **实板逻辑分析仪时序观测** | **NOT RUN** | 待上板抓取实际 SPI CS 与 DOUT 响应时序 |
| **掉电物理注入测试** | **NOT RUN** | 待硬件测试台进行连续 500 次继电器随机掉电冲击 |

## 7. 缺陷、限制与综合结论
- **模型局限性**：主机回归通过仅证明状态机在逻辑时间步进下的正确性，不代表芯片晶振精度或真实中断嵌套安全。
- **综合评估**：逻辑修改通过基线验收，允许合并至主干，等待实板烧录联调。
```

---

<h2 id="example-code-fixtures">参考源码：状态机与双端通信主机测试夹具</h2>

### 1. 状态机超时与无符号回绕测试 (`test_session.c`)

```c
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>

/* 引入业务头文件 */
#include "session.h"

#define CHECK(x) do { \
    if (!(x)) { \
        fprintf(stderr, "FAIL line %d: %s\n", __LINE__, #x); \
        return 1; \
    } \
} while (0)

int main(void)
{
    DemoSession s;
    uint32_t start;

    /* 场景 1：基础生命周期与精确超时边界 (12,000 Tick) */
    demo_start(&s, 100U);
    demo_process(&s, 12099U); CHECK(s.active);
    demo_process(&s, 12100U); CHECK(!s.active);
    demo_process(&s, 20000U); CHECK(!s.active);

    /* 场景 2：重新启动应立即刷新周期，电脑端无需真实等待 12 秒 */
    demo_start(&s, 30000U);
    demo_start(&s, 31000U);
    demo_process(&s, 42000U); CHECK(s.active);
    demo_process(&s, 43001U); CHECK(!s.active);

    /* 场景 3：uint32_t 溢出回绕边界验证 */
    start = UINT32_MAX - 500U;
    demo_start(&s, start);
    demo_process(&s, (uint32_t)(start + 11999U)); CHECK(s.active);
    demo_process(&s, (uint32_t)(start + 12000U)); CHECK(!s.active);

    puts("PASS: session deadline, restart, delayed service, uint32 wrap");
    return 0;
}
```

### 2. 双端通信独立向量与丢包测试 (`test_link.c`)

```c
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include "link.h"

#define CHECK(x) do { \
    if (!(x)) { \
        fprintf(stderr, "FAIL line %d: %s\n", __LINE__, #x); \
        return 1; \
    } \
} while (0)

int main(void)
{
    DemoReceiver r = {3, 3, 0, 0};
    uint8_t tx[5], bad[5], controller_saved;

    /* 场景 1：独立已知 Golden 向量对比，不调用组帧函数自我验证 */
    const uint8_t golden[5] = {7, 0x34, 0x12, 0x31, 0x7e};
    demo_frame(tx, 7, 0x1234, DEMO_SWITCH);
    CHECK(memcmp(tx, golden, 5) == 0);

    /* 场景 2：残缺长度与校验和损坏防御 */
    demo_receive(&r, tx, 4); CHECK(r.current == 3);
    demo_receive(&r, NULL, 5); CHECK(r.current == 3);
    memcpy(bad, tx, 5); bad[4] ^= 1;
    demo_receive(&r, bad, 5); CHECK(r.current == 3);

    /* 场景 3：丢失切换通知：保存命令绝不能让未参与的接收端盲目换信道 */
    demo_frame(tx, 7, 0x1234, DEMO_SAVE);
    demo_receive(&r, tx, 5); CHECK(r.saved == 3 && r.writes == 0);

    demo_frame(tx, 7, 0x1234, DEMO_SWITCH);
    demo_receive(&r, tx, 5); CHECK(r.current == 7 && r.saved == 3);

    /* 场景 4：重复帧防护，避免多次重写非易失存储 */
    demo_receive(&r, tx, 5); CHECK(r.current == 7 && r.writes == 0);

    /* 场景 5：模拟发送端漏收：单端保存不虚构为双端成功 */
    controller_saved = 7;
    demo_frame(tx, 7, 0x1234, DEMO_SAVE); /* 故意不交付给接收端 */
    CHECK(controller_saved == 7 && r.saved == 3);

    demo_receive(&r, tx, 5); CHECK(r.saved == 7 && r.writes == 1);
    demo_receive(&r, tx, 5); CHECK(r.writes == 1); /* 重复保存不累加写入 */

    puts("PASS: known frame, length, checksum, loss, token, duplicate save, return");
    return 0;
}
```
