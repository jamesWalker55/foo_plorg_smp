# foo_plorg_smp

A reimplementation of foobar2000 v1's `foo_plorg` (playlist organizer /
folder tree) as a foobar2000 v2 Spider Monkey Panel script, written in
TypeScript and bundled to a single flat JS file.

## Status: Phase 4 - inline rename (F2)

Phases 1, 2, and 3 are complete. Phases 1 and 2 are confirmed against a
real foobar2000 + SMP install - see "Verification status" below. Phase 4
adds F2-driven rename for both folders and playlists.

- Folders: renamed in-tree, with sibling-uniqueness enforced (case-
  sensitive, matching Windows Explorer). `scheduleSave()` persists the
  change.
- Playlists: routed through `plman.RenamePlaylist` (returns false on
  collision or a `RenamePlaylist` lock, which we surface as a generic
  popup).
- Input: SMP's modal `utils.InputBox` (try/catch on
  `errorOnCancel = true` for clean cancel detection).

The choice of `utils.InputBox` over a hand-rolled in-place editor is
deliberate - foo_plorg's original F2 was in-place, but `InputBox` is
~10 lines vs ~300 for a custom one, and matches this project's
pragmatic-shipping-over-polish bias. If a later polish phase wants
true inline rename, `onRenameRequested()` is the single method to
swap.

### What's in the box

- `src/types/tree.ts` - tree document schema (folders + playlist refs
  keyed by `plman` index, with a cached name used as a relocation hint
  during reconcile)
- `src/types/flags.ts` - numeric constants copied from the host's
  `Flags.js` reference (colour / font type IDs, `GdiDrawText` format
  flags, Windows VK codes for keyboard handling, modifier-mask bit
  values for mouse / keyboard callbacks)
- `src/types/smp.d.ts` - hand-rolled ambient declarations for the
  subset of the SMP API this project consumes; extend as new features
  need more surface
- `src/data/TreeStore.ts` - load / save the JSON tree file in the
  foobar profile (`%profile%\configuration\foo_plorg_smp.json`), plus
  index-based reconciliation against the live playlist list to
  self-heal drift (playlists reordered / added / removed by anything
  other than this panel) - see "Playlist identity" below
- `src/data/PlaylistSync.ts` - diffs successive playlist-name
  snapshots to tell renames apart from add / remove / reorder, since
  SMP's `on_playlists_changed()` callback fires for all of these with
  no detail about which one happened
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
  key) wired to selection and tree mutations, and the F2 rename
  handler (`onRenameRequested`)
- `src/main.ts` - wires the above together; registers every SMP
  callback this phase needs (`on_paint`, `on_size`, `on_playlists_changed`,
  `on_playlist_switch`, `on_script_unload`, `on_mouse_lbtn_down`,
  `on_mouse_lbtn_dblclk`, `on_mouse_rbtn_up`, `on_mouse_wheel`,
  `on_key_down`)

## Playlist identity: index, not name

Playlist nodes are keyed by **index**, not name. This was a deliberate
change partway through Phase 2: I confirmed by reviewing the full
`plman` API surface that SMP exposes no stable playlist id anywhere
(no Guid / Uuid / persistent handle - only mutable name and mutable
index), so index is the best primitive available, especially with
duplicate playlist names in play.

The cost is that index isn't *actually* stable either - anything that
reorders, adds, or removes a playlist shifts indices around it. Since
`on_playlists_changed()` fires identically for renames / adds /
removes / reorders with no detail about which happened,
`PlaylistSync` + `TreeStore.reconcile()` together run a two-step
self-healing pass on every firing:

1. **Rename patch** - `PlaylistSync`'s snapshot diff identifies
   same-index renames and patches the tree's cached name for that
   index directly, before anything else runs. This has to happen
   first, or a rename looks indistinguishable from "this playlist is
   gone" to the next step.
2. **Reconcile** - every playlist node is re-validated: if
   `plman.GetPlaylistName(index)` still matches the node's cached
   name, nothing moved. If not, search all playlists not already
   claimed by another node for one whose name matches the cached
   name, preferring the candidate closest to the node's last known
   index when several playlists share that name. No match at all
   means the playlist is gone.

This makes plain renames and single-playlist reorders self-heal
correctly even with duplicate playlist names in the mix. What it
**can't** do: if two identically-named playlists are both reordered
*and* one of them renamed within the same host operation, there's no
way to tell which node should end up where - this needs a stable id
SMP doesn't provide. **The script operates under the assumption that
you will manage playlists exclusively through this panel once it's
built out.** External reordering is supported as a best-effort safety
net for the main foobar2000 playlist UI and other panels, not the
primary path.

Schema v1 (name-only playlist nodes, no `index` field) loads without
any explicit migration code - a node with a missing / invalid index
is treated exactly like one whose index has drifted, and gets
relocated by its cached name on the first reconcile pass.

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
- [x] Reorder a playlist via drag in the main playlist tabs with
      uniquely-named playlists: `TreeStore.reconcile()`'s
      name-based relocation correctly finds the playlist at its new
      index and the tree node stays put logically (console logs a
      `relocated` entry per affected node). Confirmed with five
      playlists in a real install.
- [x] Reorder the same way with two or more playlists that share a
      name: reconcile silently picks the closest-index candidate
      (best-effort heuristic, not a guarantee), per the documented
      "no stable id" limitation. **This was confirmed to be
      acceptable - the script does not pretend to handle every
      reordering with duplicate names correctly, and the README's
      "manage playlists through this script" assumption is the
      contract.**

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
      The tree repaints with the new name.
- [ ] F2 on a single selected folder row opens the same dialog with
      the prompt "New folder name:". Confirming renames the folder
      in the tree and the change is persisted to
      `foo_plorg_smp.json`.
- [ ] Pressing Cancel in the dialog leaves the row name unchanged
      (try/catch on `errorOnCancel = true` handles this).
- [ ] F2 on an empty selection is a silent no-op. F2 on a multi-row
      selection shows a popup: "Select a single item to rename."
- [ ] Renaming a folder to a name that already exists as a sibling
      folder shows a popup: `A folder named "<x>" already exists
      here.` and leaves both folders unchanged. Case-sensitive
      match.
- [ ] Renaming a playlist to a name that already exists elsewhere
      in plman (regardless of whether that other playlist is in our
      tree) shows a popup: "Rename failed. A playlist with that
      name may already exist, or this playlist may be locked for
      rename." `plman.RenamePlaylist` returns false; we surface it
      generically.
- [ ] F2 on a playlist, type empty string, press OK: shows
      "Name cannot be empty." and the playlist name is unchanged.
- [ ] F2 on a playlist, press OK without changing anything (or
      re-type the same name): silent no-op (no popup, no log, no
      write).
- [ ] Rename persists across a foobar2000 restart. For folders this
      is direct (we write the tree file). For playlists it's via
      foobar2000's own persistence - the tree's cached name gets
      re-aligned by `on_playlists_changed` on next start.

## Known limitations (by design, for this phase)

- Playlist identity and reorder self-healing have real limits with
  duplicate names combined with simultaneous renames - see
  "Playlist identity" above for the full explanation.
- The `MouseMask` / `KeyMask` bit values for the `mask` argument of
  `on_mouse_*` and `on_key_down` are the Windows-expected convention
  (shift = 0x04 / 0x01, ctrl = 0x08 / 0x02, etc.) and are the best
  guess against SMP's docs. If real SMP delivers a different layout,
  the modifier detection in the input handlers will silently treat
  shift as ctrl and vice versa - a single binary grep / `console.log`
  of the raw `mask` value will confirm. Adjust `src/types/flags.ts`
  if so.
- Colours / fonts are read once at startup - `on_colours_changed`
  and `on_font_changed` aren't wired up yet, so live theme changes
  in DUI / CUI preferences won't be reflected until the panel
  reloads. The `refreshTheme()` method on `TreeView` is the hook
  once those callbacks land.
- No right-click context menu, no inline rename, no drag & drop
  reorder yet - Phases 4, 5, and 6.
- `on_mouse_rbtn_up` is wired as a no-op (returns without
  touching the selection) so SMP's default behaviour applies
  cleanly until Phase 6 builds the real context menu.

## Next: Phase 5

Drag & drop: internal reorder / move first (playlists and folders
within the tree), then track-drop-onto-playlist (add items to a
playlist, with Ctrl = copy per legacy behaviour), then Explorer file
drop (create new playlists from files / import `.m3u8` etc).
