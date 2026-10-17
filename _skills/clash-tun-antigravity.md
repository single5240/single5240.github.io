---
layout: skill
title: Clash Verge AI-Code 分流与 TUN 规则模式排障 (clash-tun-antigravity)
skill_id: clash-tun-antigravity
description: Clash Verge 的 AI-Code 前置分流规则配置（Antigravity / Cursor / Codex / Copilot），以及通过 TUN 虚拟网卡加规则模式修复直连超时与国内/GitHub 分流冲突。
category: common
category_label: 通用与工程基建
scope: project
target: Windows + Clash Verge (Mihomo 内核) + AI 编程助手
order: 5
tags:
  - Clash-Verge
  - TUN模式
  - 分流规则
  - 开发环境
---

## SKILL.md 元数据

```yaml
---
name: clash-tun-antigravity
description: >-
  [Scope: project] Keep Antigravity, Cursor, Codex, and GitHub Copilot on the
  Clash Verge AI-Code group, and fix Antigravity not responding with TUN plus
  rule mode. Use when the user mentions 反重力, Antigravity, AI-Code, Cursor,
  Codex, Copilot, Clash TUN, 系统代理, 国内网站打不开, or GitHub failing after TUN.
---
```

## 1. 核心机制区分（两项独立配置）

- **AI-Code 前置分流（Prepend Enhancement）**：在 Clash Verge 订阅之前通过 `prepend` 注入独立的代理组与高优先级分流规则，将 Antigravity、Cursor、Codex 和 GitHub Copilot 定向到稳定的专用节点，且执行“更新订阅”时不会覆盖这些增强文件。
- **TUN 模式 + 规则模式（Rule Mode）**：Antigravity 的语言服务器（`language_server`）默认直接拨号连接 Google 接口，不走 Windows 系统代理（System Proxy）。开启 `TUN + Rule` 模式才能让直连流量进入 Mihomo 内核命中 `AI-Code` 规则；而若误开 `Global（全局）+ TUN` 则会导致国内站点绕远或直连异常。

> 安全守则：绝不在日志或响应中打印 `clash-verge.yaml` 或 `profiles.yaml` 中的代理密码、UUID 或私有订阅 URL。

## 2. 本机目录与运行时通道

| 项目 | 路径 / 配置值 |
| :--- | :--- |
| Clash Verge 可执行文件 | `C:\Program Files\Clash Verge\clash-verge.exe` |
| 配置目录 | `%APPDATA%\io.github.clash-verge-rev.clash-verge-rev` |
| Mihomo 控制命名管道 | `\\.\pipe\verge-mihomo`（当 HTTP `127.0.0.1:9097` 未监听时使用） |
| 混合代理端口 | `127.0.0.1:7897` |
| Antigravity 日志路径 | `%APPDATA%\Antigravity\logs\language_server.log` |
| 订阅配置项 | `profiles.yaml` 中的 `current` 活动配置与备用配置 |

在不同开发机上复用此流程时，先读取目标机器的 `profiles.yaml` 获取对应的增强文件 ID。

## 3. AI-Code 增强分流规则（Prepend Rules & Groups）

修改 `profiles/<group-enhance>.yaml` 与 `profiles/<rule-enhance>.yaml` 增强文件（由 `profiles.yaml` 中的 `option.groups` 和 `option.rules` 关联），不要直接手改下载的原始订阅文件或生成的 `clash-verge.yaml`（下次更新订阅会被覆盖）。

规则文件在最高优先级通过 `prepend` 注入以下匹配器，统一指向 `🤖 AI-Code` 策略组：

| 服务对象 | 匹配规则（Matchers） |
| :--- | :--- |
| **Antigravity & Gemini** | `DOMAIN-SUFFIX`: `antigravity.google`, `generativelanguage.googleapis.com`, `aiplatform.googleapis.com`, `alkalimakersuite-pa.clients6.google.com`, `gemini.google.com`, `proactivebackend-pa.googleapis.com`<br>`DOMAIN-KEYWORD`: `antigravity`<br>`PROCESS-NAME`: `Antigravity.exe`, `agy.exe` |
| **Cursor** | `DOMAIN-SUFFIX`: `cursor.sh`, `cursor.com`, `cursorapi.com`, `anysphere.co`<br>`DOMAIN-KEYWORD`: `cursor`<br>`PROCESS-NAME`: `Cursor.exe` |
| **OpenAI / Codex** | `DOMAIN-SUFFIX`: `openai.com`, `chatgpt.com`, `oaistatic.com`, `oaiusercontent.com`, `auth0.openai.com` |
| **GitHub Copilot** | `DOMAIN-SUFFIX`: `githubcopilot.com`, `api.githubcopilot.com`, `copilot-proxy.githubusercontent.com`, `copilot-telemetry.githubusercontent.com`, `default.exp-tas.com` |

- `PROCESS-NAME` 仅在数据包进入 Mihomo 内核后才能生效，因此必须配合 **TUN 模式**。
- 保留订阅原有的后续规则不变：`GEOIP,CN` → `国内网站`（默认 `DIRECT`），`github.com` → `选择节点`，兜底 `MATCH` → `漏网之鱼`。

## 4. 开启 TUN 与规则模式（PowerShell 命名管道热更新）

当 `language_server.log` 出现连接 `googleapis.com`、`play.googleapis.com` 或 `daily-cloudcode-pa.googleapis.com` 的 `i/o timeout` 时，说明直连流量未进入 TUN 网卡。

持久化配置项：

- `verge.yaml`：`enable_tun_mode: true`（保留 `enable_system_proxy: true`）
- `config.yaml`：`tun.enable: true`（`stack: gvisor`, `auto-route: true`, `dns-hijack: [any:53]`）

若运行时 TUN 被关闭或模式误处于 `global`，可通过 PowerShell 连接命名管道 `verge-mihomo` 发送 `PATCH /configs?force=true`：

```powershell
$pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', 'verge-mihomo', [System.IO.Pipes.PipeDirection]::InOut)
$pipe.Connect(5000)
$sw = New-Object System.IO.StreamWriter($pipe)
$body = '{"mode":"rule","tun":{"enable":true,"stack":"gvisor","auto-route":true,"auto-detect-interface":true,"dns-hijack":["any:53"]}}'
$sw.Write("PATCH /configs?force=true HTTP/1.1`r`nHost: 127.0.0.1`r`nContent-Type: application/json`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n$body")
$sw.Flush()
Start-Sleep -Milliseconds 800
(New-Object System.IO.StreamReader($pipe)).ReadToEnd()
$pipe.Dispose()
```

预期返回 `HTTP/1.1 204 No Content`，且 `GET /configs` 显示 `"mode":"rule"` 与 `"tun":{"enable":true}`。

## 5. 验证方法（绕过系统代理直测 TUN 通路）

使用 `curl.exe --noproxy "*"` 强制绕过系统代理，直接检验虚拟网卡 TUN 路由与分流规则是否同时正常：

```powershell
curl.exe -4 -sS -o NUL -w "%{http_code} time=%{time_total}`n" --noproxy "*" --max-time 15 https://www.baidu.com
curl.exe -4 -sS -o NUL -w "%{http_code} time=%{time_total}`n" --noproxy "*" --max-time 15 https://github.com
curl.exe -4 -sS -o NUL -w "%{http_code} time=%{time_total}`n" --noproxy "*" --max-time 15 https://www.google.com
```

- **通过判据**：三条命令均返回正常 HTTP 状态码（如 `200`），其中百度走 `DIRECT` 低延迟返回，GitHub 与 Google 正常连通；同时 `language_server.log` 尾部不再出现新的 `i/o timeout`。
- **故障速查**：若开启 TUN 后国内网站打不开，检查运行模式是否误设为 `global` 或国内规则组未指向 `DIRECT`；若仅 GitHub 失败，切换代理节点即可。
