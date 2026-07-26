# foo_plorg_smp

A reimplementation of foobar2000 v1's `foo_plorg` (playlist organizer /
folder tree) as a foobar2000 v2 Spider Monkey Panel script, written in
TypeScript and bundled to a single flat JS file.

## Status: Phase 4 - inline rename (F2)

Phases 1-3 are complete and confirmed against a real foobar2000 + SMP
install - see "Verification status" below. Phase 4 adds F2 rename for
both folders and playlists.

- `src/types/tree.ts` - tree document schema (folders + playlist refs),
  schema v3 (per-node `id`, see "Why node ids")
- `src/types/flags.ts` - numeric constants copied from the host's
  `Flags.js` reference, plus `VK.F2` (added this phase - not in the
  component's curated `IsKeyPressed()` list, but a standard, unchanging
  Win32 virtual-key code, safe to hardcode)
- `src/data/TreeStore.ts` - load/save the JSON tree file in the foobar
  profile, index-based reconciliation (see "Playlist identity" below).
  This phase adds `renameFolder()` and exports `getCurrentPlaylistNames()`
  as a shared helper (previously duplicated in `main.ts`, now also used
  by `TreeView`'s playlist-rename handler)
- `src/ui/Theme.ts` - resolves DUI/CUI font and text/background/selection
  colours
- `src/ui/TreeLayout.ts` - flattens the tree into the row list rendering,
  hit-testing, and keyboard nav share
- `src/ui/Selection.ts` - selected/focused node id tracking
- `src/ui/TreeView.ts` - rendering, hit-testing, click/double-click/
  keyboard input, playlist activation. This phase adds F2 rename handling
  - see "Inline rename" below
- `src/main.ts` - wires everything together and registers host callbacks

## Inline rename: native dialog, not a hand-rolled overlay

Originally planned as an edit box overlaid directly on the row. Changed
while implementing: SMP exposes `utils.InputBox()`, a native modal text
prompt, which gets cursor movement, text selection, clipboard, and IME
handling for free from the OS - all things a hand-rolled overlay editor
would have to reimplement (and get subtly wrong more than once) using
raw `on_char`/`on_key_down` events and manual caret rendering. Given this
project's general bias so far toward using what the host already solves
well rather than reinventing it (see the reorder-identity decisions
above), F2 now opens `utils.InputBox` instead. The tradeoff is a modal
popup rather than a flush inline editor - revisit only if that turns out
to feel wrong in practice.

Behaviour:
- F2 does nothing when more than one row is selected (mirrors Explorer -
  renaming an arbitrary item out of a multi-select is more confusing than
  useful).
- **Folder rename** goes straight to `TreeStore.renameFolder()`, which
  trims whitespace and rejects an empty result, but deliberately does
  **not** check for name collisions among sibling folders. Folders are
  identified by `id`, not name (see "Why node ids"), so a duplicate
  folder name is cosmetically odd at worst, never a correctness problem -
  same reasoning as dropping playlist-reorder self-healing: don't build
  resolution logic the identity model doesn't actually need.
- **Playlist rename** calls `plman.RenamePlaylist()` directly (the tree
  only ever caches the playlist's real name for display, so renaming
  means renaming the actual foobar playlist, not just a label in our
  JSON), then immediately calls `reconcile()` rather than waiting for the
  next `on_playlists_changed` firing, so the row updates without a
  visible delay. Logs a warning if `RenamePlaylist` reports failure
  (e.g. a locked playlist) rather than assuming success.
- Since `InputBox`'s default behaviour returns the original value
  unchanged on Cancel/Esc, "cancelled" and "submitted with no change"
  collapse into the same no-op check - no try/catch needed.

`activateOnSingleClick` still has no settings UI (JSON-only) - didn't get
to it this phase in favour of rename; still on the list for whenever
Phase 6 (context menu/commands) happens, since that's naturally where a
"Settings" entry would live too.

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
- [x] Phase 3 interaction confirmed in full: click/ctrl+click/shift+click
      selection, arrow-key navigation (including that `DefineScript`'s
      `features.grab_focus: true` alone was sufficient - no separate
      Configure-dialog toggle needed), glyph-zone and double-click folder
      expand/collapse, Enter/double-click playlist activation, and
      scroll-into-view on navigation.

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

## Phase 4 verification checklist (needs a real foobar2000 + SMP install -
unconfirmed as of this build)

- [ ] F2 on a focused folder opens a native input dialog pre-filled with
      its current name; submitting a new name updates the tree and
      persists; Cancel/Esc/submitting the same name leaves it untouched.
- [ ] F2 on a focused playlist opens the same dialog; submitting a new
      name actually renames the real foobar playlist (check it in the
      main UI's playlist tabs, not just this panel) and the tree row
      updates immediately, without waiting for a second interaction.
- [ ] F2 with multiple rows selected does nothing (select 2+ rows, press
      F2, confirm no dialog appears).
- [ ] Renaming a locked playlist (if you have one, or lock one via the
      main UI first) logs a `plman.RenamePlaylist failed` message to the
      console instead of silently doing nothing or throwing.
- [ ] Two sibling folders with the same name after a rename - confirm
      this is merely cosmetically odd (both still work independently,
      selection/expand/rename on either one only affects that one) rather
      than causing any actual confusion in the tree's behaviour.

## Known limitations (by design, for this phase)

- Playlist identity and reorder self-healing have real limits with
  duplicate names combined with simultaneous renames - see "Playlist
  identity" above for the full explanation.
- No drag-and-drop, no context menu, no folder/playlist creation UI yet -
  the tree can currently only grow folders by hand-editing the JSON file.
  That's Phases 5-6.
- The folder glyph click-zone is a fixed pixel width, not measured
  against the actual rendered glyph.
- Colours/fonts are read once at startup - `on_colours_changed` and
  `on_font_changed` aren't wired up yet.
- `activateOnSingleClick` has no settings UI yet (JSON-only).
- Rename uses a native modal dialog, not an inline overlay editor - see
  "Inline rename" above for why, and revisit if it feels wrong in use.

## Next: Phase 5

Drag-and-drop: reordering/moving nodes within the tree first, then
dropping tracks onto a playlist row, then (lower priority) dragging
playlist files in from Explorer.
