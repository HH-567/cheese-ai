import { useEffect, useRef, useState } from 'react';
import { BookOpen, FileText, Paperclip } from 'lucide-react';

type KnowledgeDocument = { id: string; name: string; size: number; active: number; created_at: string };
type Library = { can_manage: boolean; documents: KnowledgeDocument[] };
type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
const endpoint = '/api/knowledge/documents';

export function KnowledgeLibrary({ api, onAsk }: { api: Api; onAsk: () => void }) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    api<Library>(endpoint).then(
      (result) => { if (active) setLibrary(result); },
      (cause: Error) => { if (active) setError(cause.message); },
    );
    return () => { active = false; };
  }, [api]);

  async function update(path: string, options: RequestInit) {
    setBusy(true);
    setError('');
    try {
      await api(path, options);
      setLibrary(await api<Library>(endpoint));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '更新共享资料失败');
    } finally {
      setBusy(false);
    }
  }

  function publish(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setError('文件大小不能超过 5 MB。');
      return;
    }
    void update(endpoint + '?' + new URLSearchParams({ filename: file.name }), {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
    });
  }

  return <section className="page-content">
    <div className="page-heading">
      <div><h1>共享知识库</h1><p>成员可根据已发布的文档提问并核对原文。</p></div>
      <div className="page-heading-actions">
        {library?.can_manage && <button type="button" className="outline-button" onClick={() => fileInput.current?.click()} disabled={busy}>
          <Paperclip size={15} />{busy ? '处理中…' : '发布资料'}
        </button>}
        {library?.documents.some((item) => item.active) && <button type="button" className="primary-button" onClick={onAsk}>
          <BookOpen size={15} />根据资料提问
        </button>}
      </div>
    </div>
    <input ref={fileInput} type="file" accept=".pdf,.docx,.txt,.md,.csv" hidden onChange={(event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) publish(file);
    }} />
    {error && <p role="alert" className="global-error">{error}</p>}
    {library && <div className="data-section knowledge-list">
      {library.documents.length ? <ul>{library.documents.map((item) => <li key={item.id}>
        <FileText size={18} />
        <div><strong>{item.name}</strong><small>{(item.size / 1024).toFixed(1)} KB · {item.active ? '已发布' : '已下架'}</small></div>
        {library.can_manage && <button type="button" className="small-button" disabled={busy}
          onClick={() => void update(endpoint + '/' + encodeURIComponent(item.id), {
            method: 'PATCH', body: JSON.stringify({ active: !item.active }),
          })}>{item.active ? '下架' : '恢复发布'}</button>}
      </li>)}</ul> : <p className="inline-empty">暂无共享资料。</p>}
    </div>}
  </section>;
}
