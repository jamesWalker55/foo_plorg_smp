import { TreeNode, isFolderNode } from '../types/tree';

export interface FlatRow {
  node: TreeNode;
  depth: number;
  /**
   * The siblings array that contains this row - i.e. the array from
   * which `node` was read. `parent` IS the array, not a folder wrapper
   * around it, so `parent.indexOf(row.node)` gives the row's position
   * in the array and iterating `parent` gives the row's siblings.
   *
   * Top-level rows have `parent === rootNodes` (the document's
   * top-level array). Folders are not parents themselves; their
   * children live in a separate array, which is the `parent` of any
   * row that nests inside them.
   *
   * Used by rename (Phase 4) to check for sibling-name collisions
   * without having to walk the whole document.
   */
  parent: TreeNode[];
}

/**
 * Produces the list of rows that would actually be visible if the tree
 * were fully unrolled (i.e. respecting `expanded: false` on folders by
 * omitting their children). This is the same list virtualization slices
 * into a viewport window - see TreeView.
 *
 * `parent` is the array from which each row was read (see FlatRow).
 * Root callers pass the document's top-level node array; recursive
 * calls pass each folder's `children` array.
 */
export function flattenVisibleNodes(
  nodes: TreeNode[],
  depth = 0,
  parent: TreeNode[] = nodes
): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const node of nodes) {
    rows.push({ node, depth, parent });
    if (isFolderNode(node) && node.expanded) {
      rows.push(...flattenVisibleNodes(node.children, depth + 1, node.children));
    }
  }
  return rows;
}

/**
 * Returns the flat-row index whose top edge sits at or above `y` and
 * whose bottom edge sits strictly below it, or null if `y` is outside
 * the row range entirely.
 *
 * `y` is in window coordinates (the same `y` passed to on_mouse_*
 * callbacks, NOT a content-space coordinate). Callers in the input
 * handlers feed raw click `y` values here; paint callers feeding the
 * row's own computed `y` would always land on the correct row.
 */
export function rowAtY(
  y: number,
  scrollOffsetPx: number,
  rowHeight: number,
  totalRows: number
): number | null {
  if (y < 0 || totalRows === 0 || rowHeight <= 0) {
    return null;
  }
  const index = Math.floor((y + scrollOffsetPx) / rowHeight);
  if (index < 0 || index >= totalRows) {
    return null;
  }
  return index;
}

/** Y position (window-space) of the top edge of the row at `index`. */
export function rowY(index: number, rowHeight: number): number {
  return index * rowHeight;
}

/**
 * Clamps a scroll offset so it cannot scroll past either end of the
 * content. Returns 0 if the content fits entirely in the viewport.
 */
export function clampScrollOffset(
  scrollOffsetPx: number,
  viewportHeight: number,
  totalContentHeight: number
): number {
  const maxScroll = Math.max(0, totalContentHeight - viewportHeight);
  if (scrollOffsetPx > maxScroll) return maxScroll;
  if (scrollOffsetPx < 0) return 0;
  return scrollOffsetPx;
}

/**
 * Returns a scroll offset that ensures the row at `rowIndex` is fully
 * visible inside the viewport, minimising the amount we actually shift.
 * Leaves the offset alone if the row already fits. Safe to call with an
 * out-of-range index (returns the clamped current value).
 */
export function ensureRowVisible(
  rowIndex: number,
  scrollOffsetPx: number,
  viewportHeight: number,
  rowHeight: number,
  totalContentHeight: number
): number {
  if (rowHeight <= 0 || viewportHeight <= 0 || totalContentHeight <= 0) {
    return 0;
  }
  if (rowIndex < 0) {
    return 0;
  }
  const rowTop = rowY(rowIndex, rowHeight);
  const rowBottom = rowTop + rowHeight;
  const viewTop = scrollOffsetPx;
  const viewBottom = scrollOffsetPx + viewportHeight;

  let next = scrollOffsetPx;
  if (rowTop < viewTop) {
    next = rowTop;
  } else if (rowBottom > viewBottom) {
    next = rowBottom - viewportHeight;
  }
  return clampScrollOffset(next, viewportHeight, totalContentHeight);
}
