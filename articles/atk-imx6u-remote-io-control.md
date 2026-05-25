---
layout: article
title: ATK-IMX6U 远程访问与 IO 控制搭建教程
description: 记录 Windows 直连 ATK-IMX6U Linux 板、Tailscale 自用维护、Cloudflare Tunnel 临时分享，以及网页 IO 控制台的搭建流程。
date: 2026-05-25
category: 嵌入式
tags:
  - ATK-IMX6U
  - Linux
  - Tailscale
  - Cloudflare Tunnel
---

> 本文记录从 Windows 电脑直连 ATK-IMX6U Linux 板子，到通过 Tailscale 自用维护、Cloudflare Tunnel 临时分享、网页 IO 控制台控制灯和显示输入状态的完整流程。

## 一、目标与最终效果

目标是让家里的 ATK-IMX6U Linux 板子具备两类访问方式：

- 自用维护通道：通过 Tailscale 访问板子所在的 `192.168.10.0/24` 子网，可 SSH 登录、调试、维护。
- 分享访问通道：通过 Cloudflare Tunnel 暴露一个 HTTPS 登录页，登录后访问板子的 IO 控制台。
- 板子本地控制台：替换原 nginx 默认页，提供 `sys-led`、`beep` 输出控制，以及 GPIO Key 输入状态实时显示。

### 当前关键状态

| 项目 | 值 | 说明 |
|-|-|-|
| 板子主机名 | ATK-IMX6U | 通过串口和 SSH 确认 |
| 板子网口 IP | `192.168.10.2/24` | `eth1` 静态配置 |
| Windows 有线网卡 | `192.168.10.1/24` | 与板子直连 |
| 串口 | COM4，115200 | 备用控制台 |
| SSH 用户 | `root` | Dropbear SSH，端口 22 |
| Tailscale 地址 | `100.86.152.70` | Windows 网关 `desktop-im8si77` |
| 板子 IO 控制台 | `http://192.168.10.2/` | nginx 提供网页 |
| 板子状态 API | `http://192.168.10.2/api/status` | nginx 反代到本机 Python API |

## 二、整体架构

整体分为三层：板子端、Windows 网关端、外部访问端。

| 层级 | 组件 | 职责 |
|-|-|-|
| 板子端 | nginx + Python IO API | 提供网页控制台，读写 LED 和输入事件 |
| Windows 网关 | Tailscale | 把 `192.168.10.0/24` 子网发布到 tailnet |
| Windows 网关 | Node 登录代理 | 给 Cloudflare 公网访问加密码登录 |
| Windows 网关 | cloudflared | 把本机 `127.0.0.1:8090` 暴露为 HTTPS 临时链接 |
| 外部设备 | 浏览器或 SSH 客户端 | 浏览器访问控制台；自用设备可通过 Tailscale SSH |

```text
自己维护：
你的电脑/手机 -> Tailscale -> Windows 网关 -> ATK-IMX6U 192.168.10.2

临时分享：
别人浏览器 -> Cloudflare Tunnel HTTPS -> Windows 登录代理 127.0.0.1:8090 -> ATK-IMX6U 192.168.10.2
```

## 三、第一阶段：打通 Windows 与板子直连 SSH

### 1. 通过串口确认板子信息

已确认串口为 COM4，波特率为 115200，登录后用户为 `root`，主机名为 `ATK-IMX6U`。

```powershell
powershell -ExecutionPolicy Bypass -File .\serial_bridge.ps1 -Port COM4 -Baud 115200 -Command "whoami; hostname; ip addr show" -TimeoutMs 8000
```

### 2. 设置板子静态 IP

板子 `eth1` 初始拿到 `169.254.x.x` 链路本地地址，无法与 Windows 的 `192.168.10.1/24` 互通。通过串口设置静态 IP：

```bash
ifconfig eth1 192.168.10.2 netmask 255.255.255.0 up
ip addr show eth1
ip route
```

### 3. Windows 侧测试连通性

```powershell
ping 192.168.10.2
ssh -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa root@192.168.10.2
```

> 板子上的 Dropbear SSH 较旧，只提供 `ssh-rsa` host key。新版本 OpenSSH 默认禁用该算法，所以连接时需要添加 `HostKeyAlgorithms` 和 `PubkeyAcceptedAlgorithms` 参数。

## 四、第二阶段：Tailscale 自用维护通道

### 1. 安装并登录 Tailscale

Windows 上安装 Tailscale 后登录账号，当前设备显示为 `desktop-im8si77`，Tailscale IP 为 `100.86.152.70`。

```powershell
winget install --id Tailscale.Tailscale --source winget --accept-package-agreements --accept-source-agreements
"C:\Program Files\Tailscale\tailscale.exe" up
"C:\Program Files\Tailscale\tailscale.exe" status
"C:\Program Files\Tailscale\tailscale.exe" ip
```

### 2. 发布板子所在子网

Windows 电脑作为 Tailscale 子网路由器，把直连板子的 `192.168.10.0/24` 发布给 tailnet。

```powershell
"C:\Program Files\Tailscale\tailscale.exe" up --advertise-routes=192.168.10.0/24
```

随后在 Tailscale 管理后台进入 Machines，找到 `DESKTOP-IM8SI77`，批准 `192.168.10.0/24` 路由。批准后状态中会出现：

```text
AllowedIPs:
  100.86.152.70/32
  fd7a:115c:a1e0::d036:9846/128
  192.168.10.0/24

PrimaryRoutes:
  192.168.10.0/24
```

### 3. 手机或其他电脑访问

其他设备如果安装并登录同一个 Tailscale，就可以直接访问板子：

```bash
ping 192.168.10.2
ssh -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa root@192.168.10.2
浏览器打开 http://192.168.10.2/
```

## 五、第三阶段：板子 IO 控制台

### 1. 板子端硬件资源

已识别可用资源如下：

| 资源 | 路径 | 用途 |
|-|-|-|
| 系统灯 | `/sys/class/leds/sys-led` | 网页开关控制 |
| 蜂鸣器 | `/sys/class/leds/beep` | 网页开关控制 |
| GPIO Key | `/dev/input/event1` | 实时输入状态显示 |
| nginx 根目录 | `/var/www/localhost/html` | 控制台前端页面 |

### 2. 板子端文件

| 文件 | 作用 |
|-|-|
| `/var/www/localhost/html/index.html` | IO 控制台网页 |
| `/root/io-control/io_api.py` | Python API，读写 LED 与输入事件 |
| `/etc/nginx/nginx.conf` | nginx 反向代理 `/api/` 到 `127.0.0.1:8081` |
| `/etc/init.d/io-api` | API 开机启动脚本 |

### 3. 备份文件

原始 nginx 页面和配置已备份，可用于回滚：

```text
/var/www/localhost/html/index.html.bak-codex
/etc/nginx/nginx.conf.bak-codex
```

### 4. API 功能

| 接口 | 用途 | 刷新频率 |
|-|-|-|
| `/api/status` | 返回主机时间、LED 状态、输入状态 | 网页每 1 秒请求一次 |
| `/api/input` | 只返回输入状态，用于更实时显示 | 网页每 200 ms 请求一次 |
| `/api/led?name=sys-led&value=1` | 打开 `sys-led` | 点击按钮触发 |
| `/api/led?name=sys-led&value=0` | 关闭 `sys-led` | 点击按钮触发 |
| `/api/led?name=beep&value=1` | 打开 `beep` | 点击按钮触发 |
| `/api/led?name=beep&value=0` | 关闭 `beep` | 点击按钮触发 |

### 5. 常用验证命令

```powershell
curl http://192.168.10.2/api/status
curl http://192.168.10.2/api/input
curl "http://192.168.10.2/api/led?name=sys-led&value=1"
curl "http://192.168.10.2/api/led?name=sys-led&value=0"
```

## 六、第四阶段：Cloudflare Tunnel 临时分享通道

### 1. 设计原则

Cloudflare Tunnel 用于让别人无需安装 Tailscale，只用浏览器访问 HTTPS 地址。但由于页面可以控制硬件，不能直接裸露板子 API，所以在 Windows 上增加了一个 Node 登录代理。

| 组件 | 地址 | 作用 |
|-|-|-|
| Node 登录代理 | `127.0.0.1:8090` | 校验密码，成功后代理到板子 |
| 板子控制台 | `192.168.10.2:80` | 实际 IO 控制页面 |
| Cloudflare quick tunnel | `trycloudflare.com` 临时域名 | 公网 HTTPS 入口 |

### 2. Windows 端文件

```text
C:\Users\vincent\Documents\Codex\2026-05-22\github-linux\cloudflare-board-proxy.js
C:\Users\vincent\Documents\Codex\2026-05-22\github-linux\cloudflare-board-password.txt
C:\Users\vincent\Documents\Codex\2026-05-22\github-linux\cloudflared.err.log
```

### 3. 启动代理与 Tunnel

```powershell
$env:BOARD_PROXY_PASSWORD = Get-Content .\cloudflare-board-password.txt
node .\cloudflare-board-proxy.js
```

```powershell
cloudflared tunnel --url http://127.0.0.1:8090 --no-autoupdate
```

### 4. 当前公网地址

当前 quick tunnel 地址如下。该地址是临时地址，进程重启后可能变化：

```text
https://cholesterol-remark-increasing-dimension.trycloudflare.com
```

> 访问密码不要写入公开文档。当前密码保存在 Windows 本机 `cloudflare-board-password.txt` 中；需要分享时建议通过单独渠道发送，并定期更换。

### 5. 安全验证

已验证未登录访问 API 会被拒绝，登录后才允许访问控制台和 API。

```text
未登录访问 /api/status -> 401 login required
输入密码登录 -> 302 跳转到 /
登录后访问 /api/status -> 返回板子实时状态
登录后访问 / -> 返回 ATK-IMX6U IO 控制台
```

## 七、个人主页入口

个人主页本地副本已增加两个入口：

- 顶部导航：板子
- 首页按钮：板子控制

本地预览地址：

```text
http://127.0.0.1:8088/
```

入口页：

```text
http://127.0.0.1:8088/board.html
```

注意：当前只是本地副本，若要让线上 GitHub Pages 也出现入口，需要提交并推送 `single5240.github.io` 仓库。

## 八、性能与刷新策略

为了兼顾实时性与板子负载，网页采用分层刷新：

| 数据 | 接口 | 频率 | 原因 |
|-|-|-|-|
| LED 和整体状态 | `/api/status` | 1 秒 | 避免频繁读 sysfs 导致页面卡顿 |
| GPIO Key 输入 | `/api/input` | 200 ms | 提升输入显示实时性 |

实测板子本地 API 延迟约 12 ms 到 43 ms；Cloudflare 公网访问首跳延迟可能约 1 秒，适合分享体验，不适合高频硬实时控制。

## 九、常见问题与排查

### 1. 手机打不开 192.168.10.2

- 确认手机已经登录同一个 Tailscale。
- 确认 Windows 电脑在线，Tailscale 在线。
- 确认 Tailscale 后台已批准 `desktop-im8si77` 的 `192.168.10.0/24` 子网路由。
- 确认板子仍然是 `192.168.10.2`。

### 2. SSH 报 no matching host key type found

这是旧版 Dropbear 只提供 `ssh-rsa` 导致，使用以下命令：

```powershell
ssh -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa root@192.168.10.2
```

### 3. Cloudflare 链接失效

- 检查 `cloudflared` 进程是否还在。
- quick tunnel 是临时地址，重启后可能换地址。
- 长期使用建议配置 Cloudflare named tunnel 和 Cloudflare Access。

### 4. IO 控制台打不开

```powershell
curl http://192.168.10.2/
curl http://192.168.10.2/api/status
```

```bash
ps | grep python3
netstat -tlnp | grep 8081
/etc/init.d/io-api restart
/etc/init.d/nginx restart
```

## 十、回滚方案

如果需要恢复 nginx 默认页面和配置，可以在板子上执行：

```bash
cp /etc/nginx/nginx.conf.bak-codex /etc/nginx/nginx.conf
cp /var/www/localhost/html/index.html.bak-codex /var/www/localhost/html/index.html
/etc/init.d/io-api stop
/etc/init.d/nginx restart
```

## 十一、后续建议

- 将板子 IP 持久化，避免重启后 `eth1` 回到 `169.254.x.x`。
- 将 Cloudflare quick tunnel 升级为 named tunnel，绑定固定域名。
- 使用 Cloudflare Access 邮箱登录替代简单密码，便于授权和撤销。
- 为 IO 控制加入操作日志，记录谁在什么时候切换了输出。
- 如需开放给他人长期使用，只暴露网页控制台，不暴露 SSH。
