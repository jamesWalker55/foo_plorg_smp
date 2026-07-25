/**
 * Selection state for the tree view. Always expressed in terms of flat
 * row indices (positions in the unrolled, expanded-or-not tree produced
 * by `flattenVisibleNodes`) so that callers don't have to care whether
 * a row is a folder or a leaf - the same model applies uniformly.
 *
 * Anchor semantics follow Windows Explorer: a plain click sets both the
 * selection and the anchor to the clicked row; ctrl-click toggles the
 * row in the selection and moves the anchor; shift-click replaces the
 * selection with the range [anchor..clicked] (in either direction).
 * This is what makes shift-arrow extend the existing range work
 * naturally too.
 *
 * NOT thread-safe, but SMP is single-threaded so this is fine.
 */
export class Selection {
  private readonly selected = new Set<number>();
  private anchor: number | null = null;

  isEmpty(): boolean {
    return this.selected.size === 0;
  }

  getSize(): number {
    return this.selected.size;
  }

  getAnchor(): number | null {
    return this.anchor;
  }

  isSelected(row: number): boolean {
    return this.selected.has(row);
  }

  /** Replaces the selection with a single row; resets anchor to that row. */
  setSingle(row: number): void {
    this.selected.clear();
    this.selected.add(row);
    this.anchor = row;
  }

  /**
   * Toggles `row` in/out of the selection and moves the anchor to it.
   * After this, `isSelected(row)` is guaranteed to be the opposite of
   * what it was on entry, even if the row was already in the set.
   */
  toggle(row: number): void {
    if (this.selected.has(row)) {
      this.selected.delete(row);
    } else {
      this.selected.add(row);
    }
    this.anchor = row;
  }

  /**
   * Replaces the selection with the inclusive range [min(from,to) .. max(from,to)].
   * Leaves the anchor alone (the caller is presumably in the middle of a
   * shift-extend that started at the existing anchor).
   */
  setRange(from: number, to: number): void {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    this.selected.clear();
    for (let i = lo; i <= hi; i++) {
      this.selected.add(i);
    }
  }

  /**
   * Shift-extend: if there is no anchor yet, falls back to setSingle();
   * otherwise replaces the selection with [anchor..row] inclusive.
   * Returns the row that should now be scrolled into view (i.e. `row`).
   */
  extendRangeTo(row: number): number {
    if (this.anchor === null) {
      this.setSingle(row);
    } else {
      this.setRange(this.anchor, row);
    }
    return row;
  }

  /** Selects every row from 0..count-1. Leaves the anchor alone. */
  selectAll(count: number): void {
    this.selected.clear();
    for (let i = 0; i < count; i++) {
      this.selected.add(i);
    }
  }

  clear(): void {
    this.selected.clear();
    this.anchor = null;
  }

  /**
   * Yields the selected row indices in ascending display order. Useful
   * for any "do something with the selection" code path (e.g. Phase 6's
   * "move selected to folder" / right-click bulk ops).
   */
  *iter(): IterableIterator<number> {
    const sorted = [...this.selected].sort((a, b) => a - b);
    for (const i of sorted) {
      yield i;
    }
  }

  /** The selected row nearest the top of the view, or null if empty. */
  first(): number | null {
    if (this.selected.size === 0) return null;
    let min = Number.POSITIVE_INFINITY;
    for (const i of this.selected) {
      if (i < min) min = i;
    }
    return min;
  }

  /** The selected row nearest the bottom of the view, or null if empty. */
  last(): number | null {
    if (this.selected.size === 0) return null;
    let max = Number.NEGATIVE_INFINITY;
    for (const i of this.selected) {
      if (i > max) max = i;
    }
    return max;
  }
}
