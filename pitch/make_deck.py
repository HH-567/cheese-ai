# -*- coding: utf-8 -*-
"""生成柒柿AI黑客松 pitch deck。"""
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.util import Inches, Pt

INK = RGBColor(0x14, 0x14, 0x14)
MUTED = RGBColor(0x6F, 0x6B, 0x63)
PAPER = RGBColor(0xF6, 0xF5, 0xEF)
YELLOW = RGBColor(0xFF, 0xD8, 0x4A)
YELLOW_DEEP = RGBColor(0xE0, 0xA8, 0x00)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
LINE = RGBColor(0xDD, 0xD8, 0xCD)
FONT = "微软雅黑"
SHOTS = r"C:\Users\21397\AppData\Local\Temp\qishi-shots"

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)


def bg(slide, color):
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = color


def text(slide, value, x, y, w, h, size, *, bold=False, color=INK, align=PP_ALIGN.LEFT,
         spacing=1.12, font=FONT, anchor=MSO_ANCHOR.TOP):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    frame = box.text_frame
    frame.word_wrap = True
    frame.vertical_anchor = anchor
    lines = value.split("\n")
    for index, line in enumerate(lines):
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        paragraph.alignment = align
        paragraph.line_spacing = spacing
        run = paragraph.add_run()
        run.text = line
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.color.rgb = color
        run.font.name = font
    return box


def rect(slide, x, y, w, h, fill, *, line=None, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.08):
    node = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    node.fill.solid()
    node.fill.fore_color.rgb = fill
    if line is None:
        node.line.fill.background()
    else:
        node.line.color.rgb = line
        node.line.width = Pt(1)
    if shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        try:
            node.adjustments[0] = radius
        except Exception:
            pass
    node.text_frame.text = ""
    return node


def arrow(slide, x, y, w, h, color=YELLOW_DEEP):
    node = slide.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(x), Inches(y), Inches(w), Inches(h))
    node.fill.solid()
    node.fill.fore_color.rgb = color
    node.line.fill.background()
    return node


def footer(slide, index, dark=False):
    color = RGBColor(0x88, 0x84, 0x7A) if dark else MUTED
    text(slide, "柒柿AI · Cheese AI", 0.6, 7.08, 4, 0.3, 9, color=color)
    text(slide, f"{index:02d}", 12.3, 7.08, 0.5, 0.3, 9, color=color, align=PP_ALIGN.RIGHT)


def picture(slide, name, x, y, w, h, *, border=True):
    pic = slide.shapes.add_picture(f"{SHOTS}\\{name}", Inches(x), Inches(y), Inches(w), Inches(h))
    if border:
        pic.line.color.rgb = LINE
        pic.line.width = Pt(1)
    return pic


def new_slide(color=PAPER, index=None):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg(slide, color)
    if index is not None:
        footer(slide, index, dark=(color != PAPER))
    return slide


# ── 1. 封面 ────────────────────────────────────────────────────────────────
s = new_slide(RGBColor(0x0B, 0x0B, 0x0B))
text(s, "CHEESE AI  ·  黑客松提交  ·  2026.11", 0.8, 0.7, 8, 0.35, 12, color=RGBColor(0x9A, 0x96, 0x8C))
text(s, "柒柿AI", 0.8, 2.15, 8, 1.3, 66, bold=True, color=WHITE)
text(s, "会成长的问答库", 0.85, 3.55, 8, 0.8, 30, bold=True, color=YELLOW)
text(s, "越用越快 · 越用越省 · 越用越全", 0.9, 4.5, 8, 0.5, 16, color=RGBColor(0xD8, 0xD3, 0xC6))
line = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.9), Inches(5.25), Inches(2.2), Inches(0.04))
line.fill.solid()
line.fill.fore_color.rgb = YELLOW
line.line.fill.background()
text(s, "本地先命中，大模型兜底；一次回答，全校复用。", 0.9, 5.55, 9, 0.6, 14, color=RGBColor(0xB8, 0xB3, 0xA6))
text(s, "github.com/HH-567/cheese-ai", 0.9, 6.75, 6, 0.35, 10, color=RGBColor(0x8A, 0x86, 0x7C))

# ── 2. 问题：一年重复多少 ────────────────────────────────────────────────
s = new_slide()
text(s, "一所学校，一年要重复回答多少问题？", 0.7, 0.55, 12, 0.7, 30, bold=True)
big = [
    ("5,000", "次 / 天", "一所万人规模学校的保守估计"),
    ("180 万", "次 / 年", "5,000 × 365"),
    ("100 万", "次重复推理", "哪怕只有 60% 是重复的"),
]
for i, (number, unit, note) in enumerate(big):
    x = 0.7 + i * 4.2
    rect(s, x, 1.75, 3.9, 2.55, WHITE, line=LINE, radius=0.06)
    text(s, number, x + 0.35, 1.95, 3.2, 0.95, 44, bold=True)
    text(s, unit, x + 0.35, 2.9, 3.2, 0.35, 14, color=YELLOW_DEEP, bold=True)
    text(s, note, x + 0.35, 3.4, 3.2, 0.7, 11, color=MUTED)
text(s, "食堂几点开门  ·  校园卡怎么挂失  ·  补考怎么报名", 0.7, 4.85, 12, 0.4, 16, color=MUTED)
text(s, "每一次重复，都是一次本可以省掉的推理。", 0.7, 5.55, 12, 0.6, 22, bold=True)
text(s, "贵、慢，而且不同人得到的答案还可能不一致。", 0.7, 6.1, 12, 0.4, 13, color=MUTED)
footer(s, 2)

# ── 3. 现状的代价 ────────────────────────────────────────────────────────
s = new_slide()
text(s, "每次重复，都要把同样的推理再付一遍", 0.7, 0.55, 12, 0.7, 30, bold=True)
cards = [
    ("1–2 秒", "首字延迟", "用户等的是模型从零开始"),
    ("全价", "每次云端调用", "同一问题，第 100 次仍然全价"),
    ("不一致", "同一个问题", "不同时间、不同人，答案可能不同"),
]
for i, (head, sub, note) in enumerate(cards):
    x = 0.7 + i * 4.2
    rect(s, x, 1.9, 3.9, 2.7, WHITE, line=LINE, radius=0.06)
    text(s, head, x + 0.35, 2.1, 3.2, 0.8, 38, bold=True, color=YELLOW_DEEP)
    text(s, sub, x + 0.35, 2.95, 3.2, 0.4, 14, bold=True)
    text(s, note, x + 0.35, 3.5, 3.2, 0.8, 11, color=MUTED)
text(s, "这就是为什么“再来一次”很贵：不是模型不够强，是重复没有被复用。", 0.7, 5.2, 12, 0.6, 18, bold=True)
footer(s, 3)

# ── 4. 方案：先本地后云端 ────────────────────────────────────────────────
s = new_slide()
text(s, "先本地，后云端", 0.7, 0.55, 12, 0.7, 30, bold=True)
steps = [
    ("本地工具", "日期 / 计算 / 比较 / 画图", "0 调用"),
    ("问答库", "原问 / 等价问法 / 语义", "0 调用"),
    ("资料与搜索", "共享资料 / 网页 / 文件", "带引用"),
    ("大模型兜底", "任意 OpenAI 兼容模型", "1 次调用"),
]
for i, (head, sub, tag) in enumerate(steps):
    x = 0.7 + i * 3.12
    rect(s, x, 1.85, 2.75, 2.35, WHITE, line=LINE, radius=0.07)
    text(s, f"0{i + 1}", x + 0.25, 2.0, 0.9, 0.4, 12, bold=True, color=YELLOW_DEEP)
    text(s, head, x + 0.25, 2.4, 2.25, 0.5, 18, bold=True)
    text(s, sub, x + 0.25, 2.95, 2.25, 0.75, 11, color=MUTED)
    text(s, tag, x + 0.25, 3.65, 2.25, 0.35, 12, bold=True, color=YELLOW_DEEP)
    if i < 3:
        arrow(s, x + 2.82, 2.9, 0.22, 0.22)
text(s, "命中就返回，不命中才请大模型。", 0.7, 4.65, 12, 0.6, 22, bold=True)
text(s, "命中之后，这个问题还会被写回库里——下一次就更快。", 0.7, 5.25, 12, 0.5, 14, color=MUTED)
footer(s, 4)

# ── 5. 成长性 ────────────────────────────────────────────────────────────
s = new_slide()
text(s, "库会自己长：覆盖面、表达面、可信度", 0.7, 0.55, 12, 0.7, 30, bold=True)
cols = [
    ("覆盖面", "问题组越来越多", "没问过的问题，回答后自动入库"),
    ("表达面", "等价问法越来越多", "同一件事，换种说法也能命中"),
    ("可信度", "答案越来越准", "反馈、审核、版本、时效"),
]
for i, (head, sub, note) in enumerate(cols):
    x = 0.7 + i * 4.2
    rect(s, x, 1.75, 3.9, 2.25, WHITE, line=LINE, radius=0.06)
    text(s, head, x + 0.3, 1.95, 3.3, 0.5, 20, bold=True)
    text(s, sub, x + 0.3, 2.5, 3.3, 0.4, 13, bold=True, color=YELLOW_DEEP)
    text(s, note, x + 0.3, 3.05, 3.3, 0.8, 11, color=MUTED)
text(s, "不是一次性整理好的 FAQ，而是用出来的库。", 0.7, 4.35, 12, 0.55, 20, bold=True)
text(s, "用得越多 → 命中率越高 → 云端调用越少", 0.7, 5.0, 12, 0.5, 15, color=MUTED)
rect(s, 0.7, 5.75, 11.9, 0.75, RGBColor(0xFF, 0xF3, 0xC4), line=YELLOW, radius=0.1)
text(s, "成长性 = 每条问题只贵一次，之后越来越便宜。", 1.0, 5.95, 11.3, 0.4, 14, bold=True, color=RGBColor(0x6B, 0x50, 0x00))
footer(s, 5)

# ── 6. 快与兜底（截图） ──────────────────────────────────────────────────
s = new_slide()
text(s, "命中：50 毫秒，0 次云端调用", 0.7, 0.55, 6.3, 0.7, 26, bold=True)
text(s, "没命中：大模型兜底，答案照样有。", 0.7, 1.25, 6.3, 0.5, 16, color=MUTED)
bullets = [
    ("命中", "本地匹配，几十毫秒返回，界面显示「库内复用」"),
    ("兜底", "未命中才调用云端；网页、资料、文件都能带"),
    ("一致", "同一问题读同一条答案版本，全校一个口径"),
]
for i, (head, note) in enumerate(bullets):
    y = 2.1 + i * 1.2
    rect(s, 0.7, y, 0.16, 0.16, YELLOW, shape=MSO_SHAPE.OVAL)
    text(s, head, 1.0, y - 0.12, 1.4, 0.4, 14, bold=True)
    text(s, note, 2.2, y - 0.12, 4.6, 0.7, 11, color=MUTED)
picture(s, "chat.png", 6.9, 1.35, 5.6, 3.5)
text(s, "命中问答库：库内复用 1 · 云端调用 0", 6.9, 5.0, 5.6, 0.4, 10, color=MUTED)
footer(s, 6)

# ── 7. 共建共享（截图） ──────────────────────────────────────────────────
s = new_slide()
text(s, "一个人花一次调用，全校复用", 0.7, 0.55, 12, 0.7, 28, bold=True)
text(s, "问题有共性，答案就该共享；但要有人对答案负责。", 0.7, 1.25, 12, 0.5, 15, color=MUTED)
roles = [
    ("管理员", "全部权限：用户管理、审核、共享库"),
    ("审核", "处理反馈、采纳问法、审核共享提交"),
    ("普通用户", "提问、反馈、建议等价问法"),
]
for i, (head, note) in enumerate(roles):
    y = 2.0 + i * 1.05
    text(s, head, 0.7, y, 1.5, 0.4, 14, bold=True, color=YELLOW_DEEP)
    text(s, note, 2.2, y, 4.3, 0.6, 11, color=MUTED)
rect(s, 0.7, 5.35, 5.8, 0.9, RGBColor(0xFF, 0xF3, 0xC4), line=YELLOW, radius=0.1)
text(s, "反馈 → 处理 → 通知反馈者；建议 → 采纳 → 立即参与匹配。", 0.95, 5.55, 5.4, 0.5, 11, color=RGBColor(0x6B, 0x50, 0x00))
picture(s, "queue.png", 6.9, 1.35, 5.6, 3.5)
text(s, "审核与治理：反馈队列 · 问法建议 · 共享待审核", 6.9, 5.0, 5.6, 0.4, 10, color=MUTED)
footer(s, 7)

# ── 8. 省下的算力 ────────────────────────────────────────────────────────
s = new_slide(RGBColor(0x0B, 0x0B, 0x0B))
text(s, "省下的算力，去哪？", 0.8, 0.7, 10, 0.8, 32, bold=True, color=WHITE)
text(s, "DeepSeek 网页版的每日限额提醒我们：算力仍然是稀缺资源。", 0.85, 1.7, 11.5, 0.5, 14, color=RGBColor(0xB8, 0xB3, 0xA6))
boxes = [
    ("给更多人免费额度", "命中一次，就少一次调用；省下来的额度，可以让更多人用到顶级模型。"),
    ("投向新模型的前沿研发", "少一次重复推理，就多一次训练的机会；如果每个机构都这样做，算力会更快流向训练更强的模型。"),
]
for i, (head, note) in enumerate(boxes):
    x = 0.85 + i * 6.15
    rect(s, x, 2.55, 5.8, 2.4, RGBColor(0x18, 0x17, 0x14), line=RGBColor(0x3A, 0x37, 0x2F), radius=0.06)
    text(s, f"0{i + 1}", x + 0.35, 2.7, 0.8, 0.4, 12, bold=True, color=YELLOW)
    text(s, head, x + 0.35, 3.05, 5.1, 0.6, 18, bold=True, color=WHITE)
    text(s, note, x + 0.35, 3.7, 5.1, 1.0, 11, color=RGBColor(0xB8, 0xB3, 0xA6))
text(s, "这是路线图，不是已经实现的能力；先把“省”做实，再谈反哺。", 0.85, 5.35, 11.5, 0.5, 12, color=RGBColor(0x8A, 0x86, 0x7C))
text(s, "RSI · 递归自我改进", 0.85, 6.05, 6, 0.5, 16, bold=True, color=YELLOW)
footer(s, 8, dark=True)

# ── 9. 现状 ──────────────────────────────────────────────────────────────
s = new_slide()
text(s, "现在长成什么样", 0.7, 0.55, 12, 0.7, 30, bold=True)
stats = [("34,657", "共享问题组"), ("139,185", "有效问法"), ("50 ms", "本地命中"), ("0", "命中时云端调用")]
for i, (number, label) in enumerate(stats):
    x = 0.7 + i * 3.12
    text(s, number, x, 1.75, 2.8, 0.9, 34, bold=True, color=YELLOW_DEEP)
    text(s, label, x, 2.65, 2.8, 0.4, 12, color=MUTED)
picture(s, "library.png", 0.7, 3.1, 5.6, 3.5)
text(s, "问答库：问题组、答案版本、等价问法", 0.7, 6.7, 5.6, 0.3, 10, color=MUTED)
text(s, "模型接口", 7.35, 3.25, 5.2, 0.4, 14, bold=True)
text(s, "GPT · DeepSeek · Claude · Gemini · GLM · Kimi · 自定义", 7.35, 3.7, 5.2, 1.0, 12, color=MUTED)
text(s, "Key 只存本机；内置三种角色与冻结、额度。", 7.35, 4.5, 5.2, 0.6, 11, color=MUTED)
text(s, "git clone → 解压 → 启动，开箱即带完整演示库。", 7.35, 5.2, 5.2, 0.6, 12, bold=True)
footer(s, 9)

# ── 10. 演示 3 分钟 ──────────────────────────────────────────────────────
s = new_slide()
text(s, "现场演示：3 分钟", 0.7, 0.55, 12, 0.7, 30, bold=True)
demo = [
    ("学生 A 问", "云端回答 1 次，提示已入库 + 生成 3 条等价问法"),
    ("学生 B 换说法", "50 ms 命中，0 次调用，界面显示「库内复用」"),
    ("审核员发现过期", "修正或暂停，下一次命中就是新答案"),
    ("看板", "今日命中率、节省的调用数、贡献榜"),
]
for i, (head, note) in enumerate(demo):
    x = 0.7 + i * 3.12
    rect(s, x, 1.9, 2.75, 2.3, WHITE, line=LINE, radius=0.07)
    text(s, f"{i + 1:02d}", x + 0.25, 2.05, 0.8, 0.4, 12, bold=True, color=YELLOW_DEEP)
    text(s, head, x + 0.25, 2.45, 2.3, 0.5, 16, bold=True)
    text(s, note, x + 0.25, 3.0, 2.3, 1.0, 11, color=MUTED)
text(s, "四个初衷，一次讲完：快、兜底、共建、省算力。", 0.7, 4.8, 12, 0.6, 20, bold=True)
footer(s, 10)

# ── 11. 架构 ─────────────────────────────────────────────────────────────
s = new_slide()
text(s, "架构：单进程就能跑", 0.7, 0.55, 12, 0.7, 30, bold=True)
rect(s, 0.7, 1.85, 3.3, 2.0, WHITE, line=LINE)
text(s, "前端", 0.95, 2.0, 2.8, 0.4, 15, bold=True)
text(s, "React + TypeScript + Vite\n聊天 / 问答库 / 审核 / 设置", 0.95, 2.45, 2.8, 1.2, 11, color=MUTED)
rect(s, 4.7, 1.85, 4.0, 2.0, WHITE, line=LINE)
text(s, "FastAPI", 4.95, 2.0, 3.5, 0.4, 15, bold=True)
text(s, "鉴权 · 匹配 · 学习任务\n治理 · 配额 · 模型路由", 4.95, 2.45, 3.5, 1.2, 11, color=MUTED)
rect(s, 9.4, 1.85, 3.2, 2.0, WHITE, line=LINE)
text(s, "SQLite (WAL)", 9.65, 2.0, 2.8, 0.4, 15, bold=True)
text(s, "问题组 / 版本 / 问法\n用户 / 反馈 / 模型接口", 9.65, 2.45, 2.8, 1.2, 11, color=MUTED)
for x in (4.0, 8.7):
    arrow(s, x, 2.65, 0.7, 0.3)
rect(s, 0.7, 4.4, 5.9, 1.4, WHITE, line=LINE)
text(s, "云端：任意 OpenAI 兼容接口", 0.95, 4.55, 5.4, 0.4, 13, bold=True)
text(s, "服务端 Key 或用户自己的 Key；配额只对内置通道计费。", 0.95, 5.0, 5.4, 0.6, 10, color=MUTED)
rect(s, 6.9, 4.4, 5.7, 1.4, WHITE, line=LINE)
text(s, "本地工具 + 可选 BGE", 7.15, 4.55, 5.2, 0.4, 13, bold=True)
text(s, "日期、算术、比较、画图；语义检索与重排。", 7.15, 5.0, 5.2, 0.6, 10, color=MUTED)
text(s, "没有向量数据库、没有消息队列：一台机器、一个进程、一个 SQLite 文件。", 0.7, 6.2, 12, 0.5, 13, color=MUTED)
footer(s, 11)

# ── 12. 收尾 ─────────────────────────────────────────────────────────────
s = new_slide(RGBColor(0x0B, 0x0B, 0x0B))
text(s, "让每一次提问，都成为下一次的答案。", 0.9, 1.9, 11.5, 0.9, 30, bold=True, color=WHITE)
text(s, "让省下的算力，去训练更强的模型。", 0.9, 2.9, 11.5, 0.9, 30, bold=True, color=YELLOW)
line = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.95), Inches(4.1), Inches(2.2), Inches(0.04))
line.fill.solid()
line.fill.fore_color.rgb = YELLOW
line.line.fill.background()
text(s, "github.com/HH-567/cheese-ai", 0.95, 4.5, 8, 0.4, 13, color=RGBColor(0xD8, 0xD3, 0xC6))
text(s, "release v0.1.0 · 演示库 34,657 组 / 139,185 条问法", 0.95, 4.95, 10, 0.4, 11, color=RGBColor(0x9A, 0x96, 0x8C))
footer(s, 12, dark=True)

prs.save(r"C:\Users\Public\给ai\dsh\柒柿AI\pitch\柒柿AI-PitchDeck-20261122.pptx")
print("slides:", len(prs.slides.__iter__.__self__._sldIdLst))
