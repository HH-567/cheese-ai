import { useEffect, useState, type FormEvent } from 'react';

type Entry = { id: string; content: string; updated_at: string };
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
const endpoint = '/api/personal-memories';

export function PersonalMemorySettings({ enabled, request }: { enabled: boolean; request: Request }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let active = true;
    request<Entry[]>(endpoint).then(
      (items) => { if (active) setEntries(items); },
      (error: Error) => { if (active) setStatus(error.message); },
    );
    return () => { active = false; };
  }, [request]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || busy || (!editing && !enabled)) return;
    setBusy(true);
    try {
      const updated = await request<Entry>(editing ? `${endpoint}/${editing}` : endpoint, {
        method: editing ? 'PATCH' : 'POST', body: JSON.stringify({ content }),
      });
      setEntries((current) => [updated, ...(current ?? []).filter((entry) => entry.id !== updated.id)]);
      setDraft('');
      setEditing(null);
      setStatus('记忆已保存');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await request(`${endpoint}/${id}`, { method: 'DELETE' });
      setEntries((current) => (current ?? []).filter((entry) => entry.id !== id));
      if (editing === id) reset();
      setStatus('记忆已删除');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setEditing(null);
    setDraft('');
  }

  return <div className="personal-memory-settings">
    {status && <p role="status">{status}</p>}
    {entries?.length ? <ul>{entries.map((entry) => <li key={entry.id}>
      <span>{entry.content}</span>
      <button type="button" className="small-button" disabled={busy}
        onClick={() => { setEditing(entry.id); setDraft(entry.content); }}>编辑</button>
      <button type="button" className="small-button" disabled={busy} onClick={() => void remove(entry.id)}>删除</button>
    </li>)}</ul> : entries && <p>还没有保存个人记忆。</p>}
    {(enabled || editing) && <form onSubmit={save}>
      <label className="field-label">{editing ? '编辑个人记忆' : '添加个人记忆'}
        <textarea rows={2} maxLength={400} placeholder="例如，我常用 Python 编程" value={draft}
          onChange={(event) => setDraft(event.target.value)} disabled={busy} />
      </label>
      <div className="personal-memory-actions">
        <button type="submit" className="outline-button" disabled={!draft.trim() || busy}>保存记忆</button>
        {editing && <button type="button" className="small-button" disabled={busy} onClick={reset}>取消编辑</button>}
      </div>
    </form>}
  </div>;
}
