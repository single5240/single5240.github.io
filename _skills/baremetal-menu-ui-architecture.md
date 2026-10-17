---
layout: skill
title: 裸机按键交互、表驱动菜单与防撕裂 UI 架构 (baremetal-menu-ui-architecture)
skill_id: baremetal-menu-ui-architecture
description: 裸机嵌入式 LCD 菜单与按键交互架构：长按跨页防误触锁存、驻留 Flash 的表驱动菜单引擎（MenuItem）、条带渲染帧快照（PageSnapshot 防画面撕裂）与多语言固定边界裁剪。
category: mcu-baremetal
category_label: 单片机裸机开发
scope: global
target: All MCU (LCD/OLED Key UI, RGB565 条带刷新)
order: 13
tags:
  - 菜单架构
  - 按键防误触
  - 防画面撕裂
  - 多语言UI
related_demo: /projects/n32g455-tensile/
---

## SKILL.md 元数据

```yaml
---
name: baremetal-menu-ui-architecture
description: >-
  [Scope: global] 裸机嵌入式 LCD 菜单与按键交互架构：长按跨页防误触去抖、Flash 表驱动菜单引擎（MenuItem）、条带渲染帧快照（PageSnapshot 防画面撕裂）与多语言固定边界裁剪。
  当用户需要设计单片机按键+屏幕菜单交互、解决长按切页后继续触发新页面长按确认、消除条带刷屏中途数据跳变撕裂、或实现中/英/繁多语言 UI 布局时使用此技能。
---
```

## 1. 适用范围与背景 (Metadata)

- **技术方向**：`mcu-baremetal`
- **使用范围 (Scope)**：`global`（全平台 MCU 通用，与 [embedded-bitmap-fonts](/projects/my-skills/embedded-bitmap-fonts.html) 及 [n32g455-lcd-async-render](/projects/my-skills/n32g455-lcd-async-render.html) 组成完整的“嵌入式 GUI 三件套”）
- **适用场景**：5~8 键物理按键仪器（如 `ZERO / UNIT / DATA / MENU / PWR`）、无全帧缓冲（采用 8 行条带 DMA 异步刷屏）、多级参数设置菜单、标定向导与历史记录列表。

## 2. 四大核心交互与渲染法则

### 2.1 按键长按跨页锁存法则（防止“一次按住连环触发”）

- **典型事故**：用户在测量首页长按 `DATA` 键满 `2 s` 进入“存储清单”页，手指尚未松开，若列表页继续累计本次按住时长，再过 `3 s` 就会直接误触发列表页的“长按 `5 s` 清空全部记录”！
- **标准解决机制（Cross-Page Hold Lockout）**：
  1. 页面发生切换（`OnEnter`）或触发了一次长按动作后，立即将当前按键标记为 `waitRelease = true`；
  2. 新页面的长按计时器必须在检测到该键**完整经历一次物理释放（去抖后回到空闲态）并再次按下**后，才允许从 `0` 开始计时；
  3. 破坏性长按（如长按 `5 s` 清空全部）到时后**只允许弹出二次确认页（`PWR/ENTER` 确认、`MENU` 取消）**，绝不在长按到时瞬间直接执行擦除或清空。

### 2.2 条带渲染的“单帧不可变快照”法则（Frame-Coherent `PageSnapshot`）

- **典型事故**：240×320 屏幕按 8 行条带分 40 次 DMA 刷新（整帧约 `12~25 ms`）。若第 1~20 条带绘制时读取的是旧力值/旧页面状态，第 21~40 条带绘制时传感器或按键修改了全局变量，屏幕上就会出现**文字上下半截错位（Tearing）或两个页面混画在同一帧**。
- **标准解决机制**：
  - 业务数据变化或按键切页时，**只置位 `s_uiDirty = true`（或 `pending`）**，不在中途打断正在进行的帧条带传输；
  - 当 `stripY == 0`（新的一帧第 0 条带开始前），一次性将当前页面 ID、选中项索引、格式化好的力值文本、波形点集和底部状态栏提示复制到静态 `s_frameSnapshot` 结构体；
  - 随后的 40 个条带 `OnDrawStrip(stripY, 8)` **只允许读取 `s_frameSnapshot`**，严禁在条带绘制函数内直接查询实时变化的业务全局变量。

### 2.3 驻留 Flash 的表驱动菜单引擎 (`const MenuItem`)

- 摒弃为每个设置项手写一套坐标计算与按键加减 `switch-case` 的硬编码做法。
- 将菜单项抽象为驻留 Flash (`const`) 的描述符表：包含多语言标题 ID、类型（子页入口 / 枚举循环 / 数值步进 / 只读展示 / 动作回调）、关联参数 Getter/Setter 或偏移、最小值/最大值/步进值。
- 菜单渲染器按统一的列表行盒模型（Row Box Model，如每页固定显示 `K` 行，自动计算滚动窗口 `[firstVisible, firstVisible + K - 1]`）绘制反色高亮选中行与右侧值文本。

### 2.4 多语言 (`zh-CN / en / zh-TW`) 专用像素盒裁剪法则

- 同一栏位在不同语言下像素宽度差异巨大（如 `"存储失败"` vs `"SAVE FAIL"`，或台湾繁体笔画密集的 16/24 号点阵字）。
- **铁律**：状态栏或底部栏划分为固定互不重叠的逻辑像素矩形（如左区 `[4, 95]` 动作名、中右区 `[98, 185]` 存储提示、右区 `[188, 235]` 公差判定 `+NG`）。绘制每个区域时必须传入该区域的 `clipRect`，**依靠像素级边界裁剪保底，绝不依赖“字符串碰巧够短”**。

> `PageSnapshot` 双缓冲合并机制、`const MenuItem` 表结构与多模式列表选择（阅读模式 vs 单条删除跨页选择模式）详见 [references/menu-table-and-snapshot-pattern.md](#ref-menu-snapshot)。

## 3. 关键安全与用户体验检查清单

- [ ] **首帧背光防花屏门禁**：上电 `Lcd_Init()` 时保持背光关闭（`BL = Low`），必须等待**第一帧完整页面全部 40 个条带发送完毕后**再开启背光（或设置 PWM 亮度档位），彻底消除上电白屏或花屏闪烁。
- [ ] **临时提示与持久化状态优先级**：如底部“存储成功（蓝色 1s）”、“存储已满（红色 1s）”属于带定时器的瞬态提示，“存储失败（红色常亮）”属于锁存提示；当用户按下 `ZERO`、切换测试模式或测试动作时，必须**立即清除所有存储提示**，不等剩余的 `1 s` 到期。
- [ ] **依赖项联动显示**：如“自动归零”设为“关闭”时，其下一行“归零时间”必须显示 `---` 且跳过编辑，但内部 EEPROM 仍保留上次设置的 `1~9 s` 数值，重新开启时原值恢复。

## 4. 验证与调试方法 (Verification)

1. **快速连按与长按边界测试**：
   - 在首页快速连续点击切换动作/单位，同时观察屏幕：无半截字符撕裂、无花屏；
   - 从首页按住 `DATA` 10 秒不松手：2 秒时切入存储列表，继续按住满 10 秒也不会弹出“清空全部”确认框；松手后再按住 5 秒才正常弹出确认框。
2. **三语最宽文本同屏验证**：
   - 将语言分别切为简中、英文、繁中，同时触发最长动作名 + `存储失败/SAVE FAIL` + `+NG`，确认三块区域留有至少 `2 px` 间距且无像素互相覆盖。

<h2 id="ref-menu-snapshot">参考文档：帧一致性快照 (PageSnapshot)、表驱动菜单与列表交互状态机 (references/menu-table-and-snapshot-pattern.md)</h2>

### 1. 条带渲染器的帧快照合并模型 (`active / pending / nextY`)

```text
[IDLE: 上电初始化，背光关闭]
      │  (pending == true)
      ▼
[CAPTURE_SNAPSHOT: 冻结 s_frameSnapshot, pending = false, stripY = 0]
      │
      ▼
[STRIP_RENDER: CPU 渲染 8 行至 s_stripBuf, 启动 SPI DMA]
      │
      ▼
[WAIT_DMA: 等待 DMA 完成 & SPI BUSY == 0]
  ├── stripY + 8 < 320  ──► 回到 [STRIP_RENDER] 渲染下一条带
  └── stripY + 8 >= 320 ──► [FRAME_DONE: 整帧完成，首帧开启背光]
                               ├── 若渲染期间又有新变化置位了 pending == true ──► [CAPTURE_SNAPSHOT]
                               └── 若 pending == false ──► [IDLE]
```

帧快照结构体定义：

```c
typedef struct
{
    uint8_t  pageId;
    uint8_t  langId;
    uint8_t  menuCursor;
    uint8_t  menuScrollTop;
    uint8_t  bottomToastType;  /* NONE / SAVE_OK / SAVE_FAIL / FULL */
    char     mainForceText[16];
    char     subPeak1Text[16];
    char     subPeak2Text[16];
    uint8_t  judgeState;       /* NONE / MINUS_NG / OK / PLUS_NG / ERR */
} UiFrameSnapshot;
```

### 2. 驻留 Flash 的表驱动菜单描述符 (`const MenuItem`)

```c
typedef enum
{
    MENU_ITEM_SUBPAGE = 0,  /* 进入子菜单页 */
    MENU_ITEM_ENUM_CYCLE,   /* 枚举项循环切换 (如单位、采样率、语言) */
    MENU_ITEM_INT_STEP,     /* 整数步进调节 (如归零时间 1~9s、公差上下限) */
    MENU_ITEM_READONLY,     /* 只读展示 (如额定量程、固件版本) */
    MENU_ITEM_ACTION        /* 触发确认动作 (如恢复出厂设置) */
} MenuItemType;

typedef struct
{
    uint16_t     titleStrId;              /* 多语言字典 ID */
    MenuItemType type;
    uint8_t      targetPageOrParamId;
    int32_t      minVal;
    int32_t      maxVal;
    int32_t      stepVal;
    bool       (*isEnabled)(void);        /* 如自动归零关闭时，归零时间返回 false 显示 "---" */
    void       (*formatValue)(char *buf, uint16_t cap);
} MenuItemDesc;
```

### 3. 历史记录列表的“阅读模式 ↔ 单条删除模式”五态交互范式

针对只有 5 个按键（`ZERO`, `UNIT/UP`, `DATA/DOWN`, `MENU/BACK`, `PWR/ENTER`）的仪器，列表页（每页 5 条）采用无冲突双模式状态机：

1. **阅读模式（默认无单条光标）**：
   - `UNIT` / `DATA` 短按：上一页 / 下一页；
   - `DATA` 持续按住 `5 s`（须进入本页松手后重计时）：进入“清空全部记录？”二次确认页；
   - `PWR/ENTER` 短按：若当前有记录，切入**单条选择删除模式**，默认高亮当前页第 1 条；
   - `MENU` 短按：返回上级页面。
2. **单条选择删除模式（带行高亮光标）**：
   - `UNIT` / `DATA` 短按：按屏幕顺序移动单条高亮光标；跨页边界时自动异步加载上一页（选中末条）或下一页（选中首条），到达全局首尾时停住不循环；
   - `PWR/ENTER` 短按：锁定当前选中记录的稳定主键 `{generation, recordId}`（**绝不锁定易变的显示行号**），进入“删除本条记录？”二次确认弹窗；
   - `MENU` 短按：退出删除模式，回到无光标阅读模式。
3. **单条删除二次确认与删除后光标落点**：
   - `MENU` 取消：回到原选中行；
   - `PWR/ENTER` 确认：提交异步删除（及可能的稀疏扇区整理）；
   - **删除完成后光标落点**：若全部记录已删空，退回阅读模式显示“无记录”；若删除的是最后一页的唯一一条，自动退回上一页并选中末条；否则继续留在选择模式并选中当前页第一条，方便用户连续删除多条记录。
