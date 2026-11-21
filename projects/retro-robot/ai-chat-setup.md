---
layout: default
title: S5·BOT AI 对话部署说明
description: 在自己的服务器上为 S5·BOT 启用免前端密钥的 AI 对话代理：环境变量、systemd、Nginx 反代与静态降级说明。
section: projects
noindex: true
permalink: /projects/retro-robot/ai-chat-setup.html
---

# S5·BOT AI 对话部署说明

这套方案让静态站点在**你自己的服务器**上获得真实 AI 对话能力，而不把模型密钥暴露给浏览器。浏览器只请求本站同源的 `/api/chat`，由服务器上的 Python 代理注入角色卡人设并转发到大模型服务。

## 一、它由哪几部分组成

- `assets/data/bot-persona.json`：角色卡的**唯一数据源**。前端读取它来渲染角色卡，后端读取它的 `systemPrompt` 作为模型人设。改人设只改这一处。
- `assets/js/bot-chat.js`：零依赖前端模块，负责角色卡渲染、SSE 流式输出、停止生成、键盘可达与静态降级。
- `assets/css/bot-chat.css`：对话面板样式，复用站点主题变量。
- `server/s5bot_proxy.py`：Python 3 标准库写的代理（无需 pip 安装），做同源校验、按 IP 限流、注入人设、转发流式响应。
- `server/s5bot.service` / `server/nginx-location.conf` / `server/.env.example`：部署三件套。

## 二、服务器部署步骤

以下路径与站点现有的 `/var/www/personal-site` 发布结构保持一致；`deploy` 用户无 sudo 权限，涉及 systemd 与 Nginx 的步骤需要你有 sudo 权限一次性完成。

### 1. 放置代码

在新版本发布后，角色卡文件会随站点一起出现在：

```bash
/var/www/personal-site/current/assets/data/bot-persona.json
```

把 `server/` 里的 `s5bot_proxy.py` 放到一个独立目录（不要放进会被版本切换覆盖的 `current/`）：

```bash
sudo mkdir -p /var/www/s5bot
sudo cp s5bot_proxy.py /var/www/s5bot/
sudo chown -R deploy:deploy /var/www/s5bot
```

### 2. 配置环境变量

```bash
sudo -u deploy cp .env.example /var/www/s5bot/.env
sudo -u deploy nano /var/www/s5bot/.env
```

至少填写三项：

- `S5BOT_UPSTREAM`：接口根地址，不含末尾 `/responses` 或 `/chat/completions`。
- `S5BOT_API`：主接口协议。`responses`（默认）会把角色卡放进 `instructions`，并把 Responses 流转换成前端现有的对话片段。`chat` 则走 Chat Completions，角色卡作为 system 消息。
- `S5BOT_API_KEY`：模型密钥。
- `S5BOT_MODEL`：模型 id。

备用池用 `S5BOT_POOL_1` 到 `S5BOT_POOL_20`。三项 `根地址|密钥|模型id` 按 Responses API 调用；四项再加 `|chat` 则按 Chat Completions 调用。主接口在返回任何文字之前失败时，代理按编号改试下一个；已经开始输出的回复不会中途换池。失败的池子会在 `S5BOT_POOL_COOLDOWN` 秒（默认 45）内被排到后面。`/api/health` 里的 `poolCount` 是主接口加备用的总数，不包含地址和密钥。

并设置：

- `S5BOT_PERSONA_PATH` 指向上面那份 `bot-persona.json`（用 `current/` 路径即可，注意版本切换后仍存在）。
- `S5BOT_ALLOWED_ORIGIN` 填你的正式域名，例如 `https://single5240.cn`。
- `S5BOT_RATE_PER_MIN` 控制每 IP 每分钟请求上限，默认 12。

`.env` 权限应收紧，且**绝不能提交进仓库**：

```bash
chmod 600 /var/www/s5bot/.env
```

### 3. 启动服务

```bash
sudo cp s5bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now s5bot
sudo systemctl status s5bot
curl http://127.0.0.1:8765/api/health
```

看到 `{"ok": true, "modelConfigured": true}` 说明密钥与模型已就位。代理只监听 `127.0.0.1`，不直接对外。

### 4. 配置 Nginx 反代

把 `server/nginx-location.conf` 的内容粘贴进站点 server 块的 `location /` 之前：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

关键点是 `proxy_buffering off;` 与 `X-Accel-Buffering: no`，否则流式输出会被缓冲成一次性返回。

### 5. 验证

打开启用了对话的页面（实验台页或任意文章页），在对话框里发一条消息：

- 回复应逐字出现，可点「停止」中断。
- 服务器日志可用 `journalctl -u s5bot -f` 查看。
- 额度耗尽、上游不可达、跨域请求都会返回明确错误，前端会提示而不是静默失败。

## 三、静态镜像上的降级

GitHub Pages 等纯静态环境没有 `/api/` 服务。此时前端会加载角色卡、正常展示人设与标签，但对话输入会被禁用，并提示到启用了服务的站点使用完整对话。这是**显式降级**，不会假装对话可用。

## 四、安全说明

- 密钥只存在于服务器 `.env`，前端与仓库里都没有。
- 代理校验 `Origin`，只接受配置的主站域名，避免被当作开放代理刷额度。
- 每次请求强制把角色卡 `systemPrompt` 放在消息首位，用户输入无法覆盖人设。
- 请求体大小、消息条数与单条长度都有上限；按 IP 做滑动窗口限流。
- 模型输出按纯文本渲染，不会作为 HTML 或代码执行。

## 五、改人设

只改 `assets/data/bot-persona.json`：

- `display.*`：角色卡上展示的姓名、称号、标签、语气说明等。
- `greeting` / `suggestions`：开场白与建议问题。
- `systemPrompt`：模型人设、语气、知识边界与安全底线。

前端与后端共用该文件，发布后两边同时生效；后端若以绝对路径引用 `current/` 下的副本，需注意版本切换后路径仍指向最新发布。
