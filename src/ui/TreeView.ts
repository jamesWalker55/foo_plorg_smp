import { TreeStore, getCurrentPlaylistNames } from '../data/TreeStore';
import { isFolderNode, isPlaylistNode } from '../types/tree';
import { flattenVisibleNodes, FlatRow } from './TreeLayout';
import { resolveTheme, Theme } from './Theme';
import { DT, MK, VK } from '../types/flags';
import { SelectionState, ClickModifiers } from './Selection';

const ROW_VERTICAL_PADDING = 6;
const INDENT_PX = 16;
const LEFT_PADDING_PX = 8;
const SCROLLBAR_WIDTH_PX = 8;
const SCROLLBAR_MARGIN_PX = 2;

/**
 * Width of the click zone that toggles a folder's expanded state,
 * measured from the row's indent start. This is a fixed approximation,
 * not measured against the actual glyph's rendered width - mouse
 * callbacks don't receive a GdiGraphics context (only on_paint does), so
 * gr.CalcTextWidth() isn't available outside of paint() to measure the
 * real glyph bounds. Close enough for a 1-2 character prefix at normal
 * UI font sizes.
 */
const GLYPH_HIT_WIDTH_PX = INDENT_PX;

// Plain-text disclosure indicators, since icons are out of scope for now
// (see project decisions - plain text, clean indent, no icons/connector
// lines). Revisit if/when Phase 7 (colour/state polish) adds real icons.
const FOLDER_EXPANDED_PREFIX = '\u25BE '; // '▾ '
const FOLDER_COLLAPSED_PREFIX = '\u25B8 '; // '▸ '

export class TreeView {
  private theme: Theme;
  private rowHeight: number;
  private scrollOffsetPx = 0;
  private readonly selection = new SelectionState();

  constructor(private readonly treeStore: TreeStore) {
    this.theme = resolveTheme();
    this.rowHeight = this.theme.font.Height + ROW_VERTICAL_PADDING;
  }

  /** Call from on_colours_changed / on_font_changed once those callbacks
   *  are wired up - not yet done in this phase. */
  refreshTheme(): void {
    this.theme = resolveTheme();
    this.rowHeight = this.theme.font.Height + ROW_VERTICAL_PADDING;
  }

  onSize(_width: number, _height: number): void {
    // Nothing to precompute yet - paint() reads window.Width/Height
    // directly since on_paint doesn't receive them.
  }

  /** Call after any treeStore.reconcile() that may have dropped nodes,
   *  so selection/focus never reference an id that no longer exists. */
  pruneSelection(): void {
    this.selection.pruneToExisting(this.getVisibleRows());
  }

  paint(gr: GdiGraphics): void {
    const viewportWidth = window.Width;
    const viewportHeight = window.Height;

    gr.FillSolidRect(0, 0, viewportWidth, viewportHeight, this.theme.backgroundColour);

    const rows = this.getVisibleRows();
    const totalContentHeight = rows.length * this.rowHeight;

    const maxScroll = Math.max(0, totalContentHeight - viewportHeight);
    this.scrollOffsetPx = clamp(this.scrollOffsetPx, 0, maxScroll);

    const needsScrollbar = totalContentHeight > viewportHeight;
    const textAreaWidth = viewportWidth - (needsScrollbar ? SCROLLBAR_WIDTH_PX + SCROLLBAR_MARGIN_PX : 0);

    const firstVisibleIndex = Math.floor(this.scrollOffsetPx / this.rowHeight);
    const textFormat = DT.VCENTER | DT.SINGLELINE | DT.NOPREFIX | DT.END_ELLIPSIS | DT.NOCLIP;

    for (let i = firstVisibleIndex; i < rows.length; i++) {
      const row = rows[i];
      if (!row) break;

      const y = i * this.rowHeight - this.scrollOffsetPx;
      if (y >= viewportHeight) break;

      const selected = this.selection.isSelected(row.node.id);
      if (selected) {
        gr.FillSolidRect(0, y, viewportWidth, this.rowHeight, this.theme.selectionBackgroundColour);
      }

      const x = LEFT_PADDING_PX + row.depth * INDENT_PX;
      const label = isFolderNode(row.node)
        ? (row.node.expanded ? FOLDER_EXPANDED_PREFIX : FOLDER_COLLAPSED_PREFIX) + row.node.name
        : row.node.name;

      gr.GdiDrawText(
        label,
        this.theme.font,
        selected ? this.theme.selectionTextColour : this.theme.textColour,
        x,
        y,
        Math.max(0, textAreaWidth - x),
        this.rowHeight,
        textFormat
      );
    }

    if (needsScrollbar) {
      this.drawScrollbar(gr, viewportWidth, viewportHeight, totalContentHeight, maxScroll);
    }
  }

  /**
   * Handles a left mouse-button-down. Applies the click-selection rule
   * (see SelectionState.handleRowClick) to whatever row was hit, then -
   * if the row is a folder AND the click landed in its glyph zone -
   * additionally toggles its expanded state. If the row is a playlist
   * and options.activateOnSingleClick is set, also switches foobar's
   * active playlist to it (a plain click only - not while ctrl/shift
   * are held, since that's a multi-select gesture, not an "open this"
   * gesture).
   */
  handleMouseDown(x: number, y: number, mask: number): void {
    const rows = this.getVisibleRows();
    const index = this.hitTestRowIndex(rows, y);
    if (index === null) {
      return;
    }
    const row = rows[index]!;

    const modifiers: ClickModifiers = { shift: (mask & MK.SHIFT) !== 0, ctrl: (mask & MK.CONTROL) !== 0 };
    this.selection.handleRowClick(rows, index, modifiers);

    if (isFolderNode(row.node)) {
      const glyphStart = LEFT_PADDING_PX + row.depth * INDENT_PX;
      if (x >= glyphStart && x < glyphStart + GLYPH_HIT_WIDTH_PX) {
        this.treeStore.setFolderExpanded(row.node.id, !row.node.expanded);
      }
    } else if (isPlaylistNode(row.node) && !modifiers.shift && !modifiers.ctrl) {
      if (this.treeStore.getDocument().options.activateOnSingleClick) {
        activatePlaylist(row.node.index);
      }
    }

    this.ensureRowVisible(index);
  }

  /**
   * Double-click: always toggles a folder's expanded state (anywhere on
   * the row, not just the glyph zone - standard convention), or always
   * activates a playlist regardless of the activateOnSingleClick option
   * (double-click-to-open is close to universal, so it's not gated by
   * that option).
   */
  handleDoubleClick(x: number, y: number): void {
    const rows = this.getVisibleRows();
    const index = this.hitTestRowIndex(rows, y);
    if (index === null) {
      return;
    }
    const row = rows[index]!;

    this.selection.handleRowClick(rows, index, { shift: false, ctrl: false });

    if (isFolderNode(row.node)) {
      this.treeStore.setFolderExpanded(row.node.id, !row.node.expanded);
    } else if (isPlaylistNode(row.node)) {
      activatePlaylist(row.node.index);
    }

    this.ensureRowVisible(index);
  }

  /**
   * Keyboard navigation. Requires window.DlgCode to include
   * DLGC.WANTARROWS (set once in main.ts) for arrow keys to actually
   * reach this at all - see smp.d.ts DlgCode doc comment.
   */
  handleKeyDown(vkey: number): void {
    const rows = this.getVisibleRows();
    if (rows.length === 0) {
      return;
    }
    const shiftHeld = utils.IsKeyPressed(VK.SHIFT);
    const viewportRowCount = Math.max(1, Math.floor(window.Height / this.rowHeight));

    switch (vkey) {
      case VK.UP:
        this.selection.moveFocus(rows, -1, shiftHeld);
        this.ensureFocusVisible(rows);
        return;
      case VK.DOWN:
        this.selection.moveFocus(rows, 1, shiftHeld);
        this.ensureFocusVisible(rows);
        return;
      case VK.PGUP:
        this.selection.moveFocus(rows, -viewportRowCount, shiftHeld);
        this.ensureFocusVisible(rows);
        return;
      case VK.PGDN:
        this.selection.moveFocus(rows, viewportRowCount, shiftHeld);
        this.ensureFocusVisible(rows);
        return;
      case VK.HOME:
        this.selection.moveFocusTo(rows, 0, shiftHeld);
        this.ensureFocusVisible(rows);
        return;
      case VK.END:
        this.selection.moveFocusTo(rows, rows.length - 1, shiftHeld);
        this.ensureFocusVisible(rows);
        return;
      case VK.LEFT:
        this.handleLeftArrow(rows);
        return;
      case VK.RIGHT:
        this.handleRightArrow(rows);
        return;
      case VK.RETURN:
        this.handleActivateFocused(rows);
        return;
      case VK.F2:
        this.handleRenameFocused(rows);
        return;
      default:
        return;
    }
  }

  private handleLeftArrow(rows: FlatRow[]): void {
    const focused = this.getFocusedRow(rows);
    if (!focused) return;

    if (isFolderNode(focused.node) && focused.node.expanded) {
      this.treeStore.setFolderExpanded(focused.node.id, false);
      return;
    }
    if (focused.parent) {
      const parentIndex = rows.findIndex((r) => r.node.id === focused.parent!.id);
      if (parentIndex !== -1) {
        this.selection.moveFocusTo(rows, parentIndex, false);
        this.ensureFocusVisible(rows);
      }
    }
  }

  private handleRightArrow(rows: FlatRow[]): void {
    const focusedIndex = this.getFocusedIndex(rows);
    if (focusedIndex === null) return;
    const focused = rows[focusedIndex]!;

    if (isFolderNode(focused.node)) {
      if (!focused.node.expanded) {
        this.treeStore.setFolderExpanded(focused.node.id, true);
        return;
      }
      // Already expanded - move to first child, which (if it has any
      // children) is the very next row once re-flattened.
      const refreshedRows = this.getVisibleRows();
      const stillAtIndex = refreshedRows[focusedIndex];
      if (stillAtIndex && refreshedRows[focusedIndex + 1]?.parent?.id === focused.node.id) {
        this.selection.moveFocusTo(refreshedRows, focusedIndex + 1, false);
        this.ensureFocusVisible(refreshedRows);
      }
    }
  }

  private handleActivateFocused(rows: FlatRow[]): void {
    const focused = this.getFocusedRow(rows);
    if (!focused) return;

    if (isPlaylistNode(focused.node)) {
      activatePlaylist(focused.node.index);
    } else if (isFolderNode(focused.node)) {
      this.treeStore.setFolderExpanded(focused.node.id, !focused.node.expanded);
    }
  }

  /**
   * F2 rename. Mirrors Explorer: disabled outright when more than one
   * row is selected, rather than guessing which one the user meant.
   * Uses utils.InputBox (native modal dialog) rather than a hand-rolled
   * inline edit box - see README "Inline rename" for why.
   */
  private handleRenameFocused(rows: FlatRow[]): void {
    if (this.selection.getSelectedIds().size > 1) {
      return;
    }
    const focused = this.getFocusedRow(rows);
    if (!focused) return;

    if (isFolderNode(focused.node)) {
      const newName = utils.InputBox(0, 'Folder name:', 'Rename folder', focused.node.name);
      if (newName !== focused.node.name) {
        this.treeStore.renameFolder(focused.node.id, newName);
      }
    } else if (isPlaylistNode(focused.node)) {
      const newName = utils.InputBox(0, 'Playlist name:', 'Rename playlist', focused.node.name);
      if (newName !== focused.node.name && newName.trim() !== '') {
        const ok = plman.RenamePlaylist(focused.node.index, newName);
        if (!ok) {
          console.log(`foo_plorg_smp: plman.RenamePlaylist failed for index ${focused.node.index} (locked playlist?)`);
        }
        // Don't wait for the next on_playlists_changed firing - reconcile
        // immediately so the tree reflects the rename without a visible
        // delay. Idempotent, so it's harmless if on_playlists_changed
        // also fires separately for the same change (it should).
        this.treeStore.reconcile(getCurrentPlaylistNames());
      }
    }
  }

  private getVisibleRows(): FlatRow[] {
    return flattenVisibleNodes(this.treeStore.getDocument().nodes);
  }

  private getFocusedIndex(rows: FlatRow[]): number | null {
    const id = this.selection.getFocusedId();
    if (id === null) return null;
    const index = rows.findIndex((r) => r.node.id === id);
    return index === -1 ? null : index;
  }

  private getFocusedRow(rows: FlatRow[]): FlatRow | null {
    const index = this.getFocusedIndex(rows);
    return index === null ? null : rows[index]!;
  }

  /** Hit-tests a y coordinate (viewport-relative, as delivered by mouse
   *  callbacks) against the current scroll offset. Returns null if the
   *  click was below the last row. */
  private hitTestRowIndex(rows: FlatRow[], y: number): number | null {
    const index = Math.floor((y + this.scrollOffsetPx) / this.rowHeight);
    return index >= 0 && index < rows.length ? index : null;
  }

  private ensureRowVisible(index: number): void {
    const rowTop = index * this.rowHeight;
    const rowBottom = rowTop + this.rowHeight;
    if (rowTop < this.scrollOffsetPx) {
      this.scrollOffsetPx = rowTop;
    } else if (rowBottom > this.scrollOffsetPx + window.Height) {
      this.scrollOffsetPx = rowBottom - window.Height;
    }
  }

  private ensureFocusVisible(rows: FlatRow[]): void {
    const index = this.getFocusedIndex(rows);
    if (index !== null) {
      this.ensureRowVisible(index);
    }
  }

  private drawScrollbar(
    gr: GdiGraphics,
    viewportWidth: number,
    viewportHeight: number,
    totalContentHeight: number,
    maxScroll: number
  ): void {
    const trackX = viewportWidth - SCROLLBAR_WIDTH_PX;
    const thumbHeight = Math.max(20, (viewportHeight * viewportHeight) / totalContentHeight);
    const scrollRatio = maxScroll > 0 ? this.scrollOffsetPx / maxScroll : 0;
    const thumbY = scrollRatio * (viewportHeight - thumbHeight);

    // Blend partway toward the text colour for a visible-but-subtle thumb,
    // without introducing a whole separate colour-scheme decision yet.
    const thumbColour = blendColours(this.theme.backgroundColour, this.theme.textColour, 0.35);

    gr.FillSolidRect(trackX, thumbY, SCROLLBAR_WIDTH_PX, thumbHeight, thumbColour);
  }
}

function activatePlaylist(index: number): void {
  plman.ActivePlaylist = index;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
