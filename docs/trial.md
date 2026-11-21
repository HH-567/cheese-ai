# 注册与使用

开启注册后，用户可以从同一个登录页创建个人账号或登录已有账号。使用同一账号登录同一个服务，即可在另一台设备上继续已有会话。返回聊天标签页时，会话列表和当前消息从服务器刷新。新账号使用个人库。维护者可授予共享库成员资格，并在核验身份后开启暂停投票权限。

云端请求在发出前占用额度。云端回答、重答、主动改写及其后台学习重试共用额度。开启注册时，默认每账号每天 20 次，工作区每天 200 次。额度在 UTC 每日零时重置。已耗尽时，已有问答和本地工具仍可使用，后台学习等到重置再继续。运营者可以设置输出 Token 上限和模型单价。用量页显示额度和费用估算。实际账单仍取决于模型服务商定价及用量。

## 本机运行

从项目根目录确认前端已经构建。设置以下变量可在同一个本地入口提供预置账号和个人账号注册。所有数据默认保存在 `data/qishi.sqlite3`。

```powershell
$env:QISHI_DEMO_MODE = "1"
$env:QISHI_OPEN_REGISTRATION = "1"
python -m uvicorn app.main:app --app-dir backend --env-file .env --host 127.0.0.1 --port 8000
```

打开 [本机登录页](http://127.0.0.1:8000/)，选择「登记新身份」。供不同设备访问时，使用同一个 HTTPS 地址和持久化数据目录。公开部署时设置 `QISHI_DEMO_MODE=0` 和 `QISHI_COOKIE_SECURE=1`，反向代理保留 Host 并向受信任的 Uvicorn 转发 HTTPS 协议及客户端地址。执行管理命令时沿用服务的数据目录。

额度可通过 `QISHI_USER_DAILY_CLOUD_CALLS`、`QISHI_SITE_DAILY_CLOUD_CALLS` 和 `CLOUD_MAX_TOKENS` 调整，其中 0 表示不设对应限制。注册按客户端地址和工作区限速，`QISHI_REGISTRATION_PER_HOUR` 默认为每客户端每小时 5 次尝试，工作区上限为该值的 20 倍。

## 外部来源

维护者可以把指定公开仓库的最新正式发布加入个人库或共享库。先用 `create-user --role admin` 创建管理账号，再将下列示例中的账号替换为实际账号。

```powershell
$env:PYTHONPATH = "backend"
python -m app.cli track-release --repo vitejs/vite --owner workshop-admin --scope shared
python -m app.cli grant-member --id workshop-member
```

成员可以问「vitejs/vite 的最新正式版本是什么？」或「vitejs/vite 最新稳定版是什么？」。答复保留官方发布页链接。记录到期时按需核对 GitHub，发现变更后进入现有审核流程。 [GitHub Releases API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)

运行 `python backend/tests/trial_acceptance.py`，在隔离数据库中验证注册、旧演示身份隔离、同账号从第二个登录读取会话、个人记录隔离，以及额度耗尽时的本地复用和并发调用限制。
