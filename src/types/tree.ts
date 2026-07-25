/**
 * Data model for the virtual folder tree overlaid on top of foobar2000's
 * flat playlist list. See TreeStore.ts for load/save/reconciliation logic.
 */

export const TREE_SCHEMA_VERSION = 2;

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
   * Primary identity. SMP's plman API exposes no stable playlist id -
   * only name and index, both mutable (confirmed by reviewing the full
   * plman surface: no Guid/Uuid/stable-handle method exists anywhere).
   * Index was chosen over name because playlist names are frequently
   * duplicated in practice, while index at least holds until something
   * reorders/adds/removes a playlist.
   */
  index: number;
  /**
   * Cached display name as of the last successful reconciliation. NOT
   * the identity - used purely as a drift-detection/relocation hint: if
   * plman.GetPlaylistName(index) no longer matches this, something
   * moved, and TreeStore.reconcile() uses this cached name to try to
   * find where the playlist went. See TreeStore.reconcile() for the
   * full algorithm and its limitations with duplicate names.
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
