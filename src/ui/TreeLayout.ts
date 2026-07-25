import { TreeNode, isFolderNode } from '../types/tree';

export interface FlatRow {
  node: TreeNode;
  depth: number;
}

/**
 * Produces the list of rows that would actually be visible if the tree
 * were fully unrolled (i.e. respecting `expanded: false` on folders by
 * omitting their children). This is the same list virtualization slices
 * into a viewport window - see TreeView.
 */
export function flattenVisibleNodes(nodes: TreeNode[], depth = 0): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (isFolderNode(node) && node.expanded) {
      rows.push(...flattenVisibleNodes(node.children, depth + 1));
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
