import {
  TreeDocument,
  TreeNode,
  PlaylistNode,
  TREE_SCHEMA_VERSION,
  createEmptyDocument,
  isFolderNode,
  isPlaylistNode,
} from '../types/tree';

const STORAGE_RELATIVE_PATH = 'configuration\\foo_plorg_smp.json';
const SAVE_DEBOUNCE_MS = 500;

export interface ReconcileResult {
  document: TreeDocument;
  /** Nodes whose index was still in range, but whose live name no longer
   *  matched the cached one - cached name refreshed in place. */
  renamed: Array<{ index: number; oldName: string; newName: string }>;
  /** Nodes whose index is no longer in range (playlist count shrunk to
   *  or past it) and were dropped. */
  removed: Array<{ index: number; name: string }>;
  /** Playlists that exist in plman but weren't claimed by any tree node -
   *  imported as new root-level nodes. */
  addedOrphans: Array<{ index: number; name: string }>;
}

export class TreeStore {
  private document: TreeDocument;
  private saveTimer: number | null = null;
  private readonly storagePath: string;

  constructor() {
    this.storagePath = fb.ProfilePath + STORAGE_RELATIVE_PATH;
    this.document = createEmptyDocument();
  }

  getDocument(): TreeDocument {
    return this.document;
  }

  /**
   * Loads the tree file from disk. Never throws - on any failure (missing
   * file, corrupt JSON, or a version newer than this build understands) it
   * falls back to an empty document so the panel always starts in a usable
   * state. A corrupt file is preserved alongside a ".bak" copy rather than
   * silently overwritten, so nothing is lost.
   *
   * Note: schema v1 files (name-only playlist nodes, no `index` field) are
   * no longer auto-migrated by relocating nodes via name search - that
   * machinery was removed (see "Playlist identity" in the README for why).
   * A v1 node loads with `index` effectively invalid, so reconcile() drops
   * it and it reappears as a fresh root-level orphan instead of keeping
   * its folder placement. Acceptable for pre-release use; if this ever
   * matters, write a one-time explicit migration instead of resurrecting
   * the relocation search.
   */
  load(): void {
    if (!utils.FileExists(this.storagePath)) {
      this.document = createEmptyDocument();
      return;
    }

    try {
      const raw = utils.ReadTextFile(this.storagePath);
      if (!raw.trim()) {
        this.document = createEmptyDocument();
        return;
      }

      const parsed = JSON.parse(raw) as Partial<TreeDocument>;

      if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.nodes)) {
        throw new Error('Tree file is missing a valid "nodes" array.');
      }

      if (typeof parsed.version !== 'number' || parsed.version > TREE_SCHEMA_VERSION) {
        throw new Error(`Unsupported tree schema version: ${String(parsed.version)}`);
      }

      this.document = {
        version: TREE_SCHEMA_VERSION,
        nodes: parsed.nodes as TreeNode[],
        options: {
          activateOnSingleClick: false,
          colorScheme: 'default',
          ...parsed.options,
        },
      };
    } catch (err) {
      console.log(`foo_plorg_smp: failed to load tree file, starting empty. Reason: ${String(err)}`);
      this.backupCorruptFile();
      this.document = createEmptyDocument();
    }
  }

  /** Debounced write-through. Call after any mutation to the tree. */
  scheduleSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  /** Immediate, synchronous write - use on panel/script unload. */
  saveNow(): void {
    try {
      const json = JSON.stringify(this.document, null, 2);
      const ok = utils.WriteTextFile(this.storagePath, json, true);
      if (!ok) {
        console.log('foo_plorg_smp: WriteTextFile returned false while saving tree.');
      }
    } catch (err) {
      console.log(`foo_plorg_smp: failed to save tree file. Reason: ${String(err)}`);
    }
  }

  /**
   * Re-syncs the tree against the live playlist list, trusting each
   * node's stored index directly - deliberately NOT attempting to detect
   * or correct reordering by searching for a matching name elsewhere.
   * That approach was tried and abandoned: a swap between two
   * identically-named playlists produces no observable change in the
   * name list at all, so no name-based heuristic can ever catch every
   * case, and partial coverage was judged not worth the complexity.
   *
   * This project now assumes playlists are managed exclusively through
   * this script. Reordering or removing a playlist via the built-in
   * playlist manager (or another panel/script) while this tree exists
   * is unsupported and can desync tree nodes silently - see "Playlist
   * identity" in the README.
   *
   * Per node:
   *   - index in range and unclaimed by an earlier node this pass: kept.
   *     If its live name differs from the cached one, the cache is
   *     refreshed and it's reported in `renamed` (this is what makes
   *     plain renames - the one thing that IS reliably detectable -
   *     keep working with no special-casing needed elsewhere).
   *   - index out of range (or already claimed - shouldn't normally
   *     happen, but defends against a hand-edited or corrupt file):
   *     dropped, reported in `removed`.
   * Any playlist index not claimed by any node becomes a new root-level
   * orphan node, same as before.
   */
  reconcile(currentNames: string[]): ReconcileResult {
    const claimedIndices = new Set<number>();
    const renamed: ReconcileResult['renamed'] = [];
    const removed: ReconcileResult['removed'] = [];

    const walk = (nodes: TreeNode[]): TreeNode[] => {
      const result: TreeNode[] = [];
      for (const node of nodes) {
        if (isFolderNode(node)) {
          result.push({ ...node, children: walk(node.children) });
          continue;
        }

        // isPlaylistNode(node) from here on.
        const indexValid =
          Number.isInteger(node.index) &&
          node.index >= 0 &&
          node.index < currentNames.length &&
          !claimedIndices.has(node.index);

        if (!indexValid) {
          removed.push({ index: node.index, name: node.name });
          continue;
        }

        claimedIndices.add(node.index);
        const currentName = currentNames[node.index]!;
        if (currentName === node.name) {
          result.push(node);
        } else {
          renamed.push({ index: node.index, oldName: node.name, newName: currentName });
          result.push({ ...node, name: currentName });
        }
      }
      return result;
    };

    const reconciledNodes = walk(this.document.nodes);

    const addedOrphans: ReconcileResult['addedOrphans'] = [];
    for (let i = 0; i < currentNames.length; i++) {
      if (!claimedIndices.has(i)) {
        addedOrphans.push({ index: i, name: currentNames[i]! });
      }
    }
    const newPlaylistNodes: PlaylistNode[] = addedOrphans.map((o) => ({
      type: 'playlist',
      index: o.index,
      name: o.name,
    }));

    this.document = {
      ...this.document,
      nodes: [...reconciledNodes, ...newPlaylistNodes],
    };

    if (renamed.length > 0 || removed.length > 0 || addedOrphans.length > 0) {
      this.scheduleSave();
    }

    return { document: this.document, renamed, removed, addedOrphans };
  }

  private backupCorruptFile(): void {
    try {
      if (!utils.FileExists(this.storagePath)) {
        return;
      }
      const raw = utils.ReadTextFile(this.storagePath);
      utils.WriteTextFile(`${this.storagePath}.bak`, raw, true);
    } catch {
      // Best-effort only - if we can't back it up, we still proceed with
      // an empty document rather than blocking startup.
    }
  }
}
