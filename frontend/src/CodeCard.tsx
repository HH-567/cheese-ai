import { useState, type ReactNode } from 'react';

type PreProps = { children?: ReactNode };

function flatten(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flatten).join('');
  const props = (node as { props?: { children?: ReactNode } }).props;
  return props ? flatten(props.children) : '';
}

function languageOf(children: ReactNode): string {
  const first = Array.isArray(children) ? children[0] : children;
  const className = (first as { props?: { className?: string } })?.props?.className ?? '';
  return /language-([\w-]+)/.exec(className)?.[1] ?? '';
}

function humanSize(length: number) {
  return length >= 1024 ? `${(length / 1024).toFixed(1)} KB` : `${length} 字符`;
}

/**
 * 代码块：回答还在流式输出时按普通 pre 显示，打完字后长代码自动收成一张小卡片。
 * 卡片上的「复制代码」只复制代码本身，不含上下的说明文字。
 */
export function CodeCard({ streaming, children }: { streaming: boolean; children?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const code = flatten(children).replace(/\n$/, '');
  const lines = code ? code.split('\n').length : 0;
  const long = lines >= 10 || code.length >= 500;
  if (streaming || !long) return <pre>{children}</pre>;

  const preview = (code.split('\n').find((line) => line.trim()) ?? '').trim().slice(0, 60);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时，用户仍可展开后手动选中复制。 */
    }
  };

  return (
    <div className="md-code-card">
      <div className="md-code-head">
        <span className="md-code-lang">{languageOf(children) || 'code'}</span>
        <span className="md-code-meta">{lines} 行 · {humanSize(code.length)}</span>
        <span className="md-code-preview">{preview}</span>
        <span className="md-code-actions">
          <button type="button" className="md-code-button" onClick={() => void copy()}>{copied ? '已复制' : '复制代码'}</button>
          <button type="button" className="md-code-button md-code-button--primary" aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}>{expanded ? '收起' : '展开'}</button>
        </span>
      </div>
      <div className={`md-code-body ${expanded ? 'md-code-body--full' : 'md-code-body--compact'}`}>
        <pre>{children}</pre>
      </div>
    </div>
  );
}

const streamingPre = ({ children }: PreProps) => <CodeCard streaming>{children}</CodeCard>;
const readyPre = ({ children }: PreProps) => <CodeCard streaming={false}>{children}</CodeCard>;

export const codeRenderers = { streaming: { pre: streamingPre }, ready: { pre: readyPre } };
