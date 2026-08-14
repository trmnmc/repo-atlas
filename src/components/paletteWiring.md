# Wiring `CommandPalette` into `App.tsx`

`CommandPalette.tsx` is self-contained (props in, callbacks out) and its
companion hook `useCommandPalette()` owns the global `Cmd+K` / `Ctrl+K`
listener and the palette's `open` state. `App.tsx` is out of scope for this
item, so it is **not** edited here — this file documents the exact two-line
adoption for whoever applies it (the conductor).

## The two lines

Inside `App()`, alongside the other hooks near the top of the component:

```tsx
const { open, setOpen } = useCommandPalette();
```

Inside the returned JSX, as a sibling of `<main className="app__main">`
(anywhere in the tree works — it renders a fixed-position overlay and
returns `null` while closed):

```tsx
<CommandPalette
  repos={snapshot?.repos ?? []}
  open={open}
  onClose={() => setOpen(false)}
  onNavigate={openRepo}
/>
```

`openRepo` is `App.tsx`'s existing `(repoId: string) => void` callback
(already passed to `Overview`'s `onSelectRepo`) — it sets
`window.location.hash = '#/repo/' + encodeURIComponent(repoId)`, so handing
it straight to `CommandPalette`'s `onNavigate` reuses the same hash-router
navigation the rest of the folio already uses. No new routing logic needed.

## Import

```tsx
import { CommandPalette, useCommandPalette } from './components/CommandPalette.tsx';
```

## Full context (illustrative — not applied by this item)

```tsx
export function App({ transport }: AppProps = {}) {
  const { snapshot: rawSnapshot, scanning, progress, rescan } = useAtlas({ transport });
  const { theme, toggleTheme } = useTheme();
  const { open, setOpen } = useCommandPalette(); // <-- added

  // ...existing route/openRepo/goHome logic unchanged...

  return (
    <div className="app" data-route={route.kind}>
      <Masthead /* ...unchanged... */ />
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
```

## Notes

- `repos` only needs `{ id, name, path }` per entry — a full `RepoSummary[]`
  (or `AtlasRepo[]`) satisfies this structurally; no mapping required.
- The palette manages its own internal state (query text, active row index)
  and resets both whenever `open` flips to `true`.
- Escape, a backdrop click, and a successful Enter/click-to-navigate all
  eventually call `onClose` — `setOpen(false)` is all that needs to happen
  there.
