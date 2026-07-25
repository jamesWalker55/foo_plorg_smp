/**
 * Data model for the virtual folder tree overlaid on top of foobar2000's
 * flat playlist list. See TreeStore.ts for load/save/reconciliation logic.
 */

export const TREE_SCHEMA_VERSION = 1;

export interface FolderNode {
  type: 'folder';
  /** Not a stable id - display name, editable via F2 rename. Uniqueness is
   *  only enforced among *siblings*, not globally. */
  name: string;
  expanded: boolean;
  children: TreeNode[];
}

export interface PlaylistNode {
  type: 'playlist';
  /**
   * Playlists are matched by name against plman, matching legacy
   * foo_plorg behaviour. This is intentionally simple but has a known
   * weakness: duplicate playlist names. See TreeStore.reconcile() for
   * how collisions are resolved (position-based tiebreak).
   */
  name: string;
}

export type TreeNode = FolderNode | PlaylistNode;

export interface TreeOptions {
  activateOnSingleClick: boolean;
  colorScheme: 'default' | 'dark';
}

export interface TreeDocument {
  version: number;
  nodes: TreeNode[];
  options: TreeOptions;
}

export function createEmptyDocument(): TreeDocument {
  return {
    version: TREE_SCHEMA_VERSION,
    nodes: [],
    options: {
      activateOnSingleClick: false,
      colorScheme: 'default',
    },
  };
}

export function isFolderNode(node: TreeNode): node is FolderNode {
  return node.type === 'folder';
}

export function isPlaylistNode(node: TreeNode): node is PlaylistNode {
  return node.type === 'playlist';
}
