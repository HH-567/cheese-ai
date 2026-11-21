import { useId, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { citationLinks } from './WebSources';

export type DocumentSource = { number: number; location: string; excerpt: string; title?: string };

export function DocumentAnswer({ content, sources, name }: {
  content: string; sources: DocumentSource[]; name?: string;
}) {
  const id = useId();
  const sourceList = useRef<HTMLDetailsElement>(null);
  const numbers = new Set(sources.map((source) => source.number));
  return <>
    <ReactMarkdown remarkPlugins={[remarkGfm, citationLinks(numbers)]} components={{
      a: ({ href, children }) => {
        const number = Number(/^#qishi-source-(\d+)$/.exec(href ?? '')?.[1]);
        return numbers.has(number) ? <button type="button" className="document-citation"
          aria-label={`查看原文 ${number}`} onClick={() => {
            if (sourceList.current) sourceList.current.open = true;
            document.getElementById(`${id}-${number}`)?.focus();
          }}>{children}</button> : <span>{children}</span>;
      },
      img: () => null,
    }}>{content}</ReactMarkdown>
    {!!sources.length && <details className="web-sources document-sources" ref={sourceList}>
      <summary>文件原文{ name && <small>{name}</small>}</summary>
      <ol>{sources.map((source) => <li key={source.number} id={`${id}-${source.number}`} tabIndex={-1}>
        <strong>{source.title ? source.title + ' · ' : ''}{source.location}</strong>
        <p>{source.excerpt}</p>
      </li>)}</ol>
    </details>}
  </>;
}
