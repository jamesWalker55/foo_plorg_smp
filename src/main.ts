import { TreeStore } from './data/TreeStore';
import { PlaylistSync } from './data/PlaylistSync';
import { TreeView } from './ui/TreeView';
import { isFolderNode, isPlaylistNode, TreeNode } from './types/tree';

window.DefineScript('foo_plorg_smp', {
  author: 'you',
  version: '0.2.1-phase2-index-identity',
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
      console.log(`${indent}- [${node.index}] ${node.name}`);
    }
  }
}

function initialize(): void {
  treeStore.load();

  const { relocated, unresolved, addedOrphans } = treeStore.reconcile(currentPlaylistNames());
  if (relocated.length > 0) {
    console.log(`foo_plorg_smp: relocated ${relocated.length} node(s) by cached name: ${relocated.map((r) => `"${r.name}" [${r.fromIndex}]->[${r.toIndex}]`).join(', ')}`);
  }
  if (unresolved.length > 0) {
    console.log(`foo_plorg_smp: dropped ${unresolved.length} node(s) for playlists that no longer exist: ${unresolved.map((u) => u.name).join(', ')}`);
  }
  if (addedOrphans.length > 0) {
    console.log(`foo_plorg_smp: imported ${addedOrphans.length} playlist(s) not yet in the tree: ${addedOrphans.map((o) => `[${o.index}] ${o.name}`).join(', ')}`);
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
  const { diff, reconcile } = playlistSync.onPlaylistsChanged();

  if (diff.renamed.length > 0) {
    console.log(`foo_plorg_smp: renamed ${diff.renamed.map((r) => `"${r.oldName}" -> "${r.newName}"`).join(', ')}`);
  }
  if (reconcile.relocated.length > 0) {
    console.log(`foo_plorg_smp: relocated ${reconcile.relocated.length} node(s) by cached name: ${reconcile.relocated.map((r) => `"${r.name}" [${r.fromIndex}]->[${r.toIndex}]`).join(', ')}`);
  }
  if (reconcile.unresolved.length > 0) {
    console.log(`foo_plorg_smp: dropped ${reconcile.unresolved.length} node(s) for playlists that no longer exist: ${reconcile.unresolved.map((u) => u.name).join(', ')}`);
  }
  if (reconcile.addedOrphans.length > 0) {
    console.log(`foo_plorg_smp: imported ${reconcile.addedOrphans.length} playlist(s) not yet in the tree: ${reconcile.addedOrphans.map((o) => `[${o.index}] ${o.name}`).join(', ')}`);
  }

  window.Repaint();
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
