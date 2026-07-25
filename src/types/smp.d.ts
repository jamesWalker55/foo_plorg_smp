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

  /** True if the given virtual-key is currently held down. See types/flags.ts VK. */
  IsKeyPressed(vkey: number): boolean;
};

// ---------------------------------------------------------------------------
// gdi namespace + GdiFont / GdiGraphics
// ---------------------------------------------------------------------------

declare const gdi: {
  /** Returns null if the requested font was not found. */
  Font(name: string, sizePx: number, style?: number): GdiFont | null;
};

interface GdiFont {
  readonly Name: string;
  readonly Size: number;
  readonly Style: number;
  readonly Height: number;
}

/**
 * The graphics context passed into on_paint(). Only the subset of
 * GdiGraphics methods this project uses is declared - see
 * https://theqwertiest.github.io/foo_spider_monkey_panel/assets/generated_files/docs/html/GdiGraphics.html
 * for the full surface if more is needed later.
 */
interface GdiGraphics {
  FillSolidRect(x: number, y: number, w: number, h: number, colour: number): void;
  DrawRect(x: number, y: number, w: number, h: number, lineWidth: number, colour: number): void;
  DrawLine(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: number): void;

  /**
   * Faster/better rendering than DrawString - preferred for normal text.
   * Do not use outside the on_paint GdiGraphics instance (ClearType artifacts).
   */
  GdiDrawText(
    str: string,
    font: GdiFont,
    colour: number,
    x: number,
    y: number,
    w: number,
    h: number,
    format?: number
  ): void;

  CalcTextWidth(str: string, font: GdiFont, useExact?: boolean): number;
  CalcTextHeight(str: string, font: GdiFont): number;
}

// ---------------------------------------------------------------------------
// window namespace (panel-scoped; NOT the browser Window)
// ---------------------------------------------------------------------------

declare const window: {
  readonly Width: number;
  readonly Height: number;
  /** 0 = Columns UI, 1 = Default UI - determines which GetColourXXX/GetFontXXX pair to call. */
  readonly InstanceType: 0 | 1;

  /**
   * Which keys the host should route to this panel instead of handling
   * itself (arrow-key focus navigation, tab, etc). Set with the DLGC_*
   * bitflags from types/flags.ts - e.g. `window.DlgCode = DLGC.WANTARROWS`.
   * Despite the Callbacks.js doc prose phrasing it as a function call,
   * the authoritative API listing declares this as a plain read/write
   * property, not a method - confirmed against foo_spider_monkey_panel.js.
   */
  DlgCode: number;

  Repaint(force?: boolean): void;
  RepaintRect(x: number, y: number, w: number, h: number, force?: boolean): void;

  GetProperty<T = unknown>(name: string, defaultValue?: T): T;
  SetProperty(name: string, value: unknown): void;

  /** Returns null if the requested font was not found - always have a gdi.Font() fallback ready. */
  GetFontDUI(type: number): GdiFont | null;
  GetFontCUI(type: number, clientGuid?: string): GdiFont | null;
  /** Returns black if the requested colour is not available. */
  GetColourDUI(type: number): number;
  GetColourCUI(type: number, clientGuid?: string): number;

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
  on_paint?(gr: GdiGraphics): void;
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
