import { TreeStore } from '../data/TreeStore';
import { isFolderNode, isPlaylistNode } from '../types/tree';
import {
  clampScrollOffset,
  ensureRowVisible,
  FlatRow,
  flattenVisibleNodes,
  rowAtY,
  rowY,
} from './TreeLayout';
import { Selection } from './Selection';
import { resolveTheme, Theme } from './Theme';
import { DT, KeyMask, MouseMask, VK } from '../types/flags';

const ROW_VERTICAL_PADDING = 6;
const INDENT_PX = 16;
const LEFT_PADDING_PX = 8;
const SCROLLBAR_WIDTH_PX = 8;
const SCROLLBAR_MARGIN_PX = 2;
const ACTIVE_FRAME_PX = 1;

/** Width of the clickable area in front of each row that toggles a
 *  folder's expanded state when the row is a folder. Roughly one indent
 *  unit, so the hit zone lines up with the disclosure marker. */
const DISCLOSURE_HIT_WIDTH_PX = 16;

/** How many row heights a single wheel notch scrolls. 3 is a common
 *  Windows default and feels right for a tree. */
const WHEEL_LINES_PER_NOTCH = 3;

// Plain-text disclosure indicators, since icons are out of scope for now
// (see project decisions - plain text, clean indent, no icons/connector
// lines). Revisit if/when Phase 7 (colour/state polish) adds real icons.
const FOLDER_EXPANDED_PREFIX = '\u25BE '; // '▾ '
const FOLDER_COLLAPSED_PREFIX = '\u25B8 '; // '▸ '

/** Where a click landed. `null` means "below the last row" / "past the
 *  scrollbar" / "outside any row" - used by the input handlers to
 *  distinguish "click on the disclosure triangle of a folder" from
 *  "click on the rest of the row" from "click on empty space below." */
interface HitResult {
  rowIndex: number;
  isDisclosure: boolean;
  row: FlatRow;
}

export class TreeView {
  private theme: Theme;
  private rowHeight: number;
  private scrollOffsetPx = 0;

  /** Cached so we don't pay a tree walk for it on every paint. */
  private lastFlattened: FlatRow[] = [];

  private readonly selection: Selection = new Selection();

  /** Cached "row index in lastFlattened" of the playlist that is
   *  currently active, or null if no playlist in the tree is the
   *  active one (e.g. an autoplaylist that was just removed). Updated
   *  during paint, so it always reflects what we just drew. */
  private activeRowIndex: number | null = null;

  constructor(private readonly treeStore: TreeStore) {
    this.theme = resolveTheme();
    this.rowHeight = this.theme.font.Height + ROW_VERTICAL_PADDING;
  }

  /** Call from on_colours_changed / on_font_changed once those callbacks
   *  are wired up. */
  refreshTheme(): void {
    this.theme = resolveTheme();
    this.rowHeight = this.theme.font.Height + ROW_VERTICAL_PADDING;
  }

  onSize(_width: number, _height: number): void {
    // Nothing precomputed here; paint() reads window.Width/Height and
    // clamps the scroll offset on every draw, which catches resize.
  }

  // ---------------------------------------------------------------------
  // Painting
  // ---------------------------------------------------------------------

  paint(gr: GdiGraphics): void {
    const viewportWidth = window.Width;
    const viewportHeight = window.Height;

    gr.FillSolidRect(0, 0, viewportWidth, viewportHeight, this.theme.backgroundColour);

    const rows = flattenVisibleNodes(this.treeStore.getDocument().nodes);
    this.lastFlattened = rows;

    const totalContentHeight = rows.length * this.rowHeight;
    this.scrollOffsetPx = clampScrollOffset(
      this.scrollOffsetPx,
      viewportHeight,
      totalContentHeight
    );

    const needsScrollbar = totalContentHeight > viewportHeight;
    const textAreaWidth = viewportWidth - (needsScrollbar ? SCROLLBAR_WIDTH_PX + SCROLLBAR_MARGIN_PX : 0);

    this.activeRowIndex = this.findActivePlaylistRow(rows);

    const firstVisibleIndex = Math.max(0, Math.floor(this.scrollOffsetPx / this.rowHeight));
    const lastVisibleIndex = Math.min(
      rows.length - 1,
      Math.ceil((this.scrollOffsetPx + viewportHeight) / this.rowHeight) - 1
    );

    if (lastVisibleIndex >= firstVisibleIndex) {
      for (let i = firstVisibleIndex; i <= lastVisibleIndex; i++) {
        const row = rows[i];
        if (!row) continue;
        this.paintRow(gr, row, i, textAreaWidth, viewportHeight);
      }
    }

    if (needsScrollbar) {
      this.drawScrollbar(gr, viewportWidth, viewportHeight, totalContentHeight);
    }
  }

  private paintRow(
    gr: GdiGraphics,
    row: FlatRow,
    rowIndex: number,
    textAreaWidth: number,
    viewportHeight: number
  ): void {
    const y = rowY(rowIndex, this.rowHeight) - this.scrollOffsetPx;
    if (y + this.rowHeight <= 0 || y >= viewportHeight) {
      return;
    }

    const isSelected = this.selection.isSelected(rowIndex);
    const isActive = rowIndex === this.activeRowIndex;

    const textAreaLeft = LEFT_PADDING_PX;
    const textAreaRight = textAreaWidth;

    if (isSelected) {
      gr.FillSolidRect(0, y, textAreaRight, this.rowHeight, this.theme.selectionBackgroundColour);
    }

    if (isActive) {
      gr.DrawRect(
        ACTIVE_FRAME_PX / 2,
        y + ACTIVE_FRAME_PX / 2,
        Math.max(0, textAreaRight - ACTIVE_FRAME_PX),
        Math.max(0, this.rowHeight - ACTIVE_FRAME_PX),
        ACTIVE_FRAME_PX,
        this.theme.activeItemFrameColour
      );
    }

    const textColour = isSelected ? this.theme.selectionTextColour : this.theme.textColour;

    const labelX = textAreaLeft + row.depth * INDENT_PX;
    const labelWidth = Math.max(0, textAreaRight - labelX);

    let label: string;
    if (isFolderNode(row.node)) {
      label = (row.node.expanded ? FOLDER_EXPANDED_PREFIX : FOLDER_COLLAPSED_PREFIX) + row.node.name;
    } else {
      label = row.node.name;
    }

    gr.GdiDrawText(
      label,
      this.theme.font,
      textColour,
      labelX,
      y,
      labelWidth,
      this.rowHeight,
      DT.VCENTER | DT.SINGLELINE | DT.NOPREFIX | DT.END_ELLIPSIS | DT.NOCLIP
    );
  }

  private findActivePlaylistRow(rows: FlatRow[]): number | null {
    const activeIndex = plman.ActivePlaylist;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (isPlaylistNode(row.node) && row.node.index === activeIndex) {
        return i;
      }
    }
    return null;
  }

  private drawScrollbar(
    gr: GdiGraphics,
    viewportWidth: number,
    viewportHeight: number,
    totalContentHeight: number
  ): void {
    const maxScroll = Math.max(1, totalContentHeight - viewportHeight);
    const trackX = viewportWidth - SCROLLBAR_WIDTH_PX;
    const thumbHeight = Math.max(20, (viewportHeight * viewportHeight) / totalContentHeight);
    const scrollRatio = this.scrollOffsetPx / maxScroll;
    const thumbY = Math.max(0, scrollRatio * (viewportHeight - thumbHeight));

    // Blend partway toward the text colour for a visible-but-subtle thumb,
    // without introducing a whole separate colour-scheme decision yet.
    const thumbColour = blendColours(this.theme.backgroundColour, this.theme.textColour, 0.35);

    gr.FillSolidRect(trackX, thumbY, SCROLLBAR_WIDTH_PX, thumbHeight, thumbColour);
  }

  // ---------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------

  /** Currently selected rows, in display order. Read-only view. */
  getSelection(): Selection {
    return this.selection;
  }

  /** Current scroll offset, in pixels. Exposed for tests. */
  getScrollOffset(): number {
    return this.scrollOffsetPx;
  }

  onMouseLbtnDown(x: number, y: number, mask: number): void {
    const hit = this.hitTest(x, y);

    if (hit === null) {
      // Click on empty area below the last row / on the scrollbar. Clear
      // the selection so a stray click doesn't leave a stale row
      // highlighted. (Scrollbar is hit by the scrollOffsetPx math - it's
      // outside the text area but inside the viewport; rowAtY still
      // returns null there because rowWidth > textAreaWidth is not
      // enforced, but the scrollbar x is well to the right of any row.)
      this.selection.clear();
      window.Repaint();
      return;
    }

    if (hit.isDisclosure && isFolderNode(hit.row.node)) {
      // Toggling the disclosure triangle is a structural edit and is
      // NEVER ctrl/shift-modified - those modifiers belong to selection
      // operations. The click also doesn't change the selection, so
      // users can collapse a folder while keeping their current pick.
      hit.row.node.expanded = !hit.row.node.expanded;
      this.treeStore.scheduleSave();
      window.Repaint();
      return;
    }

    const isCtrl = (mask & MouseMask.CONTROL) !== 0;
    const isShift = (mask & MouseMask.SHIFT) !== 0;

    if (isShift) {
      const target = this.selection.extendRangeTo(hit.rowIndex);
      this.scrollSelectionIntoView(target);
    } else if (isCtrl) {
      this.selection.toggle(hit.rowIndex);
    } else {
      this.selection.setSingle(hit.rowIndex);
    }

    const options = this.treeStore.getDocument().options;
    if (options.activateOnSingleClick && isPlaylistNode(hit.row.node)) {
      plman.ActivePlaylist = hit.row.node.index;
    }

    window.Repaint();
  }

  onMouseLbtnDblClick(x: number, y: number, _mask: number): void {
    const hit = this.hitTest(x, y);
    if (hit === null) return;

    if (isFolderNode(hit.row.node)) {
      // Double-click on a folder toggles it - same as the disclosure
      // triangle. The single-click on the row body (not the triangle)
      // selects without toggling, so this is the "I clicked the folder
      // name twice" gesture.
      hit.row.node.expanded = !hit.row.node.expanded;
      this.treeStore.scheduleSave();
    } else if (isPlaylistNode(hit.row.node)) {
      plman.ActivePlaylist = hit.row.node.index;
    }
    window.Repaint();
  }

  onMouseRbtnUp(_x: number, _y: number, _mask: number): void {
    // Phase 6 will build and track a ContextMenuManager here. For now,
    // we explicitly DO NOT track the right-click - returning without
    // calling any selection-changing code means SMP's default behaviour
    // applies (no menu, no selection change), which matches "no right-
    // click menu exists yet" better than a state mutation that we then
    // have to undo.
  }

  onMouseWheel(step: number): void {
    // SMP's documented convention: positive step = wheel rolled forward
    // = scroll content up = decrease scroll offset. Multiply by rows
    // per notch for a usable per-notch amount.
    const deltaPx = -step * WHEEL_LINES_PER_NOTCH * this.rowHeight;
    const totalContentHeight = this.lastFlattened.length * this.rowHeight;
    this.scrollOffsetPx = clampScrollOffset(
      this.scrollOffsetPx + deltaPx,
      window.Height,
      totalContentHeight
    );
    window.Repaint();
  }

  onKeyDown(vkey: number, mask: number): void {
    const totalRows = this.lastFlattened.length;
    if (totalRows === 0) {
      return;
    }

    const isShift = (mask & KeyMask.SHIFT) !== 0;

    // Note: Ctrl+A select-all is intentionally not bound - per the
    // owner's preference, the panel doesn't grab that shortcut.

    if (vkey === VK.ESCAPE) {
      if (!this.selection.isEmpty()) {
        this.selection.clear();
        window.Repaint();
      }
      return;
    }

    if (vkey === VK.RETURN) {
      this.activateAnchor();
      return;
    }

    if (vkey === VK.F2) {
      this.onRenameRequested();
      return;
    }

    const currentAnchor = this.selection.getAnchor();
    const cursor: number = currentAnchor !== null
      ? currentAnchor
      : (this.selection.first() ?? 0);

    let next: number | null = null;

    switch (vkey) {
      case VK.DOWN:
        next = cursor + 1 < totalRows ? cursor + 1 : cursor;
        break;
      case VK.UP:
        next = cursor - 1 >= 0 ? cursor - 1 : cursor;
        break;
      case VK.HOME:
        next = 0;
        break;
      case VK.END:
        next = totalRows - 1;
        break;
      case VK.PRIOR: {
        const page = Math.max(1, Math.floor(window.Height / this.rowHeight));
        next = Math.max(0, cursor - page);
        break;
      }
      case VK.NEXT: {
        const page = Math.max(1, Math.floor(window.Height / this.rowHeight));
        next = Math.min(totalRows - 1, cursor + page);
        break;
      }
      case VK.LEFT:
        next = this.handleLeftKey(cursor);
        break;
      case VK.RIGHT:
        next = this.handleRightKey(cursor);
        break;
      default:
        return;
    }

    if (next === null) return;

    if (isShift) {
      this.selection.extendRangeTo(next);
    } else {
      this.selection.setSingle(next);
    }
    this.scrollSelectionIntoView(next);
    window.Repaint();
  }

  /**
   * Sets plman.ActivePlaylist to the index of the first selected
   * playlist node, if any. Folders are skipped (Enter on a folder-only
   * selection is a no-op, matching the original foo_plorg).
   */
  private activateAnchor(): void {
    for (const rowIndex of this.selection.iter()) {
      if (rowIndex >= this.lastFlattened.length) continue;
      const row = this.lastFlattened[rowIndex];
      if (!row) continue;
      if (isPlaylistNode(row.node)) {
        plman.ActivePlaylist = row.node.index;
        return;
      }
    }
  }

  /**
   * Prompts the user for a new name and applies it.
   */
  onRenameRequested(): void {
    if (this.selection.getSize() === 0) {
      return;
    }
    if (this.selection.getSize() > 1) {
      fb.ShowPopupMessage('Select a single item to rename.');
      return;
    }

    const rowIndex = this.selection.getAnchor();
    if (rowIndex === null) return;
    const row = this.lastFlattened[rowIndex];
    if (!row) return;

    const prompt = isFolderNode(row.node)
      ? 'New folder name:'
      : 'New playlist name:';

    let raw: string;
    try {
      raw = utils.InputBox(window.ID, prompt, 'Rename', row.node.name, true);
    } catch {
      return; // user cancelled
    }

    const newName = raw.trim();
    if (newName === row.node.name) {
      return; // no change
    }

    if (isFolderNode(row.node)) {
      this.treeStore.renameFolder(row.node, newName);
    } else if (isPlaylistNode(row.node)) {
      // plman enforces its own playlist-name uniqueness and may also
      // reject the rename for other reasons (lock, etc.). Empty new
      // names are allowed here per the "sibling collisions + empty
      // names allowed" design - plman may or may not accept them; if
      // it doesn't, we surface a generic failure popup.
      const ok = plman.RenamePlaylist(row.node.index, newName);
      if (!ok) {
        fb.ShowPopupMessage(
          'Rename failed. foobar2000 may have rejected the new name (duplicate or locked playlist).'
        );
        return;
      }
      // Optimistically update the cached name so the tree shows the
      // new name immediately. on_playlists_changed will fire
      // asynchronously and reconcile, but this avoids a brief flicker.
      row.node.name = newName;
      this.treeStore.scheduleSave();
    }

    window.Repaint();
  }

  /**
   * LEFT in Explorer convention: collapse an expanded folder, otherwise
   * jump to the parent. Returns the new cursor row, or null if the
   * cursor doesn't move (e.g. we're already on a root-level leaf and
   * there's no parent to jump to).
   */
  private handleLeftKey(cursor: number): number | null {
    const row = this.lastFlattened[cursor];
    if (!row) return null;
    if (isFolderNode(row.node) && row.node.expanded) {
      row.node.expanded = false;
      this.treeStore.scheduleSave();
      return cursor;
    }
    // Find the nearest ancestor by walking up while decreasing depth.
    for (let i = cursor - 1; i >= 0; i--) {
      const candidate = this.lastFlattened[i];
      if (!candidate) continue;
      if (candidate.depth < row.depth) {
        return i;
      }
    }
    return null;
  }

  /**
   * RIGHT in Explorer convention: expand a collapsed folder, otherwise
   * jump to the first child (or stay put if the row has no children).
   */
  private handleRightKey(cursor: number): number | null {
    const row = this.lastFlattened[cursor];
    if (!row) return null;
    if (isFolderNode(row.node)) {
      if (!row.node.expanded) {
        row.node.expanded = true;
        this.treeStore.scheduleSave();
      } else if (cursor + 1 < this.lastFlattened.length) {
        const child = this.lastFlattened[cursor + 1];
        if (child && child.depth === row.depth + 1) {
          return cursor + 1;
        }
      }
      return cursor;
    }
    // Playlist leaf - jump to next sibling if there is one.
    if (cursor + 1 < this.lastFlattened.length) {
      const next = this.lastFlattened[cursor + 1];
      if (next && next.depth === row.depth) {
        return cursor + 1;
      }
    }
    return null;
  }

  private scrollSelectionIntoView(rowIndex: number): void {
    const totalContentHeight = this.lastFlattened.length * this.rowHeight;
    this.scrollOffsetPx = ensureRowVisible(
      rowIndex,
      this.scrollOffsetPx,
      window.Height,
      this.rowHeight,
      totalContentHeight
    );
  }

  /**
   * Map a window-space (x, y) to a row index and whether the click
   * landed on the disclosure-triangle column. Returns null when the
   * click was on the scrollbar or below the last row.
   */
  private hitTest(x: number, y: number): HitResult | null {
    if (this.lastFlattened.length === 0) {
      return null;
    }

    // The scrollbar lives on the right edge; clicks on it shouldn't
    // count as "click on the bottom-most row" or anything.
    const needsScrollbar = this.lastFlattened.length * this.rowHeight > window.Height;
    if (needsScrollbar && x >= window.Width - SCROLLBAR_WIDTH_PX - SCROLLBAR_MARGIN_PX) {
      return null;
    }

    const rowIndex = rowAtY(y, this.scrollOffsetPx, this.rowHeight, this.lastFlattened.length);
    if (rowIndex === null) {
      return null;
    }

    const row = this.lastFlattened[rowIndex];
    if (!row) {
      return null;
    }

    const disclosureX = LEFT_PADDING_PX + row.depth * INDENT_PX;
    const isDisclosure =
      isFolderNode(row.node) && x >= disclosureX && x < disclosureX + DISCLOSURE_HIT_WIDTH_PX;

    return { rowIndex, isDisclosure, row };
  }
}

/** Linear-interpolates between two 0xAARRGGBB colours. `t` of 0 = a, 1 = b. */
function blendColours(a: number, b: number, t: number): number {
  const channel = (shift: number): number => {
    const av = (a >>> shift) & 0xff;
    const bv = (b >>> shift) & 0xff;
    return Math.round(av + (bv - av) * t) & 0xff;
  };
  return (0xff << 24) | (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
