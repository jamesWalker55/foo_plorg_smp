import { ColourTypeCUI, ColourTypeDUI, FontTypeCUI, FontTypeDUI } from '../types/flags';

export interface Theme {
  font: GdiFont;
  textColour: number;
  backgroundColour: number;
  /** Fill colour for a selected row's background. */
  selectionBackgroundColour: number;
  /**
   * Text colour to use on top of selectionBackgroundColour. CUI exposes a
   * dedicated selection-text colour; DUI does not (only text/background/
   * highlight/selection), so DUI reuses the normal text colour on the
   * selection background - acceptable for now, revisit if it reads poorly
   * against a particular DUI colour scheme.
   */
  selectionTextColour: number;
}

const FALLBACK_FONT_NAME = 'Segoe UI';
const FALLBACK_FONT_SIZE_PX = 14;

function getFallbackFont(): GdiFont {
  const font = gdi.Font(FALLBACK_FONT_NAME, FALLBACK_FONT_SIZE_PX);
  if (!font) {
    // gdi.Font() with a near-universal system font name failing at all
    // would mean something is seriously wrong with the host environment.
    // There's nothing sensible to fall back to further, so surface it
    // loudly rather than silently drawing with a null font later.
    throw new Error('foo_plorg_smp: unable to create even the fallback font (Segoe UI).');
  }
  return font;
}

/**
 * Reads the current DUI/CUI font + text/background/selection colours.
 * Call this once at startup and again from on_colours_changed /
 * on_font_changed once those are wired up (not yet, in this phase).
 */
export function resolveTheme(): Theme {
  const isDui = window.InstanceType === 1;

  const font = isDui
    ? window.GetFontDUI(FontTypeDUI.lists) ?? getFallbackFont()
    : window.GetFontCUI(FontTypeCUI.items) ?? getFallbackFont();

  const textColour = isDui
    ? window.GetColourDUI(ColourTypeDUI.text)
    : window.GetColourCUI(ColourTypeCUI.text);

  const backgroundColour = isDui
    ? window.GetColourDUI(ColourTypeDUI.background)
    : window.GetColourCUI(ColourTypeCUI.background);

  const selectionBackgroundColour = isDui
    ? window.GetColourDUI(ColourTypeDUI.selection)
    : window.GetColourCUI(ColourTypeCUI.selectionBackground);

  const selectionTextColour = isDui ? textColour : window.GetColourCUI(ColourTypeCUI.selectionText);

  return { font, textColour, backgroundColour, selectionBackgroundColour, selectionTextColour };
}
