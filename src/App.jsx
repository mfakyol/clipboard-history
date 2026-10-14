import { useEffect, useMemo, useRef, useState } from 'react';
import { fold, tokenize, haystack, matchRanges, snippet } from './search.js';

const api = window.clip;

const FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'pinned', label: 'Pinned', test: (i) => i.pinned },
  { id: 'text', label: 'Text', test: (i) => i.kind === 'text' || i.kind === 'color' },
  { id: 'link', label: 'Links', test: (i) => i.kind === 'link' },
  { id: 'image', label: 'Images', test: (i) => i.kind === 'image' },
];

const APP_NAMES = {
  chrome: 'Chrome',
  msedge: 'Edge',
  firefox: 'Firefox',
  brave: 'Brave',
  opera: 'Opera',
  code: 'VS Code',
  winword: 'Word',
  excel: 'Excel',
  powerpnt: 'PowerPoint',
  outlook: 'Outlook',
  explorer: 'Explorer',
  windowsterminal: 'Terminal',
  notepad: 'Notepad',
  snippingtool: 'Snipping Tool',
  screenclippinghost: 'Snipping Tool',
  slack: 'Slack',
  discord: 'Discord',
  teams: 'Teams',
  'ms-teams': 'Teams',
  figma: 'Figma',
};

function appName(source) {
  if (!source) return '';
  return APP_NAMES[source.toLowerCase()] || source.charAt(0).toUpperCase() + source.slice(1);
}

function timeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function domainOf(url) {
  try {
    return new URL(url.startsWith('www.') ? `https://${url}` : url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Until search is opened, every control is mouse-only and must not grab focus: the window is
// non-activating, so the field you were typing in keeps it.
const noFocus = (e) => e.preventDefault();

function Highlight({ text, tokens }) {
  const ranges = matchRanges(text, tokens);
  if (!ranges.length) return text;
  const out = [];
  let pos = 0;
  ranges.forEach(([a, b], i) => {
    if (a > pos) out.push(text.slice(pos, a));
    out.push(<mark key={i}>{text.slice(a, b)}</mark>);
    pos = b;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

function KindIcon({ item }) {
  if (item.kind === 'color') return <span className="swatch" style={{ background: item.text.trim() }} />;
  const paths = {
    text: 'M4 6h16M4 12h16M4 18h10',
    link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
    image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01',
  };
  return (
    <svg className="kind" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[item.kind]} />
    </svg>
  );
}

function PinIcon({ filled }) {
  return (
    <svg className={`icon ${filled ? 'filled' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4h6l-1 6 3 3v2H7v-2l3-3zM12 15v5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
    </svg>
  );
}

function Row({ item, index, active, tokens, onHover, onPaste }) {
  const action = (fn) => (e) => {
    e.stopPropagation();
    fn(item.id);
  };
  return (
    <li
      data-index={index}
      className={`row ${active ? 'active' : ''}`}
      onMouseDown={noFocus}
      onMouseMove={(e) => (e.movementX || e.movementY) && !active && onHover()}
      onClick={(e) => onPaste(item, e.shiftKey)}
      title="Click to paste · Shift+click for plain text"
    >
      {item.kind === 'image' ? (
        <img className="thumb" src={`clipimg://img/${item.thumb}`} alt="" draggable={false} />
      ) : (
        <KindIcon item={item} />
      )}
      <div className="row-main">
        <div className="row-text">
          {item.kind === 'image' ? (
            <Highlight text={`Image ${item.width}×${item.height}`} tokens={tokens} />
          ) : (
            <Highlight text={snippet(item.text, tokens)} tokens={tokens} />
          )}
        </div>
        <div className="row-meta">
          {[appName(item.source), timeAgo(item.usedAt)].filter(Boolean).join(' · ')}
        </div>
      </div>
      <button
        className={`row-btn ${item.pinned ? 'pinned' : ''}`}
        title={item.pinned ? 'Unpin' : 'Pin'}
        onMouseDown={noFocus}
        onClick={action(api.togglePin)}
      >
        <PinIcon filled={item.pinned} />
      </button>
      <button className="row-btn danger" title="Delete" onMouseDown={noFocus} onClick={action(api.remove)}>
        <TrashIcon />
      </button>
    </li>
  );
}

function Preview({ item, tokens }) {
  if (!item) return <div className="preview empty" />;

  const facts = [];
  if (item.kind === 'image') {
    facts.push(['Size', `${item.width} × ${item.height}`]);
    if (item.bytes) facts.push(['File', formatBytes(item.bytes)]);
  } else {
    const t = item.text;
    facts.push(['Characters', t.length.toLocaleString()]);
    facts.push(['Words', (t.trim().match(/\S+/g) || []).length.toLocaleString()]);
    const lines = t.split(/\r\n|\r|\n/).length;
    if (lines > 1) facts.push(['Lines', lines.toLocaleString()]);
    if (item.html) facts.push(['Format', 'Rich text']);
  }
  if (item.source) facts.push(['Source', appName(item.source)]);
  facts.push(['First copied', timeAgo(item.createdAt)]);
  if (item.copies > 1) facts.push(['Copied', `${item.copies} times`]);
  if (item.pastes) facts.push(['Pasted', `${item.pastes} times`]);

  return (
    <div className="preview">
      <div className="preview-body">
        {item.kind === 'image' && (
          <div className="preview-image">
            <img src={`clipimg://img/${item.image}`} alt="" draggable={false} />
          </div>
        )}
        {item.kind === 'color' && <div className="preview-color" style={{ background: item.text.trim() }} />}
        {item.kind === 'link' && <div className="preview-domain">{domainOf(item.text.trim())}</div>}
        {item.kind !== 'image' && (
          <pre className="preview-text">
            <Highlight text={item.text.slice(0, 20000)} tokens={tokens} />
            {item.text.length > 20000 && <span className="dim">{'\n'}… truncated preview</span>}
          </pre>
        )}
      </div>
      <dl className="facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Two-step so a stray click can't wipe the history: first click arms it for 3 s, second clears.
function ClearButton({ count }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  if (!count) return null;
  return (
    <button
      className={`clear ${armed ? 'armed' : ''}`}
      onMouseDown={noFocus}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        api.clear();
      }}
    >
      {armed ? `Click again to delete ${count} item${count === 1 ? '' : 's'}` : 'Clear history'}
    </button>
  );
}

export default function App() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all');
  const [hovered, setHovered] = useState(0);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [, setTick] = useState(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    api.getHistory().then(setItems);
    const offHistory = api.onHistory(setItems);
    const offShow = api.onShow(() => {
      setFilter('all');
      setHovered(0);
      setSearching(false);
      setQuery('');
      setTick((t) => t + 1); // refresh "x minutes ago"
      listRef.current?.scrollTo(0, 0);
    });
    // Search is opt-in: only now does the palette take focus.
    const offSearch = api.onSearchMode(() => {
      setSearching(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    });
    return () => {
      offHistory();
      offShow();
      offSearch();
    };
  }, []);

  const folded = useMemo(() => new Map(items.map((i) => [i.id, fold(haystack(i))])), [items]);
  const tokens = useMemo(() => (searching ? tokenize(query) : []), [searching, query]);
  const matching = useMemo(
    () => items.filter((i) => tokens.every((t) => folded.get(i.id).includes(t))),
    [items, folded, tokens]
  );
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, matching.filter(f.test).length])),
    [matching]
  );
  const visible = useMemo(() => {
    const list = matching.filter(FILTERS.find((f) => f.id === filter).test);
    // In the Pinned tab, keep pin order so positions stay stable.
    return filter === 'pinned' ? list.sort((a, b) => a.pinnedAt - b.pinnedAt) : list;
  }, [matching, filter]);

  useEffect(() => setHovered(0), [filter, query]);

  const index = Math.min(hovered, Math.max(visible.length - 1, 0));
  const current = visible[index];
  const paste = (item, plain = false) => item && api.paste(item.id, { plain });

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index, visible]);

  // Pressing the shortcut again pastes the hovered item (or the newest one).
  const currentRef = useRef(current);
  currentRef.current = current;
  useEffect(() => api.onPasteSelected(() => paste(currentRef.current)), []);

  // Keyboard only exists in search mode (the palette has focus then); Esc is handled by main.
  const onSearchKey = (e) => {
    const move = (delta) => {
      e.preventDefault();
      setHovered(Math.max(0, Math.min(visible.length - 1, index + delta)));
    };
    if (e.key === 'ArrowDown') return move(1);
    if (e.key === 'ArrowUp') return move(-1);
    if (e.key === 'PageDown') return move(8);
    if (e.key === 'PageUp') return move(-8);
    if (e.key === 'Enter') {
      e.preventDefault();
      paste(current, e.shiftKey);
    }
  };

  return (
    <div className="palette">
      <header className="search">
        {searching ? (
          <>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" />
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Search…  (↑↓ select, Enter paste)"
              spellCheck={false}
            />
          </>
        ) : (
          <button className="search-btn" onMouseDown={noFocus} onClick={() => api.startSearch()}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" />
            </svg>
            Search
            <kbd>Ctrl F</kbd>
          </button>
        )}
      </header>

      <nav className="filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={filter === f.id ? 'on' : ''}
            onMouseDown={(e) => {
              noFocus(e);
              setFilter(f.id);
            }}
          >
            {f.label}
            <span className="count">{counts[f.id]}</span>
          </button>
        ))}
      </nav>

      <main className="body">
        {visible.length ? (
          <>
            <ul className="list" ref={listRef}>
              {visible.map((item, i) => (
                <Row
                  key={item.id}
                  item={item}
                  index={i}
                  active={i === index}
                  tokens={tokens}
                  onHover={() => setHovered(i)}
                  onPaste={paste}
                />
              ))}
            </ul>
            <Preview item={current} tokens={tokens} />
          </>
        ) : (
          <div className="empty-state">
            {items.length === 0 ? (
              <>
                <strong>Nothing here yet</strong>
                <span>Copy some text, a link or a screenshot. It will show up here.</span>
              </>
            ) : query ? (
              <>
                <strong>No matches for “{query}”</strong>
                <span>Search ignores case and accents: “cafe” also finds “Café”.</span>
              </>
            ) : (
              <>
                <strong>Nothing in this tab</strong>
                <span>{filter === 'pinned' ? 'Use the pin button on an item to keep it here.' : ''}</span>
              </>
            )}
          </div>
        )}
      </main>

      <footer className="hints">
        <span>Click to paste</span>
        <span><kbd>Shift</kbd> + click: plain text</span>
        <span><kbd>Esc</kbd> close</span>
        <ClearButton count={items.filter((i) => !i.pinned).length} />
      </footer>
    </div>
  );
}
