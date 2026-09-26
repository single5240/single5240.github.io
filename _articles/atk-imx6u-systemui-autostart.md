---
layout: article
title: ATK-IMX6U 开机自启动 LCD UI 配置教程
description: 记录 ATK-IMX6U 开发板通过 /etc/rc.local 在系统启动时后台启动 /opt/ui/systemui 的完整流程。
date: 2026-07-17
category: 嵌入式
tags:
  - ATK-IMX6U
  - Linux
  - Qt
  - framebuffer
---
> 本文记录 ATK-IMX6U 开发板通过 `/etc/rc.local` 在系统启动时后台启动 `/opt/ui/systemui` 的配置方法，并包含 SSH 连接、屏幕检查、手动启动、日志查看和排错步骤。

## 一、适用场景

开发板已经可以通过 SSH 登录，LCD 屏幕已经接好，并且 framebuffer 设备 `/dev/fb0` 正常存在。目标是在系统开机后自动后台运行 `/opt/ui/systemui`，让 UI 显示到 LCD 屏幕上。

## 二、前置检查

### 1. SSH 连接

如果板子的 dropbear 只支持旧的 `ssh-rsa` 主机密钥算法，Windows 或新版 OpenSSH 连接时需要加兼容参数：

```bash
ssh -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa root@192.168.10.2
```

### 2. 检查 framebuffer

```bash
ls -l /dev/fb*
cat /sys/class/graphics/fb0/name
cat /sys/class/graphics/fb0/virtual_size
cat /sys/class/graphics/fb0/bits_per_pixel
```

本次板子的检查结果：

| 项目 | 结果 | 说明 |
|-|-|-|
| 设备 | `/dev/fb0` | framebuffer 存在 |
| 驱动名 | `mxs-lcdif` | i.MX6U LCDIF framebuffer 驱动 |
| 分辨率 | `1024x600` | 当前 LCD 模式 |
| 色深 | `16 bit` | 通常为 RGB565 |

### 3. 屏幕写入测试

```bash
/usr/bin/test-fb --verbose --cycles 10
```

正常输出示例：

```text
test-fb: Surface ( 1024 X 600, 1200 KB ) Created in 11 ms
test-fb: Framebuffer write speed: 397350 KB/Sec
test-fb: Approx frame rate: 331 frames/sec
```

如果屏幕出现测试画面或花屏，说明 LCD 硬件链路、背光、framebuffer 写入基本正常。

## 三、手动启动 UI

Qt 程序在没有 X11/Wayland 的嵌入式系统上，需要指定 `linuxfb` 平台插件：

```bash
export QT_QPA_PLATFORM=linuxfb:fb=/dev/fb0
export XDG_RUNTIME_DIR=/var/volatile/tmp/runtime-root
mkdir -p /var/volatile/tmp/runtime-root
/opt/ui/systemui
```

前台运行时，命令行会停在 UI 进程里，这是正常现象。按 `Ctrl+C` 可以结束。

后台运行推荐使用：

```bash
export QT_QPA_PLATFORM=linuxfb:fb=/dev/fb0
export XDG_RUNTIME_DIR=/var/volatile/tmp/runtime-root
mkdir -p /var/volatile/tmp/runtime-root
nohup /opt/ui/systemui >/tmp/systemui.log 2>&1 &
```

## 四、配置开机自启动

编辑 `/etc/rc.local`，把下面内容放在 `exit 0` 之前：

```bash
echo 30000 > /proc/sys/vm/min_free_kbytes
. /etc/profile

# Start LCD UI on boot
export QT_QPA_PLATFORM=linuxfb:fb=/dev/fb0
export XDG_RUNTIME_DIR=/var/volatile/tmp/runtime-root
mkdir -p /var/volatile/tmp/runtime-root

if [ -x /opt/ui/systemui ] && ! pidof systemui >/dev/null 2>&1; then
    nohup /opt/ui/systemui >/tmp/systemui.log 2>&1 &
fi

exit 0
```

如果从 Windows 复制脚本到板子，注意不要留下 CRLF 换行。否则可能出现：

```text
exit: 0\r: numeric argument required
```

可用下面命令修复：

```bash
sed -i 's/\r$//' /etc/rc.local
```

## 五、验证配置

### 1. 检查脚本语法

```bash
sh -n /etc/rc.local
```

没有输出通常表示语法正常。

### 2. 手动执行 rc.local

```bash
/etc/rc.local
echo $?
```

返回 `0` 表示脚本执行成功。

### 3. 查看 UI 进程

```bash
ps | grep systemui | grep -v grep
```

正常示例：

```text
788 ?        00:00:01 systemui
```

### 4. 查看日志

```bash
tail -40 /tmp/systemui.log
```

本次日志中出现 Qt 字体目录警告：

```text
QFontDatabase: Cannot find font directory /usr/lib/fonts.
```

该警告通常不影响 UI 进程启动；如果界面字体显示异常，再补充字体或配置 fontconfig。

## 六、常见问题

| 现象 | 可能原因 | 处理方法 |
|-|-|-|
| SSH 提示 `no matching host key type found` | 板子 dropbear 只提供 `ssh-rsa` | 连接命令加 `HostKeyAlgorithms=+ssh-rsa` 和 `PubkeyAcceptedAlgorithms=+ssh-rsa` |
| UI 前台运行后命令行卡住 | UI 是前台进程 | 这是正常现象；需要继续操作时用 `nohup` 和 `&` 后台运行 |
| 屏幕花屏 | 写入了随机 framebuffer 数据 | 这是测试现象；用 UI 程序或正确 RGB565 数据显示正常画面 |
| 开机后没有 `systemui` 进程 | `rc.local` 未执行、脚本语法错误、路径错误 | 检查 `/etc/inittab`、`sh -n /etc/rc.local`、`/tmp/systemui.log` |
| `exit: 0\r: numeric argument required` | 脚本是 Windows CRLF 换行 | 执行 `sed -i 's/\r$//' /etc/rc.local` |

## 七、最终推荐版 /etc/rc.local

```bash
#!/bin/sh -e
#
# rc.local
#
# This script is executed at the end of each multiuser runlevel.

echo 30000 > /proc/sys/vm/min_free_kbytes
. /etc/profile

# Start LCD UI on boot
export QT_QPA_PLATFORM=linuxfb:fb=/dev/fb0
export XDG_RUNTIME_DIR=/var/volatile/tmp/runtime-root
mkdir -p /var/volatile/tmp/runtime-root

if [ -x /opt/ui/systemui ] && ! pidof systemui >/dev/null 2>&1; then
    nohup /opt/ui/systemui >/tmp/systemui.log 2>&1 &
fi

exit 0
```

## 八、回滚方法

如果开机 UI 导致系统异常，可以通过 SSH 或串口登录后注释掉启动块，或恢复备份文件：

```bash
cp /etc/rc.local.bak-systemui-codex /etc/rc.local
chmod +x /etc/rc.local
```

也可以临时结束 UI：

```bash
killall systemui
```
