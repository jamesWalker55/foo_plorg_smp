import { TreeStore, ReconcileResult } from './data/TreeStore';
import { TreeView } from './ui/TreeView';
import { isFolderNode, isPlaylistNode, TreeNode } from './types/tree';
import { DLGC } from './types/flags';

window.DefineScript('foo_plorg_smp', {
  author: 'you',
  version: '0.3.0-phase3-selection-nav',
  features: { drag_n_drop: true, grab_focus: true },
});

// Requesting arrow keys is required for on_key_down to receive them at
// all - see smp.d.ts DlgCode doc comment for why this is a property
// assignment rather than the function-call syntax the Callbacks.js docs
// prose suggests.
window.DlgCode = DLGC.WANTARROWS;

// Design assumption (see README "Playlist identity"): this panel is the
// exclusive way playlists get created/renamed/removed/reordered. Using
// foobar2000's built-in playlist manager (or another panel/script) to
// reorder or remove playlists while this tree exists is unsupported and
// can silently desync tree nodes - there is no reliable way to detect or
// correct that in general, only plain renames and end-of-list add/remove
// are handled. This was a deliberate scope decision, not an oversight.

const treeStore = new TreeStore();
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

function logReconcileResult(result: ReconcileResult): void {
  if (result.renamed.length > 0) {
    console.log(`foo_plorg_smp: renamed ${result.renamed.map((r) => `[${r.index}] "${r.oldName}" -> "${r.newName}"`).join(', ')}`);
  }
  if (result.removed.length > 0) {
    console.log(`foo_plorg_smp: dropped ${result.removed.length} node(s) whose index no longer exists: ${result.removed.map((r) => `[${r.index}] ${r.name}`).join(', ')}`);
  }
  if (result.addedOrphans.length > 0) {
    console.log(`foo_plorg_smp: imported ${result.addedOrphans.length} playlist(s) not yet in the tree: ${result.addedOrphans.map((o) => `[${o.index}] ${o.name}`).join(', ')}`);
  }
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
  logReconcileResult(treeStore.reconcile(currentPlaylistNames()));

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
// bundler wrapping. Confirmed working against a real foobar2000 instance.
// ---------------------------------------------------------------------------

function on_playlists_changed(): void {
  logReconcileResult(treeStore.reconcile(currentPlaylistNames()));
  treeView?.pruneSelection();
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

function on_mouse_lbtn_down(x: number, y: number, mask: number): void {
  treeView?.handleMouseDown(x, y, mask);
  window.Repaint();
}

function on_mouse_lbtn_dblclk(x: number, y: number, mask: number): void {
  void mask;
  treeView?.handleDoubleClick(x, y);
  window.Repaint();
}

function on_key_down(vkey: number): void {
  treeView?.handleKeyDown(vkey);
  window.Repaint();
}

Object.assign(globalThis, {
  on_playlists_changed,
  on_script_unload,
  on_paint,
  on_size,
  on_mouse_lbtn_down,
  on_mouse_lbtn_dblclk,
  on_key_down,
});

initialize();
