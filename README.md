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
  profile (`%profile%\configuration\foo_plorg_smp.json`), plus
  index-based reconciliation against the live playlist list - see
  "Playlist identity" below
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

**Confirmed and accepted, not a bug to chase further:** reordering a
playlist via the main UI's playlist tabs desyncs any tree node whose
index falls in the shifted range - tested with both unique and duplicate
playlist names, the latter producing no detectable change at all (see
"Playlist identity" above). This is why the design assumption is that
playlist management happens exclusively through this panel.

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
