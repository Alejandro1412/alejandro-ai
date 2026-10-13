import { Fragment, type ReactNode } from 'react';

/**
 * Minimal, safe markdown for assistant replies: **bold**, *italic*, `code`, https links, bullet and
 * numbered lists, paragraphs. Builds React elements (never innerHTML), so model output cannot inject markup.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join('\n'))}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={`l${blocks.length}`} className="list-decimal space-y-0.5 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={`l${blocks.length}`} className="space-y-0.5 pl-1">
          {list.items.map((it, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true" className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-50" />
              <span>{inline(it)}</span>
            </li>
          ))}
        </ul>
      ),
    );
    list = null;
  };
  for (const line of lines) {
    const bullet = line.match(/^\s*(?:[•\-*])\s+(.*)$/);
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushPara();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ? bullet[1] : numbered![2]).trim());
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className={className ?? 'space-y-2'}>{blocks}</div>;
}

const TOKEN = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\(https:\/\/[^)\s]+\)|https:\/\/[^\s)]+)/g;

function inline(s: string): ReactNode {
  const parts = s.split(TOKEN);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[0.85em]">{part.slice(1, -1)}</code>;
    const md = part.match(/^\[([^\]]+)\]\((https:\/\/[^)\s]+)\)$/);
    if (md) return <a key={i} href={md[2]} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2">{md[1]}</a>;
    if (/^https:\/\//.test(part)) return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all font-medium underline underline-offset-2">{part}</a>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    return (
      <Fragment key={i}>
        {part.split('\n').map((seg, j, arr) => (
          <Fragment key={j}>
            {seg}
            {j < arr.length - 1 && <br />}
          </Fragment>
        ))}
      </Fragment>
    );
  });
}
