---
layout: article
title: "从零到一：阿里云服务器 + Nginx + GitHub Actions 自动化双发与回滚实战"
description: "记录个人站点从轻量云服务器搭建、WSL 本地构建，到 GitHub Actions 自动化双发（Pages + 阿里云）与基于符号链接原子回滚的完整生产级实战与故障复盘。"
date: 2026-11-05
category: 嵌入式 Linux
tags:
  - GitHub Actions
  - Nginx
  - CI/CD
  - 云服务器
  - Ubuntu
---

搭建个人技术站点时，GitHub Pages 提供了极低成本且免运维的静态托管服务，但它存在公网访问延迟受限、无法灵活配置反向代理以及难以演进后端能力的局限。为了兼顾高可用与自主可控，最理想的架构是将站点**同时双发**至 GitHub Pages 与自建云服务器。

本文记录了一套生产级个人站点部署架构的演进全过程：从一台全新的 Ubuntu 云服务器选型加固、Nginx 服务调优，到借助 WSL2 进行本地编译，最终通过 GitHub Actions 打造自动化双发流水线，并基于 Linux 符号链接（Symlink）实现了**零停机原子切换**与**自动健康探测回滚**机制。

---

## 1. 总体架构与四层环境职责

在实施自动化流水线前，必须首先厘清开发、构建、调度与生产这四套异构环境的职责边界。许多部署过程中的权限冲突与网络困惑，本质上都是因为混淆了执行环境：

```text
[本地开发终端] Windows (PowerShell / VS Code)
   │ 编写 Markdown 源码、前端脚本与样式文件
   ▼
[本地编译验证] WSL2 Ubuntu (Ruby + Bundler + Node.js)
   │ 负责本地依赖管理、Jekyll 静态编译、页面元数据与死链检查
   ▼
[远端持续集成] GitHub Actions Runner (云端临时 Ubuntu 容器)
   │ 监听 main 分支推送，一次编译产物，同时向两个目标发布
   ├───────────────────────────────┬───────────────────────────────┐
   ▼                               ▼                               ▼
[目标 A：托管平台]            [网络通道：SSH/SCP]          [目标 B：自建云服务器]
GitHub Pages                 传输发布脚本与归档包            阿里云轻量应用服务器 (Ubuntu)
                                                             │
                                                             ├─ 专用 deploy 用户解压至 releases/
                                                             ├─ 校验 index.html 完整性
                                                             ├─ 原子替换 current 软链接
                                                             └─ Nginx 提供公网 HTTP/HTTPS 服务
```

### 环境职责划分

| 环境层次 | 物理载体 | 核心角色与职责 | 关键原则 |
| :--- | :--- | :--- | :--- |
| **工作台环境** | Windows 宿主机 | 日常编写、Git 版本管理与浏览器调试 | 不直接运行 Linux 原生构建工具链 |
| **本地构建环境** | 电脑内 WSL2 Ubuntu | 本地依赖安装、静态编译模拟与预检 | 保证本地能 100% 复现云端构建结果 |
| **CI 调度环境** | GitHub Actions 运行器 | 执行自动化测试、打包并充当传输跳板 | 纯无状态临时容器，凭据通过 Secrets 注入 |
| **线上生产环境** | 阿里云云服务器 (ECS) | 托管 Nginx、存储版本目录并响应访问 | 实行最小权限原则，禁止直接使用 root 部署 |

---

## 2. 基础设施与云服务器初始化

### 2.1 云服务器选型与系统基线

对于个人静态站点及后续扩展轻量后端服务，选择一台 **2 vCPU / 2 GiB 内存 / 40 GiB 系统盘** 的轻量应用服务器完全足够。

* **操作系统**：推荐选择官方纯净的 **Ubuntu 24.04 LTS x86_64** 系统镜像，避免预装过多捆绑软件，保持环境纯净；
* **地域选择**：优先选择物理距离较近的地域（如深圳、广州或杭州），降低访问 RTT 延迟；
* **公网带宽**：通常云厂商标注的峰值带宽（如 200 Mbps）为瞬时共享带宽上限，实际使用中按流量包计费或受 QoS 限速，静态资源需做好 Gzip 压缩以节省带宽。

### 2.2 系统加固与包管理器维护

通过网页控制台或本地终端以默认管理员用户（`admin` 或 `ubuntu`）登录后，首先更新系统索引与安全补丁：

```bash
# 1. 刷新软件源索引
sudo apt update

# 2. 升级已安装软件包
sudo apt upgrade -y
```

> [!IMPORTANT]
> **升级 OpenSSH 时的配置保留提示**
> 当系统升级到 OpenSSH 相关包时，终端可能会弹出 `/etc/ssh/sshd_config` 配置冲突提示。务必选择 **`keep the local version currently installed`（保留本地当前版本）**，防止云厂商预设的密钥登录配置被覆盖导致 SSH 离线失联。

升级完成后若涉及核心库变更，执行重启以刷新内核及服务：

```bash
sudo reboot
```

### 2.3 安装并启动 Nginx

```bash
# 安装 Nginx
sudo apt install -y nginx

# 设置开机自启并立即启动
sudo systemctl enable --now nginx

# 验证本地回环连通性
curl -I http://127.0.0.1
```

在云控制台的安全组/防火墙规则中，确保已放行 **TCP 80（HTTP）** 与 **TCP 443（HTTPS）** 入站端口。此时在浏览器访问服务器公网 IP，若看到 `Welcome to nginx!` 页面，说明外部网络链路正常打通。

---

## 3. 本地构建与手动部署验证

在把一切交给 CI 自动化之前，必须先在本地完整演练一次“编译-打包-传输-发布”的手动闭环，以便建立直观的排错基准。

### 3.1 WSL2 环境中的静态网站构建

Windows 上的源码目录（例如 `E:\mydata\work\code\blog`）在 WSL2 中自动挂载于 `/mnt/e/mydata/work/code/blog`。进入 WSL2 终端执行：

```bash
# 1. 检查 Ruby 与 Bundler 依赖
bundle check || bundle install

# 2. 严格模式构建静态网页
bundle exec jekyll build --strict_front_matter

# 3. 运行本地预检脚本（校验元数据、死链、Sitemap 等）
node scripts/check-site.mjs
```

此时生成的静态文件均存放在 `_site/` 目录下。

### 3.2 规范归档打包

打包静态资源时，需要特别注意压缩路径的层级结构，必须直接打包目录内部文件，而非外层包裹目录：

```bash
# -C _site . 表示切入 _site 目录打包其内部所有文件（含隐藏文件）
tar -czf /tmp/personal-site.tar.gz -C _site .
```

*如果打包命令错误写成了 `tar -czf site.tar.gz _site`，解压到服务器后将多出一层 `_site` 目录，导致访问根域名直接触发 404/403 错误。*

### 3.3 手动部署与权限基线

将压缩包上传至服务器用户家目录（如 `/home/admin/personal-site.tar.gz`），在服务器端解压并校正权限：

```bash
# 1. 备份原有站点（如存在）
sudo tar -czf /home/admin/nginx-html-backup.tar.gz -C /var/www/html .

# 2. 解压新版本至 Nginx 目录，--no-same-owner 避免还原打包机的 UID/GID
sudo tar -xzf /home/admin/personal-site.tar.gz -C /var/www/html --no-same-owner

# 3. 设置生产级权限掩码：目录 755，文件 644
sudo chmod -R u=rwX,go=rX /var/www/html
```

> [!TIP]
> **为什么拒绝 `chmod -R 777`？**
> `u=rwX,go=rX` 中大写的 `X` 具有特殊含义：它只给**目录**（以及原本就具备可执行属性的文件）赋予 `+x`（进入目录的执行权限），而不会把普通的 HTML、CSS、JS 等静态文件变成 `777` 可执行文件。这既保障了 Nginx worker 进程有权限读取并遍历目录，又恪守了文件系统的安全防线。

---

## 4. 生产级自动化发布：GitHub Actions 与安全加固

手动上传虽然可行，但存在操作繁琐、易遗漏校验、缺乏审计记录等痛点。我们需要将整个过程交由 GitHub Actions 驱动。

### 4.1 最小权限原则：创建专用 `deploy` 用户

自动化部署属于非交互式脚本操作，**坚决不能直接使用 `root` 或拥有无密码 `sudo` 权限的日常管理账号进行 SSH 登录**。

在云服务器上创建专用的系统部署账号：

```bash
# 创建禁用密码登录的 deploy 用户
sudo adduser --disabled-password --gecos "" deploy

# 创建专属部署根目录并移交属主
sudo mkdir -p /var/www/personal-site
sudo chown -R deploy:deploy /var/www/personal-site
```

该用户无 `sudo` 权限，其工作空间完全隔离在 `/var/www/personal-site` 之内，即使 CI 密钥发生意外泄露，攻击者也无法通过该账号接管操作系统。

### 4.2 部署密钥生成与严格互信配置

#### 步骤一：本地生成专属 Ed25519 密钥对

在本地 WSL2 终端中生成专用于 GitHub Actions 的密钥对，严禁设置私钥密码（保证非交互式运行）：

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github-actions-deploy -N ""
```

#### 步骤二：向云服务器安装公钥并限制能力

登录云服务器，为 `deploy` 用户部署公钥：

```bash
# 创建并限制 .ssh 目录权限
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh

# 追加公钥内容，并在行首加上 restrict 限制标记
sudo tee -a /home/deploy/.ssh/authorized_keys > /dev/null <<'EOF'
restrict ssh-ed25519 AAAA...你的公钥内容... github-actions-deploy
EOF

# 固化权限（OpenSSH 强制要求）
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

> [!NOTE]
> `authorized_keys` 中的 `restrict` 关键字可以在不破坏 SCP 文件传输的前提下，强制禁用该密钥的 PTY 终端分配、端口转发（Port Forwarding）、X11 转发和 Agent 转发能力，将攻击面压缩到极小范围。

#### 步骤三：双向身份确认（Known Hosts）

SSH 登录不仅需要服务器验证客户端身份，**客户端也必须验证服务器的主机指纹**，以防范中间人劫持（MITM）：

```bash
# 在云服务器上获取自身主机公钥指纹：
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
# 输出示例：SHA256:NeUY3NUsk2sfCTCbxGXOSFgu5GPAysIxHkPcyLkoZSE

# 在本地 WSL2 中测试连接并核对指纹无误后写入 known_hosts：
ssh -i ~/.ssh/github-actions-deploy deploy@<SERVER_IP> 'whoami'
```

### 4.3 配置 GitHub 仓库 Secrets

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中，配置如下四个 Repository Secrets：

| Secret 键名 | 作用与格式 | 示例值 / 获取方式 |
| :--- | :--- | :--- |
| `ALIYUN_HOST` | 目标服务器公网 IP 或域名 | `203.0.113.10`（纯地址，不带 http 或端口） |
| `ALIYUN_USER` | 登录所用的操作系统账号 | `deploy` |
| `ALIYUN_SSH_KEY` | 自动化专用的 Ed25519 私钥明文 | `~/.ssh/github-actions-deploy` 完整内容（含 BEGIN/END） |
| `ALIYUN_KNOWN_HOSTS` | 服务器主机公钥指纹记录 | `ssh-keygen -F <SERVER_IP> -f ~/.ssh/known_hosts` 输出整行 |

---

## 5. 零停机原子切换与自动化回滚机制

传统部署往往采用直接覆盖旧文件的方式，这种做法在生产环境中存在严重缺陷：
1. **服务毛刺**：解压新包需要数秒，在此期间外部请求可能会读取到半写入的损坏文件，甚至导致 404；
2. **孤儿残留**：在代码库中已经删除的旧文章或旧资源，直接解压不会被自动清理，会在生产环境持续累积；
3. **回滚困难**：一旦新版本上线后发现重大缺陷，必须重新构建或寻找旧备份解压，无法秒级恢复。

为此，我们引入工业界标准的**基于符号链接（Symlink）的原子发布架构**。

### 5.1 版本目录拓扑设计

```text
/var/www/personal-site/
├── current -> releases/abc1234-890123-1/    <--- 稳定入口（符号链接）
│
└── releases/                               <--- 历史版本隔离目录
    ├── initial/                            <--- 手工备份基线
    ├── abc1234-890123-1/                   <--- 正在运行的版本 (Git Commit + Run ID)
    └── def5678-890456-1/                   <--- 上一个稳定版本（待命回滚）
```

Nginx 的静态站点根目录始终配置为固定的 `/var/www/personal-site/current`，它本身是一个软链接。**发布新版本时，只需在后台创建新版本目录，验证完毕后通过 Linux 系统调用瞬间将 `current` 重定向到新版本。**

### 5.2 Nginx 根目录适配与平滑加载

修改 `/etc/nginx/sites-available/default`（修改前务必先备份）：

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    # 关键：将 root 指向符号链接 current
    root /var/www/personal-site/current;
    index index.html index.htm;

    server_name _;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

测试并重载 Nginx（本次重载后，今后版本更新只需切换软链接，无需再触动 Nginx）：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 5.3 生产级部署与双向校验脚本设计

在仓库中新增部署核心脚本 `scripts/deploy-static-site.sh`。GitHub Actions 在远端通过 SSH 管道将脚本注入目标服务器执行：

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. 约束版本标识格式（Commit SHA - Run ID - Run Attempt）
RELEASE_ID="${1:?Missing release_id}"
SITE_ROOT="/var/www/personal-site"
RELEASES_DIR="${SITE_ROOT}/releases"
CURRENT_LINK="${SITE_ROOT}/current"
NEW_RELEASE="${RELEASES_DIR}/${RELEASE_ID}"
ARCHIVE_PATH="${HOME}/site-${RELEASE_ID}.tar.gz"

umask 022

# 2. 检查前置软链接是否有效，记录回滚目标
if [ ! -L "${CURRENT_LINK}" ]; then
    echo "Error: ${CURRENT_LINK} is not a valid symlink!" >&2
    exit 1
fi
PREVIOUS_TARGET="$(readlink "${CURRENT_LINK}")"

# 3. 错误捕获：任何步骤异常立即触发自动回滚
rollback() {
    local exit_code=$?
    if [ ${exit_code} -ne 0 ]; then
        echo "Deployment failed! Initiating rollback to ${PREVIOUS_TARGET}..." >&2
        ln -sfn "${PREVIOUS_TARGET}" "${CURRENT_LINK}"
        echo "Previous version successfully restored." >&2
    fi
    rm -f "${ARCHIVE_PATH}"
    exit ${exit_code}
}
trap rollback EXIT INT TERM

# 4. 创建隔离的新版本目录并解压
mkdir -p "${NEW_RELEASE}"
tar -xzf "${ARCHIVE_PATH}" -C "${NEW_RELEASE}" --no-same-owner

# 5. 校验新目录首页有效性并固化权限
test -s "${NEW_RELEASE}/index.html"
chmod -R u=rwX,go=rX "${NEW_RELEASE}"

# 6. 【核心动作】原子切换软链接 (通过 ln + mv -Tf 实现不可分割的替换)
TEMP_LINK="${SITE_ROOT}/.link-${RELEASE_ID}"
ln -s "releases/${RELEASE_ID}" "${TEMP_LINK}"
mv -Tf "${TEMP_LINK}" "${CURRENT_LINK}"

# 7. 【双向深度校验】从本机 HTTP 端口拉取页面，字节级对比新版本首页
PROBE_FILE="$(mktemp)"
curl -fsS --retry 3 --retry-connrefused "http://127.0.0.1/" -o "${PROBE_FILE}"

if ! cmp --silent "${PROBE_FILE}" "${NEW_RELEASE}/index.html"; then
    echo "Verification error: HTTP response does not match newly deployed index.html!" >&2
    rm -f "${PROBE_FILE}"
    exit 1
fi
rm -f "${PROBE_FILE}"

# 8. 成功完成，解除 trap 保护
trap - EXIT INT TERM
rm -f "${ARCHIVE_PATH}"
echo "Release ${RELEASE_ID} deployed and verified successfully."
```

> [!TIP]
> **为什么要用 `cmp` 进行字节比对，而不是仅检查 `HTTP 200`？**
> 在复杂的生产环境中，仅检查 `HTTP 200` 极具欺骗性。如果 Nginx 内存中的配置未更新、或者根路径误指到了旧目录，HTTP 响应同样会返回 `200 OK`，但这属于典型的**假死/假成功（Phantom Success）**。通过将本地 `curl` 抓取的实时网页与本次打包的 `index.html` 逐字节比对（`cmp --silent`），能够确保 Nginx 当前输出的内容绝对来自于本次最新构建！

### 5.4 换行符陷阱：`.gitattributes` 的必要性

Windows 开发者在本地 Git 提交 Shell 脚本时，默认可能会被 Git 的 `core.autocrlf` 转换为 `CRLF`（Windows 回车换行）。当远端 Linux 执行带有 `\r` 的 Bash 脚本时，会直接抛出语法崩溃：

```text
syntax error near unexpected token $'{\r'
```

为了从工程规范上根除此隐患，必须在仓库根目录添加 `.gitattributes`：

```gitattributes
scripts/deploy-static-site.sh text eol=lf
```

这确保无论在任何操作系统上检出，该脚本的行尾都严格保持 `LF`。

---

## 6. GitHub Actions 双发流水线编排

在 `.github/workflows/site-quality.yml` 中编排构建与发布任务。关键原则是：**同一份构建产物进行一次编译和校验，产物打包后分别投递给 GitHub Pages 与自建服务器，避免重复编译产生的哈希不一致。**

```yaml
name: Site Quality and Dual Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: pages-${{ github.ref }}
  cancel-in-progress: false

jobs:
  build-and-check:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.3'
          bundler-cache: true

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Build Jekyll site
        run: bundle exec jekyll build --strict_front_matter

      - name: Verify site integrity
        run: node scripts/check-site.mjs

      # 规范打包网页归档，供后续两个部署任务复用
      - name: Package website artifact
        run: tar -czf /tmp/site-dist.tar.gz -C _site .

      - name: Upload artifact for Aliyun
        uses: actions/upload-artifact@v4
        with:
          name: aliyun-site-artifact
          path: /tmp/site-dist.tar.gz
          retention-days: 1

      - name: Upload artifact for GitHub Pages
        uses: actions/upload-pages-artifact@v3
        with:
          path: _site

  # 任务 1：发布至 GitHub Pages
  deploy-github-pages:
    needs: build-and-check
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4

  # 任务 2：发布至阿里云生产服务器
  deploy-aliyun:
    needs: build-and-check
    runs-on: ubuntu-latest
    timeout-minutes: 10
    env:
      ALIYUN_HOST: ${{ secrets.ALIYUN_HOST }}
      ALIYUN_USER: ${{ secrets.ALIYUN_USER }}
      ALIYUN_SSH_KEY: ${{ secrets.ALIYUN_SSH_KEY }}
      ALIYUN_KNOWN_HOSTS: ${{ secrets.ALIYUN_KNOWN_HOSTS }}
    steps:
      - name: Checkout repository for scripts
        uses: actions/checkout@v4

      - name: Download compiled artifact
        uses: actions/download-artifact@v4
        with:
          name: aliyun-site-artifact
          path: /tmp

      - name: Configure secure SSH environment
        run: |
          mkdir -p ~/.ssh
          chmod 700 ~/.ssh
          echo "$ALIYUN_SSH_KEY" > ~/.ssh/id_deploy
          chmod 600 ~/.ssh/id_deploy
          echo "$ALIYUN_KNOWN_HOSTS" > ~/.ssh/known_hosts
          chmod 644 ~/.ssh/known_hosts

      - name: Deliver artifact and trigger atomic switch
        run: |
          RELEASE_ID="${GITHUB_SHA}-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
          
          # 1. 安全传输静态归档
          scp -i ~/.ssh/id_deploy -o IdentitiesOnly=yes \
            /tmp/site-dist.tar.gz \
            "${ALIYUN_USER}@${ALIYUN_HOST}:~/site-${RELEASE_ID}.tar.gz"

          # 2. 管道式远端执行部署与比对验证
          ssh -i ~/.ssh/id_deploy -o IdentitiesOnly=yes \
            "${ALIYUN_USER}@${ALIYUN_HOST}" \
            "bash -s -- '${RELEASE_ID}'" < scripts/deploy-static-site.sh

      - name: Cleanup credentials
        if: always()
        run: rm -rf ~/.ssh/id_deploy
```

---

## 7. 真实生产故障复盘：从“假成功”到真闭环

在流水线首次实战运行时，遇到了一个极其典型、极具启发性的生产故障。

### 7.1 故障现象

GitHub Actions 执行时，`build-and-check` 与 `deploy-github-pages` 全部呈现绿色通过；但在 `deploy-aliyun` 任务中，流水线在最后一步突然报错红灯：

```text
Verification failed; restoring the previous website
Previous website restored
Process completed with exit code 1
```

与此同时，外部浏览器访问自建服务器依然一切正常，页面并未宕机。

### 7.2 根因排查链路

根据日志信息，部署脚本触发了第 8 节的自动回滚逻辑。登录服务器进行诊断：

1. 检查软链接状态：`readlink /var/www/personal-site/current` 准确指回了上一个版本 `releases/initial`，证明**自动回滚机制完全生效**；
2. 检查新产物：`releases/` 下新版本的 `index.html` 确实存在且内容完整；
3. 检查 Nginx 配置文件：`/etc/nginx/sites-available/default` 中的 `root` 确实已经被改为了 `/var/www/personal-site/current`；
4. **定位关键死穴**：查看 Nginx 运行进程的启停时间戳：
   ```bash
   ps -eo pid,lstart,cmd | grep nginx
   ```
   发现当前正在运行的 Nginx Worker 进程启动时间为 `22:58`，而修改配置文件的写入时间是 `23:34`！

**真相大白**：之前在服务器上修改了 Nginx 配置文件后，执行了 `nginx -t` 测试成功，**但遗漏了 `systemctl reload nginx` 命令！**

因此，Nginx Worker 进程依然在内存中沿用旧的 `/var/www/html` 配置提供服务。当部署脚本通过 `curl http://127.0.0.1/` 探测首页并与新版本比对时，Nginx 返回的始终是旧站的内容，触发了 `cmp` 字节校验失败。

这也雄辩地证明了：**简单的 HTTP 200 探测只能发现服务死活，无法发现内容陈旧；深入到字节级哈希或内容比对，才能彻底杜绝假发布。**

### 7.3 修复验证

在服务器上以管理员身份执行真正的平滑重载：

```bash
sudo systemctl reload nginx
```

随后在 GitHub Actions 中点击 **Re-run failed jobs**，流水线耗时 24 秒全部变绿。此时比对本地打包产物与线上实时输出：

```bash
# 获取线上公网首页哈希与本地产物哈希对比
curl -s http://<SERVER_IP>/ | sha256sum
sha256sum _site/index.html
```

两份 SHA-256 摘要完全一致，站点正式实现自动化闭环！

---

## 8. 日常运维规范与应急手册

### 8.1 开发者日常心智负担归零

随着双发自动化流水线落地，日常运维复杂度大幅下降：

```bash
# 日常发布三部曲：
git add .
git commit -m "docs: 增加新技术专栏文章"
git push origin main
```

推送后只需观察 GitHub 仓库的 Actions 图标变绿，GitHub Pages 与阿里云两处节点即在 1 分钟内完成全自动同步。

### 8.2 紧急手动回滚命令速查

如果在极端异常情况下（如新提交的文章存在逻辑漏洞但通过了编译），需要手工将云服务器紧急回滚到历史版本：

```bash
# 登录服务器，查看历史保留版本
ls -lt /var/www/personal-site/releases

# 确认上一可用版本的完整性后，执行原子重置
sudo -u deploy ln -sfn releases/<指定历史版本号> /var/www/personal-site/current

# 验证当前生效版本
readlink /var/www/personal-site/current
```

无需重启 Nginx，公网访问即刻秒级切换回历史版本。

---

## 9. 总结与工程启示

从最基础的手工 `tar` 打包上传，演进到具备双发与回滚能力的 CI/CD 流水线，这套架构落地带来了几条通用的工程启示：

1. **环境认知是运维的第一前提**：分清代码在何处编译、在何处调度、在何处运行，是规避权限与网络混乱的根本；
2. **永远不要信任单一的状态码**：监控与探针中，“返回 200”不代表“业务正确”，结合内容摘要的比对才是防御假死发布的利器；
3. **把基础设施沉淀为规范**：通过最小权限账号、`restrict` 标记与 LF 换行符约束，在系统层消灭由于人为失误导致的非预期故障。
