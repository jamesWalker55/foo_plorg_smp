/**
 * Ambient declarations for the Spider Monkey Panel (SMP) host environment.
 *
 * Scope: only the surface this project actually uses. Extend as new
 * features are implemented rather than trying to declare the whole API
 * up front - that just invites drift against the real (versioned) API.
 *
 * Cross-reference when extending:
 *   https://theqwertiest.github.io/foo_spider_monkey_panel/assets/generated_files/docs/html/index.html
 *
 * Do NOT add "dom" to tsconfig lib - see the note in tsconfig.json.
 * This file declares SMP's own `window`, which is unrelated to
 * lib.dom.d.ts's `Window`.
 */

// ---------------------------------------------------------------------------
// fb namespace
// ---------------------------------------------------------------------------

declare const fb: {
  /** foobar2000 profile directory, always ends with a trailing backslash. */
  readonly ProfilePath: string;
  /** foobar2000 version string, e.g. "2.1.2". */
  readonly Version: string;
  readonly ComponentPath: string;
};

// ---------------------------------------------------------------------------
// plman namespace (playlist manager)
// ---------------------------------------------------------------------------

declare const plman: {
  readonly PlaylistCount: number;
  ActivePlaylist: number;

  GetPlaylistName(playlistIndex: number): string;
  RenamePlaylist(playlistIndex: number, name: string): boolean;
  FindOrCreatePlaylist(name: string, showTab: boolean): number;
  CreatePlaylist(playlistIndex: number, name: string): number;
  RemovePlaylist(playlistIndex: number): boolean;
  ReorderPlaylists(order: number[]): boolean;
  MovePlaylist(from: number, to: number): boolean;

  PlaylistItemCount(playlistIndex: number): number;
  IsAutoPlaylist(playlistIndex: number): boolean;

  /** Actions currently blocked on this playlist, e.g. 'RemovePlaylist'. */
  GetPlaylistLockedActions(playlistIndex: number): string[];
  GetPlaylistLockName(playlistIndex: number): string | null;

  UndoBackup(playlistIndex: number): void;
};

// ---------------------------------------------------------------------------
// utils namespace (file I/O)
// ---------------------------------------------------------------------------

declare const utils: {
  /**
   * Throws a script error if the file does not exist or can't be mapped -
   * always guard with FileExists() first, and still wrap in try/catch.
   */
  ReadTextFile(filename: string, codepage?: number): string;

  /**
   * Note: the parent folder must already exist - this call will NOT
   * create intermediate directories. Writes UTF-8 (BOM by default).
   */
  WriteTextFile(filename: string, content: string, writeBom?: boolean): boolean;

  FileExists(path: string): boolean;
  IsDirectory(path: string): boolean;
  IsFile(path: string): boolean;
};

// ---------------------------------------------------------------------------
// window namespace (panel-scoped; NOT the browser Window)
// ---------------------------------------------------------------------------

declare const window: {
  readonly Width: number;
  readonly Height: number;
  Repaint(force?: boolean): void;
  RepaintRect(x: number, y: number, w: number, h: number, force?: boolean): void;

  GetProperty<T = unknown>(name: string, defaultValue?: T): T;
  SetProperty(name: string, value: unknown): void;

  DefineScript(
    scriptName: string,
    options?: {
      author?: string;
      version?: string;
      features?: { drag_n_drop?: boolean; grab_focus?: boolean };
    }
  ): void;
};

// ---------------------------------------------------------------------------
// console (SMP provides a subset of the usual console API)
// ---------------------------------------------------------------------------

declare const console: {
  log(...args: unknown[]): void;
};

// ---------------------------------------------------------------------------
// Global functions provided by the host runtime
// ---------------------------------------------------------------------------

declare function setTimeout(fn: () => void, delayMs: number): number;
declare function clearTimeout(id: number): void;
declare function setInterval(fn: () => void, delayMs: number): number;
declare function clearInterval(id: number): void;

// ---------------------------------------------------------------------------
// Callback signatures (module:callbacks in the SMP docs)
//
// These are recognized by the host purely by *name*, as top-level global
// function bindings - see src/main.ts for how we register them despite
// esbuild wrapping our bundle in an IIFE.
// ---------------------------------------------------------------------------

interface SmpCallbacks {
  on_paint?(gr: unknown): void;
  on_size?(width: number, height: number): void;
  on_script_unload?(): void;

  /**
   * Fired for ANY structural playlist change: add / remove / reorder /
   * rename / lock-status change. It carries no detail about *what*
   * changed - callers must diff a snapshot themselves. See
   * src/data/PlaylistSync.ts.
   */
  on_playlists_changed?(): void;

  on_playlist_switch?(): void;
  on_playlist_items_added?(playlistIndex: number): void;
  on_playlist_items_removed?(playlistIndex: number, newCount: number): void;
  on_playlist_items_reordered?(playlistIndex: number): void;

  on_mouse_lbtn_down?(x: number, y: number, mask: number): void;
  on_mouse_lbtn_up?(x: number, y: number, mask: number): void;
  on_mouse_lbtn_dblclk?(x: number, y: number, mask: number): void;
  on_mouse_rbtn_up?(x: number, y: number, mask: number): boolean | void;
  on_mouse_move?(x: number, y: number, mask: number): void;
  on_mouse_leave?(): void;
  on_mouse_wheel?(step: number): void;

  on_key_down?(vkey: number): void;
  on_key_up?(vkey: number): void;

  on_drag_enter?(action: unknown, x: number, y: number, mask: number): void;
  on_drag_over?(action: unknown, x: number, y: number, mask: number): void;
  on_drag_leave?(): void;
  on_drag_drop?(action: unknown, x: number, y: number, mask: number): void;
}
