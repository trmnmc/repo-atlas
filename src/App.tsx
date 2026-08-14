/**
 * App — the folio shell: masthead, hash routing, and the one place the
 * snapshot is loaded.
 *
 * Routes (hash-only; this is a local, file-served SPA with no history API
 * dependency and no server-side route table):
 *   #/            -> Overview
 *   #/repo/<id>   -> RepoDetail for that RepoSummary.id
 * Anything else falls back to the Overview rather than 404-ing.
 *
 * The shell owns three pieces of state the views are deliberately kept
 * ignorant of:
 *   - the Snapshot, via the frozen useAtlas hook (transport injectable so
 *     tests can drive scan progress without an EventSource)
 *   - `aggregateCommitDays`, the sum of every repo's commitDays, memoized
 *     so the 371-cell heatmap and the 52-week timeline both read one map
 *   - `filterDay`, the AGGREGATE side of the cross-filter steal: Fig. 2's
 *     heatmap emits a day, Fig. 3's timeline narrows to it, clicking the
 *     same day again clears it. (RepoDetail keeps its own, per-repo copy of
 *     the same steal — the two never share a value.)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtlas } from './hooks/useAtlas.ts';
import type { AtlasTransport, Snapshot } from './hooks/useAtlas.ts';
import { useTheme } from './hooks/useTheme.ts';
import { Overview } from './views/Overview.tsx';
import type { AtlasRepo, AtlasSnapshot } from './views/Overview.tsx';
import { RepoDetail } from './views/RepoDetail.tsx';
import { CommandPalette, useCommandPalette } from './components/CommandPalette.tsx';
import { CSS, dayKey } from '../shared/contract.js';

export type Route = { kind: 'overview' } | { kind: 'repo'; id: string };

/** `#/repo/<id>` -> the repo route; everything else -> the overview. */
export function parseHash(hash: string): Route {
  const match = /^#\/repo\/(.+)$/.exec(hash ?? '');
  if (match && match[1]) {
    return { kind: 'repo', id: decodeURIComponent(match[1]) };
  }
  return { kind: 'overview' };
}

/**
 * Sum of every repo's sparse commitDays map. Keys absent from a repo simply
 * contribute nothing, so the result stays sparse too.
 */
export function aggregateCommitDays(repos: AtlasRepo[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const repo of repos ?? []) {
    for (const [day, count] of Object.entries(repo.commitDays ?? {})) {
      if (!Number.isFinite(count)) continue;
      total[day] = (total[day] ?? 0) + count;
    }
  }
  return total;
}

/**
 * useAtlas types Snapshot.repos/attention as unknown[] (it never inspects
 * them). The shell is where that widened payload becomes the typed folio
 * snapshot the views consume — one narrowing, in one place.
 */
function asAtlasSnapshot(snapshot: Snapshot | null): AtlasSnapshot | null {
  return snapshot as AtlasSnapshot | null;
}

export interface AppProps {
  /**
   * Forwarded to useAtlas. Omit in the browser (the hook builds its own
   * EventSource transport); tests inject a mock to drive scan progress.
   */
  transport?: AtlasTransport | null;
}

function Masthead({
  generatedAt,
  theme,
  onToggleTheme,
}: {
  generatedAt: string | null;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}) {
  return (
    <header className="masthead">
      <div className="masthead__rule masthead__rule--heavy" aria-hidden="true" />
      <div className="masthead__plate">
        <h1 className="masthead__title">
          <a className="masthead__home" href="#/">
            Repo Atlas
          </a>
        </h1>
        <p className="masthead__subtitle">A Survey of the Projects Directory</p>
        <button
          type="button"
          className="masthead__theme"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          data-theme-state={theme}
        >
          <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
        </button>
      </div>
      <div className="masthead__rule" aria-hidden="true" />
      <p className="masthead__edition">
        <span className="masthead__edition-label">Edition of</span>
        <span className={`masthead__edition-date ${CSS.sounding}`} data-generated-at={generatedAt ?? ''}>
          {generatedAt ? dayKey(generatedAt) : '····-··-··'}
        </span>
        <span className="masthead__edition-label">drawn from local git only</span>
      </p>
    </header>
  );
}

export function App({ transport }: AppProps = {}) {
  const { snapshot: rawSnapshot, scanning, progress, rescan } = useAtlas({ transport });
  const { theme, toggleTheme } = useTheme();

  const [route, setRoute] = useState<Route>(() =>
    parseHash(typeof window === 'undefined' ? '' : window.location.hash),
  );
  const [filterDay, setFilterDay] = useState<string | undefined>(undefined);

  useEffect(() => {
    function syncRoute() {
      setRoute(parseHash(window.location.hash));
    }
    window.addEventListener('hashchange', syncRoute);
    syncRoute();
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);

  const snapshot = asAtlasSnapshot(rawSnapshot);
  const { open, setOpen } = useCommandPalette();

  const aggregate = useMemo(
    () => aggregateCommitDays(snapshot?.repos ?? []),
    [snapshot],
  );

  const handleDayClick = useCallback((day: string) => {
    setFilterDay((current) => (current === day ? undefined : day));
  }, []);

  const openRepo = useCallback((repoId: string) => {
    window.location.hash = `#/repo/${encodeURIComponent(repoId)}`;
  }, []);

  const goHome = useCallback(() => {
    window.location.hash = '#/';
  }, []);

  const handleRescan = useCallback(() => {
    void rescan();
  }, [rescan]);

  // A snapshot with generatedAt === null means the server has never
  // completed a scan (server/index.js's emptySnapshot()) — that is still
  // "no survey yet", not a real (epoch-dated) result, so it must take the
  // loading branch just like a null snapshot does.
  let main;
  if (!snapshot || snapshot.generatedAt == null) {
    main = (
      <p className="app__loading" role="status">
        Surveying the projects directory…
      </p>
    );
  } else if (route.kind === 'repo') {
    const repo = (snapshot.repos ?? []).find((candidate) => candidate.id === route.id);
    main = repo ? (
      <RepoDetail repo={repo} onBack={goHome} />
    ) : (
      <div className="app__missing">
        <p>No repository charted under “{route.id}”.</p>
        <button type="button" className="app__missing-back" onClick={goHome}>
          &larr; Back to atlas
        </button>
      </div>
    );
  } else {
    main = (
      <Overview
        snapshot={snapshot}
        aggregateCommitDays={aggregate}
        filterDay={filterDay}
        onDayClick={handleDayClick}
        scanning={scanning}
        progress={progress}
        onRescan={handleRescan}
        onSelectRepo={openRepo}
      />
    );
  }

  return (
    <div className="app" data-route={route.kind}>
      <Masthead
        generatedAt={snapshot?.generatedAt ?? null}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <main className="app__main">{main}</main>
      <footer className="app__colophon">
        <span>Repo Atlas — surveyed locally; no network, no remotes consulted.</span>
      </footer>
      <CommandPalette
        repos={snapshot?.repos ?? []}
        open={open}
        onClose={() => setOpen(false)}
        onNavigate={openRepo}
      />
    </div>
  );
}

export default App;
