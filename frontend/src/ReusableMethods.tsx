import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

type Field = { id: string; label: string; type?: 'date' | 'file'; placeholder?: string };
type Method = { id: string; name: string; fields: Field[] };
type Result = { label: string; value: string };
type Api = <T>(path: string, options?: RequestInit) => Promise<T>;

export function ReusableMethods({ api }: { api: Api }) {
  const [methods, setMethods] = useState<Method[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api<Method[]>('/api/methods').then(
      (items) => { if (active) { setMethods(items); setSelectedId(items[0]?.id ?? ''); } },
      (cause: Error) => { if (active) setError(cause.message); },
    );
    return () => { active = false; };
  }, [api]);

  const selected = methods.find((item) => item.id === selectedId);

  function select(id: string) {
    setSelectedId(id);
    setValues({});
    setResult([]);
    setError('');
  }

  async function readFile(field: Field, file: File | undefined) {
    setValues((current) => ({ ...current, [field.id]: '' }));
    setResult([]);
    if (!file) return;
    if (file.size > 512_000) {
      setError('CSV 文件不能超过 500 KB。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const bytes = await file.arrayBuffer();
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        content = new TextDecoder('gb18030', { fatal: true }).decode(bytes);
      }
      setValues((current) => ({ ...current, [field.id]: content }));
    } catch {
      setError('请使用 UTF-8 或 GB18030 编码的 CSV 文件。');
    } finally {
      setBusy(false);
    }
  }

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    setResult([]);
    try {
      const response = await api<{ result: Result[] }>(`/api/methods/${encodeURIComponent(selected.id)}/run`, {
        method: 'POST', body: JSON.stringify({ values }),
      });
      setResult(response.result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '计算失败');
    } finally {
      setBusy(false);
    }
  }

  return <section className="page-content">
    <div className="page-heading"><div><h1>复用方法</h1><p>填写参数即可在本机计算，可更换数据反复使用。</p></div></div>
    <div className="segmented-control" aria-label="选择复用方法">
      {methods.map((method) => <button type="button" key={method.id} disabled={busy}
        className={method.id === selectedId ? 'active' : ''} onClick={() => select(method.id)}>{method.name}</button>)}
    </div>
    {selected && <form key={selected.id} className="data-section method-form" onSubmit={run}>
      {selected.fields.map((field) => <label className="field-label" key={field.id}>{field.label}
        {field.type === 'file'
          ? <input type="file" accept=".csv,text/csv" disabled={busy} required onChange={(event) => void readFile(field, event.target.files?.[0])} />
          : <input type={field.type ?? 'text'} placeholder={field.placeholder} maxLength={120}
            value={values[field.id] ?? ''} disabled={busy} required onChange={(event) => {
              setValues({ ...values, [field.id]: event.target.value });
              setResult([]);
            }} />}
      </label>)}
      <button type="submit" className="primary-button" disabled={busy || selected.fields.some((field) => !values[field.id]?.trim())}>计算</button>
      {result.length > 0 && <dl className="method-results" aria-live="polite">
        {result.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
      </dl>}
    </form>}
    {error && <p className="global-error" role="alert">{error}</p>}
  </section>;
}
