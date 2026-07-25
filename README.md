# foo_plorg_smp

A reimplementation of foobar2000 v1's `foo_plorg` (playlist organizer /
folder tree) as a foobar2000 v2 Spider Monkey Panel script, written in
TypeScript and bundled to a single flat JS file.

## Status: Phase 2 - static tree rendering

Phase 1 (data layer) is complete and confirmed against a real foobar2000 +
SMP install - see "Verification status" below. Phase 2 adds
non-interactive rendering on top of it: no click/drag/keyboard handling
yet, just drawing the current tree state.

- `src/types/tree.ts` - tree document schema (folders + playlist refs)
- `src/types/flags.ts` - numeric constants copied from the host's
  `Flags.js` reference (colour/font type IDs, `GdiDrawText` format flags)
- `src/data/TreeStore.ts` - load/save the JSON tree file in the foobar
  profile (`%profile%\configuration\foo_plorg_smp.json`), plus index-based
  reconciliation against the live playlist list to self-heal drift
  (playlists reordered/added/removed by anything other than this panel) -
  see "Playlist identity" below
- `src/data/PlaylistSync.ts` - diffs successive playlist-name snapshots to
  tell renames apart from add/remove/reorder, since SMP's
  `on_playlists_changed()` callback fires for all of these with no detail
  about which one happened
- `src/ui/Theme.ts` - resolves the current DUI/CUI font and text/background
  colours, with a `gdi.Font("Segoe UI", 14)` fallback if the host font
  lookup returns null
- `src/ui/TreeLayout.ts` - flattens the (possibly collapsed) tree into the
  linear row list rendering and virtualization both work from
- `src/ui/TreeView.ts` - draws the visible rows only (virtualized against
  `window.Height`), clean indentation (no connector lines), plain-text
  folder disclosure markers (`▾`/`▸` - no icons, per current UX decisions),
  and a visual-only scrollbar
- `src/main.ts` - wires the above together; registers `on_paint`/`on_size`
  in addition to Phase 1's callbacks

## Playlist identity: index, not name

Playlist nodes are keyed by **index**, not name. This was a deliberate
change partway through Phase 2: I confirmed by reviewing the full `plman`
API surface that SMP exposes no stable playlist id anywhere (no
Guid/Uuid/persistent handle - only mutable name and mutable index), so
index is the best primitive available, especially with duplicate playlist
names in play.

The cost is that index isn't *actually* stable either - anything that
reorders, adds, or removes a playlist shifts indices around it. Since
`on_playlists_changed()` fires identically for renames/adds/removes/
reorders with no detail about which happened, `PlaylistSync` +
`TreeStore.reconcile()` together run a two-step self-healing pass on every
firing:

1. **Rename patch** - `PlaylistSync`'s snapshot diff (unchanged from
   Phase 1) identifies same-index renames and patches the tree's cached
   name for that index directly, before anything else runs. This has to
   happen first, or a rename looks indistinguishable from "this playlist
   is gone" to the next step.
2. **Reconcile** - every playlist node is re-validated: if
   `plman.GetPlaylistName(index)` still matches the node's cached name,
   nothing moved. If not, search all playlists not already claimed by
   another node for one whose name matches the cached name, preferring
   the candidate closest to the node's last known index when several
   playlists share that name. No match at all means the playlist is gone.

This makes plain renames and single-playlist reorders self-heal correctly
even with duplicate playlist names in the mix. What it can't do: if two
identically-named playlists are both reordered *and* one of them renamed
within the same host operation, there's no way to tell which node should
end up where - this needs a stable id SMP doesn't provide. Given you've
said you'll manage playlists exclusively through this script once it's
built out, this reconciliation is really a safety net for the main
foobar2000 playlist UI or other panels, not the primary path.

Schema v1 (name-only playlist nodes, no `index` field) loads without any
explicit migration code - a node with a missing/invalid index is treated
exactly like one whose index has drifted, and gets relocated by its cached
name on the first reconcile pass.

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

## Verification status (confirmed against a real foobar2000 + SMP install)

- [x] Panel loads without a script error on first run and imports existing
      playlists as root-level entries (confirmed with 5 pre-existing
      playlists).
- [x] Renaming a playlist via the main UI is logged as a `renamed` event,
      not a remove+add. Confirmed against the original name-keyed design;
      the diff logic (`PlaylistSync.diffPlaylistNames`) is unchanged since,
      but *how* a rename is applied changed with the switch to index-based
      identity (see "Playlist identity" below) - reconfirm that renaming
      still keeps a node in place under the new code path.
- [x] Restarting foobar2000 reloads the same tree from disk, in the same
      order, with the rename persisted - `on_script_unload` -> `saveNow()`
      and the `utils.WriteTextFile`/`ReadTextFile` round-trip both work.
- [x] `Object.assign(globalThis, { on_playlists_changed, ... })` is picked
      up correctly by SMP's callback dispatch despite esbuild's IIFE
      wrapper. This was the biggest unverified assumption in this phase -
      it holds.

**Known benign quirk:** the full startup sequence logs twice the first
time a script edit is applied via the panel's Edit Script dialog. This is
SMP itself running the script once as a trial/validation pass before
committing it to the panel, then once for real - not a bug here, and it
does not recur on a normal foobar2000 restart. Confirmed harmless since
`initialize()`/`reconcile()` are idempotent.

## Phase 2 verification checklist (needs a real foobar2000 + SMP install -
unconfirmed as of this build)

- [ ] Panel draws the reconciled tree as plain text, correctly indented,
      with `▾`/`▸` prefixes on folders (none exist yet on a first run -
      create one via editing `foo_plorg_smp.json` by hand to check, since
      folder creation UI is Phase 6).
- [ ] Font and colours match the surrounding DUI/CUI theme rather than
      falling back to Segoe UI / black - confirms `resolveTheme()` picked
      the right `InstanceType` branch.
- [ ] Add enough dummy playlists (or shrink the panel) to exceed one
      screen of rows - confirms virtualization only draws visible rows
      (watch for missing/misaligned rows, not just a crash) and that the
      scrollbar thumb appears, sized/positioned plausibly, at
      `scrollOffsetPx = 0` (nothing sets it yet, so it should always sit
      at the top).
- [ ] Resize the panel - confirms `on_size` fires without error (it
      currently does nothing observable, this just checks it's wired).
- [ ] Reorder a playlist via drag in the main playlist tabs (or
      `plman.MovePlaylist` from another script) - confirms
      `TreeStore.reconcile()`'s name-based relocation correctly finds the
      playlist at its new index and the tree node stays put logically
      (check the console log for a `relocated` entry). Try once with a
      uniquely-named playlist and once with a duplicate name to see the
      "closest index" tie-break in action.

## Known limitations (by design, for this phase)

- Playlist identity and reorder self-healing have real limits with
  duplicate names combined with simultaneous renames - see "Playlist
  identity" above for the full explanation.
- No click/drag/keyboard handling, no context menu, no folder creation UI
  yet - the tree can currently only grow folders by hand-editing the JSON
  file. That's Phases 3-6.
- Colours/fonts are read once at startup - `on_colours_changed` and
  `on_font_changed` aren't wired up yet, so live theme changes in
  DUI/CUI preferences won't be reflected until the panel reloads.

## Next: Phase 3

Selection and keyboard navigation: click to select, ctrl/shift
multi-select, arrow-key navigation, and click-to-expand/collapse on
folders - the first phase where the panel responds to input at all.
