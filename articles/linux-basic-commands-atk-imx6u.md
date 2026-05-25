---
layout: article
title: ATK-IMX6U Linux 网页控制项目常用命令
description: 整理 ATK-IMX6U Linux 板子网页控制项目中用到的网络、SSH、nginx、Python API、硬件接口和排查命令。
date: 2026-05-26
category: 嵌入式
tags:
  - Linux
  - ATK-IMX6U
  - SSH
  - nginx
---
> 这份文档整理的是 ATK-IMX6U Linux 板子网页控制项目中实际用到的基础命令。重点围绕网络连通、SSH 登录、nginx、Python API、硬件接口和常见问题排查。

## 一、项目链路

本项目的大致访问链路如下：

```text
浏览器
  -> nginx
  -> Python API
  -> /sys/class/leds、/dev/input
  -> LED / 蜂鸣器 / 按键
```

所以排查问题时，一般按这条链路逐层检查：

1. 网络是否通。
2. nginx 是否运行。
3. Python API 是否运行。
4. Linux 硬件接口是否存在。
5. LED、蜂鸣器、按键是否能被直接读写。

## 二、设备与网络确认

### 1. `whoami`：查看当前用户

用途：确认当前登录用户是不是 `root`。

```bash
whoami
```

示例输出：

```text
root
```

说明：

- 控制 `/sys/class/leds`、读取 `/dev/input/event1` 通常需要较高权限。
- 如果不是 `root`，可能会遇到权限不足。

### 2. `hostname`：查看主机名

用途：确认当前登录的是哪块板子。

```bash
hostname
```

示例输出：

```text
ATK-IMX6U
```

适用场景：

- 多块板子同时调试时，避免登录错设备。
- 确认串口或 SSH 当前连接目标。

### 3. `ip addr show`：查看 IP 和网卡状态

用途：查看网卡名称、IP 地址、网卡是否启用。

```bash
ip addr show
```

只查看 `eth1`：

```bash
ip addr show eth1
```

项目中关心的目标状态：

```text
eth1
192.168.10.2/24
```

如果能看到：

```text
inet 192.168.10.2/24
```

说明板子的静态 IP 已经设置成功。

### 4. `ifconfig`：临时设置板子 IP

用途：给板子网口设置静态 IP。

```bash
ifconfig eth1 192.168.10.2 netmask 255.255.255.0 up
```

参数说明：

| 参数 | 含义 |
|-|-|
| `eth1` | 板子网卡名 |
| `192.168.10.2` | 给板子设置的 IP |
| `netmask 255.255.255.0` | 子网掩码 |
| `up` | 启用网卡 |

设置后验证：

```bash
ip addr show eth1
```

注意：

- 这种设置通常是临时的。
- 板子重启后可能失效。
- 长期使用应写入启动脚本或网络配置文件。

### 5. `ip route`：查看路由

用途：查看当前系统知道哪些网络应该从哪个网卡走。

```bash
ip route
```

可能看到：

```text
192.168.10.0/24 dev eth1 scope link
```

说明：

- `192.168.10.0/24` 这个网段走 `eth1`。
- Windows 直连板子时，Windows 是 `192.168.10.1`，板子是 `192.168.10.2`。

### 6. `ping`：测试网络连通

用途：测试两台设备能不能互相访问。

从 Windows 测试板子：

```powershell
ping 192.168.10.2
```

从板子测试 Windows：

```bash
ping 192.168.10.1
```

Linux 下只 ping 4 次：

```bash
ping -c 4 192.168.10.1
```

判断方式：

- 有回复：网络层基本通了。
- 没回复：先检查 IP、网线、网卡、路由、防火墙。

## 三、远程登录与接口测试

### 1. `ssh`：远程登录板子

用途：从电脑进入 Linux 板子的命令行。

```bash
ssh root@192.168.10.2
```

如果遇到旧版 Dropbear SSH 算法兼容问题，可以使用：

```bash
ssh -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa root@192.168.10.2
```

参数说明：

| 参数 | 含义 |
|-|-|
| `root@192.168.10.2` | 使用 `root` 登录板子 |
| `HostKeyAlgorithms=+ssh-rsa` | 允许旧的 `ssh-rsa` 主机密钥算法 |
| `PubkeyAcceptedAlgorithms=+ssh-rsa` | 允许旧的 `ssh-rsa` 公钥算法 |

### 2. `curl`：测试网页和 API

用途：不打开浏览器，直接测试 HTTP 服务是否正常。

测试首页：

```bash
curl http://192.168.10.2/
```

测试状态接口：

```bash
curl http://192.168.10.2/api/status
```

测试输入接口：

```bash
curl http://192.168.10.2/api/input
```

控制 LED：

```bash
curl "http://192.168.10.2/api/led?name=sys-led&value=1"
curl "http://192.168.10.2/api/led?name=sys-led&value=0"
```

控制蜂鸣器：

```bash
curl "http://192.168.10.2/api/led?name=beep&value=1"
curl "http://192.168.10.2/api/led?name=beep&value=0"
```

判断方式：

| 现象 | 可能原因 |
|-|-|
| `/` 正常，`/api/status` 异常 | nginx 正常，但 Python API 或反向代理异常 |
| `/` 异常 | nginx 或网页文件路径异常 |
| `127.0.0.1:8081/api/status` 正常，但 `192.168.10.2/api/status` 异常 | nginx 反向代理配置异常 |

## 四、进程和端口检查

### 1. `ps`：查看进程

用途：查看 nginx、Python API 是否正在运行。

查看所有进程：

```bash
ps
```

查 Python API：

```bash
ps | grep python3
```

查 nginx：

```bash
ps | grep nginx
```

可能看到：

```text
python3 /root/io-control/io_api.py
nginx: master process nginx
nginx: worker process
```

说明服务正在运行。

### 2. `grep`：过滤关键内容

用途：从大量输出中筛选包含关键字的行。

```bash
ps | grep python3
```

含义：

| 部分 | 含义 |
|-|-|
| `ps` | 输出进程列表 |
| <code>&#124;</code> | 管道，把前一个命令结果交给后一个命令 |
| `grep python3` | 只保留包含 `python3` 的行 |

查看 nginx 错误日志中包含 `error` 的内容：

```bash
grep error /var/log/nginx/error.log
```

### 3. `netstat`：查看端口监听

用途：确认服务是否监听指定端口。

查看 Python API 的 `8081` 端口：

```bash
netstat -tlnp | grep 8081
```

查看 nginx 的 `80` 端口：

```bash
netstat -tlnp | grep :80
```

参数说明：

| 参数 | 含义 |
|-|-|
| `-t` | 查看 TCP |
| `-l` | 只看监听端口 |
| `-n` | 用数字显示 IP 和端口 |
| `-p` | 显示对应进程 |

示例输出：

```text
tcp  0  0  127.0.0.1:8081  0.0.0.0:*  LISTEN  123/python3
```

说明 Python API 正在监听本机 `8081`。

## 五、服务启动、停止和重启

### 1. 重启 Python API

```bash
/etc/init.d/io-api restart
```

### 2. 启动 Python API

```bash
/etc/init.d/io-api start
```

### 3. 停止 Python API

```bash
/etc/init.d/io-api stop
```

### 4. 重启 nginx

```bash
/etc/init.d/nginx restart
```

修改以下内容后通常需要重启：

- 修改 `/root/io-control/io_api.py` 后，重启 `io-api`。
- 修改 `/etc/nginx/nginx.conf` 后，重启 `nginx`。
- 修改网页 `index.html` 后，一般刷新浏览器即可。

## 六、文件和目录操作

### 1. `ls`：查看文件列表

查看 LED 目录：

```bash
ls /sys/class/leds
```

可能看到：

```text
beep  sys-led
```

查看网页目录：

```bash
ls /var/www/localhost/html
```

查看 API 目录：

```bash
ls /root/io-control
```

### 2. `pwd`：查看当前目录

```bash
pwd
```

示例：

```text
/root/io-control
```

### 3. `cd`：切换目录

进入 API 目录：

```bash
cd /root/io-control
```

进入网页目录：

```bash
cd /var/www/localhost/html
```

返回上一级：

```bash
cd ..
```

回到当前用户家目录：

```bash
cd ~
```

### 4. `cat`：查看文件内容

查看 LED 当前亮度：

```bash
cat /sys/class/leds/sys-led/brightness
```

查看蜂鸣器状态：

```bash
cat /sys/class/leds/beep/brightness
```

查看 nginx 配置：

```bash
cat /etc/nginx/nginx.conf
```

适用场景：

- 小文件快速查看。
- 硬件状态文件读取。
- 配置文件确认。

### 5. `cp`：复制、备份、恢复文件

备份 nginx 配置：

```bash
cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak-codex
```

恢复 nginx 配置：

```bash
cp /etc/nginx/nginx.conf.bak-codex /etc/nginx/nginx.conf
```

恢复网页首页：

```bash
cp /var/www/localhost/html/index.html.bak-codex /var/www/localhost/html/index.html
```

格式：

```bash
cp 源文件 目标文件
```

### 6. `chmod`：修改文件权限

用途：让脚本可以执行。

```bash
chmod +x /etc/init.d/io-api
```

说明：

- `chmod` 用于修改权限。
- `+x` 表示增加可执行权限。
- 启动脚本没有执行权限时，可能无法正常运行。

## 七、直接测试硬件接口

### 1. 用 `echo` 写 LED 状态

打开系统灯：

```bash
echo 1 > /sys/class/leds/sys-led/brightness
```

关闭系统灯：

```bash
echo 0 > /sys/class/leds/sys-led/brightness
```

### 2. 用 `echo` 写蜂鸣器状态

打开蜂鸣器：

```bash
echo 1 > /sys/class/leds/beep/brightness
```

关闭蜂鸣器：

```bash
echo 0 > /sys/class/leds/beep/brightness
```

说明：

- 这就是 Python API 背后做的关键动作之一。
- 如果 `echo` 能控制硬件，但网页不能控制，问题多半在 API 或 nginx。
- 如果 `echo` 也不能控制硬件，先检查驱动、设备树、路径和权限。

## 八、Python 环境和 API 调试

### 1. 查看 Python 版本

```bash
python3 --version
```

示例：

```text
Python 3.8.10
```

如果提示：

```text
python3: not found
```

说明当前系统没有 Python 3 环境。

### 2. 手动运行 Python API

```bash
python3 /root/io-control/io_api.py
```

说明：

- 适合调试 API 报错。
- 手动运行时终端会被占用。
- 正式运行通常使用 `/etc/init.d/io-api start`。

另开一个终端测试：

```bash
curl http://127.0.0.1:8081/api/status
```

## 九、日志查看

### 1. 查看 nginx 错误日志

```bash
cat /var/log/nginx/error.log
```

### 2. 查看日志最后几行

```bash
tail /var/log/nginx/error.log
```

查看最后 50 行：

```bash
tail -n 50 /var/log/nginx/error.log
```

### 3. 实时跟踪日志

```bash
tail -f /var/log/nginx/error.log
```

说明：

- `tail -f` 会持续显示新写入的日志。
- 适合一边刷新网页，一边观察 nginx 是否报错。

## 十、常见排查组合

### 1. 网页打不开

```bash
ping 192.168.10.2
curl http://192.168.10.2/
ps | grep nginx
/etc/init.d/nginx restart
```

排查思路：

1. 先确认网络是否通。
2. 再确认 nginx 是否运行。
3. 最后确认网页文件是否存在。

### 2. API 不工作

```bash
ps | grep python3
netstat -tlnp | grep 8081
curl http://127.0.0.1:8081/api/status
/etc/init.d/io-api restart
```

排查思路：

1. 确认 Python API 进程是否存在。
2. 确认是否监听 `8081`。
3. 绕过 nginx，直接访问 `127.0.0.1:8081`。
4. 如果本地 API 正常，再检查 nginx 反向代理。

### 3. LED 不受控

```bash
ls /sys/class/leds
cat /sys/class/leds/sys-led/brightness
echo 1 > /sys/class/leds/sys-led/brightness
echo 0 > /sys/class/leds/sys-led/brightness
```

排查思路：

1. 确认 `sys-led` 是否存在。
2. 确认 `brightness` 是否可读。
3. 直接用 `echo` 控制硬件。
4. 如果直接控制正常，再检查 API。

### 4. 网络不通

```bash
ip addr show eth1
ifconfig eth1 192.168.10.2 netmask 255.255.255.0 up
ip route
ping 192.168.10.1
```

排查思路：

1. 确认板子网卡名称。
2. 确认 IP 是 `192.168.10.2/24`。
3. 确认路由。
4. 测试 Windows 直连网卡 `192.168.10.1`。

## 十一、优先掌握的命令清单

建议先重点掌握以下命令：

```bash
ip addr show
ifconfig
ip route
ping
ssh
curl
ps | grep
netstat -tlnp
ls
cd
pwd
cat
echo
cp
chmod
python3 --version
tail -f
/etc/init.d/nginx restart
/etc/init.d/io-api restart
```

掌握这些命令后，就能独立排查这个 Linux 网页控制项目的大部分问题。
