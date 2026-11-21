import io
import sys
import unicodedata
import wave
from array import array
from functools import lru_cache
from pathlib import PurePosixPath
from threading import Lock

from PIL import Image, ImageOps, UnidentifiedImageError

from . import config

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGES = 8
SPEECH_SECONDS = 25
SPEECH_RATE = 16_000
MAX_WAVE_BYTES = SPEECH_SECONDS * SPEECH_RATE * 2 + 1024
_speech_lock = Lock()


class MediaError(ValueError):
    pass


def clean_image(filename: str, data: bytes) -> tuple[str, str, bytes]:
    name = PurePosixPath(filename.replace(chr(92), "/")).name.strip()
    if not name or len(name) > 180 or any(unicodedata.category(c).startswith("C") for c in name):
        raise MediaError("图片文件名无效。")
    try:
        with Image.open(io.BytesIO(data), formats=("PNG", "JPEG", "WEBP")) as source:
            if source.width * source.height > 16_000_000 or getattr(source, "n_frames", 1) != 1:
                raise MediaError("请选择不超过 1600 万像素的静态图片。")
            image = ImageOps.exif_transpose(source)
            image.thumbnail((1600, 1600))
            if "A" in image.getbands() or "transparency" in image.info:
                alpha = image.convert("RGBA")
                rgb = Image.new("RGB", alpha.size, "white")
                rgb.paste(alpha, mask=alpha.getchannel("A"))
                image = rgb
            output = io.BytesIO()
            image.convert("RGB").save(output, "PNG", optimize=False)
            return name, "image/png", output.getvalue()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError) as error:
        raise MediaError("无法读取图片，请选择 PNG、JPEG 或 WebP。") from error


def speech_files():
    folder = config.SPEECH_MODEL_DIR
    models = sorted(folder.glob("*.onnx"))
    return models[0] if len(models) == 1 and (folder / "tokens.txt").is_file() else None


@lru_cache(maxsize=1)
def _recognizer():
    import sherpa_onnx

    model = speech_files()
    if model is None:
        raise RuntimeError("本机语音模型未安装。")
    return sherpa_onnx.OnlineRecognizer.from_zipformer2_ctc(
        model=str(model), tokens=str(config.SPEECH_MODEL_DIR / "tokens.txt"),
        num_threads=2, sample_rate=SPEECH_RATE, enable_endpoint_detection=False,
    )


def transcribe(data: bytes) -> str:
    try:
        with wave.open(io.BytesIO(data), "rb") as recording:
            if (recording.getnchannels(), recording.getsampwidth(), recording.getframerate()) != (1, 2, SPEECH_RATE):
                raise MediaError("录音格式无效，请重新录制。")
            frames = recording.getnframes()
            if not SPEECH_RATE // 5 <= frames <= SPEECH_RATE * SPEECH_SECONDS:
                raise MediaError("请录制 0.2–25 秒的语音。")
            pcm = recording.readframes(frames)
            if len(pcm) != frames * 2:
                raise MediaError("录音不完整，请重新录制。")
    except (wave.Error, EOFError) as error:
        raise MediaError("录音格式无效，请重新录制。") from error
    samples = array("h")
    samples.frombytes(pcm)
    if sys.byteorder != "little":
        samples.byteswap()
    low, high = min(samples), max(samples)
    if high - low < 6:
        raise MediaError("麦克风几乎没有录到声音，请检查输入设备是否选对、是否静音。")
    # Remove the DC offset and lift quiet recordings before they reach the recognizer.
    offset = sum(samples) / len(samples)
    peak = max(high - offset, offset - low)
    scale = min(512.0, max(1.0, 16384 / peak)) / 32768
    if not _speech_lock.acquire(blocking=False):
        raise RuntimeError("本机正在识别另一段语音，请稍后重试。")
    try:
        recognizer = _recognizer()
        stream = recognizer.create_stream()
        stream.accept_waveform(SPEECH_RATE, [(number - offset) * scale for number in samples] + [0.0] * (SPEECH_RATE // 2))
        stream.input_finished()
        while recognizer.is_ready(stream):
            recognizer.decode_stream(stream)
        result = recognizer.get_result(stream).strip()
    finally:
        _speech_lock.release()
    if not result:
        raise MediaError("没有识别到文字，请重新录制。")
    return result
