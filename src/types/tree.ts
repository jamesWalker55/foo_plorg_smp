/**
 * Data model for the virtual folder tree overlaid on top of foobar2000's
 * flat playlist list. See TreeStore.ts for load/save/reconciliation logic.
 */

export const TREE_SCHEMA_VERSION = 3; // Bumped: added GUID-based identity

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
   * Primary identity. Stable GUID obtained from plman.GetGUID().
   * Survives renames, reorders, and duplications.
   */
  id: string;
  /**
   * Cached current playlist index. Used for immediate access
   * (e.g., plman.ActivePlaylist). Must be re-validated on every reconcile
   * via plman.FindByGUID(id).
   */
  index: number;
  /**
   * Cached display name. Read from plman.GetPlaylistName(index) during
   * reconcile. For display only, NOT identity.
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
