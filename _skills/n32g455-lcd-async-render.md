---
layout: skill
title: N32G455 LCD DMA 异步条带渐进刷新 (n32g455-lcd-async-render)
skill_id: n32g455-lcd-async-render
description: 将 N32G455 上的 ST7789 等 SPI LCD 页面绘制改为 DMA 异步条带渐进刷新，并在不干扰 AD7190 高优先级采集 DMA 的前提下完成 Keil 验证。
category: mcu-baremetal
category_label: 单片机裸机开发
scope: vendor
target: Nationstech N32G455 (Cortex-M4) + ST7789 SPI LCD
order: 7
tags:
  - N32G455
  - ST7789
  - SPI-DMA
  - 条带渲染
related_article: n32g455-spi-dma-guide
related_demo: /projects/n32g455-tensile/
---

> 将同步逐图元或逐矩形刷屏改为：CPU 将当前页面渲染至小型静态 RGB565 条带缓冲，SPI DMA 在后台发送该条带，主循环在传输完成后再生成下一条带。目标是让采样、按键和状态机在页面刷新期间继续调度，而非追求全帧缓存。

## SKILL.md 元数据

```yaml
---
name: n32g455-lcd-async-render
description: "[Scope: vendor] 将 N32G455 上的 ST7789 等 SPI LCD 页面绘制改为 DMA 异步条带渐进刷新，并在不影响既有高优先级采集 DMA 的前提下完成 Keil 验证。适用于裸机 N32G455、RGB565 屏幕和主循环 UI；不用于全帧缓存充足或 RTOS 图形框架已有异步显示驱动的工程。"
---
```

## 1. 先确认的事实

- 先读工程协作说明、LCD 驱动、UI 入口、启动文件和 DMA/IRQ 配置；以源码和芯片手册为准，不按外设名称猜测 DMA 映射。
- 在修改前执行 `git status --short`，保留已有用户改动。明确 LCD 的 SPI、DMA RX/TX 通道、DMA 请求重映射及所有已占用 DMA 通道。
- 对 N32G455 项目，若 AD7190 已使用 DMA1 通道 4/5，则保持其通道、请求映射和中断优先级不变；LCD 仅可继续使用其既有 DMA1 通道 1/2。
- 确认 SPI 的数据宽度、RGB565 端序和 DMA 半字配置与现有同步填充路径一致。没有实测或数据手册依据时，不能假设端序正确。

## 2. 推荐结构

1. 在 UI 中使用静态条带缓冲。默认可从 `240 * 8 * sizeof(uint16_t)`（3840 字节）开始；条带高度必须由可用 RAM、主循环实时性和 SPI 带宽共同决定。
2. 将原有页面绘制原语改为写入带裁剪的内存画布。每次仅写当前条带覆盖的 Y 区间，所有矩形、字符和线段均须检查坐标、宽高及裁剪边界。
3. LCD 驱动提供非阻塞接口：提交一块连续 RGB565 像素、查询忙状态、主循环处理完成/超时、DMA RX 完成 ISR 仅置位状态。不要在 ISR 中轮询 SPI busy、绘制页面或打印日志。
4. DMA 提交前同步写入 `CASET`、`RASET`、`RAMWR`；发送期保持 `CS` 有效。DMA 完成后由主循环确认 `SPI BUSY` 已释放，再关闭 DMA 请求、恢复 8-bit SPI 并释放缓冲。对 DMA 错误和超时必须有停止、清标志和可观测日志。
5. UI 渲染器维护 `active/pending/nextY`。页面或数据变化只置 `pending`；当前帧结束后采集最新页面快照开始下一帧，合并快速变化，避免绘制请求无界积压。
6. 页面快照至少包含页面类型、菜单选择和动态显示文本，防止切页或采样值变化时单帧混入不同状态。背光应在首帧完整发送后开启。

## 3. 并发与优先级

- DMA 正在读取条带缓冲时，绝不能覆写该缓冲；只有 `IsBusy() == false` 后才生成下一条带。
- LCD DMA 完成 IRQ 应低于采样/通信等实时 IRQ。DMA ISR 只读取/清除本通道标志并设置 `volatile` 完成或错误状态；多字节共享状态需要原子性分析。
- DMA RX 完成并不总等价于 SPI 最后一位已发送完。结束 `CS`、切换 SPI 数据宽度前，必须在主循环确认 `SPI BUSY` 标志已清除。
- 保留已有高优先级 DMA 的通道及 IRQ；若 DMA 仲裁优先级会改变采样时序，停止修改并要求用户确认或提供测量依据。

## 4. 验证与交付

- 至少执行 `git diff --check`、审查 `git diff` 和 `git status --short`。不要纳入 Objects、HEX、AXF、MAP、日志或 IDE 用户文件。
- 对 Keil ARMCC 工程，沿用工程已有 Target/工具链做 Rebuild，记录错误和警告；没有实际运行构建时须明确说明。
- 构建通过后仍需实板验证：RGB565 颜色/端序、条带交界、首帧背光时机、快速切页、DMA 超时恢复，以及刷屏时 AD7190 数据连续性。建议用逻辑分析仪或示波器观察 SPI 和 AD7190 RDY/DMA 时序。
- 仅在用户明确要求提交时，暂存本任务文件并创建中文 commit。提交说明应写明 DMA 通道约束、缓冲占用、验证结果和未完成的实板验证。
