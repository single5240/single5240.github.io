---
layout: article
title: ATK-IMX6U Qt/QML UI 部署与排障指南
description: 从 Windows QML 调试、WSL 交叉编译到 i.MX6U 板子部署、字体与 tslib 触摸排障的完整实战流程。
date: 2026-07-20
category: 嵌入式 Linux
tags:
  - ATK-IMX6U
  - Qt
  - QML
  - WSL2
  - tslib
---

# ATK-IMX6U Qt/QML UI 部署与排障指南

本文记录在 ATK-IMX6U 开发板上，从 Windows 桌面调试到 WSL 交叉编译、部署 QML 触摸 UI，并控制 LED 与蜂鸣器的完整过程。

## 1. 最终架构

```text
Windows Qt Creator
  - Qt 5.12.9 MinGW 64-bit
  - 快速预览 QML 页面和交互

WSL2 Ubuntu
  - 正点原子/NXP i.MX6U Qt 交叉编译 SDK
  - 构建 ARM Linux 可执行文件

ATK-IMX6U
  - Qt 5.12.9 运行库
  - linuxfb 显示 /dev/fb0
  - tslib 触摸 /dev/input/touchscreen0
  - sysfs 控制 LED 和蜂鸣器
```

原则是：QML 负责界面，C++ 负责硬件，开发机负责编译，开发板负责运行。

## 2. 板子环境确认

开发板当前运行环境：

```text
CPU 架构：ARMv7 hard-float
动态加载器：/lib/ld-linux-armhf.so.3
Qt：5.12.9
显示：/dev/fb0，1024x600
网络：192.168.10.2
```

检查 Qt 版本和 linuxfb 插件：

```sh
qmake -v
ls -l /usr/lib/libQt5Core.so*
find /usr/lib -type f -name 'libqlinuxfb.so'
```

本项目依赖的运行库已经存在：

```text
libQt5Core.so.5.12.9
libQt5Gui.so.5.12.9
libQt5Qml.so.5.12.9
libQt5Quick.so.5.12.9
libQt5QuickControls2.so.5.12.9
```

## 3. 为什么不能直接复制 Windows 程序到板子

Windows Qt Creator 使用 `Desktop Qt 5.12.9 MinGW 64-bit` 编译出的文件是 Windows x86_64 程序，例如 `.exe`，不能在 ARM Linux 板子运行。

正确流程：

```text
同一份 C++ / QML 源码
  ├─ Desktop Kit -> Windows 预览和调试
  └─ i.MX6U SDK -> ARM Linux 程序 -> SSH/SCP 部署到板子
```

板子只有 Qt 运行库，缺少 `/usr/include` 中的 Qt 开发头文件。因此不能在板子上直接编译 Qt 应用，也不能用 Ubuntu 通用 ARM 工具链随意替代厂商 SDK。

原因是板子 glibc 较旧，通用工具链可能生成依赖更高版本 GLIBC 的程序，部署后会出现 `GLIBC_x.xx not found`。

## 4. Windows 桌面 Qt 环境

安装 Qt 5.12.9 时选择：

```text
Qt 5.12.9
  - MinGW 7.3.0 64-bit

Developer and Designer Tools
  - Qt Creator
  - MinGW 7.3.0 64-bit
```

本项目使用：

```text
项目类型：Qt Quick Application - Empty
构建系统：qmake
桌面 Kit：Desktop Qt 5.12.9 MinGW 64-bit
```

QML 用于页面、按钮、布局和触摸交互；C++ 用于 GPIO、CAN、串口和系统接口。

## 5. 安装 i.MX6U 交叉编译 SDK

使用正点原子资料中的安装包：

```text
E:\BaiduNetdiskDownload\05、开发工具\01、交叉编译器\
fsl-imx-x11-glibc-x86_64-meta-toolchain-qt5-cortexa7hf-neon-toolchain-4.1.15-2.1.0.sh
```

在 WSL 中安装到用户目录，避免污染系统 `/opt`：

```sh
sh '/mnt/e/BaiduNetdiskDownload/05、开发工具/01、交叉编译器/fsl-imx-x11-glibc-x86_64-meta-toolchain-qt5-cortexa7hf-neon-toolchain-4.1.15-2.1.0.sh' \
  -y -d "$HOME/imx6u/sdk"
```

每次使用 SDK 前加载环境：

```sh
source "$HOME/imx6u/sdk/environment-setup-cortexa7hf-neon-poky-linux-gnueabi"
```

该脚本设置了：

```text
ARM 交叉编译器：arm-poky-linux-gnueabi-g++
目标 sysroot
Qt 5.12.9 ARM 头文件和库
目标 qmake/mkspec
```

### 易错点：SDK 环境脚本与 `set -u`

SDK 环境脚本会读取未定义的 `CCACHE_PATH`。脚本中不能在 `source` 前使用 `set -u`：

```sh
set -eo pipefail
source "$HOME/imx6u/sdk/environment-setup-cortexa7hf-neon-poky-linux-gnueabi"
set -u
```

否则会出现：

```text
CCACHE_PATH: unbound variable
```

## 6. 本项目结构

```text
vincent_ui/
├─ main.qml                 # 1024x600 QML 控制界面
├─ main.cpp                 # 把 C++ device 对象注册到 QML
├─ devicecontroller.h       # UI 与硬件的统一接口
├─ devicecontroller.cpp     # Windows 模拟与 Linux sysfs 控制
├─ vincent_ui.pro           # qmake 工程文件
└─ build-imx6u.sh           # WSL ARM 构建脚本
```

QML 通过统一接口控制设备：

```qml
Switch {
    checked: device.ledOn
    onToggled: device.setLed(checked)
}
```

C++ 后端在 Linux 上向 sysfs 写入开关值；在 Windows 上只记录模拟状态。因此同一套 QML 可以在电脑预览，也可以部署到板子。

## 7. 真实硬件节点

不要假设所有板子的 LED 都叫 `status`。本板实际节点通过下面命令确认：

```sh
ls -1 /sys/class/leds
```

当前板子结果：

```text
LED：    /sys/class/leds/sys-led/brightness
蜂鸣器：/sys/class/leds/beep/brightness
```

手工测试：

```sh
echo 1 > /sys/class/leds/sys-led/brightness
echo 0 > /sys/class/leds/sys-led/brightness

echo 1 > /sys/class/leds/beep/brightness
echo 0 > /sys/class/leds/beep/brightness
```

`devicecontroller.cpp` 会自动探测这些节点，也支持覆盖路径：

```sh
IMX6U_LED_PATH=/custom/led/brightness
IMX6U_BUZZER_PATH=/custom/beep/brightness
```

## 8. 构建 ARM 版 UI

从 WSL 执行：

```sh
bash /mnt/c/Users/vincent/Documents/qt/vincent_ui/build-imx6u.sh
```

构建输出：

```text
/home/vincent/imx6u/build-vincent_ui/vincent_ui
```

验证必须是 ARM 程序：

```sh
file /home/vincent/imx6u/build-vincent_ui/vincent_ui
```

预期关键字：

```text
ELF 32-bit ... ARM ... interpreter /lib/ld-linux-armhf.so.3
```

## 9. 上传与运行

上传：

```sh
scp \
  -o HostKeyAlgorithms=+ssh-rsa \
  -o PubkeyAcceptedAlgorithms=+ssh-rsa \
  /home/vincent/imx6u/build-vincent_ui/vincent_ui \
  root@192.168.10.2:/opt/ui/vincent_ui
```

板子上赋予执行权限并检查依赖：

```sh
chmod 755 /opt/ui/vincent_ui
ldd /opt/ui/vincent_ui
```

`ldd` 输出中不能出现 `not found`。

原有 `/opt/ui/systemui` 会占用 `/dev/fb0`。测试新 UI 前先停止旧程序：

```sh
killall systemui
```

## 10. 字体问题

### 现象

屏幕只有色块、控件轮廓，没有任何文字。日志出现：

```text
QFontDatabase: Cannot find font directory /usr/lib/fonts.
```

### 原因

系统裁剪了 Qt 默认字体目录，QML 的 `Text` 和 `Button` 文本无法渲染。

### 解决

从 WSL 部署字体：

```sh
scp /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf \
  root@192.168.10.2:/opt/ui/fonts/DejaVuSans.ttf
```

启动时设置：

```sh
QT_QPA_FONTDIR=/opt/ui/fonts
```

板子原系统也有 `/usr/share/fonts/ttf/SourceHanSansCN-Regular.otf`，但不要依赖不存在的 `/usr/lib/fonts`。

## 11. 触摸无响应问题

### 现象

文字显示正常，但点击 LED、蜂鸣器开关没有反应。

### 错误做法

强制使用：

```sh
QT_QPA_GENERIC_PLUGINS=evdevtouch:/dev/input/event1
```

本板触摸设备 `EP0820M09` 的驱动报告坐标最大值异常为 `-1`。通用 evdevtouch 无法稳定完成坐标映射，而且可能和 Qt 自动输入处理重复读取 `event1`。

### 正确做法：使用出厂 tslib 配置

确认触摸设备：

```sh
ls -l /dev/input/touchscreen0
cat /proc/bus/input/devices
```

当前映射：

```text
/dev/input/touchscreen0 -> event1
设备名：EP0820M09
```

系统 tslib 配置：

```text
/etc/profile                 # QT_QPA_FB_TSLIB=1
/etc/profile.d/tslib.sh      # TSLIB_TSDEVICE=/dev/input/touchscreen0
/etc/ts.conf                 # pthres, dejitter, linear 等模块
```

正确启动参数：

```sh
QT_QPA_FB_TSLIB=1
TSLIB_TSDEVICE=/dev/input/touchscreen0
TSLIB_CONFFILE=/etc/ts.conf
```

不要同时启用 `evdevtouch` 和 `QT_QPA_FB_TSLIB=1`。

## 12. 当前推荐启动命令

```sh
QT_QPA_PLATFORM=linuxfb:fb=/dev/fb0 \
QT_QPA_FONTDIR=/opt/ui/fonts \
QT_QPA_FB_TSLIB=1 \
TSLIB_TSDEVICE=/dev/input/touchscreen0 \
TSLIB_CONFFILE=/etc/ts.conf \
QT_QUICK_BACKEND=software \
XDG_RUNTIME_DIR=/var/volatile/tmp/runtime-root \
nohup /opt/ui/vincent_ui >/tmp/vincent_ui.log 2>&1 &
```

检查程序和日志：

```sh
pidof vincent_ui
cat /tmp/vincent_ui.log
```

运行正常时，不应再有字体目录错误。进程的文件描述符中应看到：

```text
/dev/fb0
/dev/input/event1
```

## 13. 常见问题速查

| 现象 | 原因 | 解决 |
|---|---|---|
| `ssh-rsa` 协商失败 | 新版 OpenSSH 禁用了旧算法 | 加 `HostKeyAlgorithms=+ssh-rsa` 和 `PubkeyAcceptedAlgorithms=+ssh-rsa` |
| `.exe` 无法运行 | Windows x86_64 程序不是 ARM Linux 程序 | 使用 i.MX6U SDK 交叉编译 |
| `GLIBC_x.xx not found` | 工具链/系统库版本不匹配 | 使用厂商 SDK，不用通用 Ubuntu ARM 工具链 |
| `g++ not found` | 直接在 PowerShell 调用 qmake 时 MinGW 未加 PATH | 用 Qt Creator，或加入 MinGW `bin` 目录 |
| 页面无字 | Qt 找不到字体目录 | 部署字体并设置 `QT_QPA_FONTDIR` |
| 触摸不响应 | 使用 evdevtouch，驱动坐标范围异常 | 使用 `QT_QPA_FB_TSLIB=1` 和 tslib |
| 新 UI 无法显示 | `systemui` 占用 framebuffer | 先 `killall systemui` |
| 程序启动即退出 | Qt 库/插件缺失 | 用 `ldd` 检查并查看 `/tmp/vincent_ui.log` |

## 14. 开机自启动建议

当前只是手动测试，重启后仍会启动原来的 `/opt/ui/systemui`。

确认新 UI 功能稳定后，再把 `/etc/rc.local` 中的启动目标从：

```sh
/opt/ui/systemui
```

改为：

```sh
/opt/ui/vincent_ui
```

并使用第 12 节的完整环境变量。修改前保留旧启动命令，便于出现问题时回退。

## 15. 日常开发：修改 UI 到板子验证的标准流程

这一节用于日常迭代。每次修改界面或 C++ 后端后，按以下顺序执行。

### 第一步：修改源码

常见修改位置：

```text
main.qml                 修改页面、颜色、按钮、布局和交互
devicecontroller.cpp     修改 LED、蜂鸣器、CAN、GPIO 等硬件逻辑
devicecontroller.h       增加 QML 可调用的方法和属性
main.cpp                 注册新的 C++ 后端对象
vincent_ui.pro           新增 C++ 源文件、Qt 模块或资源文件
```

修改 QML 时，要保持目标屏幕尺寸：

```qml
ApplicationWindow {
    width: 1024
    height: 600
}
```

硬件访问必须放在 C++ 后端，不要在 QML 里直接执行 shell 命令或写 sysfs。

### 第二步：在 Windows 电脑预览 UI

在 Qt Creator 中：

```text
1. 选择 Desktop Qt 5.12.9 MinGW 64-bit Kit。
2. 点击 Run qmake（修改 .pro 后必须执行）。
3. 点击绿色运行按钮。
4. 检查 1024x600 窗口中的布局、文字、按钮和页面跳转。
```

电脑运行时，`DeviceController` 自动进入模拟模式：点击 LED、蜂鸣器不会操作真实板子，只会更新 UI 和输出调试信息。

先在电脑完成视觉和交互调试，再构建 ARM 版，可以减少板子部署次数。

### 第三步：交叉编译 ARM 版

打开 WSL，执行：

```sh
bash /mnt/c/Users/vincent/Documents/qt/vincent_ui/build-imx6u.sh
```

此脚本会自动：

```text
1. 加载 ~/imx6u/sdk 的正点原子/NXP SDK 环境。
2. 使用 ARM Qt 5.12.9 的 qmake。
3. 调用 arm-poky-linux-gnueabi-g++ 编译。
4. 输出 ARM 程序到 ~/imx6u/build-vincent_ui/vincent_ui。
```

如果改动了 `vincent_ui.pro`，脚本会重新运行 qmake；不需要手动删除构建目录。

验证产物架构：

```sh
file ~/imx6u/build-vincent_ui/vincent_ui
```

必须看到：

```text
ELF 32-bit ... ARM ... /lib/ld-linux-armhf.so.3
```

出现 `x86-64`、`PE32+` 或 `.exe` 说明错误地使用了 Windows Desktop Kit，不能部署。

### 第四步：上传新程序

从 WSL 上传到板子。始终上传为独立文件 `/opt/ui/vincent_ui`，不要覆盖原始 `/opt/ui/systemui`：

```sh
scp \
  -o HostKeyAlgorithms=+ssh-rsa \
  -o PubkeyAcceptedAlgorithms=+ssh-rsa \
  ~/imx6u/build-vincent_ui/vincent_ui \
  root@192.168.10.2:/opt/ui/vincent_ui
```

首次上传或权限发生变化时：

```sh
ssh -o HostKeyAlgorithms=+ssh-rsa \
  -o PubkeyAcceptedAlgorithms=+ssh-rsa \
  root@192.168.10.2 'chmod 755 /opt/ui/vincent_ui'
```

### 第五步：检查运行库

在启动前检查动态库：

```sh
ssh -o HostKeyAlgorithms=+ssh-rsa \
  -o PubkeyAcceptedAlgorithms=+ssh-rsa \
  root@192.168.10.2 'ldd /opt/ui/vincent_ui'
```

确认输出没有：

```text
not found
```

若有 `not found`，不要继续启动。应检查是否误用了 Desktop Qt 或错误的 ARM 工具链。

### 第六步：停止旧 UI 并启动新 UI

`/dev/fb0` 只能由一个 UI 使用。先停止当前 UI：

```sh
ssh -o HostKeyAlgorithms=+ssh-rsa \
  -o PubkeyAcceptedAlgorithms=+ssh-rsa \
  root@192.168.10.2 'killall vincent_ui 2>/dev/null; killall systemui 2>/dev/null || true'
```

然后用完整环境变量启动。不要省略字体和 tslib 配置：

```sh
ssh -o HostKeyAlgorithms=+ssh-rsa \
  -o PubkeyAcceptedAlgorithms=+ssh-rsa \
  root@192.168.10.2 '
    QT_QPA_PLATFORM=linuxfb:fb=/dev/fb0 \
    QT_QPA_FONTDIR=/opt/ui/fonts \
    QT_QPA_FB_TSLIB=1 \
    TSLIB_TSDEVICE=/dev/input/touchscreen0 \
    TSLIB_CONFFILE=/etc/ts.conf \
    QT_QUICK_BACKEND=software \
    XDG_RUNTIME_DIR=/var/volatile/tmp/runtime-root \
    nohup /opt/ui/vincent_ui >/tmp/vincent_ui.log 2>&1 &
  '
```

### 第七步：板子现场验证

在屏幕上依次检查：

```text
1. 所有标题、按钮文字是否显示。
2. 触摸 LED 和 Buzzer 开关是否有状态变化。
3. LED 是否实际亮灭。
4. 蜂鸣器是否实际响停。
5. 点击 Refresh 后状态栏是否正常更新。
```

同时通过 SSH 检查：

```sh
ssh -o HostKeyAlgorithms=+ssh-rsa \
  -o PubkeyAcceptedAlgorithms=+ssh-rsa \
  root@192.168.10.2 'pidof vincent_ui; cat /tmp/vincent_ui.log'
```

正常情况：

```text
能看到 vincent_ui 的 PID
日志没有 QML、字体或插件加载错误
```

硬件状态可复查：

```sh
cat /sys/class/leds/sys-led/brightness
cat /sys/class/leds/beep/brightness
```

### 第八步：出现问题时的回退

停止新 UI，恢复旧 UI：

```sh
killall vincent_ui

QT_QPA_PLATFORM=linuxfb:fb=/dev/fb0 \
XDG_RUNTIME_DIR=/var/volatile/tmp/runtime-root \
nohup /opt/ui/systemui >/tmp/systemui.log 2>&1 &
```

`/opt/ui/systemui` 未被覆盖，因此新 UI 出问题时可以快速恢复显示。

### 每次修改的最短命令清单

当环境已配置完成后，日常最短流程是：

```sh
# WSL：编译
bash /mnt/c/Users/vincent/Documents/qt/vincent_ui/build-imx6u.sh

# WSL：上传
scp -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa \
  ~/imx6u/build-vincent_ui/vincent_ui root@192.168.10.2:/opt/ui/vincent_ui

# 板子：停止旧 UI，按第六步完整命令启动新 UI
```
