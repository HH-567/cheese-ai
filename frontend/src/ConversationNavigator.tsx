import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

type Turn = { id: string; content: string };

export function ConversationNavigator({ turns, scrollRef, onJump }: {
  turns: Turn[];
  scrollRef: RefObject<HTMLDivElement>;
  onJump: () => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string>();
  const [previewId, setPreviewId] = useState<string>();
  const labels = useMemo(() => turns.map((turn, index) => {
    const text = turn.content.replace(/\s+/g, ' ').trim();
    return '第 ' + (index + 1) + ' 条提问 · ' + (text.length > 90 ? text.slice(0, 90) + '…' : text || '附件');
  }), [turns]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const stack = scroll.querySelector('.message-stack');
    let frame = 0;
    function update() {
      if (!scroll) return;
      const viewport = scroll.getBoundingClientRect();
      const readingLine = viewport.top + Math.min(72, viewport.height * 0.25);
      let start = 0;
      let end = turns.length - 1;
      while (start < end) {
        const middle = Math.ceil((start + end) / 2);
        const turn = document.getElementById('chat-turn-' + turns[middle].id);
        if (turn && turn.getBoundingClientRect().top <= readingLine) start = middle;
        else end = middle - 1;
      }
      setActiveId(turns[start]?.id);
    }
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    }
    update();
    scroll.addEventListener('scroll', schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(scroll);
    if (stack) resize.observe(stack);
    return () => {
      scroll.removeEventListener('scroll', schedule);
      resize.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [turns, scrollRef]);

  useEffect(() => {
    const rail = railRef.current;
    const button = rail?.querySelector<HTMLButtonElement>('[aria-current="location"]');
    if (!rail || !button) return;
    if (button.offsetTop < rail.scrollTop) rail.scrollTop = button.offsetTop;
    const bottom = button.offsetTop + button.offsetHeight;
    if (bottom > rail.scrollTop + rail.clientHeight) rail.scrollTop = bottom - rail.clientHeight;
  }, [activeId]);

  function jump(id: string) {
    const scroll = scrollRef.current;
    const anchor = document.getElementById('chat-turn-' + id);
    if (!scroll || !anchor || scroll.offsetHeight === 0) return;
    const viewport = scroll.getBoundingClientRect();
    const scale = viewport.height / scroll.offsetHeight;
    const top = scroll.scrollTop + (anchor.getBoundingClientRect().top - viewport.top) / scale - 16;
    onJump();
    scroll.scrollTo({ top, behavior: 'instant' });
  }

  const preview = previewId ? labels[turns.findIndex((turn) => turn.id === previewId)] : undefined;
  return <nav className="conversation-navigator" aria-label="对话导航">
    <div className="conversation-navigator-rail" ref={railRef}>
      {turns.map((turn, index) => (
        <button type="button" key={turn.id} aria-label={labels[index]} aria-current={turn.id === activeId ? 'location' : undefined}
          onMouseEnter={() => setPreviewId(turn.id)} onMouseLeave={() => setPreviewId(undefined)}
          onFocus={() => setPreviewId(turn.id)} onBlur={() => setPreviewId(undefined)}
          onClick={() => jump(turn.id)}>
          <span />
        </button>
      ))}
    </div>
    {preview && <div className="conversation-navigator-preview" aria-hidden="true">{preview}</div>}
  </nav>;
}
