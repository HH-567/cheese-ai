# -*- coding: utf-8 -*-
"""把录屏、配音、字幕和 BGM 组装成宣传片。"""
import subprocess
from pathlib import Path

ROOT = Path(r"C:\Users\Public\给ai\dsh\柒柿AI")
PROMO = ROOT / "pitch/promo"
CLIPS = PROMO / "clips"
ASSETS = PROMO / "assets"
VO = PROMO / "vo"
BUILD = PROMO / "build"
BUILD.mkdir(exist_ok=True)
FF = r"C:\Users\21397\AppData\Local\Programs\Python\Python314\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v9.0.2.exe"

# name, clip, start, duration, voice, caption
SCENES = [
    ("title", None, 0, 3.8, "01-title", None),
    ("intro", "intro", 2.2, 7.4, "02-intro", "intro"),
    ("chat", "chat", 2.2, 9.9, "03-chat", "chat"),
    ("alias", "alias", 2.0, 9.0, "04-alias", "alias"),
    ("pelican", "pelican", 2.0, 9.9, "05-pelican", "pelican"),
    ("render", "render", 0.0, 7.5, "06-render", "render"),
    ("miss", "miss", 2.0, 8.3, "07-miss", "miss"),
    ("library", "library", 1.8, 7.9, "08-library", "library"),
    ("governance", "governance", 2.0, 8.7, "09-governance", "governance"),
    ("members", "members", 1.8, 5.5, "10-members", "members"),
    ("usage", "usage", 2.0, 5.9, "11-usage", "usage"),
    ("settings", "settings", 2.2, 8.5, "12-settings", "settings"),
    ("switch", "switch", 2.8, 7.7, "13-switch", "switch"),
    ("closing", None, 0, 5.6, "14-closing", None),
]


def run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stderr[-1200:])
        raise SystemExit(1)


def webm(name):
    files = list((CLIPS / name).glob("*.webm"))
    return max(files, key=lambda item: item.stat().st_mtime)


def build_scene(name, clip, start, duration, voice, caption, index):
    out = BUILD / f"{index:02d}-{name}.mp4"
    vo = VO / f"{voice}.mp3"
    if clip is None:
        image = ASSETS / ("title.png" if name == "title" else "closing.png")
        filt = (
            f"[0:v]scale=1920:1080,fps=30,setsar=1,format=yuv420p,"
            f"fade=t=in:st=0:d=0.45,fade=t=out:st={max(0, duration - 0.5):.2f}:d=0.5[v];"
            f"[1:a]adelay=300|300,apad=whole_dur={duration},atrim=0:{duration},"
            f"aformat=sample_rates=48000:channel_layouts=stereo[a]"
        )
        args = [FF, "-y", "-loop", "1", "-t", f"{duration}", "-i", str(image),
                "-i", str(vo), "-filter_complex", filt, "-map", "[v]", "-map", "[a]",
                "-t", f"{duration}", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", str(out)]
    else:
        cap = ASSETS / f"cap-{caption}.png"
        filt = (
            f"[0:v]trim=start={start}:duration={duration},setpts=PTS-STARTPTS,fps=30,"
            f"scale=1920:1080:force_original_aspect_ratio=decrease,"
            f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,"
            f"tpad=stop_mode=clone:stop_duration=2,trim=duration={duration},format=yuv420p[v0];"
            f"[2:v]format=rgba,fade=t=in:st=0.15:d=0.35:alpha=1[cap];"
            f"[v0][cap]overlay=0:0:enable='gte(t,0.35)'[v];"
            f"[1:a]adelay=320|320,apad=whole_dur={duration},atrim=0:{duration},"
            f"aformat=sample_rates=48000:channel_layouts=stereo[a]"
        )
        args = [FF, "-y", "-i", str(webm(clip)), "-i", str(vo), "-loop", "1",
                "-t", f"{duration}", "-i", str(cap), "-filter_complex", filt,
                "-map", "[v]", "-map", "[a]", "-t", f"{duration}",
                "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", str(out)]
    run(args)
    print("scene", name, "ok")
    return out


parts = []
for i, (name, clip, start, duration, voice, caption) in enumerate(SCENES, 1):
    parts.append(build_scene(name, clip, start, duration, voice, caption, i))

total = sum(s[3] for s in SCENES)
list_file = BUILD / "concat.txt"
list_file.write_text("\n".join(f"file '{p.as_posix()}'" for p in parts), encoding="utf-8")
rough = BUILD / "rough.mp4"
run([FF, "-y", "-f", "concat", "-safe", "0", "-i", str(list_file), "-c", "copy", str(rough)])
print("rough", total)

final = PROMO / "柒柿AI-宣传片.mp4"
fade_out = max(0, total - 3.0)
run([
    FF, "-y", "-i", str(rough), "-i", str(ASSETS / "bgm.wav"),
    "-filter_complex",
    f"[1:a]volume=0.14,afade=t=in:st=0:d=2,afade=t=out:st={fade_out:.2f}:d=3[bg];"
    f"[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0,"
    f"loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.95[a]",
    "-map", "0:v", "-map", "[a]", "-c:v", "copy",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", str(final)
])
print("final", final, round(final.stat().st_size / 1024 / 1024, 2), "MB")
