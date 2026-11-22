import { Fragment, memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Collection, Repo, SortKey, StarsData } from './types';

const PAGE = 80;
const TOP_LANGS = 12;

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'starred', label: 'Recent' },
  { key: 'stars', label: 'Popular' },
  { key: 'updated', label: 'Active' },
  { key: 'name', label: 'A–Z' },
];

const COLLECTIONS: { key: Collection; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'starred', label: 'Starred' },
  { key: 'archive', label: 'Archive' },
];

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

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

function readParams() {
  const p = new URLSearchParams(location.search);
  const c = p.get('c');
  return {
    q: p.get('q') ?? '',
    collection: (c === 'starred' || c === 'archive' ? c : 'all') as Collection,
    list: p.get('list') ?? 'all',
    lang: p.get('lang') ?? 'all',
    sort: (p.get('sort') as SortKey) ?? 'starred',
    readOnly: p.get('readonly') !== '0',
  };
}

export default function App() {
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
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      if (e.key === '/' && !typing) {
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

  if (error) return <div className="state">Couldn't load stars. {error}</div>;
  if (!data) return <div className="state">Loading…</div>;

  const activeList = sortedLists.find((l) => l.slug === list);
  const isFiltered = Boolean(query || collection !== 'all' || list !== 'all' || lang !== 'all' || !showReadOnly);
  const reset = () => {
    setQuery('');
    setCollection('all');
    setList('all');
    setLang('all');
    setShowReadOnly(true);
  };
  const shownLangs = allLangs ? languages : languages.slice(0, TOP_LANGS);
  const pickLang = (l: string) => setLang((cur) => (cur === l ? 'all' : l));
  const collectionCount = (c: Collection) =>
    c === 'all' ? items.length : c === 'starred' ? data.stars.length : archiveCount;

  const visible = filtered.slice(0, limit);
  const grouped = sort === 'starred';

  const title = activeList ? listLabel(activeList.name) : null;
  const heading = title ? (
    <>
      {title.split(' ').slice(0, -1).join(' ')} <em>{title.split(' ').at(-1)}</em>
    </>
  ) : collection === 'archive' ? (
    <>
      The <em>archive</em>
    </>
  ) : (
    <>
      Things worth <em>starring</em>
    </>
  );

  return (
    <div className="shell">
      <aside className="side">
        <a className="mark" href={`https://github.com/${data.user}`} target="_blank" rel="noreferrer">
          <span className="mark-star">✦</span> {data.user}
        </a>

        <nav aria-label="Collection">
          <p className="side-label">Collection</p>
          <ul>
            {COLLECTIONS.map((c) => (
              <li key={c.key}>
                <button aria-pressed={collection === c.key} onClick={() => setCollection(c.key)}>
                  <span className="lbl">{c.label}</span>
                  <span className="num">{collectionCount(c.key)}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <nav className="index" aria-label="Lists">
          <p className="side-label">Lists</p>
          <ol>
            <li>
              <button aria-pressed={list === 'all'} onClick={() => setList('all')}>
                <span className="idx">00</span>
                <span className="lbl">All lists</span>
                <span className="num">{inCollection.length}</span>
              </button>
            </li>
            {sortedLists.filter((l) => listCounts.get(l.slug) || l.slug === list).map((l, i) => {
              const active = list === l.slug;
              return (
                <li key={l.slug}>
                  <button aria-pressed={active} onClick={() => setList(active ? 'all' : l.slug)}>
                    <span className="idx">{String(i + 1).padStart(2, '0')}</span>
                    <span className="lbl">{listLabel(l.name)}</span>
                    <span className="num">{listCounts.get(l.slug) ?? 0}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <nav className="langs" aria-label="Languages">
          <p className="side-label">Languages</p>
          <ul>
            {shownLangs.map(([l, { n, color }]) => (
              <li key={l}>
                <button aria-pressed={lang === l} onClick={() => pickLang(l)}>
                  <span className="dot" style={{ background: color ?? 'var(--muted)' }} />
                  <span className="lbl">{l}</span>
                  <span className="num">{n}</span>
                </button>
              </li>
            ))}
          </ul>
          {languages.length > TOP_LANGS ? (
            <button className="more-link" onClick={() => setAllLangs((v) => !v)}>
              {allLangs ? 'Fewer' : `All ${languages.length} languages`}
            </button>
          ) : null}
        </nav>
      </aside>

      <main className="main">
        <header className="masthead">
          <p className="kicker">
            A field guide to {data.stars.length.toLocaleString()} starred repositories
            {since ? ` since ${since}` : ''}, plus {archiveCount} from the archive
          </p>
          <h1>{heading}</h1>
        </header>

        <div className="controls">
          <label className="search">
            <span className="sr-only">Search</span>
            <input
              ref={searchRef}
              type="search"
              placeholder="Search names, topics, descriptions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            />
            <kbd aria-hidden="true">/</kbd>
          </label>
          <div className="bar">
            <div className="sorts" role="group" aria-label="Sort">
              {SORTS.map((s) => (
                <button key={s.key} aria-pressed={sort === s.key} onClick={() => setSort(s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="bar-right">
              <label className="check" title="Repos their owners archived on GitHub">
                <input type="checkbox" checked={showReadOnly} onChange={(e) => setShowReadOnly(e.target.checked)} />
                Read-only
              </label>
              <span className="tally">
                {filtered.length.toLocaleString()} {filtered.length === 1 ? 'result' : 'results'}
              </span>
              {isFiltered ? (
                <button className="clear" onClick={reset}>
                  Clear
                </button>
              ) : null}
            </div>
          </div>
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
                      <span>{key}</span>
                      <span className="year-count">
                        {groupCounts.get(key)} {key === 'Archive' ? 'previously starred' : 'starred'}
                      </span>
                    </li>
                  ) : null}
                  <Row repo={r} onLang={pickLang} showSource={collection !== 'archive'} />
                </Fragment>
              );
            })}
          </ol>
        ) : (
          <div className="empty">
            <p>
              Nothing matches <em>that</em>.
            </p>
            <button className="clear" onClick={reset}>
              Clear filters
            </button>
          </div>
        )}
        {hasMore ? <div ref={sentinel} className="sentinel" /> : null}

        <footer className="foot">
          <span>
            Updated {new Date(data.generatedAt).toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
          <a href="https://github.com/geocine/awesome" target="_blank" rel="noreferrer">
            Source ↗
          </a>
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
  onLang,
  showSource,
}: {
  repo: Repo;
  onLang: (l: string) => void;
  showSource: boolean;
}) {
  const isRepo = repo.stars != null;
  const [owner, name] = isRepo ? repo.name.split('/') : [null, repo.name];
  return (
    <li className="row">
      {repo.avatar ? (
        <img
          className="avatar"
          src={`${repo.avatar}${repo.avatar.includes('?') ? '&' : '?'}s=56`}
          alt=""
          width="28"
          height="28"
          loading="lazy"
        />
      ) : (
        <span className="avatar monogram" aria-hidden="true">
          {repo.name.replace(/^the\s+/i, '').charAt(0).toUpperCase()}
        </span>
      )}
      <div className="body">
        <a className="title" href={repo.url} target="_blank" rel="noreferrer">
          {owner ? (
            <>
              <span className="owner">{owner}</span>
              <span className="slash">/</span>
            </>
          ) : null}
          <span className="name">{name}</span>
          <span className="arrow" aria-hidden="true">
            ↗
          </span>
        </a>
        {showSource && repo.source === 'archive' ? <span className="tag tag-archive">Archive</span> : null}
        {repo.archived ? (
          <span className="tag" title="Archived by its owner on GitHub">
            Read-only
          </span>
        ) : null}
        {repo.description ? <p className="desc">{repo.description}</p> : null}
      </div>
      <div className="aside">
        {repo.language ? (
          <button className="lang" onClick={() => onLang(repo.language!)} title={`Filter by ${repo.language}`}>
            <span className="dot" style={{ background: repo.languageColor ?? 'var(--muted)' }} />
            {repo.language}
          </button>
        ) : !isRepo ? (
          <span className="domain">{host(repo.url)}</span>
        ) : (
          <span />
        )}
        {repo.stars != null ? (
          <span className="stars" title={`${repo.stars.toLocaleString()} stars`}>
            {compact.format(repo.stars)}
            <span className="star">★</span>
          </span>
        ) : (
          <span />
        )}
      </div>
    </li>
  );
});
