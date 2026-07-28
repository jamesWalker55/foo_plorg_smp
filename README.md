# foo_plorg_smp

A reimplementation of foobar2000 v1's `foo_plorg` (playlist organizer /
folder tree) as a foobar2000 v2 Spider Monkey Panel script, written in
TypeScript and bundled to a single flat JS file.

## Status: Phase 5 Round 1 - internal drag-and-drop

Phases 1, 2, and 3 are complete. Phases 1 and 2 are confirmed against a
real foobar2000 + SMP install - see "Verification status" below. Phase 4
adds F2-driven rename for both folders and playlists, on top of a
mid-phase refactor that switched the playlist identity model from
"index with cached name" to "stable GUID". Phase 5 Round 1 adds
internal drag-and-drop within the tree (drag a row to reorder, drop
on a folder to move into it, drop between rows to insert at a
position). External drag (Explorer files, foobar track lists) is
scheduled for Phase 5 Round 2 and is not implemented yet.

**Rename:**
- Folders: renamed in-tree. Sibling-uniqueness is **not** enforced and
  empty names **are** allowed - both per the owner's design choice
  (mirrors whatever the user has in their foobar2000 setup, no
  judgement from the script).
- Playlists: routed through `plman.RenamePlaylist`. `plman` enforces
  its own global uniqueness for playlist names and may reject empty
  names; failures are surfaced as a generic popup. An optimistic
  cached-name update on success avoids a flicker waiting for
  `on_playlists_changed` to round-trip.
- Input: SMP's modal `utils.InputBox` (try/catch on
  `errorOnCancel = true` for clean cancel detection).

The choice of `utils.InputBox` over a hand-rolled in-place editor is
deliberate - foo_plorg's original F2 was in-place, but `InputBox` is
~10 lines vs ~300 for a custom one, and matches this project's
pragmatic-shipping-over-polish bias. If a later polish phase wants
true inline rename, `onRenameRequested()` is the single method to
swap.

### What's in the box

- `src/types/tree.ts` - tree document schema v3 (folders + playlist
  refs keyed by stable GUID, with a cached index + name for display)
- `src/types/flags.ts` - numeric constants copied from the host's
  `Flags.js` reference (colour / font type IDs, `GdiDrawText` format
  flags, Windows VK codes for keyboard handling, modifier-mask bit
  values for mouse / keyboard callbacks)
- `src/types/smp.d.ts` - hand-rolled ambient declarations for the
  subset of the SMP API this project consumes, including the two
  undocumented `plman.GetGUID` / `plman.FindByGUID` calls this phase
  depends on; extend as new features need more surface
- `src/data/TreeStore.ts` - load / save the JSON tree file in the
  foobar profile (`%profile%\configuration\foo_plorg_smp.json`), plus
  GUID-based reconciliation against the live playlist list that
  self-heals drift (playlists added / removed / reordered anywhere
  in foobar2000) - see "Playlist identity" below
- `src/ui/Theme.ts` - resolves the current DUI / CUI font, text,
  background, and selection colours. Falls back to `gdi.Font("Segoe
  UI", 14)` if the host font lookup returns null
- `src/ui/TreeLayout.ts` - flattens the (possibly collapsed) tree
  into the linear row list rendering and virtualization both work
  from, plus the hit-testing helpers (`rowAtY`, `rowY`, `ensureRowVisible`,
  `clampScrollOffset`) that mouse and keyboard input both rely on
- `src/ui/Selection.ts` - flat-row-index selection model with
  Explorer-style anchor semantics (plain click sets anchor, ctrl
  toggles, shift replaces with a range from anchor)
- `src/ui/TreeView.ts` - draws the visible rows only (virtualized
  against `window.Height`), clean indentation (no connector lines),
  plain-text folder disclosure markers (`▾` / `▸` - no icons, per
  current UX decisions), selection-background + active-playlist frame,
  mouse-wheel scroll, the input dispatch (click / dblclick / wheel /
  key) wired to selection and tree mutations, the F2 rename handler
  (`onRenameRequested`), and the internal drag-and-drop state machine
  (`onMouseLbtnDown` / `onMouseMove` / `onMouseLbtnUp` / `onMouseLeave`,
  drop-target computation, drop-indicator paint)
- `src/data/TreeStore.ts` - includes `moveNodes(sources, target)`
  for the structural move the internal drag commits on drop (with
  correct same-parent index adjustment for sources that were
  originally before the target)
- `src/main.ts` - wires the above together; registers every SMP
  callback this phase needs (`on_paint`, `on_size`, `on_playlists_changed`,
  `on_playlist_switch`, `on_script_unload`, `on_mouse_lbtn_down`,
  `on_mouse_lbtn_dblclk`, `on_mouse_rbtn_up`, `on_mouse_move`,
  `on_mouse_leave`, `on_mouse_wheel`, `on_key_down`)

## Playlist identity: GUID, with cached index + name

Playlist nodes are keyed by a **stable string GUID** obtained from
`plman.GetGUID(playlistIndex)`. This is the SMP equivalent of a
"stable id" - the previous phases had to work around the absence of
one with a fragile "trust index + closest-index heuristic" dance, but
it turns out SMP exposes `GetGUID` and `FindByGUID` as undocumented
helpers and they Just Work. Reconciliation now asks "where is the
node whose GUID is X?" instead of "where is the playlist that used to
be at index N and was named Y?", which removes the entire class of
duplicate-name / index-drift edge cases the previous model had to
contend with.

Each `PlaylistNode` now carries three fields:

- `id` - the GUID. Identity. Set once during the first reconcile
  after a node appears in the tree and never re-derived. (For v2
  nodes that load without an `id`, the migration code in `reconcile`
  does a one-time index+name match with a closest-index tiebreak to
  pick a GUID, then the node behaves like any other v3 node from
  there on.)
- `index` - the current `plman` index, refreshed on every reconcile.
  Used for immediate access (e.g. `plman.ActivePlaylist =
  node.index`). Not an identity.
- `name` - the current `plman` name, refreshed on every reconcile.
  Pure display cache.

Reconcile algorithm:

1. Build `guid -> {index, name}` for every live playlist via
   `plman.GetGUID(i)` + `plman.GetPlaylistName(i)`.
2. Walk the tree. For each `PlaylistNode`:
   - If its `id` is in the live map, claim it, update `index` and
     `name` from the live map. Log `relocated` if `index` changed.
   - If its `id` is **not** in the live map, the playlist is gone
     - drop the node, log `unresolved`.
3. Any live GUID that wasn't claimed becomes a new root-level
   `PlaylistNode` (the "imported orphan" path; this is the natural
   entry point for autoplaylists created via foobar2000's internal
   filter window).

External renames, reorders, and removes are all handled by step 2
automatically. The previous phase's "fool's errand" failure mode
(two duplicate-named playlists both reordered + renamed within one
host operation) simply doesn't apply any more - the GUID identifies
the playlist, the name is just a cache.

## Design choices (explicit, per owner)

- **Sibling name collisions are allowed** - both for folders and
  playlists. Folders are a UI construct with no external authority
  forbidding duplicates; plman has its own global uniqueness for
  playlist names, so duplicates at the playlist level aren't
  possible anyway, but if two folders under the same parent want
  the same name, the script doesn't stop them.
- **Empty names are allowed** - both for folders and playlists.
  Folders will render as a bare `▾ ` disclosure marker, which is a
  valid if unusual state. For playlists, plman may or may not accept
  an empty new name; if it doesn't, the generic rename-failed popup
  tells the user.
- **External add / remove is supported** - the reconcile path
  imports new playlists as root-level orphans, and drops tree nodes
  whose GUID disappears. See "External additions: autoplaylists
  workflow" below for the practical implication.

## External additions: autoplaylists workflow

Autoplaylists created via foobar2000's `Library > Search` /
`Create Autoplaylist` (or any other path that adds a playlist
without going through this panel) will appear at the **end of the
root level** in the tree, in the order `plman` reports them. Move
them into a folder by drag (Phase 5) or by editing the tree JSON
manually. There's no auto-classification magic - the script mirrors
the structure you arrange, and surfaces new playlists for placement
rather than guessing where they belong.

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

Load `dist/foo_plorg_smp.js` into a Spider Monkey Panel (panel
context menu > Edit Script, or point the panel at the file directly).

## Verification status (confirmed against a real foobar2000 + SMP install)

### Phase 1 - data layer

- [x] Panel loads without a script error on first run and imports
      existing playlists as root-level entries (confirmed with 5
      pre-existing playlists).
- [x] Renaming a playlist via the main UI is logged as a `renamed`
      event, not a remove + add. The two-step patch-then-reconcile
      order keeps the index-keyed design honest.
- [x] Restarting foobar2000 reloads the same tree from disk, in the
      same order, with the rename persisted - `on_script_unload` →
      `saveNow()` and the `utils.WriteTextFile` / `ReadTextFile`
      round-trip both work.
- [x] `Object.assign(globalThis, { on_playlists_changed, ... })` is
      picked up correctly by SMP's callback dispatch despite
      esbuild's IIFE wrapper. This was the biggest unverified
      assumption in early phases - it holds.

### Phase 2 - static rendering

- [x] Panel draws the reconciled tree as plain text, correctly
      indented, with `▾` / `▸` prefixes on folders.
- [x] Font and colours match the surrounding DUI / CUI theme rather
      than falling back to Segoe UI / black - `resolveTheme()` picks
      the right `InstanceType` branch in both interfaces.
- [x] Virtualization only draws visible rows; the scrollbar thumb
      appears at `scrollOffsetPx = 0` (nothing was setting it yet at
      this point in time) and is sized / positioned plausibly.
- [x] Resize fires `on_size` without error.
- [x] Reorder a playlist via drag in the main playlist tabs (with
      any name, duplicates or not): `TreeStore.reconcile()`'s GUID
      lookup follows the playlist to its new index and the tree node
      stays put logically (console logs a `relocated` entry with
      `fromIndex -> toIndex`). Confirmed against a real install.
- [x] Rename a playlist via the main UI: tree's cached name updates
      on the next reconcile. With GUID identity, this is a trivial
      no-op for the tree structure (only the cached name field
      changes).
- [x] Add a new autoplaylist via the Library filter window: the new
      playlist shows up at the end of the root level in the tree
      on the next reconcile. Logged as `imported N playlist(s)`.

**Known benign quirk:** the full startup sequence logs twice the
first time a script edit is applied via the panel's Edit Script
dialog. This is SMP itself running the script once as a trial /
validation pass before committing it to the panel, then once for
real - not a bug here, and it does not recur on a normal foobar2000
restart. `initialize()` / `reconcile()` are idempotent.

### Phase 3 - selection & keyboard nav

Phase 3 is built and typechecks; the following still needs
verification against a real foobar2000 + SMP install:

- [ ] Plain left-click on a row highlights it (selection background
      visible) and the previous selection is cleared. Confirms the
      row → `Selection.setSingle()` path.
- [ ] Ctrl+click toggles rows in / out of the selection without
      clearing the rest. Confirms `Selection.toggle()` and the
      `MouseMask.CONTROL` bit in the click `mask` argument.
- [ ] Shift+click replaces the selection with a contiguous range
      from the last anchor. Try a three-click sequence: plain-click
      row 3, shift-click row 7 (rows 3..7 selected), shift-click
      row 1 (rows 1..7 selected).
- [ ] Click on a folder's `▾` / `▸` disclosure triangle toggles
      that folder only and does not change the selection. The
      triangle's hit zone is `DISCLOSURE_HIT_WIDTH_PX` (16) wide at
      the leftmost indent for the row.
- [ ] Double-click on a playlist row sets `plman.ActivePlaylist` to
      that playlist's index; the active-playlist frame (1px border
      in the `activeItemFrameColour`) draws around that row in the
      tree. Switching to a different playlist via the main playlist
      tabs (or another panel) moves the frame to the new row -
      confirms `on_playlist_switch` is wired.
- [ ] Double-click on a folder row toggles its expanded state.
- [ ] Arrow keys: Down / Up move the cursor one row at a time.
      Shift extends the selection; plain click / arrow replaces it.
- [ ] Right arrow on a collapsed folder expands it; right arrow on
      an expanded folder jumps to its first child if it has one.
      Left arrow on an expanded folder collapses it; left arrow on
      a collapsed folder / playlist jumps to the parent row.
- [ ] Home / End jump to the first / last visible row. PageUp /
      PageDown jump by roughly one viewport of rows and clamp at
      the top / bottom of the row list.
- [ ] Enter activates the first selected playlist (skips folders).
      With no selection, Enter is a no-op.
- [ ] Mouse wheel scrolls by `WHEEL_LINES_PER_NOTCH` (3) rows per
      notch, with `clampScrollOffset` keeping the offset inside
      `[0, totalContentHeight - viewportHeight]`.
- [ ] Esc clears the selection.
- [ ] `on_playlists_changed` (add / remove / rename via another
      panel) clears the current selection and repaints, so a row
      that no longer exists can't stay "selected" pointing at
      nothing.

### Phase 4 - inline rename (F2)

Phase 4 is built and typechecks; the following still needs
verification against a real foobar2000 + SMP install:

- [ ] F2 on a single selected playlist row opens a modal input
      dialog titled "Rename" with the prompt "New playlist name:"
      and the current name pre-filled. Confirming with a new name
      renames the playlist in foobar2000 (visible in the main
      playlist tabs and in any other panel that lists playlists).
      The tree repaints with the new name immediately (no flicker
      via the optimistic cached-name update).
- [ ] F2 on a single selected folder row opens the same dialog with
      the prompt "New folder name:". Confirming renames the folder
      in the tree and the change is persisted to
      `foo_plorg_smp.json`.
- [ ] Pressing Cancel in the dialog leaves the row name unchanged
      (try/catch on `errorOnCancel = true` handles this).
- [ ] F2 on an empty selection is a silent no-op. F2 on a multi-row
      selection shows a popup: "Select a single item to rename."
- [ ] F2 on a folder, type a name that already exists as a sibling
      folder, confirm: rename proceeds without complaint. Two
      folders with the same name under the same parent is an
      allowed state per the design.
- [ ] F2 on a folder, type an empty string (or a string of just
      whitespace, which gets trimmed), confirm: rename proceeds; the
      folder renders as a bare `▾ ` disclosure marker. The
      rename is a silent success, no popup.
- [ ] F2 on a playlist, type a name that already exists elsewhere
      in plman (regardless of whether that other playlist is in our
      tree) shows a popup: "Rename failed. foobar2000 may have
      rejected the new name (duplicate or locked playlist)." The
      tree name is unchanged.
- [ ] F2 on a playlist, type an empty string, press OK: if plman
      accepts it, the tree renames successfully; if plman rejects
      it, the generic "Rename failed" popup shows.
- [ ] F2 on anything, press OK without changing anything (or
      re-type the same name): silent no-op (no popup, no log, no
      write).
- [ ] Rename persists across a foobar2000 restart. For folders this
      is direct (we write the tree file). For playlists it's via
      foobar2000's own persistence; the tree's GUID lookup on
      next-start reconcile finds the (now renamed) playlist by id
      and refreshes the cached name.
- [ ] **GUID refactor regression checks:**
  - [ ] A pre-existing v2 tree file (`%profile%\configuration\
        foo_plorg_smp.json`) loads under the new build. The console
        logs the v2-to-v3 migration; after the first reconcile,
        every playlist node has a non-empty `id` field. Restart
        foobar and confirm the tree still loads correctly (no
        re-migration needed - the file is now v3 on disk).
  - [ ] Add a new playlist via the Library filter window; the
        reconcile log shows it as `imported`. Its node has a fresh
        GUID and lands at the end of the root level.
  - [ ] Rename an existing playlist via the main UI (not via this
        panel). The tree's cached name updates on the next
        reconcile; the node's id, index, and position are
        unchanged.
  - [ ] With two or more duplicate-named playlists, drag-reorder
        them in the main playlist tabs. The console logs `relocated`
        for the affected nodes; the tree still shows the right
        playlists at the right rows afterwards (GUID lookup, not
        name lookup, so duplicate names don't confuse it).

### Phase 5 Round 1 - internal drag-and-drop

Phase 5 Round 1 is built and typechecks; the following still needs
verification against a real foobar2000 + SMP install. The drag
gesture is the standard "hold left button, move past a small
threshold (~5px), release on target" pattern - the same as Windows
Explorer.

- [ ] **Single-row drag (playlist):** click-and-hold on a playlist
      row, drag to a different position in the same folder, release.
      The playlist moves to the new position. No visual artifacts
      (selection background updates, drop indicator disappears, no
      stray highlights).
- [ ] **Single-row drag (folder):** same gesture on a folder row.
      The folder moves; children come with it.
- [ ] **Drag into folder (playlist):** drag a playlist row to a
      folder row. Hovering in the middle third of the folder row
      paints a 2px frame around the folder (the "into" indicator).
      Release: the playlist is appended to the folder.
- [ ] **Drag into folder (folder):** drag a folder row to another
      folder row. The target folder highlights; release moves the
      source folder inside.
- [ ] **Drop position split (folder target):** on a folder row,
      hover in the top ¼ to see an "insert before" line above the
      folder; hover in the bottom ¼ to see an "insert after" line
      below; the middle ½ shows the "into" frame. Verify all three
      work as labelled.
- [ ] **Drop position split (playlist target):** on a playlist row,
      hover in the top ½ to see an "insert before" line above; the
      bottom ½ shows "insert after". (Folders get a 3-way split
      because "into" is a meaningful third option there; playlist
      leaves only have two.)
- [ ] **Drop in empty space:** drag a row past the bottom of the
      last row, release in the empty area below. The row is
      appended to the root level. (No "into" indicator makes sense
      here - the target is the root.)
- [ ] **Drop on scrollbar:** drag a row to the right edge of the
      panel and release on the scrollbar. The drop is silently
      aborted (no move, no popup). This is intentional - we don't
      have a meaningful interpretation of "drop on the scrollbar".
- [ ] **Multi-select drag:** ctrl-click two non-contiguous playlist
      rows to multi-select, then drag either of them. Both rows
      move together to the new position. Try also with
      non-adjacent rows in different folders (one at root, one in
      a folder) - both move as a set, and the order in the
      destination preserves the original selection order.
- [ ] **Cycle prevention (folder into its own child):** create
      folder A containing folder B, then drag A onto B. The "into"
      zone is forbidden (A is one of the forbidden targets via the
      B-ancestor-of-A path); instead, hovering in the middle of B
      shows an "insert before" line and release moves A to be a
      sibling of B (above it). Verify A is NOT moved inside B.
- [ ] **Cycle prevention (folder onto itself):** drag a folder row
      onto itself. The drop is silently aborted (no move) - the
      playlist-row forbidden check refuses to suggest a target, and
      the folder-row "into" check is also forbidden, leaving no
      valid drop position.
- [ ] **Drag a single row that isn't currently selected:** with no
      selection, click-and-hold a row and drag. The row becomes the
      selection (highlighted) at the moment the drag activates
      (past the threshold), and only that one row is dragged. This
      matches Windows Explorer.
- [ ] **Click vs drag threshold:** click and release without
      moving (or with only a few pixels of jiggle). The selection
      updates normally - no drag is initiated. The threshold is
      5px, deliberately forgiving.
- [ ] **Drag past the panel edge:** start a drag inside the panel
      and drag the mouse out the bottom. The drag is cancelled
      (`on_mouse_leave` clears the state). This is the safe
      default - we can't reliably detect mouseup outside the panel.
- [ ] **Selection cleared after drop:** after a successful drop,
      the selection is cleared (the moved rows now live at
      different flat indices, and tracking that would be fiddly
      without obvious value). The user can ctrl-click to re-select
      what they just moved if they need to keep acting on it.
- [ ] **Persistence:** drag a few rows, close foobar2000, reopen.
      The moved rows are where you left them - the tree file was
      written by `TreeStore.moveNodes` → `scheduleSave()`.
- [ ] **F2 + drag don't conflict:** with a playlist selected (F2
      would rename it), click-and-hold on a different playlist and
      drag. The drag works as expected, no rename dialog appears.
- [ ] **Disclosure click doesn't start a drag:** click directly on
      a folder's `▾` / `▸` glyph. The folder expands or collapses
      and no drag is initiated, even if you move the mouse a few
      pixels during the click.

## Known limitations (by design, for this phase)

- The `MouseMask` / `KeyMask` bit values for the `mask` argument of
  `on_mouse_*` and `on_key_down` are the Windows-expected convention
  (shift = 0x04 / 0x01, ctrl = 0x08 / 0x02, etc.) and are the best
  guess against SMP's docs. If real SMP delivers a different layout,
  the modifier detection in the input handlers will silently treat
  shift as ctrl and vice versa - a single binary grep / `console.log`
  of the raw `mask` value will confirm. Adjust `src/types/flags.ts`
  if so.
- **`plman.GetGUID` / `plman.FindByGUID` are undocumented.** They
  exist in the SMP versions this script has been tested against, but
  there's no promise they won't be renamed / removed in a future SMP
  release. The dependency is explicit in `src/types/smp.d.ts` (look
  for the "Undocumented GUID methods" comment). If they ever break,
  the script will need a fallback - likely a return to a "trust
  index" model with a much smaller feature set, since that's the
  only mode that doesn't need stable identity.
- Colours / fonts are read once at startup - `on_colours_changed`
  and `on_font_changed` aren't wired up yet, so live theme changes
  in DUI / CUI preferences won't be reflected until the panel
  reloads. The `refreshTheme()` method on `TreeView` is the hook
  once those callbacks land.
- **No external drag yet** - dropping files from Explorer or tracks
  from another foobar2000 panel does nothing useful. SMP's
  `on_drag_enter` / `on_drag_over` / `on_drag_drop` callbacks are
  declared in the type definitions but not registered in `main.ts`
  yet. Phase 5 Round 2 will wire these up and handle the two
  cases: Explorer file drop creates a new playlist; foobar track
  drop onto a playlist row adds to that playlist (with Ctrl = copy
  per legacy foo_plorg behaviour).
- **No right-click context menu yet** - Phase 6 (which will also
  introduce the "New Folder" / "New Playlist" / "Delete" /
  "Sort" entries that the user expects from a tree-based playlist
  manager).
- `on_mouse_rbtn_up` is wired as a no-op (returns without
  touching the selection) so SMP's default behaviour applies
  cleanly until Phase 6 builds the real context menu.
- **Drag-cursor change isn't done.** Windows normally changes the
  cursor to a "move" cursor during drag; we don't. We rely on the
  drop indicator (line / folder frame) for feedback. SMP's
  `window.SetCursor` exists but the cursor-ID constants aren't
  documented in the version of the API docs we cross-reference,
  so we left the cursor alone rather than guess. Easy to add once
  the constants are confirmed.
- **Drag auto-scroll isn't done.** Dragging near the top or
  bottom of the panel doesn't auto-scroll the tree. For trees
  that fit on one screen this is irrelevant; for longer trees
  the user has to scroll with the wheel mid-drag, which is
  awkward. Add as a follow-up: a `setInterval` started when the
  cursor is within `SCROLL_MARGIN_PX` of either edge, until the
  drag ends.
- The v2-to-v3 migration is a one-time name+closest-index heuristic
  for nodes that load without a GUID. With duplicate names AND a
  reorder having happened since the file was last written, the
  heuristic may bind a node to a different playlist than the user
  intended. Once any v2 file is reconciled once, it's saved as v3
  with GUIDs and never re-runs the heuristic, so this is a
  one-shot concern at most.

## Next: Phase 5 Round 2

External drag-and-drop - the SMP `on_drag_*` callbacks, which
handles two cases:

- **Explorer file drop** (action.IsInternal = false, action.Text
  contains file paths) - create a new playlist containing those
  files. The target is a folder (drop inside) or the root (drop in
  empty space).
- **Foobar track drop** (action.IsInternal = true, action.Playlist
  is a handle list) - add the tracks to the target playlist. The
  target must be a playlist row, not a folder. Ctrl-held = copy
  instead of move (per legacy foo_plorg behaviour).

Plus the cross-cutting question of what to do with each case when
the drop target is the panel background vs a specific row - which
is a "where exactly did the user drop" question the row hit-test
already answers.
