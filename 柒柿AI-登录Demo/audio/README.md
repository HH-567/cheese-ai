# audio/ —— 配音：原声、现用、怎么改

> 本包是**运行版**：这里只有 `original/`、`current/line-6.mp3`、`compare.html`。
> 母版 WAV、历史版本（`_archive/`）、拼接与电平脚本（`splice.py` / `normalize.py`）
> 以及 `tools/` 里的音频工具都在开发工作区。

片头六幕各有一句英语旁白。第 6 句（终幕揭幕前那句）原本念的是
**"Welcome to DeepSeek Harness"**，本项目把它换成了 **"Welcome to Qishi AI"**。

现用版本是**你给的整句录音**（`line-6.welcome-to-cheese-ai.mp3`）：前半段「Welcome to」
与上游原声逐样本一致（互相关 1.000），名字段是新录的，结尾自然收到静音。
换句话说，原版那句的语速、停顿、气息都保住了，只有名字换了。

电平做过一次**压平**：整段 −2.9dB（−20.3 → −23.7 dBFS RMS），峰值 −3.1 → −6.3，
和原句（−23.7 / −5.0）落在同一条水平线上。不改动态、不压缩、不动 EQ，只是整段乘一个系数。

## 目录

    original/            上游原声（提取留存，不改动）
      line-1..6.mp3        六句原声；line-6 就是 "Welcome to DeepSeek Harness"
      sfx-*.mp3            两个界面音效
    current/             现在片头里用的那句
      line-6.mp3           成品（3.63s，−23.7 dBFS，57 KB）
      line-6.wav           成品对应的无损母版（要再改从这份改）
      _archive/            上两版：原电平版、以及「原声骨架 + 换名」的拼接件
    incoming/            素材与中间件
      line-6.welcome-to-cheese-ai.mp3   你给的整句原件（未压平）
      welcome-qishi.mp3    更早一版只含「Welcome to cheese~ A」的素材
      *.wav                解码后的 PCM（分析、切割用）
    splice.py            拼接脚本（上一版的做法，留着备用）
    normalize.py         电平压平（线性增益 + 削波保护）
    compare.html         双击打开：原句 / 现用并排播放，六句原声逐条试听

## 现用这句的实测

| | 原句 | 现用（压平前 → 后） |
|---|---|---|
| 时长 | 4.30s | 3.58s → 3.63s（mp3 容器补齐帧） |
| RMS | −23.7 dBFS | −20.3 → **−23.7 dBFS** |
| 峰值 | −5.0 dBFS | −3.1 → −6.3 dBFS |
| 「Welcome to」 | 原声 | 与原声逐样本一致 |
| 结尾 | 0.8s 尾巴 | 自然收到 −30dB，无截断 |

压平链路（换素材照抄就行）：

    node tools/decode-audio.mjs audio/incoming/xxx.mp3 audio/current/line-6.wav
    python audio/normalize.py  audio/current/line-6.wav audio/current/line-6.flat.wav -23.2
    npm i lamejs
    node tools/encode-audio.mjs audio/current/line-6.flat.wav audio/current/line-6.mp3
    copy audio\current\line-6.mp3 vendor\dsh-boot-suite\lib\assets\voices\f\line-6.mp3

> 目标写 −23.2 而不是 −23.7：mp3 编码会在两端补帧，量出来会低约 0.5dB，
> 编完实测 −23.7，正好落在原句的位置。

## 上一版是怎么拼的（留档）

原版时间结构：`1.00–1.60 Welcome to` / `1.60–2.40 停顿` / `2.40–3.52 DeepSeek Harness` /
`3.52–4.30 尾巴`。做法是保留首尾、只把 2.40–3.52 换成新素材里的「Qishi AI」，
按原段 RMS 给 −5.4dB 增益，切口前后 8/22ms 淡入淡出 —— 成品 4.21s / −24.1 dBFS，
两个拼接点邻域最大跳变 0.0001 / 0.0004（都在静音里）。成品在 `current/_archive/`。

    python audio/splice.py                                   # → current/line-6.wav
    npm i lamejs
    node tools/encode-audio.mjs audio/current/line-6.wav audio/current/line-6.mp3

## 原声清单

| 文件 | 幕 | 台词 | 时长 | RMS | 峰值 |
|---|---|---|---|---|---|
| `line-1.mp3` | 1 需要访问许可 | Access permission required. | 3.67s | −23.8 | −3.0 |
| `line-2.mp3` | 2 身份资料确认 | Identity verification. | 3.25s | −23.1 | −5.3 |
| `line-3.mp3` | 3 接收访问需求 | Access request received. | 1.44s | −20.7 | −2.8 |
| `line-4.mp3` | 4 开始读取权限 | Beginning permission read. | 1.09s | −17.8 | −6.1 |
| `line-5.mp3` | 5 读取完毕 · 核验通过 | Read complete. Verification passed. | 2.75s | −19.8 | −5.9 |
| `line-6.mp3` | 6 欢迎 XXX 访问 | Welcome to DeepSeek Harness.（原句） | 4.30s | −23.7 | −5.0 |

电平用 `node tools/measure-audio.mjs <file>` 实测（无头浏览器解码，没有 ffmpeg 也能量）。
做新录音时按 −23.8 … −17.8 dBFS 这个区间对齐，别比整包响一截。

## 回滚

    copy audio\original\line-6.mp3 vendor\dsh-boot-suite\lib\assets\voices\f\line-6.mp3

不用改任何代码。

## 工具链（都为这件事写的，可复用）

| 工具 | 干什么 |
|---|---|
| `tools/measure-audio.mjs` | 量时长 / RMS / 峰值 |
| `tools/decode-audio.mjs` | mp3 → 16bit 单声道 WAV（WebAudio 解码，无需 ffmpeg） |
| `tools/encode-audio.mjs` | WAV → MP3（lamejs） |
| `audio/normalize.py` | 电平压平（线性增益 + 削波保护） |
| `audio/splice.py` | 按时间点拼接 + 电平对齐 + 淡入淡出 |

## 权利

原声六句与两个音效来自上游 `dsh-boot-suite`，上游注明"音频素材取自第三方视频，
权利归原权利人；未授权任何商业用途"。这里只做提取留存与工程处理，
不改变其授权状态；商用前请自行取得授权。你提供的 `incoming/` 素材版权归你。
