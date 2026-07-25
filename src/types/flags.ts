/**
 * Numeric constants from foo_spider_monkey_panel's Flags.js reference.
 * These are NOT provided by the host at runtime - Flags.js is documentation
 * shipped with the component, listing values you're expected to hardcode.
 * Source: component/docs/Flags.js in TheQwertiest/foo_spider_monkey_panel.
 */

/** window.GetColourCUI() type argument (Columns UI). */
export const ColourTypeCUI = {
  text: 0,
  selectionText: 1,
  inactiveSelectionText: 2,
  background: 3,
  selectionBackground: 4,
  inactiveSelectionBackground: 5,
  activeItemFrame: 6,
} as const;

/** window.GetColourDUI() type argument (Default UI). */
export const ColourTypeDUI = {
  text: 0,
  background: 1,
  highlight: 2,
  selection: 3,
} as const;

/** window.GetFontDUI() type argument (Default UI). */
export const FontTypeDUI = {
  defaults: 0,
  tabs: 1,
  lists: 2,
  playlists: 3,
  statusbar: 4,
  console: 5,
} as const;

/** window.GetFontCUI() type argument (Columns UI). */
export const FontTypeCUI = {
  items: 0,
  labels: 1,
} as const;

/** GdiGraphics#GdiDrawText format argument, combine with bitwise OR. */
export const DT = {
  TOP: 0x00000000,
  LEFT: 0x00000000,
  CENTER: 0x00000001,
  RIGHT: 0x00000002,
  VCENTER: 0x00000004,
  BOTTOM: 0x00000008,
  WORDBREAK: 0x00000010,
  SINGLELINE: 0x00000020,
  NOCLIP: 0x00000100,
  /** Prevents '&' from being consumed as an underline-next-char prefix -
   *  needed since playlist names may legitimately contain '&'. */
  NOPREFIX: 0x00000800,
  END_ELLIPSIS: 0x00008000,
} as const;
