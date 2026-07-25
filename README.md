# foo_plorg_smp

A reimplementation of foobar2000 v1's `foo_plorg` (playlist organizer /
folder tree) as a foobar2000 v2 Spider Monkey Panel script, written in
TypeScript and bundled to a single flat JS file.

## Status: Phase 1 - data layer

No UI yet. This phase implements and (partially) verifies the tree
persistence and playlist-sync logic in isolation:

- `src/types/tree.ts` - tree document schema (folders + playlist refs)
- `src/data/TreeStore.ts` - load/save the JSON tree file in the foobar
  profile (`%profile%\configuration\foo_plorg_smp.json`), plus
  reconciliation against the live playlist list to handle drift (playlists
  created/removed/renamed by anything other than this panel)
- `src/data/PlaylistSync.ts` - diffs successive playlist-name snapshots to
  tell renames apart from add/remove pairs, since SMP's
  `on_playlists_changed()` callback fires for all of these with no detail
  about which one happened
- `src/main.ts` - wires the above together; currently just logs the
  reconciled tree and sync events to the SMP console for verification

## Setup

```
npm install
```

## Build

```
npm run build           # typecheck + build dist/foo_plorg_smp.js (readable)
npm run build:release   # same, minified
npm run watch           # rebuild on save
```

Load `dist/foo_plorg_smp.js` into a Spider Monkey Panel (panel context
menu > Edit Script, or point the panel at the file directly).

## Verification checklist (needs a real foobar2000 + SMP install - not
available in the environment this was built in, so these are unconfirmed)

- [ ] Panel loads without a script error on a clean profile (no existing
      `foo_plorg_smp.json`) - should log an empty tree.
- [ ] Console shows the reconciled tree listing all existing playlists as
      root-level "added orphan" entries on first run.
- [ ] Renaming a playlist via the main UI's playlist tabs is logged as a
      `renamed` event, not a remove+add - confirms the index-position
      rename heuristic in `PlaylistSync.diffPlaylistNames` holds up
      against the real host, not just the assumption in its doc comment.
- [ ] Restarting foobar2000 reloads the same tree from disk (confirms
      `on_script_unload` -> `saveNow()` actually fires and
      `utils.WriteTextFile`/`ReadTextFile` round-trip correctly).
- [ ] **Most important, and the biggest unverified assumption in this
      phase**: confirm `Object.assign(globalThis, { on_playlists_changed,
      ... })` is actually equivalent to a top-level `function
      on_playlists_changed() {}` declaration from the host's point of
      view, despite esbuild's IIFE wrapper. If SMP's callback dispatch
      turns out to use something other than a plain global-object property
      lookup, this whole registration approach needs rethinking (e.g.
      switching the esbuild format so top-level function declarations
      aren't wrapped at all).

## Known limitations (by design, for this phase)

- Playlists are matched by **name**, not a stable ID (SMP doesn't expose
  one). Duplicate playlist names are handled by first-available matching
  during reconciliation - see doc comments in `TreeStore.reconcile()`.
- Rename detection assumes a single playlist rename fires
  `on_playlists_changed()` in isolation, with the playlist's index
  unchanged. A rename that happens to occur in the same host operation as
  an unrelated add/remove elsewhere in the list may be misread as a
  remove+add instead - see `PlaylistSync.diffPlaylistNames()` doc comment.
- No UI, no drag-and-drop, no context menu yet - that's Phases 2-6.

## Next: Phase 2

Static (non-interactive) virtualized tree rendering: indentation,
folder/playlist icons, tree-line connectors, scrollbar - on top of the
data layer above, no click/drag handling yet.
