import { ColourTypeCUI, ColourTypeDUI, FontTypeCUI, FontTypeDUI } from '../types/flags';

export interface Theme {
  font: GdiFont;
  textColour: number;
  backgroundColour: number;
  selectionTextColour: number;
  selectionBackgroundColour: number;
  /** Frame drawn around the row that is the currently-active playlist
   *  (plman.ActivePlaylist), to distinguish "selected for ops" from
   *  "selected for playback" at a glance. */
  activeItemFrameColour: number;
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
 *
 * Call this once at startup and again from on_colours_changed / on_font_changed
 * once those are wired up (not yet, in this phase). The selection pair is
 * what makes selected rows readable - the panel draws a selection
 * background using `selectionBackgroundColour` and switches the row's
 * text to `selectionTextColour` on top, mirroring how the rest of
 * foobar2000 paints highlighted items in its own list views.
 *
 * CUI additionally exposes a separate `activeItemFrameColour` (a frame
 * drawn around the active playlist). DUI doesn't have an equivalent
 * concept in its public colour set, so we reuse the selection frame
 * colour there - close enough that "this is the playing one" is still
 * visually distinct from "this is selected but not playing."
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

  const selectionTextColour = isDui
    ? window.GetColourDUI(ColourTypeDUI.text) // DUI has no separate selection-text colour; falls back to plain text
    : window.GetColourCUI(ColourTypeCUI.selectionText);

  const selectionBackgroundColour = isDui
    ? window.GetColourDUI(ColourTypeDUI.selection)
    : window.GetColourCUI(ColourTypeCUI.selectionBackground);

  const activeItemFrameColour = isDui
    ? window.GetColourDUI(ColourTypeDUI.selection)
    : window.GetColourCUI(ColourTypeCUI.activeItemFrame);

  return {
    font,
    textColour,
    backgroundColour,
    selectionTextColour,
    selectionBackgroundColour,
    activeItemFrameColour,
  };
}
