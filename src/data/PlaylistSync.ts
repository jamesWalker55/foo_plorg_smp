import { TreeStore, ReconcileResult } from './TreeStore';

export interface PlaylistDiff {
  /** Same-length case: index i kept its position but changed name, and
   *  that name doesn't appear anywhere else in either snapshot. */
  renamed: Array<{ index: number; oldName: string; newName: string }>;
  added: string[];
  removed: string[];
  /** True if names are identical but order changed (drag-reorder in the
   *  playlist tabs, ReorderPlaylists, etc). Reserved for a future phase
   *  where the tree also mirrors playlist order - not acted on yet. */
  reordered: boolean;
}

function getCurrentPlaylistNames(): string[] {
  const names: string[] = [];
  for (let i = 0; i < plman.PlaylistCount; i++) {
    names.push(plman.GetPlaylistName(i));
  }
  return names;
}

function countByName(names: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const name of names) {
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return map;
}

/**
 * Diffs two ordered playlist-name snapshots.
 *
 * Rename detection is a heuristic, not a guarantee - SMP gives us no
 * stable playlist id, only a name and an index, via a single callback
 * that fires for add/remove/reorder/rename alike. The heuristic used
 * here: if both snapshots have the same length, and index i has a
 * different name in each, and that old name doesn't survive elsewhere
 * in `curr` while the new name didn't already exist somewhere in `prev`,
 * treat it as a rename of the playlist at index i rather than an
 * unrelated add+remove pair.
 *
 * This covers the common case (renaming one playlist via F2 in the main
 * UI or another panel) correctly. A rename performed in the same host
 * operation as an add/remove elsewhere in the list may instead surface
 * as a plain remove+add - acceptable for v1, revisit only if it proves
 * disruptive in practice.
 */
export function diffPlaylistNames(prev: string[], curr: string[]): PlaylistDiff {
  const renamed: PlaylistDiff['renamed'] = [];

  if (prev.length === curr.length) {
    const prevCounts = countByName(prev);
    const currCounts = countByName(curr);

    for (let i = 0; i < prev.length; i++) {
      const oldName = prev[i]!;
      const newName = curr[i]!;
      if (oldName === newName) {
        continue;
      }
      const oldNameStillExists = (currCounts.get(oldName) ?? 0) > 0;
      const newNameAlreadyExisted = (prevCounts.get(newName) ?? 0) > 0;
      if (!oldNameStillExists && !newNameAlreadyExisted) {
        renamed.push({ index: i, oldName, newName });
      }
    }
  }

  const renamedOldNames = new Set(renamed.map((r) => r.oldName));
  const renamedNewNames = new Set(renamed.map((r) => r.newName));

  const currRemaining = [...curr].filter((n) => !renamedNewNames.has(n));
  const prevRemaining = [...prev].filter((n) => !renamedOldNames.has(n));

  const consume = (list: string[], name: string): boolean => {
    const idx = list.indexOf(name);
    if (idx === -1) return false;
    list.splice(idx, 1);
    return true;
  };

  const added: string[] = [];
  for (const name of currRemaining) {
    if (!consume(prevRemaining, name)) {
      added.push(name);
    }
  }
  const removed = prevRemaining;

  const reordered =
    renamed.length === 0 &&
    added.length === 0 &&
    removed.length === 0 &&
    prev.some((n, i) => n !== curr[i]);

  return { renamed, added, removed, reordered };
}

export class PlaylistSync {
  private prevNames: string[] = [];

  constructor(private readonly treeStore: TreeStore) {}

  /** Call once at startup, after TreeStore.load()/reconcile(). */
  captureBaseline(): void {
    this.prevNames = getCurrentPlaylistNames();
  }

  /**
   * Call from the global on_playlists_changed() callback.
   *
   * Order matters here: renames are patched into the tree's cached names
   * FIRST, before reconcile() runs. Otherwise reconcile() would see a
   * renamed-in-place playlist's stale cached name, fail to find it at its
   * (unchanged) index, and misclassify it as "moved or gone" - triggering
   * an unnecessary (and for duplicate names, potentially wrong) relocation
   * search instead of the trivial no-op a pure rename should be.
   */
  onPlaylistsChanged(): { diff: PlaylistDiff; reconcile: ReconcileResult } {
    const currentNames = getCurrentPlaylistNames();
    const diff = diffPlaylistNames(this.prevNames, currentNames);
    this.prevNames = currentNames;

    for (const r of diff.renamed) {
      this.treeStore.updateCachedName(r.index, r.newName);
    }

    // Always reconcile, even when the diff found nothing notable - it's
    // cheap when nothing actually drifted (every node's cached name will
    // still match its index on the first check), and it's the single
    // source of truth for index validity, so there's no benefit to
    // trying to skip it based on the diff's classification.
    const reconcile = this.treeStore.reconcile(currentNames);

    return { diff, reconcile };
  }
}
