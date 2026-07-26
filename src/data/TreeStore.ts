import {
  TreeDocument,
  TreeNode,
  FolderNode,
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
  /** Nodes whose stored index no longer matched their GUID's current index. */
  relocated: Array<{ name: string; fromIndex: number; toIndex: number }>;
  /** Nodes whose GUID could no longer be found in plman, and were dropped. */
  unresolved: Array<{ name: string; lastIndex: number }>;
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
    // Cancel any pending debounced save so it doesn't fire after this
    // synchronous write (e.g., during on_script_unload).
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
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

  renameFolder(
    folder: FolderNode,
    newName: string,
    siblings: TreeNode[]
  ): { ok: boolean; reason?: string } {
    if (newName.length === 0) {
      return { ok: false, reason: 'Name cannot be empty.' };
    }
    if (newName === folder.name) {
      return { ok: true };
    }
    for (const sibling of siblings) {
      if (sibling !== folder && isFolderNode(sibling) && sibling.name === newName) {
        return {
          ok: false,
          reason: `A folder named "${newName}" already exists here.`,
        };
      }
    }
    folder.name = newName;
    this.scheduleSave();
    return { ok: true };
  }

  /**
   * Re-validates every playlist node's GUID against the live playlist
   * list, self-healing index drift, and imports any playlist not claimed
   * by an existing node as a new root-level orphan.
   */
  reconcile(): ReconcileResult {
    const livePlaylists = new Map<string, { index: number; name: string }>();
    for (let i = 0; i < plman.PlaylistCount; i++) {
      const guid = plman.GetGUID(i);
      livePlaylists.set(guid, { index: i, name: plman.GetPlaylistName(i) });
    }

    const claimedGuids = new Set<string>();
    const relocated: ReconcileResult['relocated'] = [];
    const unresolved: ReconcileResult['unresolved'] = [];

    const walk = (nodes: TreeNode[]): TreeNode[] => {
      const result: TreeNode[] = [];
      for (const node of nodes) {
        if (isFolderNode(node)) {
          result.push({ ...node, children: walk(node.children) });
          continue;
        }

        // isPlaylistNode
        if (!node.id) {
          // Migration from schema v2 (index/name based) to v3 (GUID based)
          let matchedId: string | null = null;

          // 1. Try exact index match first
          const guidAtIndex = plman.GetGUID(node.index);
          if (livePlaylists.has(guidAtIndex) && livePlaylists.get(guidAtIndex)!.name === node.name && !claimedGuids.has(guidAtIndex)) {
            matchedId = guidAtIndex;
          } else {
            // 2. Search by name (closest index heuristic)
            let bestMatchIndexDiff = Infinity;
            for (const [id, live] of livePlaylists) {
              if (live.name === node.name && !claimedGuids.has(id)) {
                const diff = Math.abs(live.index - node.index);
                if (diff < bestMatchIndexDiff) {
                  bestMatchIndexDiff = diff;
                  matchedId = id;
                }
              }
            }
          }

          if (matchedId) {
            node.id = matchedId;
            // Fall through to normal logic below
          } else {
            unresolved.push({ name: node.name, lastIndex: node.index });
            continue; // drop
          }
        }

        if (livePlaylists.has(node.id)) {
          const live = livePlaylists.get(node.id)!;
          if (live.index !== node.index) {
            relocated.push({ name: node.name, fromIndex: node.index, toIndex: live.index });
          }
          node.index = live.index;
          node.name = live.name;
          claimedGuids.add(node.id);
          result.push(node);
        } else {
          unresolved.push({ name: node.name, lastIndex: node.index });
          // dropped
        }
      }
      return result;
    };

    const reconciledNodes = walk(this.document.nodes);

    const addedOrphans: ReconcileResult['addedOrphans'] = [];
    for (const [id, live] of livePlaylists) {
      if (!claimedGuids.has(id)) {
        addedOrphans.push({ index: live.index, name: live.name });
      }
    }

    const newPlaylistNodes: PlaylistNode[] = addedOrphans.map((o) => ({
      type: 'playlist',
      id: plman.GetGUID(o.index),
      index: o.index,
      name: o.name,
    }));

    this.document = {
      ...this.document,
      nodes: [...reconciledNodes, ...newPlaylistNodes],
    };

    if (relocated.length > 0 || unresolved.length > 0 || addedOrphans.length > 0) {
      this.scheduleSave();
    }

    return { document: this.document, relocated, unresolved, addedOrphans };
  }

  private backupCorruptFile(): void {
    try {
      if (!utils.FileExists(this.storagePath)) {
        return;
      }
      const raw = utils.ReadTextFile(this.storagePath);
      utils.WriteTextFile(`${this.storagePath}.bak`, raw, true);
    } catch {
      // Best-effort only
    }
  }
}