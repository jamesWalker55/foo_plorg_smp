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
  /** Playlist names that existed in the tree but no longer exist in plman. */
  removedOrphans: string[];
  /** Playlist names that exist in plman but were missing from the tree. */
  addedOrphans: string[];
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
   * file, corrupt JSON, unknown schema version) it falls back to an empty
   * document so the panel always starts in a usable state. A corrupt file
   * is preserved alongside a ".bak" copy rather than silently overwritten,
   * so nothing is lost.
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

      if (parsed.version !== TREE_SCHEMA_VERSION) {
        // Placeholder for future migrations. For now, schema v1 is the
        // only version, so anything else is treated as unreadable.
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
   * Reconciles the in-memory tree against the authoritative list of
   * playlist names currently in plman. This is the core defense against
   * drift: playlists renamed/removed/created outside this panel (main UI,
   * another script, another panel instance) must not desync the tree.
   *
   * Matching is by name, with duplicates resolved by first-available
   * (i.e. each name in `currentNames` can satisfy at most one tree node).
   * Playlist nodes referencing a name with no remaining match are dropped.
   * Names left over after all nodes are matched are appended as new
   * playlist nodes at the root, so nothing already in foobar ever
   * "disappears" from the panel.
   */
  reconcile(currentNames: string[]): ReconcileResult {
    const remaining = [...currentNames];
    const removedOrphans: string[] = [];

    const consume = (name: string): boolean => {
      const idx = remaining.indexOf(name);
      if (idx === -1) {
        return false;
      }
      remaining.splice(idx, 1);
      return true;
    };

    const walk = (nodes: TreeNode[]): TreeNode[] => {
      const result: TreeNode[] = [];
      for (const node of nodes) {
        if (isFolderNode(node)) {
          result.push({ ...node, children: walk(node.children) });
        } else if (isPlaylistNode(node)) {
          if (consume(node.name)) {
            result.push(node);
          } else {
            removedOrphans.push(node.name);
          }
        }
      }
      return result;
    };

    const reconciledNodes = walk(this.document.nodes);

    // Anything left in `remaining` exists in foobar but wasn't in the tree.
    const addedOrphans = [...remaining];
    const newPlaylistNodes: PlaylistNode[] = addedOrphans.map((name) => ({
      type: 'playlist',
      name,
    }));

    this.document = {
      ...this.document,
      nodes: [...reconciledNodes, ...newPlaylistNodes],
    };

    if (removedOrphans.length > 0 || addedOrphans.length > 0) {
      this.scheduleSave();
    }

    return { document: this.document, removedOrphans, addedOrphans };
  }

  /**
   * Renames the first playlist node matching `oldName` to `newName`,
   * in place - i.e. without touching its position in the tree. This is
   * what lets a rename (detected upstream by PlaylistSync) preserve
   * folder placement, instead of falling through to reconcile()'s
   * remove-then-append-at-root behaviour.
   *
   * Known limitation: if two playlist nodes share the same name (already
   * an edge case - see PlaylistNode docs), only the first match in
   * document order is renamed. This mirrors legacy foo_plorg's own
   * ambiguity with duplicate playlist names.
   */
  renamePlaylistNode(oldName: string, newName: string): boolean {
    const walk = (nodes: TreeNode[]): boolean => {
      for (const node of nodes) {
        if (isPlaylistNode(node) && node.name === oldName) {
          node.name = newName;
          return true;
        }
        if (isFolderNode(node) && walk(node.children)) {
          return true;
        }
      }
      return false;
    };

    const found = walk(this.document.nodes);
    if (found) {
      this.scheduleSave();
    }
    return found;
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
