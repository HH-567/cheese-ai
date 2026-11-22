# 演示问答库快照

仓库和提交包都不包含完整的问答库：数据库里还有用户、会话、消息和模型密钥，而且体积较大。为了让评审能直接体验「3.4 万条问答、命中不出网」的效果，这里提供一个**脱敏的共享库快照**。

## 快照里有什么

- 只含共享库中状态为 `active` 的问题组；
- 每个问题组的原问、当前答案、意图/关键词；
- 所有有效的等价问法（不含原问本身）；
- **不含**用户、会话、聊天记录、密码哈希、模型接口密钥。

当前快照（2026-11-22）：

| 项 | 数量 |
| --- | --- |
| 问题组 | 34,657 |
| 有效等价问法 | 104,539 |
| 文件 | `cheese-ai-library-20261122.json.gz`（约 4.9 MB） |

下载地址：[release v0.1.0 附件](https://github.com/HH-567/cheese-ai/releases/tag/v0.1.0)。

## 怎么导入

需要一个已经初始化的数据库（首次启动服务会自动建库）：

```powershell
# 1) 启动一次服务，或手动初始化
python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
# 首次启动后 data/qishi.sqlite3 已存在，Ctrl+C 停掉即可

# 2) 解压并导入（Windows 自带 tar 可解 gzip）
tar -xzf cheese-ai-library-20261122.json.gz
python backend/tools/import_qa_library.py --source cheese-ai-library-20261122.json --scope shared
```

导入大约需要几秒，完成后问答库会多出约 3.4 万个共享问题组和 13.9 万条问法。

## 注意

- 内置演示种子会占用少量同名问题组（如 `grp_bool_empty`、`grp_react_hooks`），导入时会跳过个位数条目，不影响整体；
- 快照来自演示环境，包含第三方整理的校园资料，正式使用前请以学校官方口径核对；
- 如果要重新导出，使用 `backend/tools/export_shared_library.py`：

```powershell
python backend/tools/export_shared_library.py --out data/published/library.json --gzip
```
