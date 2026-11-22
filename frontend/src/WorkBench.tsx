import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Bookmark, Cloud, Download, FileSpreadsheet, ListChecks, LoaderCircle, Play, X } from 'lucide-react';

type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
type Csv = { name: string; content: string };
type RuleField = { key: string; label: string };
type Rule = {
  id: string;
  name: string;
  fields: RuleField[];
  requires_csv: boolean;
  invocation: string;
};
type RuleDraft = {
  token: string;
  fields: (RuleField & { value: string })[];
  bindings?: (RuleField & { reference: string })[];
};
type Step = {
  index: number;
  name: string;
  status: 'completed' | 'failed' | 'skipped';
  result: { label: string; value: string }[];
  error?: string;
};
type Run = {
  source: 'rule' | 'cloud';
  status: 'completed' | 'clarification' | 'failed';
  rule: string | null;
  model: string | null;
  cloud_calls: number;
  total_ms: number;
  steps: Step[];
  outcome?: string | null;
  message?: string;
  report: string | null;
  rule_draft?: RuleDraft | null;
};

const maxCsvBytes = 500 * 1024;
const maxGoalLength = 1200;
const maxRuleNameLength = 40;
const spendingGoal = '帮我做活动支出简报：总预算1500元，用CSV的「金额」列汇总支出，再算预算余额。';
const preparationGoal = '帮我做活动筹备简报：先算 2026-12-01 到 2026-12-05 的日期间隔，再用总预算 900 元和已支出 180 元算余额。';
const cloudGoal = '先汇总 CSV 的「金额」列。如果合计超过 600 元，用总预算 1500 元算余额；否则只报告合计。';
const spendingFiles = [
  { name: '活动支出-样例一.csv', content: '项目,金额\n场地,400.25\n物料,238.25\n' },
  { name: '活动支出-样例二.csv', content: '项目,金额\n场地,400\n物料,300\n' },
];
const stepStatus = { completed: '已完成', failed: '失败', skipped: '已跳过' };
const runStatus = { completed: '已完成', clarification: '待补充', failed: '未完成' };

export function WorkBench({ api, hidden }: { api: Api; hidden: boolean }) {
  const [goal, setGoal] = useState('');
  const [csv, setCsv] = useState<Csv | null>(null);
  const [result, setResult] = useState<Run | null>(null);
  const [error, setError] = useState('');
  const [fileError, setFileError] = useState('');
  const [reading, setReading] = useState(false);
  const [running, setRunning] = useState(false);
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [ruleError, setRuleError] = useState('');
  const [ruleNotice, setRuleNotice] = useState('');
  const [listRetry, setListRetry] = useState(0);
  const [selectedRule, setSelectedRule] = useState<Rule | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [editingDraft, setEditingDraft] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [parameterKeys, setParameterKeys] = useState<string[]>([]);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const busy = reading || running || saving || deleting;
  const readyToRun = selectedRule
    ? selectedRule.fields.every((field) => values[field.key]?.trim()) && (!selectedRule.requires_csv || csv !== null)
    : Boolean(goal.trim());

  useEffect(() => {
    if (hidden || rules !== null) return;
    const controller = new AbortController();
    setRuleError('');
    api<Rule[]>('/api/work/rules', { signal: controller.signal })
      .then((items) => { if (!controller.signal.aborted) setRules(items); })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setRuleError(cause instanceof Error ? cause.message : '未能载入个人规则。');
      });
    return () => controller.abort();
  }, [api, hidden, listRetry, rules]);

  function loadExample(nextGoal: string, nextCsv: Csv | null = null) {
    setSelectedRule(null);
    setGoal(nextGoal);
    setCsv(nextCsv);
    setResult(null);
    setEditingDraft(false);
    setError('');
    setFileError('');
  }

  function chooseRule(rule: Rule | null) {
    setSelectedRule(rule);
    setValues({});
    setCsv(null);
    setResult(null);
    setEditingDraft(false);
    setError('');
    setFileError('');
  }

  function openDraft(draft: RuleDraft) {
    setRuleName('');
    setParameterKeys(draft.fields.map(({ key }) => key));
    setSaveError('');
    setEditingDraft(true);
  }

  async function saveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!result?.rule_draft || !ruleName.trim() || busy) return;
    setSaving(true);
    setSaveError('');
    try {
      const rule = await api<Rule>('/api/work/rules', {
        method: 'POST',
        body: JSON.stringify({ token: result.rule_draft.token, name: ruleName.trim(), parameter_keys: parameterKeys }),
      });
      setRules((items) => [rule, ...(items ?? []).filter(({ id }) => id !== rule.id)]);
      setRuleError('');
      setRuleNotice('规则「' + rule.name + '」已保存。');
      setEditingDraft(false);
      setResult({ ...result, rule_draft: null });
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : '规则未能保存。');
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule(rule: Rule) {
    if (busy) return;
    setDeleting(true);
    setRuleError('');
    setRuleNotice('');
    try {
      await api<{ ok: boolean }>('/api/work/rules/' + encodeURIComponent(rule.id), { method: 'DELETE' });
      setRules((items) => (items ?? []).filter(({ id }) => id !== rule.id));
      if (selectedRule?.id === rule.id) chooseRule(null);
      setRuleNotice('规则「' + rule.name + '」已删除。');
      setDeleteTarget(null);
    } catch (cause) {
      setRuleError(cause instanceof Error ? cause.message : '规则未能删除。');
    } finally {
      setDeleting(false);
    }
  }

  async function selectFile(file: File) {
    setFileError('');
    if (file.size > maxCsvBytes) {
      setFileError('CSV 文件不能超过 500 KB。');
      return;
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setFileError('请选择 CSV 文件。');
      return;
    }
    setReading(true);
    try {
      const bytes = await file.arrayBuffer();
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        content = new TextDecoder('gb18030', { fatal: true }).decode(bytes);
      }
      if (new TextEncoder().encode(content).length > maxCsvBytes) {
        setFileError('CSV 转为 UTF-8 后超过 500 KB。');
        return;
      }
      setCsv({ name: file.name, content });
    } catch {
      setFileError('无法读取文件，请检查 CSV 是否使用 UTF-8 或 GB18030 编码。');
    } finally {
      setReading(false);
    }
  }

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !readyToRun || fileError) return;
    setRunning(true);
    setResult(null);
    setEditingDraft(false);
    setError('');
    const inputs = selectedRule ? { rule_id: selectedRule.id, values } : { goal: goal.trim() };
    try {
      const response = await api<Run>('/api/work/run', {
        method: 'POST', body: JSON.stringify({ ...inputs, csv: csv?.content }),
      });
      setResult(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '任务运行失败，请重试。');
    } finally {
      setRunning(false);
    }
  }

  function downloadReport() {
    if (!result?.report) return;
    const url = URL.createObjectURL(new Blob([result.report], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = (result.rule ?? 'Work 任务报告') + '.md';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="page-content work-page" hidden={hidden}>
    <div className="page-heading"><div>
      <h1>Work 工作台</h1>
      <p>给出目标，Work 会拆解任务并按需调用工具。目前支持预算余额、日期间隔和 CSV 数值列求和。</p>
    </div></div>
    <div className="work-grid">
      <div className="work-panel">
        <form onSubmit={run}>
          {selectedRule ? <div className="work-rule-inputs">
            <div className="work-rule-head">
              <h2>{selectedRule.name}</h2>
              <button type="button" className="text-button" onClick={() => chooseRule(null)} disabled={busy}>返回自由任务</button>
            </div>
            {selectedRule.fields.map((field) => <label className="field-label" key={field.key}>
              {field.label}
              <input type="text" value={values[field.key] ?? ''} required disabled={busy}
                onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} />
            </label>)}
            {selectedRule.invocation && <details className="work-rule-command">
              <summary>查看任务框用法</summary>
              <code>{selectedRule.invocation}</code>
              {selectedRule.fields.length > 0 && <p className="work-rule-note">使用自由任务时，把尖括号和其中的提示替换为实际值。</p>}
            </details>}
          </div> : <label className="field-label work-goal">
            <span>任务目标 <small>{goal.length} / {maxGoalLength}</small></span>
            <textarea rows={5} value={goal} maxLength={maxGoalLength} required disabled={busy}
              placeholder="描述你要完成的任务，可以指定条件，例如只有当支出超过某个金额时才计算余额。"
              onChange={(event) => setGoal(event.target.value)} />
          </label>}
          <div className="work-attachment">
            <label className="field-label">
              CSV 附件{selectedRule?.requires_csv ? '（必需）' : '（可选）'}
              <input type="file" accept=".csv,text/csv" disabled={busy} aria-describedby="work-file-hint"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void selectFile(file);
                }} />
            </label>
            <small id="work-file-hint">{selectedRule
              ? '每次最多一份，可上传本次计算所用的 CSV。'
              : '每次一份，最大 500 KB。原始 CSV 由服务端处理，云端代理会使用工具的汇总结果。'}</small>
            {csv && <div className="work-file" aria-live="polite">
              <FileSpreadsheet size={16} /><span>{csv.name}</span>
              <button className="small-button" type="button" disabled={busy} aria-label="移除附件"
                onClick={() => { setCsv(null); setFileError(''); }}><X size={14} /></button>
            </div>}
            {fileError && <div className="work-file-error" role="alert">
              <span>{fileError}</span>
              <button type="button" className="text-button" onClick={() => setFileError('')}>
                {csv ? '保留当前附件' : '不使用附件'}
              </button>
            </div>}
          </div>
          <button className="primary-button work-run" type="submit" disabled={busy || !readyToRun || Boolean(fileError)}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}
            {running ? '正在运行…' : reading ? '正在读取附件…' : selectedRule ? '运行规则' : '运行任务'}
          </button>
        </form>
        <div className="work-examples">
          <h2>任务示例</h2>
          <div>
            <button className="outline-button" type="button" disabled={busy} onClick={() => loadExample(spendingGoal, spendingFiles[0])}>活动支出 · CSV 一</button>
            <button className="outline-button" type="button" disabled={busy} onClick={() => loadExample(spendingGoal, spendingFiles[1])}>活动支出 · CSV 二</button>
            <button className="outline-button" type="button" disabled={busy} onClick={() => loadExample(preparationGoal)}>活动筹备</button>
            <button className="outline-button" type="button" disabled={busy} onClick={() => loadExample(cloudGoal, spendingFiles[0])}>条件预算 · 云端代理</button>
          </div>
        </div>
        <div className="work-rules">
          <h2>我的规则</h2>
          {ruleNotice && <p className="work-rule-note" role="status">{ruleNotice}</p>}
          {ruleError && <div className="work-rule-error" role="alert">
            <span>{ruleError}</span>
            {rules === null && <button type="button" className="text-button" onClick={() => setListRetry((count) => count + 1)}>重试</button>}
          </div>}
          {rules === null && !ruleError && <p className="work-rule-note">正在载入规则…</p>}
          {rules?.length === 0 && <p className="work-rule-note">运行任务后，可在结果中保存需要反复使用的步骤。</p>}
          {!!rules?.length && <ul className="work-rule-list">
            {rules.map((rule) => <li key={rule.id}>
              <span>{rule.name}</span>
              {deleteTarget === rule.id ? <div className="work-rule-actions">
                <button type="button" className="text-button" disabled={busy} onClick={() => setDeleteTarget(null)}>取消</button>
                <button type="button" className="text-button work-rule-delete" disabled={busy}
                  onClick={() => void deleteRule(rule)}>确认删除</button>
              </div> : <div className="work-rule-actions">
                <button type="button" className="outline-button" aria-label={'使用规则 ' + rule.name}
                  onClick={() => chooseRule(rule)} disabled={busy || selectedRule?.id === rule.id}>
                  {selectedRule?.id === rule.id ? '已选中' : '使用'}
                </button>
                <button type="button" className="text-button work-rule-delete" aria-label={'删除规则 ' + rule.name}
                  onClick={() => setDeleteTarget(rule.id)} disabled={busy}>删除</button>
              </div>}
            </li>)}
          </ul>}
        </div>
      </div>
      <section className="work-panel work-output" aria-label="运行结果" aria-busy={running}>
        <div className="work-output-head">
          <h2>运行结果</h2>
          <div className="work-rule-actions">
            {result?.rule_draft && !editingDraft && <button type="button" className="outline-button"
              onClick={() => { if (result.rule_draft) openDraft(result.rule_draft); }} disabled={busy || rules === null}>
              <Bookmark size={15} />保存为规则
            </button>}
            {result?.report && <button type="button" className="outline-button" onClick={downloadReport}>
              <Download size={15} />下载 Markdown
            </button>}
          </div>
        </div>
        {running && <p className="work-empty" role="status"><LoaderCircle size={20} className="spin" />正在决定下一步并运行工具…</p>}
        {error && <p className="work-message work-message--error" role="alert">{error}</p>}
        {!running && !error && !result && <p className="work-empty"><ListChecks size={23} />运行任务后，步骤和计算结果会显示在这里。</p>}
        {result && <>
          <div className="work-run-info" role="status">
            <span className={'work-source work-source--' + result.source}>
              {result.source === 'rule' ? <ListChecks size={14} /> : <Cloud size={14} />}
              {result.source === 'rule' ? '本地规则' : '云端代理'}
            </span>
            <strong>{result.cloud_calls} 次云端调用</strong>
            <span>{runStatus[result.status]}</span>
            <span>{result.total_ms} ms</span>
            {(result.rule || result.model) && <small>{result.rule || result.model}</small>}
          </div>
          {result.message && <p className={'work-message' + (result.status === 'failed' ? ' work-message--error' : '')}
            role="alert">{result.message}</p>}
          {result.outcome && <p className="work-outcome">{result.outcome}</p>}
          {result.steps.length > 0 && <ol className="work-steps">
            {result.steps.map((step) => <li key={step.index}>
              <div className="work-step-title">
                <h3>{step.index}. {step.name}</h3>
                <span className={'work-step-state work-step-state--' + step.status}>{stepStatus[step.status]}</span>
              </div>
              {step.error && <p>{step.error}</p>}
              {step.status === 'skipped' && <p>前序步骤失败。</p>}
              {step.result.length > 0 && <dl className="work-step-result">
                {step.result.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
              </dl>}
            </li>)}
          </ol>}
          {editingDraft && result.rule_draft && <form className="work-rule-editor" onSubmit={saveRule}>
            <h2>保存为个人规则</h2>
            <p className="work-rule-note">规则会按上方顺序重跑本次步骤。需要根据结果分支时，请继续使用自由任务。</p>
            <label className="field-label">
              规则名称
              <input type="text" maxLength={maxRuleNameLength} value={ruleName} onChange={(event) => setRuleName(event.target.value)}
                required disabled={busy} />
            </label>
            {result.rule_draft.fields.length > 0 && <fieldset>
              <legend>勾选每次运行都要填写的参数</legend>
              {result.rule_draft.fields.map((field) => <label className="work-rule-field" key={field.key}>
                <input type="checkbox" checked={parameterKeys.includes(field.key)} disabled={busy}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setParameterKeys((keys) => checked ? [...keys, field.key] : keys.filter((key) => key !== field.key));
                  }} />
                <span>{field.label}<small>{parameterKeys.includes(field.key) ? '本次使用 ' + field.value : '固定为 ' + field.value}</small></span>
              </label>)}
            </fieldset>}
            {!!result.rule_draft.bindings?.length && <dl className="work-rule-bindings">
              {result.rule_draft.bindings.map((binding) => <div key={binding.key}>
                <dt>{binding.label}</dt><dd>取自{binding.reference}</dd>
              </div>)}
            </dl>}
            {saveError && <p className="work-rule-error" role="alert">{saveError}</p>}
            <div className="work-rule-actions">
              <button type="submit" className="primary-button" disabled={busy || !ruleName.trim()}>
                {saving ? '正在保存…' : '保存规则'}
              </button>
              <button type="button" className="outline-button" disabled={busy} onClick={() => setEditingDraft(false)}>取消</button>
            </div>
          </form>}
        </>}
      </section>
    </div>
  </section>;
}
