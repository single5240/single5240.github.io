# GitHub Actions 同时发布 GitHub Pages 和云服务器

流程：推送到 main → 构建和检查 → 同一份网页产物分别发布到 GitHub Pages、云服务器。Pull Request 只检查，不部署。

## 服务器前提

- 创建无 sudo 权限的专用 `deploy` 用户，公钥装入该用户的 `authorized_keys`。
- `/var/www/personal-site` 归 deploy 所有。
- 已有可用的 `releases/initial/index.html`，`current` 是指向 `releases/initial` 的符号链接。
- Nginx 的 root 指向 `/var/www/personal-site/current`，普通静态文件可通过本机 HTTP 根路径访问。
- SSH 密钥登录、文件传输可用，云防火墙允许部署端访问 SSH。
- 服务器具备 Bash、tar、curl、cmp 和常用 GNU 文件工具。

具体服务器地址和密钥只保存在私有设置中，不写进仓库。

## GitHub 仓库设置

Settings → Secrets and variables → Actions，添加 Repository secrets：

- `ALIYUN_HOST`：主机 IP 或域名，不带协议和路径；此配置使用默认 SSH 22 端口。
- `ALIYUN_USER`：专用部署用户。
- `ALIYUN_SSH_KEY`：对应的无口令私钥全文，包含 BEGIN/END 行。
- `ALIYUN_KNOWN_HOSTS`：核对过服务器指纹后取得的 known_hosts 条目。

私钥不得提交到仓库，也不要粘贴进 Actions 日志或聊天。服务器指纹发生变化时，应重新核对身份，再更新 known_hosts，不能关闭主机身份检查。

## 工作流如何运行

文件：`.github/workflows/site-quality.yml`。

1. `build-and-check` 构建 Jekyll，执行现有检查，然后上传 `github-pages` 产物。
2. 原来的 `deploy` 任务继续发布到 GitHub Pages。
3. `deploy-aliyun` 下载同一个产物中的 `artifact.tar`，配置临时 SSH 密钥，上传到部署用户家目录。
4. 通过 SSH 执行 `scripts/deploy-static-site.sh`，解压到以提交和运行编号命名的新目录。
5. 原子替换 current 链接，使用服务器本机 HTTP 请求比较首页文件内容；失败时切回上一个链接，并让工作流报错。

普通静态版本切换不需要 sudo，也不需要 reload Nginx。构建失败不会执行部署。两个发布目标分别执行，因此一个失败并不自动撤回另一个发布目标。

同一分支不取消正在执行的工作流，避免后续推送打断部署。密钥在任务结束时清理。版本目录保留以便回退，目前不自动清理；长期运行后应查看磁盘并有选择地清理旧版本。

健康检查只验证本机首页内容，并不证明公网入口、全部资源和交互页面都通过验收。第一次部署后仍需浏览器检查首页、文章、图片和互动页。

## 首次触发与观察

提交并推送配置后，打开仓库 Actions → Site quality and Pages → 最新运行。

- 构建检查通过后，出现 deploy 和 deploy-aliyun 两个发布任务。
- 阿里云任务成功日志包含 `Published release ...`。
- 刷新公网网站检查实际效果。
- 后续运行也可以从 Actions 页面通过 Run workflow 手动触发 main 分支。

## 常见错误

- `Missing repository secret`：核对 Secret 名称及是否保存在 Repository secrets，而不是未引用的 Environment 下。
- `Host key verification failed`：known_hosts 条目缺失或不匹配；先核对服务器实际指纹。
- `Permission denied (publickey)`：用户、公钥、私钥或目录权限不匹配；先在自己电脑测试同一个用户和密钥。
- SSH 超时：核对主机地址、22 端口、云防火墙和服务器 SSH 服务。电脑能登录不代表 GitHub 托管运行器也一定能连接。
- `Prepare ROOT/current ...`：服务器初始目录或符号链接没有准备好。
- `Verification failed`：Nginx root、首页读取权限或实际站点路由不匹配；任务会尝试恢复旧版本。

日志中的主机值可能被 GitHub 脱敏为 `***`，不要通过关闭脱敏来排查。

## 手动回退

在服务器用 deploy 身份操作，先查看 current 和已知可用版本，选定真实存在的旧目录。以下以初始版本为例：

```bash
cd /var/www/personal-site
readlink current
test -s releases/initial/index.html
ln -s releases/initial .rollback-current
mv -Tf .rollback-current current
curl -I http://127.0.0.1/
```

确认旧目录存在后才切换；不要删除正在由 current 使用的版本。该操作只回退云服务器副本，不会改变 GitHub Pages。

## 网站地址

构建继续使用现有 `_config.yml`，站点 canonical、feed 等仍以 GitHub Pages 为主。云服务器目前是镜像副本；以后启用独立域名时，再决定是否需要单独的构建配置。
