import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export type WebSource = { number: number; title: string; url: string; excerpt: string };
type MarkdownNode = { type: string; value?: string; url?: string; children?: MarkdownNode[] };

export function citationLinks(numbers: Set<number>) {
  return () => (node: MarkdownNode) => {
    const visit = (parent: MarkdownNode) => {
      if (!parent.children || ['link', 'linkReference', 'image', 'imageReference'].includes(parent.type)) return;
      parent.children = parent.children.flatMap<MarkdownNode>((child) => {
        if (child.type !== 'text' || !child.value) {
          visit(child);
          return child;
        }
        return child.value.split(/(\[\d+\])/g).filter(Boolean).map((part) => {
          const match = /^\[(\d+)\]$/.exec(part);
          const number = match ? Number(match[1]) : 0;
          const text = { type: 'text', value: part };
          return numbers.has(number)
            ? { type: 'link', url: '#qishi-source-' + number, children: [text] }
            : text;
        });
      });
    };
    visit(node);
  };
}

function validSources(sources: WebSource[]) {
  return sources.filter((source) => /^https?:\/\//i.test(source.url));
}

export function WebAnswer({ content, sources }: { content: string; sources: WebSource[] }) {
  const byNumber = new Map(validSources(sources).map((source) => [source.number, source]));
  return <ReactMarkdown remarkPlugins={[remarkGfm, citationLinks(new Set(byNumber.keys()))]} components={{
    a: ({ href, children }) => {
      const citation = /^#qishi-source-(\d+)$/.exec(href ?? '');
      const source = citation && byNumber.get(Number(citation[1]));
      return source
        ? <a className="web-citation" href={source.url} target="_blank" rel="noopener noreferrer"
          aria-label={'来源 ' + source.number + ' · ' + source.title}>{children}</a>
        : <span>{children}</span>;
    },
    img: () => null,
  }}>{content}</ReactMarkdown>;
}

export function SourceList({ sources, provider }: { sources: WebSource[]; provider?: string }) {
  return <details className="web-sources">
    <summary>{'网页来源（' + sources.length + '）'}{provider && <small>{provider}</small>}</summary>
    <ol>{validSources(sources).map((source) => <li key={source.number}>
      <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
      <p>{source.excerpt}</p>
    </li>)}</ol>
  </details>;
}
