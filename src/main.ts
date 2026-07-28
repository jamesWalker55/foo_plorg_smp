import { TreeStore } from './data/TreeStore';
import { TreeView } from './ui/TreeView';
import { isFolderNode, isPlaylistNode, TreeNode } from './types/tree';

window.DefineScript('foo_plorg_smp', {
  author: 'you',
  version: '0.6.0-phase5-internal-drag',
  features: { drag_n_drop: true, grab_focus: true },
});

const treeStore = new TreeStore();
let treeView: TreeView | undefined;

function logTree(nodes: TreeNode[], depth = 0): void {
  const indent = '  '.repeat(depth);
  for (const node of nodes) {
    if (isFolderNode(node)) {
      console.log(`${indent}[folder] ${node.name}`);
      logTree(node.children, depth + 1);
    } else if (isPlaylistNode(node)) {
      console.log(`${indent}- [${node.index}] ${node.name} (id: ${node.id})`);
    }
  }
}

function initialize(): void {
  treeStore.load();
  const { relocated, unresolved, addedOrphans } = treeStore.reconcile();
  if (relocated.length > 0) {
    console.log(`foo_plorg_smp: relocated ${relocated.length} node(s) by GUID: ${relocated.map((r) => `"${r.name}" [${r.fromIndex}]->[${r.toIndex}]`).join(', ')}`);
  }
  if (unresolved.length > 0) {
    console.log(`foo_plorg_smp: dropped ${unresolved.length} node(s) for playlists that no longer exist: ${unresolved.map((u) => u.name).join(', ')}`);
  }
  if (addedOrphans.length > 0) {
    console.log(`foo_plorg_smp: imported ${addedOrphans.length} playlist(s) not yet in the tree: ${addedOrphans.map((o) => `[${o.index}] ${o.name}`).join(', ')}`);
  }
  console.log('foo_plorg_smp: tree after startup reconciliation:');
  logTree(treeStore.getDocument().nodes);
  treeView = new TreeView(treeStore);
  window.Repaint(true);
}

function on_playlists_changed(): void {
  const { relocated, unresolved, addedOrphans } = treeStore.reconcile();
  if (relocated.length > 0) {
    console.log(`foo_plorg_smp: relocated ${relocated.length} node(s) by GUID: ${relocated.map((r) => `"${r.name}" [${r.fromIndex}]->[${r.toIndex}]`).join(', ')}`);
  }
  if (unresolved.length > 0) {
    console.log(`foo_plorg_smp: dropped ${unresolved.length} node(s) for playlists that no longer exist: ${unresolved.map((u) => u.name).join(', ')}`);
  }
  if (addedOrphans.length > 0) {
    console.log(`foo_plorg_smp: imported ${addedOrphans.length} playlist(s) not yet in the tree: ${addedOrphans.map((o) => `[${o.index}] ${o.name}`).join(', ')}`);
  }

  const structuralChange = relocated.length > 0 || unresolved.length > 0 || addedOrphans.length > 0;
  if (structuralChange) {
    treeView?.getSelection().clear();
  }
  window.Repaint();
}

function on_playlist_switch(): void {
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
  treeView?.onMouseLbtnDown(x, y, mask);
}

function on_mouse_lbtn_dblclk(x: number, y: number, mask: number): void {
  treeView?.onMouseLbtnDblClick(x, y, mask);
}

function on_mouse_rbtn_up(x: number, y: number, mask: number): void {
  treeView?.onMouseRbtnUp(x, y, mask);
}

function on_mouse_move(x: number, y: number, mask: number): void {
  treeView?.onMouseMove(x, y, mask);
}

function on_mouse_leave(): void {
  treeView?.onMouseLeave();
}

function on_mouse_wheel(step: number): void {
  treeView?.onMouseWheel(step);
}

function on_key_down(vkey: number, mask: number): void {
  treeView?.onKeyDown(vkey, mask);
}

Object.assign(globalThis, {
  on_playlists_changed,
  on_playlist_switch,
  on_script_unload,
  on_paint,
  on_size,
  on_mouse_lbtn_down,
  on_mouse_lbtn_dblclk,
  on_mouse_rbtn_up,
  on_mouse_move,
  on_mouse_leave,
  on_mouse_wheel,
  on_key_down,
});

initialize();
