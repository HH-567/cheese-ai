# 接口契约 · 从前端原型接到 FastAPI

这份文档把 demo 里的每个交互映射到《黑客松技术方案》的后端设计上：REST 端点、SSE 事件、数据表字段、权限检查点，以及需要替换的三个前端模块。

> demo 里的状态都在 `store.js`（localStorage 快照）。接后端时把它换成 API 客户端，`cloud.js` 换成 `fetch` + `EventSource`，`matcher.js` 移到服务端即可；其余 UI 不动。

---

## 0. 需要替换的三个模块

| 前端文件 | 现在 | 接后端后 |
| --- | --- | --- |
| `assets/js/cloud.js` | 本地模板 + 仿真流式 | `POST /api/sessions/{id}/messages`，读 SSE |
| `assets/js/store.js` | 内存 + localStorage | API 客户端 + 读模型缓存（问答库/治理页可按需拉取） |
| `assets/js/matcher.js` | 浏览器里打分 | 调 `POST /api/match`，或整段挪进 Python 的 `matcher.py` |

`tools.js` 可以保留在前端（响应最快、天然离线），也可以放到服务端得到同样的 `meta`，两者结果一致即可。

---

## 1. 身份与权限

```
签发：部署者本地命令创建账号 → 登录接口验签 → 服务端用持久密钥签短期 token（sub / exp / sid）
携带：HttpOnly + SameSite cookie（HTTPS 加 Secure），写操作校验 Origin 或 CSRF token
注入：路由统一 Depends(current_user)，验签 + 查用户与登录会话状态
```

可见范围的唯一判据（每个查询都要带）：

```sql
-- 可读的问题组
groups.scope = 'shared'                                  -- 共享库：库成员可读
OR groups.owner_id = :current_user                       -- 个人库：仅本人
```

权限矩阵：

| 操作 | 个人库所有者 | 共享库成员 | 共享库管理员 |
| --- | --- | --- | --- |
| 问 / 复用 | ✅ | ✅ | ✅ |
| 报告误答 | ✅ | ✅ | ✅ |
| 提交修订建议 | ✅ | ✅ | ✅ |
| 采用为新版本 | ✅ | ❌ | ❌ |
| 发布 / 停用 / 恢复 / 回滚共享库记录 | — | ❌ | ✅ |
| 处理审核队列 | — | ❌（只读） | ✅ |

demo 对应：`S.isAdmin()`、`S.visibleRecords()`、`S.adopt()`（个人库）与 `S.publishVersion()`（管理员）。

---

## 2. REST 端点

### 会话

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/sessions` | 当前身份的会话列表（标题、更新时间、scope、最后一条消息来源） |
| `POST` | `/api/sessions` | 新建会话 `{scope}` |
| `GET` | `/api/sessions/{sid}` | 会话 + 完整消息（含 `source / group_id / version_id / variant_id / matched_alias / usage`） |
| `DELETE` | `/api/sessions/{sid}` | 删除会话 |

### 发消息（SSE）

```
POST /api/sessions/{sid}/messages
Content-Type: application/json
{ "text": "Python 3 的 bool([]) 返回什么？为什么？",
  "force_cloud": false,              // 「重新问云端」
  "reask_of": null }                 // 重新问云端时带原目标 {group_id, version_id}
```

响应 `text/event-stream`：

```
event: delta
data: {"message_id":"m_1","text":"`bool([])` 返回 "}

event: done
data: {
  "message_id":"m_1",
  "source":"library",                // library | cloud | tool | local | error
  "decision":"reuse",                // reuse | cloud | tool | ask | stale | error
  "group_id":"grp_bool_empty",
  "version_id":"v1",
  "variant_id":null,
  "matched_alias":"Python 3 的 `bool([])` 返回什么？为什么？",
  "match_type":"exact",              // exact | alias | semantic | tool | none
  "score":1.0,
  "cloud_calls":0,
  "first_token_ms":0,
  "total_ms":11,
  "cost":0,
  "trace":[{ "key":"refs","label":"指代补全","state":"skip","detail":"…" }],
  "learn_task":null                   // 云端首次回答时返回 {task_id, state}
}

event: error
data: {"message_id":"m_1","code":"cloud_unavailable","message":"…"}
```

`trace[].key` 取值与 demo 一致：`refs / memory / tool / exact / alias / semantic / verify / pause / freshness / answer / cloud / learn`，`state` 为 `ok | skip | fail | run`。前端直接渲染，不需要自己拼文案。

### 本地匹配

```
POST /api/match
{ "query": "Python 3 的 if 条件遇到空列表时会判断为真还是假？原因是什么？",
  "user_id": "u-b", "threshold": 0.7 }
```

```json
{
  "decision": "reuse",
  "chosen": { "group_id": "grp_bool_empty", "version_id": "v1", "via": "semantic", "match_key": "…" },
  "shortlist": [{ "group_id": "grp_bool_empty", "score": 0.84, "cov": 0.93, "bigram": 0.33, "missing": [] }],
  "conflicts": [],
  "blocked": [{ "group_id": "grp_xlookup", "kind": "suspended", "reason": "…" }]
}
```

`blocked[].kind`：`suspended`（目标被暂停）或 `bypass`（报告人主动绕开）。**这个端点必须同时检查暂停和报告人绕开**，demo 里就是 `E.blockReason`。

### 问答库

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/groups?filter=all\|mine\|shared\|review\|disabled&q=` | 问题组列表（含版本数、命中数、状态、暂停数） |
| `GET` | `/api/groups/{gid}` | 详情：版本时间线、表达变体、等价问法（含拒收原因）、时效策略 |
| `POST` | `/api/groups/{gid}/versions` | 发布新版本 `{answer, basis}`；旧版置 `superseded` |
| `POST` | `/api/groups/{gid}/rollback` | `{version_id}` 回滚（留痕） |
| `PATCH` | `/api/groups/{gid}` | `{status: active\|disabled}` |
| `POST` | `/api/groups/{gid}/aliases/check` | 重新跑等价检查（幂等，不产生模型调用） |

### 报告 / 暂停 / 修订

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/reports` | `{group_id, type:"version"\|"match", version_id, match_key, category:"fact"\|"mismatch"\|"style", note}` |
| `GET` | `/api/governance` | 报告队列（按目标聚合 + 票数）、修订建议、暂停列表、指标 |
| `POST` | `/api/suspensions/{id}/resolve` | `{resolution:"restored"\|"fixed"\|"disabled"}` |
| `POST` | `/api/revisions` | `{group_id, proposed_answer, note}` |
| `POST` | `/api/revisions/{id}/resolve` | `{action:"publish"\|"variant"\|"kept"}` |

报告写入时的服务端逻辑（与 demo `S.addReport` 一致）：

1. 目标键 `g:{gid}:v:{vid}` 或 `g:{gid}:m:{normalized_query}`。
2. 同一用户、同一目标、同一类别、未处理 → 更新而不是新增（重复提交只算 1 人）。
3. `fact | mismatch` 计入票数：滚动窗口内按 `user_id` 去重，只算已验签成员。
4. 达到阈值 → 建 `suspensions` 记录（`kind / match_key / version_id / report_ids`），状态 `active`。
5. `style` 只记录，不参与暂停。

### 时效核对

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/groups/{gid}/refresh` | 发起来源核对；同一来源版本已有在途任务时返回 `409` + 现有 `task_id` |
| `GET` | `/api/refresh-tasks` | 任务列表（状态、开始时间、结果） |

核对完成：内容未变 → 只更新 `last_checked_at` 与 `review_at`（下次复核时间 = now + interval）；内容变化且影响事实 → 建候选修订，审核前查询返回 `decision: "stale"`。

### 用量

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/usage?days=30` | 路径分布、云端调用（回答 / 改写）、首字与总耗时中位、成本、报告数 |
| `GET` | `/api/usage/requests?limit=40` | 请求日志（含 `path / cloud_calls / cost / reported`） |

---

## 3. 数据表

```sql
users(id, name, role, verified, created_at)                     -- role: member | admin
library_members(library_id, user_id, role)                      -- 共享库成员关系
sessions(id, owner_id, title, scope, created_at, updated_at)    -- scope: shared | personal
messages(id, session_id, role, content, source, group_id, version_id,
         variant_id, matched_alias, match_type, cloud_calls,
         first_token_ms, total_ms, cost, status, created_at)

groups(id, owner_id, scope, original, intent, entities_json, constraints_json,
       current_version_id, freshness_kind,           -- stable | versioned | tool | realtime
       source, source_version, last_checked_at, review_at, review_interval_days,
       route_tool, status, hits, created_at, updated_at)
group_versions(id, group_id, n, answer, basis, by_user_id, status, created_at)
      -- status: published | superseded | rolledback
variants(id, group_id, version_id, style, text, status, by_user_id, created_at)
      -- style: brief | detailed | example
aliases(id, group_id, text, text_key, status, reason, source, created_at)
      -- text_key = 归一化查询键（去标点、去空白、小写）
reports(id, by_user_id, group_id, target_key, type, version_id, match_key,
        category, note, status, resolution, handled_by, handled_at, created_at)
suspensions(id, group_id, kind, match_key, version_id, status, since, reason,
            report_ids_json, rounds, released_at, released_by, resolution)
revisions(id, group_id, base_version_id, proposed_answer, note, by_user_id,
          status, handled_by, handled_at, published_version_id, created_at)
learn_tasks(id, group_id, state, attempts, last_error, created_at, finished_at)
refresh_tasks(id, group_id, state, source, source_version, started_at, finished_at, result)
usage(id, at, user_id, session_id, query, path, cloud_calls, first_token_ms,
      total_ms, cost, tokens_in, tokens_out, ok, reported)
      -- path: exact | alias | semantic | tool | cloud | learn | revision | clarify
```

索引建议：`aliases(text_key)`、`reports(target_key, at)`、`messages(session_id)`、`usage(user_id, at)`。
后台任务唯一约束：`learn_tasks(group_id)` 唯一、`aliases(group_id, text_key)` 唯一，避免重复入库。

---

## 4. 前端调用点对照

| demo 里的调用 | 接到后端后 |
| --- | --- |
| `App.engine.run({...})` | `POST /api/sessions/{sid}/messages` + SSE |
| `App.tools.detect/run` | 留在前端；或 `POST /api/tools` 返回同样的 `meta` |
| `App.matcher.analyze` | `POST /api/match` |
| `S.addReport(...)` | `POST /api/reports` |
| `S.handleRevision(...)` | `POST /api/revisions/{id}/resolve` |
| `S.publishVersion(...)` | `POST /api/groups/{gid}/versions` |
| `S.releaseSuspension(...)` | `POST /api/suspensions/{id}/resolve` |
| `S.startRefresh(...)` | `POST /api/groups/{gid}/refresh` |
| `S.governance()` | `GET /api/governance` |
| `S.usageStats()` | `GET /api/usage` |

---

## 5. 验收对照

技术方案的四步验收，在 demo 里怎么复现：

| 验收项 | demo 里的做法 |
| --- | --- |
| 打通聊天（重启恢复、追问沿用条件） | 刷新页面，会话与历史都在；「这两个哪个好」「第二个呢」在追踪面板里能看到补全结果 |
| 学习与共享（空库→云端→改写→另一身份命中） | 设置里「清空问答库」→ 问一句 → 等「已入库」→ 切 B 用改写命中 |
| 未收录问法 / 误命中 | 「`if` 条件遇到空列表」→ 语义命中；「`bool([0])`」「用英语解释」→ 走云端 |
| 治理与授权 | 报告 → 审核页补齐票数 → 暂停 → 发布修正 / 恢复；B 进入审核页是只读 |
| 时效 | 问 Figma 价格 → 暂无法确认 → 去核对 → 恢复可用；连点两次只有一个在途任务 |
