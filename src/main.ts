import { TreeStore } from './data/TreeStore';
import { PlaylistSync } from './data/PlaylistSync';
import { TreeView } from './ui/TreeView';
import { isFolderNode, isPlaylistNode, TreeNode } from './types/tree';

window.DefineScript('foo_plorg_smp', {
  author: 'you',
  version: '0.2.0-phase2',
  features: { drag_n_drop: true, grab_focus: true },
});

const treeStore = new TreeStore();
const playlistSync = new PlaylistSync(treeStore);
// Created in initialize(), after reconciliation - there's no reason to
// build the view before the data it renders is ready.
let treeView: TreeView | undefined;

function currentPlaylistNames(): string[] {
  const names: string[] = [];
  for (let i = 0; i < plman.PlaylistCount; i++) {
    names.push(plman.GetPlaylistName(i));
  }
  return names;
}

function logTree(nodes: TreeNode[], depth = 0): void {
  const indent = '  '.repeat(depth);
  for (const node of nodes) {
    if (isFolderNode(node)) {
      console.log(`${indent}[folder] ${node.name}`);
      logTree(node.children, depth + 1);
    } else if (isPlaylistNode(node)) {
      console.log(`${indent}- ${node.name}`);
    }
  }
}

function initialize(): void {
  treeStore.load();

  const { removedOrphans, addedOrphans } = treeStore.reconcile(currentPlaylistNames());
  if (removedOrphans.length > 0) {
    console.log(`foo_plorg_smp: dropped ${removedOrphans.length} node(s) for playlists that no longer exist: ${removedOrphans.join(', ')}`);
  }
  if (addedOrphans.length > 0) {
    console.log(`foo_plorg_smp: imported ${addedOrphans.length} playlist(s) not yet in the tree: ${addedOrphans.join(', ')}`);
  }

  playlistSync.captureBaseline();

  console.log('foo_plorg_smp: tree after startup reconciliation:');
  logTree(treeStore.getDocument().nodes);

  treeView = new TreeView(treeStore);
  window.Repaint(true);
}

// ---------------------------------------------------------------------------
// Host callback registration
//
// SMP recognizes callbacks (on_paint, on_playlists_changed, etc.) as plain
// top-level global function bindings in the panel script. esbuild's
// --format=iife wraps our whole bundle in a closure, so a `function
// on_playlists_changed() {}` declared here would be scoped to that closure
// and invisible to the host. We work around this by explicitly attaching
// each callback we implement to globalThis, which - unlike a bare top-level
// declaration - still resolves to the real global object regardless of
// bundler wrapping.
//
// NOTE: this hasn't been verified against a running foobar2000 instance
// yet (no such environment available while building this). Confirm the
// panel actually receives on_playlists_changed after loading the built
// bundle before relying on it - see README "Verification checklist".
// ---------------------------------------------------------------------------

function on_playlists_changed(): void {
  const diff = playlistSync.onPlaylistsChanged();
  if (diff.renamed.length > 0) {
    console.log(`foo_plorg_smp: renamed ${diff.renamed.map((r) => `"${r.oldName}" -> "${r.newName}"`).join(', ')}`);
  }
  if (diff.added.length > 0) {
    console.log(`foo_plorg_smp: playlist(s) added: ${diff.added.join(', ')}`);
  }
  if (diff.removed.length > 0) {
    console.log(`foo_plorg_smp: playlist(s) removed: ${diff.removed.join(', ')}`);
  }
}

function on_script_unload(): void {
  treeStore.saveNow();
}

function on_paint(gr: GdiGraphics): void {
  treeView?.paint(gr);
}

function on_size(width: number, height: number): void {
  treeView?.onSize(width, height);
}

Object.assign(globalThis, {
  on_playlists_changed,
  on_script_unload,
  on_paint,
  on_size,
});

initialize();
