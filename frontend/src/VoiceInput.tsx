import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Mic, Square } from 'lucide-react';

const recordingLimit = 24;
const workletUrl = import.meta.env.BASE_URL + 'voice-capture.js';

async function encodeWav(chunks: Float32Array[], inputRate: number) {
  const length = Math.min(chunks.reduce((total, chunk) => total + chunk.length, 0), inputRate * recordingLimit);
  if (length < inputRate * 0.2) throw new Error('录音太短，请重新录制。');
  const rate = 16000;
  const converter = new OfflineAudioContext(1, Math.floor(length * rate / inputRate), rate);
  const audio = converter.createBuffer(1, length, inputRate);
  const input = audio.getChannelData(0);
  let offset = 0;
  for (const chunk of chunks) {
    const count = Math.min(chunk.length, length - offset);
    input.set(chunk.subarray(0, count), offset);
    offset += count;
    if (offset >= length) break;
  }
  const source = converter.createBufferSource();
  source.buffer = audio;
  source.connect(converter.destination);
  source.start();
  const samples = (await converter.startRendering()).getChannelData(0);
  const wav = new DataView(new ArrayBuffer(44 + samples.length * 2));
  for (const [offset, label] of [[0, 'RIFF'], [8, 'WAVEfmt '], [36, 'data']] as const) {
    for (let index = 0; index < label.length; index++) wav.setUint8(offset + index, label.charCodeAt(index));
  }
  wav.setUint32(4, wav.byteLength - 8, true);
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 1, true);
  wav.setUint32(24, rate, true);
  wav.setUint32(28, rate * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  wav.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    wav.setInt16(44 + index * 2, Math.max(-32768, Math.min(32767, samples[index] * 32768)), true);
  }
  return new Blob([wav.buffer], { type: 'audio/wav' });
}

const micPreference = 'qishi:microphone';

export function VoiceInput({ available, disabled, transcribe, onText, onError }: {
  available: boolean; disabled: boolean; transcribe: (file: Blob) => Promise<string>;
  onText: (text: string) => void; onError: (message: string) => void;
}) {
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'processing'>('idle');
  const [deviceId, setDeviceId] = useState(() => localStorage.getItem(micPreference) || '');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeName, setActiveName] = useState('');
  const [level, setLevel] = useState(0);
  const capture = useRef<{ stop: () => void; cancel: () => void } | null>(null);
  const alive = useRef(false);
  const recording = state === 'recording';
  const waiting = state === 'starting' || state === 'processing';

  async function refreshDevices() {
    try {
      const inputs = (await navigator.mediaDevices.enumerateDevices())
        .filter((device) => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default');
      if (alive.current) setDevices(inputs);
    } catch { /* Permission or the browser can hide device details before recording. */ }
  }

  useEffect(() => {
    alive.current = true;
    const media = navigator.mediaDevices;
    if (media) {
      void refreshDevices();
      media.addEventListener('devicechange', refreshDevices);
    }
    return () => {
      alive.current = false;
      media?.removeEventListener('devicechange', refreshDevices);
      capture.current?.cancel();
      capture.current = null;
    };
  }, []);

  const toggle = async () => {
    if (recording) {
      capture.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
      onError('语音输入需要支持麦克风录制的浏览器，请通过 localhost 或 HTTPS 打开。');
      return;
    }
    setState('starting');
    setLevel(0);
    onError('');
    let context: AudioContext | undefined;
    let stream: MediaStream | undefined;
    let node: AudioWorkletNode | undefined;
    let timer: number | undefined;
    let finishing = false;
    let closed = false;
    const chunks: Float32Array[] = [];
    const cancel = () => {
      if (closed) return;
      closed = true;
      window.clearTimeout(timer);
      node?.port.close();
      node?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      if (context) void context.close().catch(() => undefined);
      capture.current = null;
    };
    capture.current = { cancel, stop: () => undefined };
    try {
      context = new AudioContext();
      const resumed = context.resume().catch(() => undefined);
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined },
      });
      if (!alive.current || closed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState === 'ended') throw new Error('麦克风连接已断开。');
      const name = track.label || '默认麦克风';
      setActiveName(name);
      void refreshDevices();
      await context.audioWorklet.addModule(workletUrl);
      if (closed) return;
      await resumed;
      if (closed) return;
      const rate = context.sampleRate;
      const input = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, 'qishi-voice-capture');
      node = worklet;
      const mute = context.createGain();
      mute.gain.value = 0;
      const stop = () => {
        if (closed || finishing) return;
        finishing = true;
        window.clearTimeout(timer);
        setState('processing');
        worklet.port.postMessage({ stop: true });
        timer = window.setTimeout(() => {
          if (closed) return;
          cancel();
          setState('idle');
          onError('录音中断，请重试。');
        }, 1500);
      };
      worklet.port.onmessage = async ({ data }) => {
        if (closed) return;
        if (!data.done) {
          chunks.push(data.samples);
          const db = 20 * Math.log10(Math.max(data.level, 1e-5));
          setLevel(Math.round(Math.max(0, Math.min(100, (db + 80) * 1.25))));
          return;
        }
        cancel();
        try {
          const file = await encodeWav(chunks, rate);
          if (!alive.current) return;
          const text = await transcribe(file);
          if (alive.current) onText(text);
        } catch (error) {
          if (alive.current) onError(error instanceof Error ? error.message : '语音识别失败，请重试。');
        } finally {
          if (alive.current) setState('idle');
        }
      };
      worklet.onprocessorerror = () => {
        cancel();
        setState('idle');
        onError('录音组件没有收到可用音频，请重试。');
      };
      input.connect(worklet).connect(mute).connect(context.destination);
      track.addEventListener('ended', stop, { once: true });
      capture.current = { cancel, stop };
      setState('recording');
      timer = window.setTimeout(stop, recordingLimit * 1000);
    } catch (error) {
      cancel();
      if (!alive.current) return;
      setState('idle');
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        onError('请允许此页面使用麦克风后重试。');
      } else if (error instanceof DOMException && ['NotFoundError', 'OverconstrainedError'].includes(error.name)) {
        void refreshDevices();
        onError('找不到所选麦克风，请换一个输入设备。');
      } else {
        onError('无法开始录音，请检查麦克风是否已连接或切换输入设备。');
      }
    }
  };

  const label = recording ? '结束录音' : waiting ? '正在处理' : '语音输入';
  return <div className="voice-input">
    <button type="button" className={`attach-document ${recording ? 'voice-recording' : ''}`}
      disabled={!available || waiting || (disabled && !recording)} onClick={() => void toggle()}
      title={available ? '普通话转写，结果填入输入框' : '本机语音模型未安装'}>
      {recording ? <Square size={13} /> : waiting ? <LoaderCircle size={13} className="spin" /> : <Mic size={13} />}
      {label}
    </button>
    {available && <select className="voice-device" aria-label="选择麦克风"
      value={deviceId} disabled={state !== 'idle'} onChange={(event) => {
        setDeviceId(event.target.value);
        localStorage.setItem(micPreference, event.target.value);
        setActiveName('');
      }}>
      <option value="">默认麦克风</option>
      {deviceId && !devices.some((device) => device.deviceId === deviceId) && <option value={deviceId}>已选麦克风</option>}
      {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `麦克风 ${index + 1}`}</option>)}
    </select>}
    {(recording || waiting) && activeName && <span className="voice-status">
      <span title={activeName}>{activeName}</span>
      {recording && <meter min={0} max={100} value={level} aria-label="麦克风输入电平" />}
    </span>}
  </div>;
}
