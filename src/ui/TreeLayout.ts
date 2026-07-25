import { TreeNode, FolderNode, isFolderNode } from '../types/tree';

export interface FlatRow {
  node: TreeNode;
  depth: number;
  /** The folder containing this row, or null for root-level nodes. Used
   *  by keyboard navigation (Left arrow jumps to the parent folder). */
  parent: FolderNode | null;
}

/**
 * Produces the list of rows that would actually be visible if the tree
 * were fully unrolled (i.e. respecting `expanded: false` on folders by
 * omitting their children). This is the same list virtualization slices
 * into a viewport window, and that hit-testing/keyboard-nav walk - see
 * TreeView.
 */
export function flattenVisibleNodes(nodes: TreeNode[], depth = 0, parent: FolderNode | null = null): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const node of nodes) {
    rows.push({ node, depth, parent });
    if (isFolderNode(node) && node.expanded) {
      rows.push(...flattenVisibleNodes(node.children, depth + 1, node));
    }
  }
  return rows;
}
