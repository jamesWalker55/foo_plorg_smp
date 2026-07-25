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

/**
 * Windows virtual key codes - the values SMP passes to on_key_down and
 * the values the mask argument reports for the modifier keys. Subset
 * of what this project actually consumes; extend as new shortcuts land.
 */
export const VK = {
  BACK: 0x08,
  TAB: 0x09,
  RETURN: 0x0d,
  SHIFT: 0x10,
  CONTROL: 0x11,
  MENU: 0x12, // Alt
  ESCAPE: 0x1b,
  PRIOR: 0x21, // PageUp
  NEXT: 0x22, // PageDown
  END: 0x23,
  HOME: 0x24,
  LEFT: 0x25,
  UP: 0x26,
  RIGHT: 0x27,
  DOWN: 0x28,
  INSERT: 0x2d,
  DELETE: 0x2e,
  F1: 0x70,
  F2: 0x71,
  F3: 0x72,
  F4: 0x73,
  F5: 0x74,
  F6: 0x75,
  F7: 0x76,
  F8: 0x77,
  F9: 0x78,
  F10: 0x79,
  F11: 0x7a,
  F12: 0x7b,
} as const;

/**
 * Bit values for the `mask` argument of on_mouse_* callbacks. The mouse-
 * button bits come first (matches Windows MK_* convention); the
 * modifier bits use the same positions as the VK codes above so a single
 * helper can AND a mask with one of these and read it as a boolean.
 *
 * NOTE: this layout is the Windows-expected one, which is what SMP's
 * docs use as their reference. If the actual mask format SMP delivers
 * differs, the input handlers will silently treat "shift held" as
 * "ctrl held" etc. - verify against a real install before shipping.
 */
export const MouseMask = {
  LBUTTON: 0x01,
  RBUTTON: 0x02,
  SHIFT: 0x04,
  CONTROL: 0x08,
  MBUTTON: 0x10,
  XBUTTON1: 0x20,
  XBUTTON2: 0x40,
} as const;

/** Convenience for keyboard `mask` (modifiers only, no button bits). */
export const KeyMask = {
  SHIFT: 0x01,
  CONTROL: 0x02,
  ALT: 0x04,
} as const;
