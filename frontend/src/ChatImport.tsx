import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { LoaderCircle, X } from 'lucide-react';

type Api = <T>(path: string, options?: RequestInit) => Promise<T>;

function ChatDialog({ title, busy, onClose, children }: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="governance-entry-dialog chat-import-dialog" aria-label={title}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="governance-dialog-head">
      <h2>{title}</h2>
      <button className="icon-button" type="button" aria-label="关闭" disabled={busy} onClick={onClose}><X size={17} /></button>
    </div>
    <div className="governance-dialog-body">{children}</div>
  </dialog>;
}

export function ChatImport({ api, onImported, onClose }: {
  api: Api;
  onImported: (sessionId: string, count: number) => void;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File>();
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || (!file && !transcript.trim())) return;
    if (file && file.size > 64 * 1024 * 1024) {
      setError('文件超过 64 MB，请解压后分批导入 JSON。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api<{ session_id: string; count: number }>('/api/sessions/import', {
        method: 'POST', body: file ?? transcript, headers: { 'Content-Type': 'application/octet-stream' },
      });
      onImported(result.session_id, result.count);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导入失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  return <ChatDialog title="导入 AI 对话" busy={busy} onClose={onClose}>
    <form onSubmit={(event) => void submit(event)}>
      <p>导入到个人聊天。支持 ChatGPT、DeepSeek 的 ZIP、对话 JSON，或粘贴带角色标签的文本。</p>
      <label className="field-label">对话文件
        <input type="file" accept=".zip,.json,.txt,.md" disabled={busy}
          onChange={(event) => { setFile(event.target.files?.[0]); setError(''); }} />
      </label>
      <label className="field-label">或粘贴对话
        <textarea rows={7} disabled={busy || Boolean(file)} value={transcript}
          placeholder={'用户：什么是递归？\n助手：递归是函数直接或间接调用自身。'}
          onChange={(event) => setTranscript(event.target.value)} />
      </label>
      <small>仅导入可见的用户消息和回答。导入完成后会打开第一条会话。</small>
      {error && <p role="alert" className="review-error">{error}</p>}
      <div className="editor-actions">
        <button type="submit" className="primary-button" disabled={busy || (!file && !transcript.trim())}>
          {busy && <LoaderCircle size={14} className="spin" />}
          {busy ? '正在导入…' : '导入对话'}
        </button>
      </div>
    </form>
  </ChatDialog>;
}

export function SaveConversationQuestion({ api, sessionId, messageId, initialQuestion, initialAnswer, onSaved, onClose }: {
  api: Api;
  sessionId: string;
  messageId: string;
  initialQuestion: string;
  initialAnswer: string;
  onSaved: (groupId: string) => void;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [answer, setAnswer] = useState(initialAnswer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = !!question.trim() && question.trim().length <= 400 && !!answer.trim() && answer.trim().length <= 12000;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ group_id: string }>('/api/sessions/' + encodeURIComponent(sessionId) +
        '/messages/' + encodeURIComponent(messageId) + '/save-question', {
        method: 'POST', body: JSON.stringify({ question: question.trim(), answer: answer.trim() }),
      });
      onSaved(result.group_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '未能加入问答库。');
    } finally {
      setBusy(false);
    }
  }

  return <ChatDialog title="提取问答" busy={busy} onClose={onClose}>
    <form onSubmit={(event) => void submit(event)}>
      <p>检查问题和答案是否能独立理解。可以编辑后存入个人问答库。</p>
      <label className="field-label">问题
        <textarea rows={2} value={question} disabled={busy} onChange={(event) => setQuestion(event.target.value)} />
      </label>
      <label className="field-label">答案
        <textarea rows={8} value={answer} disabled={busy} onChange={(event) => setAnswer(event.target.value)} />
      </label>
      {(question.trim().length > 400 || answer.trim().length > 12000) &&
        <p className="review-error">请将问题缩短到 400 字以内、答案缩短到 12000 字以内。</p>}
      {error && <p role="alert" className="review-error">{error}</p>}
      <div className="editor-actions">
        <button type="submit" className="primary-button" disabled={busy || !valid}>
          {busy && <LoaderCircle size={14} className="spin" />}
          {busy ? '正在保存…' : '加入个人问答库'}
        </button>
      </div>
    </form>
  </ChatDialog>;
}
