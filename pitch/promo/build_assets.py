# -*- coding: utf-8 -*-
"""生成宣传片的标题卡、字幕条和背景音乐。"""
import math
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(r"C:\Users\Public\给ai\dsh\柒柿AI")
OUT = ROOT / "pitch/promo/assets"
OUT.mkdir(parents=True, exist_ok=True)
LOGO = Image.open(ROOT / "frontend/public/icons/cheese-app.png").convert("RGBA")
BOLD = "C:/Windows/Fonts/msyhbd.ttc"
FONT = "C:/Windows/Fonts/msyh.ttc"
INK = (11, 11, 11)
YELLOW = (255, 216, 74)
WHITE = (245, 242, 232)
MUTED = (154, 150, 140)


def font(path, size):
    return ImageFont.truetype(path, size)


def title_card():
    img = Image.new("RGB", (1920, 1080), INK)
    draw = ImageDraw.Draw(img)
    for i in range(9):
        draw.rectangle([80 + i * 4, 0, 84 + i * 4, 1080], fill=(14 + i, 14 + i, 12 + i))
    draw.rectangle([0, 0, 12, 1080], fill=YELLOW)
    logo = LOGO.resize((168, 168), Image.LANCZOS)
    img.paste(logo, (876, 250), logo)
    draw.text((960, 470), "柒柿AI", font=font(BOLD, 118), fill=WHITE, anchor="ma")
    draw.text((960, 620), "会成长的问答库", font=font(BOLD, 46), fill=YELLOW, anchor="ma")
    draw.text((960, 705), "本地命中 50ms  ·  大模型只负责兜底", font=font(FONT, 26), fill=MUTED, anchor="ma")
    draw.rectangle([860, 790, 1060, 794], fill=YELLOW)
    draw.text((960, 842), "CHEESE AI  ·  黑客松提交  ·  2026", font=font(FONT, 22), fill=MUTED, anchor="ma")
    img.save(OUT / "title.png")


def closing_card():
    img = Image.new("RGB", (1920, 1080), INK)
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, 12, 1080], fill=YELLOW)
    logo = LOGO.resize((110, 110), Image.LANCZOS)
    img.paste(logo, (905, 220), logo)
    draw.text((960, 400), "让每一次提问，", font=font(BOLD, 66), fill=WHITE, anchor="ma")
    draw.text((960, 500), "都成为下一次的答案", font=font(BOLD, 66), fill=YELLOW, anchor="ma")
    draw.rectangle([860, 630, 1060, 634], fill=YELLOW)
    draw.text((960, 700), "github.com/HH-567/cheese-ai", font=font(FONT, 28), fill=WHITE, anchor="ma")
    draw.text((960, 755), "release v0.1.0  ·  内置 3.4 万组问答库", font=font(FONT, 21), fill=MUTED, anchor="ma")
    img.save(OUT / "closing.png")


CAPTIONS = {
    "intro": ("开场动画", "原版动画 · 自动核验身份"),
    "chat": ("本地命中", "校园卡丢了怎么挂失？→ 0 次云端调用"),
    "alias": ("等价问法", "食堂几点开门？换个说法也能答"),
    "pelican": ("本地工具", "画一只骑自行车的鹈鹕"),
    "render": ("效果", "纯 SVG 渲染 · 不调用任何模型"),
    "cloud": ("云端兜底", "未命中时调用 DeepSeek 大模型"),
    "reuse": ("自动学习", "入库 + 等价问法 · 下次命中 0 调用"),
    "library": ("问答库", "问题组 · 答案版本 · 等价问法"),
    "governance": ("审核与治理", "反馈队列 · 问法建议 · 共享待审核"),
    "members": ("用户管理", "角色 · 冻结 · 每日额度"),
    "usage": ("用量与成本", "命中率 · 云端调用 · 请求路径"),
    "settings": ("模型接口", "GPT / DeepSeek / Claude / Gemini / GLM / Kimi"),
    "switch": ("身份切换", "普通用户看不到管理入口"),
}


def caption(name):
    label, main = CAPTIONS[name]
    img = Image.new("RGBA", (1920, 1080), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    label_font = font(BOLD, 22)
    main_font = font(BOLD, 34)
    w = max(draw.textlength(label, font=label_font), draw.textlength(main, font=main_font))
    box_w = int(w) + 96
    box_h = 128
    x, y = 88, 892
    draw.rounded_rectangle([x, y, x + box_w, y + box_h], radius=20, fill=(11, 11, 11, 215))
    draw.rectangle([x, y, x + 7, y + box_h], fill=YELLOW)
    draw.text((x + 34, y + 22), label, font=label_font, fill=YELLOW)
    draw.text((x + 34, y + 62), main, font=main_font, fill=WHITE)
    img.save(OUT / f"cap-{name}.png")


def bgm():
    sr = 44100
    duration = 130
    t = np.arange(duration * sr) / sr
    left = np.zeros_like(t)
    right = np.zeros_like(t)
    chords = [
        [174.61, 220.00, 261.63, 329.63],  # Fmaj7
        [220.00, 261.63, 329.63, 392.00],  # Am7
        [261.63, 329.63, 392.00, 493.88],  # Cmaj7
        [196.00, 246.94, 293.66, 329.63],  # G6
    ]
    bar = 8.0
    for i in range(int(duration / bar) + 1):
        start = i * bar
        chord = chords[i % len(chords)]
        for j, freq in enumerate(chord):
            seg = np.zeros_like(t)
            mask = (t >= start) & (t < start + bar)
            local = t[mask] - start
            env = np.minimum(1, local / 1.8) * np.minimum(1, (bar - local) / 1.4)
            wave_a = np.sin(2 * np.pi * freq * local + 0.3 * np.sin(2 * np.pi * 0.2 * local))
            wave_b = np.sin(2 * np.pi * (freq * 1.003) * local)
            seg[mask] = (wave_a * 0.7 + wave_b * 0.3) * env
            left += seg * (0.05 + 0.01 * j)
            right += seg * (0.05 + 0.012 * j) * 0.96
        root = chord[0] / 2
        mask = (t >= start) & (t < start + bar)
        local = t[mask] - start
        env = np.minimum(1, local / 1.2) * np.minimum(1, (bar - local) / 1.2)
        left[mask] += np.sin(2 * np.pi * root * local) * env * 0.09
        right[mask] += np.sin(2 * np.pi * root * local) * env * 0.09
    # 琶音
    step = 0.4
    for k in range(int(duration / step)):
        start = k * step
        chord = chords[int(start / bar) % len(chords)]
        freq = chord[k % len(chord)] * 2
        idx = (t >= start) & (t < start + 0.9)
        local = t[idx] - start
        pluck = np.sin(2 * np.pi * freq * local) * np.exp(-local / 0.28) * 0.055
        left[idx] += pluck
        right[idx] += pluck * 0.92
    # 轻微底噪
    rng = np.random.default_rng(7)
    noise = rng.normal(0, 1, len(t))
    smooth = np.convolve(noise, np.ones(80) / 80, mode="same")
    left += smooth * 0.006
    right += smooth * 0.006
    # 淡入淡出 + 归一化
    fade = np.minimum(1, t / 2.0) * np.minimum(1, (duration - t) / 4.0)
    left *= fade
    right *= fade
    peak = max(np.abs(left).max(), np.abs(right).max())
    left = left / peak * 0.36
    right = right / peak * 0.36
    data = np.stack([left, right], axis=1)
    pcm = (data * 32767).astype(np.int16)
    with wave.open(str(OUT / "bgm.wav"), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(sr)
        handle.writeframes(pcm.tobytes())


title_card()
closing_card()
for name in CAPTIONS:
    caption(name)
bgm()
print("assets done")
