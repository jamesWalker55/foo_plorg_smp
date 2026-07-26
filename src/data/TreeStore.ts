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
  /** Nodes whose stored index no longer matched their cached name and
   *  were successfully relocated to where that name now lives. */
  relocated: Array<{ name: string; fromIndex: number; toIndex: number }>;
  /** Nodes whose cached name could no longer be found anywhere in the
   *  current playlist list, and were dropped. */
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

  /**
   * Loads the tree file from disk. Never throws - on any failure (missing
   * file, corrupt JSON, or a version newer than this build understands) it
   * falls back to an empty document so the panel always starts in a usable
   * state. A corrupt file is preserved alongside a ".bak" copy rather than
   * silently overwritten, so nothing is lost.
   *
   * Documents from schema v1 (name-only playlist nodes, no `index` field)
   * load without complaint here - reconcile() naturally migrates them,
   * since a node with a missing/invalid `index` is treated exactly like
   * one whose index has drifted, and gets relocated by cached name.
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

  /**
   * Renames a folder in-place after enforcing sibling-uniqueness.
   * Returns a structured result so the caller can show a precise
   * popup message without re-deriving the reason.
   *
   * Why uniqueness is checked at the tree level (and not via a plman
   * call, the way playlists are): folders are a UI-only construct with
   * no foobar2000-side identity, so there's no external authority to
   * defer to. Two identically-named folders under the same parent
   * would just be confusing in any later list view, so we forbid it.
   * Case-sensitive match, matching Windows Explorer.
   *
   * Playlists intentionally do NOT route through here - the caller is
   * expected to use plman.RenamePlaylist directly, since that's where
   * the canonical name lives and where the rename takes effect.
   */
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
   * Updates a playlist node's cached name without touching its index or
   * position in the tree. Call this BEFORE reconcile() for any index that
   * PlaylistSync has determined was purely renamed (not moved) - this
   * keeps reconcile()'s "is this node still valid" check from mistaking
   * a fresh rename for the playlist having disappeared.
   */
  updateCachedName(index: number, newName: string): boolean {
    const walk = (nodes: TreeNode[]): boolean => {
      for (const node of nodes) {
        if (isPlaylistNode(node) && node.index === index) {
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

  /**
   * Re-validates every playlist node's index against the live playlist
   * list, self-healing drift via the node's cached name, and imports any
   * playlist not claimed by an existing node as a new root-level orphan.
   *
   * Algorithm per node, in document order (top-to-bottom, depth-first -
   * earlier nodes get first claim on an index when there's ambiguity):
   *   1. If the node's index is in range, unclaimed by an earlier node in
   *      this pass, and plman.GetPlaylistName(index) equals the node's
   *      cached name - it's unchanged. Keep it, claim the index.
   *   2. Otherwise, search all unclaimed indices for one whose current
   *      name equals the node's cached name. If exactly one candidate,
   *      relocate the node there. If several (duplicate names), prefer
   *      the candidate closest to the node's last known index - a
   *      best-effort heuristic, not a guarantee, when duplicates and
   *      reordering combine (see PlaylistNode doc comment).
   *   3. If no candidate exists at all, the playlist is gone - drop the
   *      node.
   *
   * Known unresolvable edge case: a playlist that is both renamed AND
   * moved within the same host operation, while another playlist shares
   * its old or new name, cannot be reliably distinguished from the
   * other's own drift. This requires a stable playlist id that SMP does
   * not expose (confirmed against the full plman API surface).
   */
  reconcile(currentNames: string[]): ReconcileResult {
    const claimedIndices = new Set<number>();
    const relocated: ReconcileResult['relocated'] = [];
    const unresolved: ReconcileResult['unresolved'] = [];

    const findUnclaimedByName = (name: string, preferredIndex: number): number | null => {
      const candidates: number[] = [];
      for (let i = 0; i < currentNames.length; i++) {
        if (!claimedIndices.has(i) && currentNames[i] === name) {
          candidates.push(i);
        }
      }
      if (candidates.length === 0) {
        return null;
      }
      candidates.sort((a, b) => Math.abs(a - preferredIndex) - Math.abs(b - preferredIndex));
      return candidates[0]!;
    };

    const walk = (nodes: TreeNode[]): TreeNode[] => {
      const result: TreeNode[] = [];
      for (const node of nodes) {
        if (isFolderNode(node)) {
          result.push({ ...node, children: walk(node.children) });
          continue;
        }

        // isPlaylistNode(node) from here on.
        const stillValid =
          Number.isInteger(node.index) &&
          node.index >= 0 &&
          node.index < currentNames.length &&
          !claimedIndices.has(node.index) &&
          currentNames[node.index] === node.name;

        if (stillValid) {
          claimedIndices.add(node.index);
          result.push(node);
          continue;
        }

        const resolvedIndex = findUnclaimedByName(node.name, node.index);
        if (resolvedIndex !== null) {
          claimedIndices.add(resolvedIndex);
          if (resolvedIndex !== node.index) {
            relocated.push({ name: node.name, fromIndex: node.index, toIndex: resolvedIndex });
          }
          result.push({ ...node, index: resolvedIndex });
        } else {
          unresolved.push({ name: node.name, lastIndex: node.index });
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
      // Best-effort only - if we can't back it up, we still proceed with
      // an empty document rather than blocking startup.
    }
  }
}
