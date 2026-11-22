# 部署到 Render（免费、稳定 HTTPS）

目标地址形如 `https://cheese-ai-demo.onrender.com`：HTTPS、无密码、无查询参数、无临时签名。

## 一键部署

1. 打开：<https://render.com/deploy?repo=https://github.com/HH-567/cheese-ai>
2. 用 GitHub 登录，授权 Render 读取这个仓库；
3. Blueprint 会自动读取 `render.yaml`，服务名默认 `cheese-ai-demo`（可改，改完地址随之变化）；
4. 三个 `sync: false` 的变量可以现在填，也可以部署后在 Dashboard → Environment 里补：
   - `CLOUD_BASE_URL`（如 `https://api.deepseek.com`）
   - `CLOUD_MODEL`（如 `deepseek-chat`）
   - `CLOUD_API_KEY`（你的模型 Key，只存在 Render 环境变量里）
   
   不填也能启动：问答库、本地工具、登录都正常，只是未命中时没有云端兜底。
5. 点 **Deploy**，等 2–4 分钟构建完成。

## 首次启动做什么

`deploy/bootstrap.py` 会：

1. 建库、建演示账号 `u-a` / `u-b` / `u-c`；
2. 如果共享库为空，从 release 下载 `cheese-ai-library-20261122.json.gz`（4.89 MB）并导入；
3. 导入约 3 秒，完成后共享库约 34,657 组 / 139,185 条问法。

后续重启会检测到库已存在，直接跳过导入。

## 免费实例的注意点

- 15 分钟无访问会休眠，下一次访问冷启动约 30–60 秒；
- 磁盘是临时的：重启后用户会话、聊天记录会清空，演示库会在启动时重新导入（约 3 秒）；
- 每月 750 小时免费额度，单个服务足够；
- 想固定不被休眠，可以升级到付费实例，或在演示前 5 分钟先访问一次唤醒。

## 演示账号

| 账号 | 角色 | 密码 |
| --- | --- | --- |
| `u-a` | 管理员 | `demo1234` |
| `u-b` | 审核 | `demo1234` |
| `u-c` | 普通用户 | `demo1234` |

## 更新

仓库 `master` 有新提交时，Render 默认自动重新部署；也可以在 Dashboard 手动 **Manual Deploy**。

## 其他平台

`deploy/bootstrap.py` 与 `render.yaml` 的启动命令同样适用于 Fly.io、Railway、自己的 VPS：只要有 Python 3.11、能写 `data/`、能访问 GitHub release 即可。自己的服务器建议再加一层 Nginx/Caddy 反代与 HTTPS。
