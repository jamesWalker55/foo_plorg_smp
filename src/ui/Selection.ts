import { FlatRow } from './TreeLayout';

export interface ClickModifiers {
  shift: boolean;
  ctrl: boolean;
}

/**
 * Selection is tracked by node id (see NodeBase.id in types/tree.ts), not
 * by row index or object reference - both of those are unstable across a
 * reconcile() pass or a re-render. `rows` (the current flattened visible
 * list) is passed into each method rather than stored, since it can
 * change between calls (expand/collapse, reconcile) and the caller
 * always has a fresh one available.
 */
export class SelectionState {
  private selectedIds = new Set<string>();
  /** Range-select start point for shift-click / shift-arrow. Reset on a
   *  plain click or ctrl-click, held steady across repeated shift-clicks
   *  so the range can grow/shrink from the same origin. */
  private anchorId: string | null = null;
  /** The single "current" row for keyboard navigation - not necessarily
   *  the same as the anchor once a shift-range has been extended. */
  private focusedId: string | null = null;

  isSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }

  getFocusedId(): string | null {
    return this.focusedId;
  }

  getSelectedIds(): ReadonlySet<string> {
    return this.selectedIds;
  }

  clear(): void {
    this.selectedIds.clear();
    this.anchorId = null;
    this.focusedId = null;
  }

  /** Drops any selected/focused/anchor id no longer present in `rows` -
   *  call after a reconcile() that may have dropped nodes. */
  pruneToExisting(rows: FlatRow[]): void {
    const existing = new Set(rows.map((r) => r.node.id));
    for (const id of this.selectedIds) {
      if (!existing.has(id)) {
        this.selectedIds.delete(id);
      }
    }
    if (this.anchorId !== null && !existing.has(this.anchorId)) {
      this.anchorId = null;
    }
    if (this.focusedId !== null && !existing.has(this.focusedId)) {
      this.focusedId = null;
    }
  }

  /**
   * Applies the click-selection rule for a row click:
   *   - plain click: select only this row, new anchor.
   *   - ctrl+click: toggle this row's membership, new anchor.
   *   - shift+click: select the contiguous range from the current anchor
   *     to this row (inclusive), replacing the prior selection. If there
   *     is no anchor yet, behaves like a plain click.
   * In all cases, focus moves to the clicked row.
   */
  handleRowClick(rows: FlatRow[], clickedIndex: number, modifiers: ClickModifiers): void {
    const clicked = rows[clickedIndex];
    if (!clicked) {
      return;
    }
    const clickedId = clicked.node.id;

    if (modifiers.shift && this.anchorId !== null) {
      const anchorIndex = rows.findIndex((r) => r.node.id === this.anchorId);
      if (anchorIndex !== -1) {
        const [start, end] = anchorIndex <= clickedIndex ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex];
        this.selectedIds = new Set(rows.slice(start, end + 1).map((r) => r.node.id));
        this.focusedId = clickedId;
        return;
      }
      // Anchor no longer exists in the current rows - fall through to
      // plain-click behaviour below rather than doing nothing.
    }

    if (modifiers.ctrl) {
      if (this.selectedIds.has(clickedId)) {
        this.selectedIds.delete(clickedId);
      } else {
        this.selectedIds.add(clickedId);
      }
      this.anchorId = clickedId;
      this.focusedId = clickedId;
      return;
    }

    this.selectedIds = new Set([clickedId]);
    this.anchorId = clickedId;
    this.focusedId = clickedId;
  }

  /**
   * Moves keyboard focus by `delta` rows (typically ±1, or a larger jump
   * for Home/End/PageUp/PageDown). If `extendSelection` (Shift held),
   * selects the range from the anchor to the new focus, same as
   * shift-click; otherwise selects only the new focus row and resets the
   * anchor there, same as a plain click.
   */
  moveFocus(rows: FlatRow[], delta: number, extendSelection: boolean): void {
    if (rows.length === 0) {
      return;
    }

    const currentIndex = this.focusedId !== null ? rows.findIndex((r) => r.node.id === this.focusedId) : -1;
    const nextIndex = clamp(currentIndex === -1 ? (delta > 0 ? 0 : rows.length - 1) : currentIndex + delta, 0, rows.length - 1);

    this.moveFocusTo(rows, nextIndex, extendSelection);
  }

  /** Same as moveFocus, but to an absolute row index (Home/End). */
  moveFocusTo(rows: FlatRow[], index: number, extendSelection: boolean): void {
    const row = rows[index];
    if (!row) {
      return;
    }

    if (extendSelection) {
      if (this.anchorId === null) {
        this.anchorId = row.node.id;
      }
      const anchorIndex = rows.findIndex((r) => r.node.id === this.anchorId);
      if (anchorIndex !== -1) {
        const [start, end] = anchorIndex <= index ? [anchorIndex, index] : [index, anchorIndex];
        this.selectedIds = new Set(rows.slice(start, end + 1).map((r) => r.node.id));
      }
    } else {
      this.selectedIds = new Set([row.node.id]);
      this.anchorId = row.node.id;
    }

    this.focusedId = row.node.id;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
