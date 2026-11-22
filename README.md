# 柒柿AI

英文名：**Cheese AI**。登录页/开场动画的品牌标识使用这个英文名，中文仍为「柒柿AI」。

按产品设计与技术方案实现的本地通用助手。React + TypeScript + Vite 提供聊天和管理界面，FastAPI + SQLite 提供登录、会话、问答库、匹配、治理与用量 API。

`frontend/` 是实际使用的网页。`backend/app/` 先查本地工具和有权限的问答，未命中再请求云端模型。`demo/` 是独立的纯前端演示，使用模拟回答和浏览器存储。

## 启动

需要 Python 3.11+、Node.js 20+。在项目根目录分别打开两个终端：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
python -m uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

```powershell
cd frontend
npm install
npm run dev
```

浏览器访问 `http://127.0.0.1:5173`。演示身份为用户 A、B、C，密码均为 `demo1234`。数据保存在项目根目录的 `data/qishi.sqlite3`，重启后会保留。

使用隔离的演示数据库启动 API 后，运行 `python backend/tests/smoke_api.py` 检查本地工具、复用和治理。运行 `python backend/tests/cloud_flow.py` 可用本地模拟服务检查云端流、后台改写重试、重启恢复和跨账号复用，无需 API 密钥。

运行 `python backend/tests/matching_acceptance.py` 可在固定的演示问答库上验收 CPU 匹配。加 `--calibrate` 可用另一组样本比较不同阈值。验收覆盖 Python、Excel、macOS 和 React。在默认阈值 0.70 下，26 条验收样本中有 8 条未收录问法正确复用，14 条不等价问法均跳过复用。

离线网页验证、四种复用配置的延迟与用量对比，以及复跑命令见 [CPU 与费用验收](docs/cpu-cost-acceptance.md)。

运行 `python backend/tests/governance_acceptance.py` 可在独立数据库中验收举报、成员权限、版本和到期复核。配置方法见 [治理与授权验收](docs/governance-acceptance.md)。

运行 `python backend/tests/greeting_acceptance.py` 可用本地模拟云端验收寒暄入库：`你好`、`你是谁` 会连同短等价问法写进问答库，`谢谢` 和 `我是谁` 不入库，再次问候由问答库直接回答。

本机可在同一登录页使用预置账号或登记新身份。注册、跨设备会话、每日云端额度和 GitHub 正式发布查询的设置方式见 [注册与使用](docs/trial.md)。管理员可以在设置页的「成员额度」里给每个账号单独设每日上限（留空跟随默认值，0 表示不限）。

勾选聊天输入框的「网页搜索」后，可以选择百度、维基百科或 DeepSeek 搜索。默认使用百度，可通过 `QISHI_SEARCH_PROVIDER` 设置默认值。搜索结果会标注引擎，并附上可点击的来源。摘要生成计入云端模型额度。

- 百度使用 `BAIDU_API_KEY`（千帆 API Key）。站内搜索不可用时，可以打开百度结果页。 [百度搜索 API](https://cloud.baidu.com/doc/qianfan-api/s/wmwbk70bv)
- 维基百科无需 API 密钥。问题包含中文时搜索中文站，其余搜索英文站。公开部署可通过 `WIKIPEDIA_USER_AGENT` 填写带有维护者联系方式的客户端标识。 [MediaWiki 搜索 API](https://www.mediawiki.org/wiki/API:Search)
- DeepSeek 搜索使用 `DEEPSEEK_SEARCH_API_KEY`。云端模型已直连 `https://api.deepseek.com` 时，可复用该连接的 `CLOUD_API_KEY`。搜索问题最多 128 个字符，搜索接口费用由 DeepSeek 单独计收。 [DeepSeek 搜索文档](https://api-docs.deepseek.com/guides/search/)

配置 `BRAVE_SEARCH_API_KEY` 后，选择器也会显示 Brave Search。

聊天输入框的「上传文件」支持有文字层的 PDF、DOCX、TXT、Markdown 和 CSV。每个文件最多 5 MB，每次选择一份文件提问。点击回答中的引用编号可查看对应的页码、段落或行号及原文。文件文本保存在当前会话，提问时将相关片段交给云端模型，并计入云端额度。

「上传文件」也支持 PNG、JPEG 和 WebP 静态图片。选择图片后可针对图片提问，图片保存在当前会话，提问时交给云端模型。若使用其他支持图片的模型，可配置 `CLOUD_VISION_MODEL`。

「语音输入」支持每段最多约 25 秒的普通话。录音发给柒柿AI 服务在本机转写，结果填入输入框供编辑。浏览器需允许麦克风权限，服务需通过 localhost 或 HTTPS 访问。部署到其他主机时，将 Zipformer 模型目录放到 `data/models/sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01`，或通过 `QISHI_SPEECH_MODEL_DIR` 指定包含 `model.int8.onnx` 和 `tokens.txt` 的目录。 [Sherpa-ONNX 普通话模型](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/small-online-models.html)

云端回答需要设置 OpenAI 兼容接口：

```powershell
$env:CLOUD_BASE_URL = "https://api.deepseek.com"
$env:CLOUD_API_KEY = "你的服务端密钥"
$env:CLOUD_MODEL = "deepseek-chat"
python -m uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

密钥只在服务端读取，不会发到浏览器。没有配置密钥时，问答库、本地日期和算术仍可使用；未命中的问题会显示错误和重试入口，不会伪造云端回答。前端通过 SSE 接收模型流。

把云端配置保存在项目根目录的 `.env` 时，启动后端加上 `--env-file .env` 即可在重启时继续使用该配置。`.env` 已被 Git 忽略。

如需显示费用估算，设置 `CLOUD_INPUT_USD_PER_MTOK` 与 `CLOUD_OUTPUT_USD_PER_MTOK` 为各自每百万 Token 的美元价格。用量优先采用模型接口返回的 Token 数，缺失时聊天用量按文本长度估计。每百次请求的费用包含后台改写及其重试。

## 生产构建

```powershell
cd frontend
npm install
npm run build
cd ..
python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

构建后 FastAPI 会在 `http://127.0.0.1:8000` 同源托管前端和 API。部署时设置 `QISHI_DEMO_MODE=0`、`QISHI_COOKIE_SECURE=1`，并为 HTTPS 代理和本地数据目录配置持久存储。在项目根目录关闭演示身份后，可通过以下命令创建账号：

```powershell
$env:QISHI_DEMO_MODE = "0"
cd backend
python -m app.cli create-user --id owner --name 管理员 --password "替换为强密码" --role admin
```

## 界面偏好

设置页的「显示」可以调字体大小（80%–150%，按账号保存在服务端，登录后在各设备生效），整页连同按钮和输入框一起缩放；聊天输入框右下角可以拖动改高度，最高约半屏。

长代码块在回答输出完成后会自动收成一个小窗口（约 5 行，滚轮或拖动右侧滚动条可上下查看），点「展开」看全文，点「收起」回到小窗口；点「复制代码」只复制代码本身、不带上下说明。问答库和本地工具的回答都用打字机逐段输出，速度约每秒 350 字（300–400 之间），超长页面最多 4 秒打完。打字时聊天窗口会跟着最新一个字往下走，向上翻看旧内容时暂停跟随，回到底部或重新提问后继续。

## 问答样例

侧栏「Work 工作台」接受自然语言目标，可添加一份 500 KB 以内的 CSV。同类任务匹配本地规则后，用本次数据重新计算。规则未覆盖的任务交给云端代理，代理可以查看工具结果，再选择下一步或结束任务。目前提供日期间隔、预算余额和 CSV 数值列求和。

可以载入两份「活动支出」示例，比较同一规则算出的余额。载入「条件预算」示例则可以看到云端代理先汇总 CSV，再判断是否需要计算预算余额。运行后可下载 Markdown 报告。云端调用计入现有额度，「用量」页可查看 Work 的完成数、零云端完成数和实际调用次数。

成功执行的固定步骤可以保存为个人规则。点「保存为规则」核对步骤和依赖，勾选每次要重新填写的参数。下次从「我的规则」选择运行，填入新值或换一份 CSV，即可在本地重算。需要根据结果选择不同步骤的任务继续使用自由任务。

运行 `python backend/tests/work_acceptance.py` 可在隔离数据库和本地模拟模型中验证 Work 的两条路径，无需 API 密钥。

侧栏「复用方法」提供预算余量、日期间隔和 CSV 数值列汇总。更换参数或文件即可重新计算，运算均在本机完成。

问「画一只骑自行车的鹈鹕」或 `draw a pelican on a bicycle`，回答是一整页能直接保存打开的 HTML，并附一句用法；中文提问给中文页，英文提问给英文页，全程不调用任何模型，云端额度也不会计数。三个样张在 `backend/data/pelican/`（完整、简单、简单2，中英各一份）：默认给「完整」，问句里写「简单」「简单2」可以换一版，也可以用 `QISHI_PELICAN_VARIANT` 改默认值。把回答里的代码另存为 `pelican.html`（UTF-8）双击即可，页面纯离线、不加载外部文件。

本机可在聊天框的「回答模型」中选择 Qwen2.5 0.5B。重开本地服务时，在项目目录运行 [start-local-model.ps1](start-local-model.ps1)。柒柿AI 通过 `QISHI_LOCAL_MODEL` 和 `QISHI_LOCAL_MODEL_URL` 连接本机的 Chat Completions 接口。本地推理适合短文案和简单改写，事实问答仍需核对。 [Qwen 权重](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF) · [llama.cpp 运行配置](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)

当前目录未找到单独的训练数据文件夹。`backend/data/seed_qa.json` 收录了从前端演示种子整理的样例，演示模式首次启动时将它们导入共享库。可用 `QISHI_DEMO_SEED_PATH` 指定相同结构的 JSON 文件，设为空值可跳过种子导入。开启自动学习后，同一会话中独立、稳定的新问题及其完整云端回答也会自动写入该会话选择的个人库或共享库。「你好」「你是谁」这类寒暄和自我介绍同样会入库（等价问法允许更短），「谢谢」「在吗」这类不构成问题的内容仍然跳过；「我是谁」「我叫什么」「我的资料是什么」这类只对提问者本人成立的个人信息不入库。原问和答案保存后，后台生成等价问法。聊天里的入库状态可以直接打开问答记录，跳过时会显示原因。

点击「换个说法」会优先使用当前版本已收录的表达，也可以按需让云端改写。按需改写保存在该条聊天回答中，可恢复原回答。未入库的云端回答也可以提交反馈，反馈和答复快照可在审核页查看。

审核页的反馈可以点「已解决」：选「已修正答案」会发布为新版本，选「不修正」则填写原因；两种处理都会把结果作为一条通知发进反馈者的会话，反馈者下次打开聊天就能看到。

设置里的「自动生成等价问法」控制入库后要不要再调一次模型补问法：关掉后问答照样入库，但不再排学习任务，可以省云端调用。批量导入的问答组可以用 `backend/tools/generate_aliases.py --prefix ... --workers 12` 并行补问法。

问答库的条目详情里，管理员、审核和问答组所有者可以直接增删等价问法（手动添加的标记为「手动添加」，原问不能删除）；普通成员在共享问答组里看到的是「提交建议」，建议进入审核页的「问法建议」，由管理员或审核采纳/不采纳，处理结果会通知建议者。

## 导入外部问答库

外部题库 JSON（`{"meta": …, "qa": [{id, category, intent, question, answer, keywords, variants}]}`）可以用脚本批量入库。问题成为原问，`variants` 成为等价问法，`keywords` 成为问答组标签，分类和意图写进意图字段，问答库页面可以直接按分类关键词搜索。同一问法只能属于一个问答组，重复问法和已存在条目会被跳过，脚本可以重复运行。

```powershell
python backend/tools/import_qa_library.py --source "C:\path\qa_library.json" --scope shared
```

写入前会把数据库备份到 `data/backups/before-qa-import-<时间>/`。`--dry-run` 只打印统计，`--replace` 先删除此前导入的条目再重导。`GET /api/groups` 接收 `page` 和 `page_size`，返回当前页 `items` 和筛选后的总条数 `total`。网页默认每页 25 条，可切换每页数量。

聊天中的模型回复可点「重新回答」，新答复和原答复都保存在会话中。个人问答库支持跨页勾选并提交共享审核。管理员在「审核与治理 → 共享待审核」核对提交时的答案，批准后会在共享库新建条目。

## 导入校园资料

`backend/tools/import_cau_data.py` 把一份校园课程表与一份校园知识库拆成两类内容：

| 数据 | 去向 | 效果 |
| --- | --- | --- |
| 校园知识库（FAQ 式条目） | 问答库的问答组 | 标题为原问、关键词为等价问法、正文为答案；同一份内容另存一份到共享知识库，供「共享资料」检索 |
| 课程数据（逐门课） | 共享知识库 | 按「学院 / 专业 / 学期」整理成课程清单，开启「共享资料」后按问题检索原文作答 |
| 学院与专业目录 | 问答组 + 知识文档 | 「农大有哪些学院」「某学院有哪些专业」可直接答 |

```powershell
python backend/tools/import_cau_data.py --course "C:\path\CAU课程数据.xlsx" --knowledge "C:\path\CAU校园知识库.xlsx"
```

同样支持 `--dry-run`、`--replace`、`--skip-qa`、`--skip-docs`，写入前备份到 `data/backups/before-cau-import-<时间>/`。共享知识库最多 30 份文档，导入后共 19 份。

批量导入的问答组可以再用 `backend/tools/generate_aliases.py` 补上口语化等价问法（每批一次云端调用，结果写回 `aliases`）：

```powershell
python backend/tools/generate_aliases.py --prefix "qa_cau-faq-" --batch 25
```

自然问法和库里的正式问法措辞往往差很远，这一步会明显提高零云端调用的命中率。脚本默认跳过已有等价问法的问答组，可以重复执行。

问答库没有可靠答案时，聊天会先按问题检索共享知识库：相关度达标就带着原文和 [1] 这样的引用去问云端，答案下方可以点开原文；相关度不够就照常直接问模型。相关度门槛由 `QISHI_KNOWLEDGE_FALLBACK_SCORE` 控制，默认 `0.40`，调到 `1` 以上等于关闭自动兜底。聊天里仍然可以手动勾选「共享资料」，按需强制按资料回答。

## 回答模型

聊天框的「回答模型」留空即自动选择：按设置页「回答模型」列表里的顺序，取第一个既启用又可用的模型（默认模型 → 备用云端模型 → 本地模型）。设置页可以逐个启用或停用，停用的模型不参与自动选择、也不出现在聊天选择框里；把云端模型都停用后自动选择会顺延到本地模型，本地也没有时只提示没有可用模型。

选择「不用模型 · 只查问答库」时，只回答问答库和本地工具能解决的问题，未命中就直接说明并停下，不调用任何模型。图片、文件、网页搜索、共享资料和重新问云端仍然需要模型。

- `CLOUD_MODEL`：默认云端模型，自动选择的第一顺位。
- `CLOUD_EXTRA_MODELS`：逗号分隔的备用云端模型，可在设置页单独停用。
- `QISHI_LOCAL_MODEL`：本机 llama.cpp 模型，配置后出现在列表里。

停用状态保存在当前账号的设置里（`settings.disabled_models`），换账号互不影响。

## 当前实现边界

- 本地匹配在 CPU 上运行，先做权限过滤、原问/别名精确查询，再做字符 n-gram 近似召回与条件冲突检查。问答库到万条以上时，会先按字符二元组建一次倒排索引筛候选，只对候选算相似度；索引按问答库、别名和成员关系的变化自动重建，缓存 10 分钟，首次未命中查询多花 1–2 秒建索引，之后约 20–60ms。可选 BGE 与 CrossEncoder 从本地模型目录加载；未配置时不下载模型，也不会假称使用了向量推理。
- 云端新回答使用 OpenAI 兼容的流式 Chat Completions API。后台改写使用同一模型并单独记一次调用。
- 到期问答会退出普通匹配。收到相关提问后可通过服务端配置的来源目录复核。缺少可用来源时，聊天会提示暂无法确认。
- SQLite 使用 WAL 和外键；开发演示身份通过签名 HttpOnly Cookie 认证。正式部署应关闭演示模式并在 HTTPS 下设置安全 Cookie。

可选本地语义模型：安装 `backend/requirements-ml.txt`，准备兼容 Sentence Transformers 的 BGE 与 CrossEncoder 模型目录，再设置 `QISHI_EMBEDDING_MODEL` 和 `QISHI_RERANKER_MODEL` 指向本地路径。模型不可用时继续使用 CPU 文本匹配。
