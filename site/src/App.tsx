import { Fragment, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Collection, Repo, SortKey, StarsData } from './types';

const PAGE = 80;
const TOP_LANGS = 12;

type Theme = 'light' | 'dark';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'starred', label: 'Recent' },
  { key: 'stars', label: 'Popular' },
  { key: 'updated', label: 'Active' },
  { key: 'name', label: 'A–Z' },
];

const COLLECTIONS: { key: Collection; label: string; short: string }[] = [
  { key: 'all', label: 'Everything', short: 'All' },
  { key: 'starred', label: 'Starred', short: 'Starred' },
  { key: 'archive', label: 'Archive', short: 'Archive' },
];

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const monthYear = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' });

/** "🚒 Reverse Engineering" -> "Reverse Engineering" */
const listLabel = (name: string) => name.replace(/^\S+\s+/, '');
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
/** Header a row falls under in the "Recent" view. */
const groupKey = (r: Repo) => (r.starredAt ? r.starredAt.slice(0, 4) : 'Archive');

function formatMonthYear(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : monthYear.format(d);
}

function readParams() {
  const p = new URLSearchParams(location.search);
  const c = p.get('c');
  const s = p.get('sort');
  return {
    q: p.get('q') ?? '',
    collection: (c === 'starred' || c === 'archive' ? c : 'all') as Collection,
    list: p.get('list') ?? 'all',
    lang: p.get('lang') ?? 'all',
    sort: (s === 'stars' || s === 'updated' || s === 'name' ? s : 'starred') as SortKey,
    readOnly: p.get('readonly') !== '0',
  };
}

function getInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.dataset.theme;
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      try {
        if (!localStorage.getItem('theme')) {
          setTheme(e.matches ? 'dark' : 'light');
        }
      } catch {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('theme', next);
      } catch {
        // Ignore storage errors in private contexts.
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [data, setData] = useState<StarsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initial] = useState(readParams);
  const [query, setQuery] = useState(initial.q);
  const [collection, setCollection] = useState<Collection>(initial.collection);
  const [list, setList] = useState(initial.list);
  const [lang, setLang] = useState(initial.lang);
  const [sort, setSort] = useState<SortKey>(initial.sort);
  const [showReadOnly, setShowReadOnly] = useState(initial.readOnly);
  const [allLangs, setAllLangs] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const deferredQuery = useDeferredValue(query);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/stars.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  // "/" focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement;
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Keep filters in the URL so a filtered view can be shared.
  useEffect(() => {
    const p = new URLSearchParams();
    if (query) p.set('q', query);
    if (collection !== 'all') p.set('c', collection);
    if (list !== 'all') p.set('list', list);
    if (lang !== 'all') p.set('lang', lang);
    if (sort !== 'starred') p.set('sort', sort);
    if (!showReadOnly) p.set('readonly', '0');
    const qs = p.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }, [query, collection, list, lang, sort, showReadOnly]);

  // Starred repos first (newest star first), then the archive in its curated order.
  const items = useMemo(() => (data ? [...data.stars, ...(data.archive ?? [])] : []), [data]);
  const archiveCount = data?.archive?.length ?? 0;

  const haystacks = useMemo(() => {
    const m = new Map<Repo, string>();
    for (const r of items) {
      m.set(
        r,
        `${r.name} ${r.description ?? ''} ${r.topics.join(' ')} ${r.language ?? ''} ${r.source === 'archive' ? host(r.url) : ''}`.toLowerCase(),
      );
    }
    return m;
  }, [items]);

  const inCollection = useMemo(
    () => (collection === 'all' ? items : items.filter((r) => r.source === collection)),
    [items, collection],
  );

  const listCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of inCollection) for (const s of r.lists) m.set(s, (m.get(s) ?? 0) + 1);
    return m;
  }, [inCollection]);

  const sortedLists = useMemo(
    () => (data?.lists ?? []).toSorted((a, b) => (listCounts.get(b.slug) ?? 0) - (listCounts.get(a.slug) ?? 0)),
    [data, listCounts],
  );

  const languages = useMemo(() => {
    const counts = new Map<string, { n: number; color: string | null }>();
    for (const r of inCollection) {
      if (list !== 'all' && !r.lists.includes(list)) continue;
      const l = r.language ?? 'Other';
      const c = counts.get(l);
      if (c) c.n++;
      else counts.set(l, { n: 1, color: r.languageColor });
    }
    return [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [inCollection, list]);

  const filtered = useMemo(() => {
    const terms = deferredQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const out = inCollection.filter((r) => {
      if (list !== 'all' && !r.lists.includes(list)) return false;
      if (lang !== 'all' && (r.language ?? 'Other') !== lang) return false;
      if (!showReadOnly && r.archived) return false;
      if (!terms.length) return true;
      const h = haystacks.get(r)!;
      return terms.every((t) => h.includes(t));
    });
    switch (sort) {
      case 'stars':
        return out.toSorted((a, b) => (b.stars ?? -1) - (a.stars ?? -1));
      case 'updated':
        return out.toSorted((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''));
      case 'name':
        return out.toSorted((a, b) => displayName(a).localeCompare(displayName(b), 'en', { sensitivity: 'base' }));
      default:
        return out;
    }
  }, [inCollection, haystacks, deferredQuery, list, lang, sort, showReadOnly]);

  const [prevFiltered, setPrevFiltered] = useState(filtered);
  if (prevFiltered !== filtered) {
    setPrevFiltered(filtered);
    setLimit(PAGE);
  }

  const groupCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of filtered) m.set(groupKey(r), (m.get(groupKey(r)) ?? 0) + 1);
    return m;
  }, [filtered]);

  const since = useMemo(() => data?.stars.at(-1)?.starredAt?.slice(0, 4), [data]);

  const sentinel = useRef<HTMLDivElement>(null);
  const hasMore = limit < filtered.length;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setLimit((n) => n + PAGE);
      },
      { rootMargin: '1200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, limit, filtered]);

  const pickLang = useCallback((l: string) => setLang((cur) => (cur === l ? 'all' : l)), []);

  if (error) return <div className="state">Couldn’t load stars. {error}</div>;
  if (!data) return <div className="state">Loading…</div>;

  const activeList = sortedLists.find((l) => l.slug === list);
  const activeLangMeta = lang !== 'all' ? languages.find(([l]) => l === lang)?.[1] : undefined;
  const hasFacetFilters = collection !== 'all' || list !== 'all' || lang !== 'all' || !showReadOnly;
  const isFiltered = Boolean(query || hasFacetFilters);
  const reset = () => {
    setQuery('');
    setCollection('all');
    setList('all');
    setLang('all');
    setShowReadOnly(true);
  };
  const shownLangs = allLangs ? languages : languages.slice(0, TOP_LANGS);
  const collectionCount = (c: Collection) =>
    c === 'all' ? items.length : c === 'starred' ? data.stars.length : archiveCount;

  const visible = filtered.slice(0, limit);
  const grouped = sort === 'starred';
  const heading = activeList ? listLabel(activeList.name) : collection === 'archive' ? 'Archive' : 'Stars';

  return (
    <div className="shell">
      <aside className="side">
        <div className="side-head">
          <a className="mark" href={`https://github.com/${data.user}`} target="_blank" rel="noreferrer">
            <span className="mark-handle">{data.user}</span>
            <span className="mark-sep" aria-hidden="true">/</span>
            <span className="mark-sub">awesome</span>
          </a>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>

        <div className="segmented" role="group" aria-label="Collection">
          {COLLECTIONS.map((c) => (
            <button
              key={c.key}
              aria-pressed={collection === c.key}
              onClick={() => setCollection(c.key)}
              title={`${c.label} (${collectionCount(c.key).toLocaleString()})`}
            >
              {c.short}
            </button>
          ))}
        </div>

        <nav className="side-nav" aria-label="Lists">
          <p className="side-label">Lists</p>
          <ul>
            <li>
              <button aria-pressed={list === 'all'} onClick={() => setList('all')}>
                <span className="lbl">All lists</span>
                <span className="num">{inCollection.length}</span>
              </button>
            </li>
            {sortedLists
              .filter((l) => listCounts.get(l.slug) || l.slug === list)
              .map((l) => {
                const active = list === l.slug;
                return (
                  <li key={l.slug}>
                    <button aria-pressed={active} onClick={() => setList(active ? 'all' : l.slug)}>
                      <span className="lbl">{listLabel(l.name)}</span>
                      <span className="num">{listCounts.get(l.slug) ?? 0}</span>
                    </button>
                  </li>
                );
              })}
          </ul>
        </nav>

        <nav className="side-nav langs" aria-label="Languages">
          <p className="side-label">Languages</p>
          <ul>
            {shownLangs.map(([l, { n, color }]) => (
              <li key={l}>
                <button aria-pressed={lang === l} onClick={() => pickLang(l)}>
                  <span className="dot" style={{ background: color ?? 'var(--muted-2)' }} />
                  <span className="lbl">{l}</span>
                  <span className="num">{n}</span>
                </button>
              </li>
            ))}
          </ul>
          {languages.length > TOP_LANGS ? (
            <button className="more-link" onClick={() => setAllLangs((v) => !v)}>
              {allLangs ? 'Show fewer' : `Show all ${languages.length}`}
            </button>
          ) : null}
        </nav>
      </aside>

      <main className="main">
        <div className="mobile-bar">
          <a className="mark" href={`https://github.com/${data.user}`} target="_blank" rel="noreferrer">
            <span className="mark-handle">{data.user}</span>
            <span className="mark-sep" aria-hidden="true">/</span>
            <span className="mark-sub">awesome</span>
          </a>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>

        <header className="masthead">
          <h1>{heading}</h1>
          <p className="lede">
            {data.stars.length.toLocaleString()} repositories starred{since ? ` since ${since}` : ''}
            <span className="lede-dot" aria-hidden="true">·</span>
            {archiveCount} archived bookmarks
          </p>
        </header>

        <div className="controls">
          <div className="search-wrap">
            <label className="search">
              <span className="sr-only">Search repositories</span>
              <IconSearch />
              <input
                ref={searchRef}
                type="search"
                placeholder="Search repositories, topics, descriptions…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    if (query) setQuery('');
                    else e.currentTarget.blur();
                  }
                }}
              />
              {query ? (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => {
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                  aria-label="Clear search"
                >
                  <IconClose />
                </button>
              ) : (
                <kbd aria-hidden="true">/</kbd>
              )}
            </label>
          </div>

          <div className="bar">
            <div className="sorts" role="group" aria-label="Sort">
              {SORTS.map((s) => (
                <button key={s.key} aria-pressed={sort === s.key} onClick={() => setSort(s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="bar-right">
              <label className="check" title="Include repositories archived by their owners on GitHub">
                <input type="checkbox" checked={showReadOnly} onChange={(e) => setShowReadOnly(e.target.checked)} />
                <span className="check-box" aria-hidden="true">
                  {showReadOnly ? <IconCheck /> : null}
                </span>
                <span>Read-only</span>
              </label>
              <span className="tally" aria-live="polite">
                {filtered.length.toLocaleString()}
              </span>
              {isFiltered ? (
                <button className="clear" onClick={reset}>
                  Reset
                </button>
              ) : null}
            </div>
          </div>

          {hasFacetFilters ? (
            <div className="chips" aria-label="Active filters">
              {collection !== 'all' ? (
                <button className="chip" onClick={() => setCollection('all')}>
                  <span>{collection === 'starred' ? 'Starred' : 'Archive'}</span>
                  <IconClose />
                </button>
              ) : null}
              {activeList ? (
                <button className="chip" onClick={() => setList('all')}>
                  <span>{listLabel(activeList.name)}</span>
                  <IconClose />
                </button>
              ) : null}
              {lang !== 'all' ? (
                <button className="chip" onClick={() => setLang('all')}>
                  <span className="dot" style={{ background: activeLangMeta?.color ?? 'var(--muted-2)' }} />
                  <span>{lang}</span>
                  <IconClose />
                </button>
              ) : null}
              {!showReadOnly ? (
                <button className="chip" onClick={() => setShowReadOnly(true)}>
                  <span>Hiding read-only</span>
                  <IconClose />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Mobile-only filters; the sidebar is hidden on small screens. */}
        <div className="mobile-filters">
          <select value={collection} onChange={(e) => setCollection(e.target.value as Collection)} aria-label="Collection">
            {COLLECTIONS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label} ({collectionCount(c.key)})
              </option>
            ))}
          </select>
          <select value={list} onChange={(e) => setList(e.target.value)} aria-label="List">
            <option value="all">All lists ({inCollection.length})</option>
            {sortedLists.map((l) => (
              <option key={l.slug} value={l.slug}>
                {listLabel(l.name)} ({listCounts.get(l.slug) ?? 0})
              </option>
            ))}
          </select>
          <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
            <option value="all">All languages</option>
            {languages.map(([l, { n }]) => (
              <option key={l} value={l}>
                {l} ({n})
              </option>
            ))}
          </select>
        </div>

        {visible.length ? (
          <ol className="rows">
            {visible.map((r, i) => {
              const key = grouped ? groupKey(r) : null;
              const prev = grouped && i > 0 ? groupKey(visible[i - 1]) : null;
              return (
                <Fragment key={r.url}>
                  {key && key !== prev ? (
                    <li className="year" aria-hidden="true">
                      <span className="year-label">{key}</span>
                      <span className="year-rule" />
                      <span className="year-count">{groupCounts.get(key)}</span>
                    </li>
                  ) : null}
                  <Row
                    repo={r}
                    activeLang={lang}
                    onLang={pickLang}
                    showSource={collection !== 'archive'}
                    showUpdated={sort === 'updated'}
                  />
                </Fragment>
              );
            })}
          </ol>
        ) : (
          <div className="empty">
            <p className="empty-title">No matching repositories</p>
            <p className="empty-sub">Try broadening your query or clearing active filters.</p>
            <button className="empty-reset" onClick={reset}>
              Reset filters
            </button>
          </div>
        )}
        {hasMore ? <div ref={sentinel} className="sentinel" /> : null}

        <footer className="foot">
          <span>
            Updated {new Date(data.generatedAt).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          <div className="foot-links">
            <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              Top ↑
            </button>
            <a href="https://github.com/geocine/awesome" target="_blank" rel="noreferrer">
              Source ↗
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}

function displayName(r: Repo) {
  return r.name.includes('/') && r.stars != null ? r.name.split('/')[1] : r.name;
}

const Row = memo(function Row({
  repo,
  activeLang,
  onLang,
  showSource,
  showUpdated,
}: {
  repo: Repo;
  activeLang: string;
  onLang: (l: string) => void;
  showSource: boolean;
  showUpdated: boolean;
}) {
  const isRepo = repo.stars != null;
  const [owner, name] = isRepo ? repo.name.split('/') : [null, repo.name];
  const updated = showUpdated ? formatMonthYear(repo.pushedAt) : null;

  return (
    <li className="row">
      {repo.avatar ? (
        <span className="avatar-frame">
          <img
            className="avatar"
            src={`${repo.avatar}${repo.avatar.includes('?') ? '&' : '?'}s=64`}
            alt=""
            width="30"
            height="30"
            loading="lazy"
          />
        </span>
      ) : (
        <span className="avatar-frame monogram" aria-hidden="true">
          {repo.name.replace(/^the\s+/i, '').charAt(0).toUpperCase()}
        </span>
      )}

      <div className="body">
        <div className="title-line">
          <a className="title" href={repo.url} target="_blank" rel="noreferrer">
            {owner ? (
              <>
                <span className="owner">{owner}</span>
                <span className="slash">/</span>
              </>
            ) : null}
            <span className="name">{name}</span>
            <span className="arrow" aria-hidden="true">
              <IconArrowUpRight />
            </span>
          </a>
          {showSource && repo.source === 'archive' ? <span className="tag">Archive</span> : null}
          {repo.archived ? (
            <span className="tag" title="Archived by its owner on GitHub">
              Read-only
            </span>
          ) : null}
        </div>
        {repo.description ? <p className="desc">{repo.description}</p> : null}
      </div>

      <div className={`aside${updated ? ' has-date' : ''}`}>
        {repo.language ? (
          <button
            className="lang"
            data-active={activeLang === repo.language || undefined}
            onClick={() => onLang(repo.language!)}
            title={`Filter by ${repo.language}`}
          >
            <span className="dot" style={{ background: repo.languageColor ?? 'var(--muted-2)' }} />
            <span>{repo.language}</span>
          </button>
        ) : !isRepo ? (
          <span className="domain">{host(repo.url)}</span>
        ) : (
          <span />
        )}
        {updated ? <span className="pushed">{updated}</span> : null}
        {repo.stars != null ? (
          <span className="stars" title={`${repo.stars.toLocaleString()} stars`}>
            <span>{compact.format(repo.stars)}</span>
            <IconStar />
          </span>
        ) : (
          <span />
        )}
      </div>
    </li>
  );
});

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? <IconSun /> : <IconMoon />}
    </button>
  );
}

function IconSun() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13.4 9.8A5.6 5.6 0 0 1 6.2 2.6a5.8 5.8 0 1 0 7.2 7.2Z" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg className="search-icon" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7.2" cy="7.2" r="4.8" />
      <path d="M10.8 10.8 14 14" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
      <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 6.3 4.9 8.7 9.5 3.6" />
    </svg>
  );
}

function IconStar() {
  return (
    <svg className="star-icon" width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.5l1.95 4.22 4.62.55-3.42 3.16.92 4.57L8 11.72 3.93 14l.92-4.57-3.42-3.16 4.62-.55L8 1.5Z" />
    </svg>
  );
}

function IconArrowUpRight() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 11 11 5M6.2 5H11v4.8" />
    </svg>
  );
}
