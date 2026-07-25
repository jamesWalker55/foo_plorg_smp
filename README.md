# foo_plorg_smp

A reimplementation of foobar2000 v1's `foo_plorg` (playlist organizer /
folder tree) as a foobar2000 v2 Spider Monkey Panel script, written in
TypeScript and bundled to a single flat JS file.

## Status: Phase 3 - selection, keyboard navigation, playlist activation

Phases 1 (data layer) and 2 (static rendering) are complete and confirmed
against a real foobar2000 + SMP install - see "Verification status"
below. Phase 3 makes the panel respond to input for the first time.

- `src/types/tree.ts` - tree document schema (folders + playlist refs).
  Schema bumped to v3 in this phase: every node now carries a stable `id`
  (see below for why).
- `src/types/flags.ts` - numeric constants copied from the host's
  `Flags.js` reference (colour/font type IDs, `GdiDrawText` format flags,
  mouse-mask/`DlgCode`/virtual-key constants added this phase)
- `src/data/TreeStore.ts` - load/save the JSON tree file in the foobar
  profile (`%profile%\configuration\foo_plorg_smp.json`), plus
  index-based reconciliation against the live playlist list - see
  "Playlist identity" below. This phase adds `setFolderExpanded()` and
  `findNodeById()`, and backfills missing/colliding node ids on load.
- `src/ui/Theme.ts` - resolves the current DUI/CUI font and
  text/background/**selection** colours (selection colours added this
  phase), with a `gdi.Font("Segoe UI", 14)` fallback if the host font
  lookup returns null
- `src/ui/TreeLayout.ts` - flattens the (possibly collapsed) tree into the
  linear row list rendering, hit-testing, and keyboard nav all work from;
  now also records each row's parent folder (for Left-arrow-to-parent)
- `src/ui/Selection.ts` - **new this phase.** Tracks selected node ids,
  keyboard focus, and the shift-click/shift-arrow range anchor, keyed by
  node id rather than row index or object reference (both are unstable
  across a reconcile() pass - see "Why node ids" below)
- `src/ui/TreeView.ts` - draws the visible rows (virtualized against
  `window.Height`), highlighting selected rows; hit-tests mouse clicks
  against rows and (for folders) a fixed-width glyph zone; handles
  click/double-click/arrow-key/Enter input; activates a playlist via
  `plman.ActivePlaylist` on click (if `options.activateOnSingleClick`) or
  double-click (always)
- `src/main.ts` - wires the above together; sets `window.DlgCode` so
  arrow keys actually reach the panel; registers
  `on_mouse_lbtn_down`/`on_mouse_lbtn_dblclk`/`on_key_down` in addition to
  earlier phases' callbacks

## Why node ids (schema v3)

Selection needs to track "the same node" across renders and across
`reconcile()` calls. Playlist nodes already have a natural handle
(`index`), but folder nodes don't, and worse: `reconcile()`'s `walk()`
rebuilds every folder object via spread (`{ ...node, children: ... }`) on
every single pass, whether or not that folder actually changed - so even
object reference isn't stable for folders from one `on_playlists_changed`
firing to the next. Rather than rework `reconcile()` to preserve
references only when nothing changed, every node now carries a small
stable `id: string` (a monotonic per-document counter, see
`generateNodeId()`), used solely for UI state - selection, keyboard
focus, and (later) drag-and-drop/context-menu targeting. It is completely
independent of playlist `index`. Schema v1/v2 files missing this field
get ids backfilled automatically on load.

## Playlist identity: index, not name - and no reorder self-healing

Playlist nodes are keyed by **index**, not name. I confirmed by reviewing
the full `plman` API surface that SMP exposes no stable playlist id
anywhere (no Guid/Uuid/persistent handle - only mutable name and mutable
index), so index is the best primitive available, especially with
duplicate playlist names in play.

Index isn't *actually* stable either, though - reordering, adding, or
removing a playlist shifts indices around it, and `on_playlists_changed()`
fires identically for all of these with no detail about which happened.
An earlier version of `TreeStore.reconcile()` tried to self-heal this by
searching for a playlist whose name matched a node's cached name when its
index no longer checked out. That was abandoned: **a swap between two
identically-named playlists produces zero observable change** in the name
list SMP exposes - there's nothing for any name-based heuristic to even
detect, let alone correct, in that case. Partial coverage (working for
unique names, silently failing for duplicates) was judged worse than a
plainly-stated limitation, so the search was removed rather than kept as
a false sense of safety.

**Current design assumption: this panel is the exclusive way playlists get
created, renamed, removed, or reordered.** Using foobar2000's built-in
playlist manager (or another panel/script) to reorder or remove playlists
while this tree exists is unsupported and can silently desync tree nodes.
`reconcile()` still handles what's reliably detectable with index alone:

- **Rename** - index unchanged, name differs: cached name is refreshed in
  place, reported in `renamed`. This is the one case that's genuinely
  robust regardless of duplicate names, since it needs no searching at
  all - the index tells you exactly which node to update.
- **Append** - a playlist index beyond any currently tracked appears:
  added as a new root-level orphan node, reported in `addedOrphans`.
- **Truncation** - a node's index is now out of range because the
  playlist count shrank to or past it: dropped, reported in `removed`.

Anything else - a mid-list removal, an insertion, or a reorder - shifts
indices out from under existing nodes with no detection or correction at
all. Once this script's own create/rename/delete/move commands exist
(Phases 4-6), that's a non-issue for normal use, since the script updates
its own tree directly and authoritatively instead of inferring anything
from `on_playlists_changed()`.

Schema v1 (name-only playlist nodes, no `index` field) is no longer
auto-migrated - since the relocation search that would have found them by
name is gone, a v1 node simply fails its index check on first load and
reappears as a fresh root-level orphan, losing its folder placement. Not
worth writing a one-time migration for at this stage; flag it if it ever
becomes a real annoyance.

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
- [x] Renaming a playlist via the main UI is logged as a `renamed` event.
      Confirmed under both the original name-keyed design and the
      index-keyed design that followed it. The reorder self-healing that
      briefly existed between those two was tested, found to have a real
      blind spot (see "Playlist identity" above), and removed - renaming
      no longer depends on that machinery at all, so this should if
      anything be more robust now, not less.
- [x] Restarting foobar2000 reloads the same tree from disk, in the same
      order, with the rename persisted - `on_script_unload` -> `saveNow()`
      and the `utils.WriteTextFile`/`ReadTextFile` round-trip both work.
- [x] `Object.assign(globalThis, { on_playlists_changed, ... })` is picked
      up correctly by SMP's callback dispatch despite esbuild's IIFE
      wrapper. This was the biggest unverified assumption in this phase -
      it holds.
- [x] Phase 2 rendering confirmed: `▾`/`▸` folder disclosure prefixes
      render correctly (both expanded/collapsed), font and colours match
      the surrounding DUI/CUI theme (dark mode included), the scrollbar
      renders correctly once content exceeds one screen, and resizing the
      panel correctly re-renders both the trimmed (ellipsized) playlist
      names and the scrollbar.

**Known benign quirk:** the full startup sequence logs twice the first
time a script edit is applied via the panel's Edit Script dialog. This is
SMP itself running the script once as a trial/validation pass before
committing it to the panel, then once for real - not a bug here, and it
does not recur on a normal foobar2000 restart. Confirmed harmless since
`initialize()`/`reconcile()` are idempotent.

**Confirmed and accepted, not a bug to chase further:** reordering a
playlist via the main UI's playlist tabs desyncs any tree node whose
index falls in the shifted range - tested with both unique and duplicate
playlist names, the latter producing no detectable change at all (see
"Playlist identity" above). This is why the design assumption is that
playlist management happens exclusively through this panel.

## Phase 3 verification checklist (needs a real foobar2000 + SMP install -
unconfirmed as of this build)

- [ ] Click a row - it highlights with the selection colours, and nothing
      else changes selection state.
- [ ] Ctrl+click a second row - both rows now selected; ctrl+click one of
      them again to deselect just that one.
- [ ] Shift+click a third row - selects the contiguous visible range from
      the first-clicked row through the shift-clicked one, replacing the
      prior selection.
- [ ] Up/Down arrow keys move a single-row selection. **Requires "Grab
      focus" - if arrow keys do nothing, check the panel's Configure
      dialog for a "Grab focus" option separate from the
      `features.grab_focus` passed to `DefineScript`; the Callbacks.js
      docs reference such a setting and it's unconfirmed whether
      `DefineScript`'s option alone satisfies it.**
- [ ] Shift+Up/Shift+Down extends the range from the last plain
      click/arrow-move, same as shift-click.
- [ ] Home/End jump to the first/last visible row; PageUp/PageDown jump by
      roughly one screen.
- [ ] Clicking directly on a folder's `▾`/`▸` glyph toggles it without
      needing a double-click. The hit zone is a fixed-width approximation
      (see `GLYPH_HIT_WIDTH_PX` in `TreeView.ts`) since mouse callbacks
      don't receive a `GdiGraphics` to measure the actual glyph width -
      confirm it doesn't feel obviously mis-sized at your font/DPI.
- [ ] Double-clicking anywhere else on a folder row also toggles it.
- [ ] Right arrow on a collapsed folder expands it; on an already-expanded
      folder with children, moves focus to the first child. Left arrow on
      an expanded folder collapses it; otherwise moves focus to the
      parent folder (no-op at the root).
- [ ] Enter on a focused playlist row switches foobar's active playlist
      (`plman.ActivePlaylist`); Enter on a folder toggles it, matching
      double-click.
- [ ] Double-click on a playlist row always switches the active playlist,
      regardless of the (currently JSON-only, no UI yet) 
      `activateOnSingleClick` option.
- [ ] After any of the above, scroll position auto-adjusts to keep the
      focused/clicked row visible when it was near the top/bottom edge.

## Known limitations (by design, for this phase)

- Playlist identity and reorder self-healing have real limits with
  duplicate names combined with simultaneous renames - see "Playlist
  identity" above for the full explanation.
- No drag-and-drop, no context menu, no folder creation UI, no F2 rename
  yet - the tree can currently only grow folders by hand-editing the JSON
  file, and selection doesn't yet do anything besides highlight + (for
  playlists) activation. That's Phases 4-6.
- The folder glyph click-zone is a fixed pixel width, not measured
  against the actual rendered glyph - see the Phase 3 checklist above.
- Colours/fonts are read once at startup - `on_colours_changed` and
  `on_font_changed` aren't wired up yet, so live theme changes in
  DUI/CUI preferences won't be reflected until the panel reloads.
- Selection is cleared implicitly whenever a selected/focused node is
  dropped by `reconcile()` (via `pruneSelection()`), with no attempt to
  carry it over - e.g. selecting a playlist then renaming it externally
  keeps the selection (index unchanged), but selecting one that then gets
  removed externally will silently clear just that entry from the
  selection, not the whole thing.

## Next: Phase 4

Inline rename: F2 opens an edit box overlaid on the focused row, Enter
commits, Escape cancels, and folder-name collisions among siblings get
handled. This is also naturally where `activateOnSingleClick` gets an
actual settings UI, rather than only being editable by hand in the JSON
file.
