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
