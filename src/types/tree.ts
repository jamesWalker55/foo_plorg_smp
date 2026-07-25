/**
 * Data model for the virtual folder tree overlaid on top of foobar2000's
 * flat playlist list. See TreeStore.ts for load/save/reconciliation logic.
 */

export const TREE_SCHEMA_VERSION = 3;

interface NodeBase {
  /**
   * Stable id, unique within this document, used ONLY for ephemeral UI
   * state (selection, keyboard focus, future drag-and-drop/context-menu
   * targeting) - NOT for playlist identity, that's `index` on
   * PlaylistNode. Needed because TreeStore.reconcile() recreates folder
   * objects on every pass (via object spread while walking), so object
   * reference is not a stable enough handle to track "the same node"
   * across a reconciliation.
   */
  id: string;
}

export interface FolderNode extends NodeBase {
  type: 'folder';
  /** Not a stable id - display name, editable via F2 rename. Uniqueness is
   *  only enforced among *siblings*, not globally. */
  name: string;
  expanded: boolean;
  children: TreeNode[];
}

export interface PlaylistNode extends NodeBase {
  type: 'playlist';
  /**
   * Playlist identity. SMP's plman API exposes no stable playlist id -
   * only name and index, both mutable (confirmed by reviewing the full
   * plman surface: no Guid/Uuid/stable-handle method exists anywhere).
   * Index was chosen over name because playlist names are frequently
   * duplicated in practice. See TreeStore.reconcile() and the README's
   * "Playlist identity" section for the full rationale and its accepted
   * limitations (no reorder self-healing).
   */
  index: number;
  /**
   * Cached display name as of the last successful reconciliation. NOT
   * the identity - refreshed by TreeStore.reconcile() whenever the live
   * name at `index` differs, which is also how renames are detected.
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
  /** Monotonic counter backing generateNodeId() - never reused, even if
   *  nodes are deleted, so ids never collide across the document's life. */
  nextNodeId: number;
}

export function createEmptyDocument(): TreeDocument {
  return {
    version: TREE_SCHEMA_VERSION,
    nodes: [],
    options: {
      activateOnSingleClick: false,
      colorScheme: 'default',
    },
    nextNodeId: 1,
  };
}

/** Mutates doc.nextNodeId and returns a fresh, never-before-used node id. */
export function generateNodeId(doc: TreeDocument): string {
  const id = String(doc.nextNodeId);
  doc.nextNodeId += 1;
  return id;
}

export function isFolderNode(node: TreeNode): node is FolderNode {
  return node.type === 'folder';
}

export function isPlaylistNode(node: TreeNode): node is PlaylistNode {
  return node.type === 'playlist';
}
