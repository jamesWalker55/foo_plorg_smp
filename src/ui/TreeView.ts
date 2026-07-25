import { TreeStore } from '../data/TreeStore';
import { isFolderNode } from '../types/tree';
import { flattenVisibleNodes } from './TreeLayout';
import { resolveTheme, Theme } from './Theme';
import { DT } from '../types/flags';

const ROW_VERTICAL_PADDING = 6;
const INDENT_PX = 16;
const LEFT_PADDING_PX = 8;
const SCROLLBAR_WIDTH_PX = 8;
const SCROLLBAR_MARGIN_PX = 2;

// Plain-text disclosure indicators, since icons are out of scope for now
// (see project decisions - plain text, clean indent, no icons/connector
// lines). Revisit if/when Phase 7 (colour/state polish) adds real icons.
const FOLDER_EXPANDED_PREFIX = '\u25BE '; // '▾ '
const FOLDER_COLLAPSED_PREFIX = '\u25B8 '; // '▸ '

export class TreeView {
  private theme: Theme;
  private rowHeight: number;

  /** Vertical scroll offset in pixels. Not yet mutated by anything - this
   *  phase is display-only - but painting already respects it so Phase 3
   *  (mouse wheel / drag) only has to set this field and repaint. */
  private scrollOffsetPx = 0;

  constructor(private readonly treeStore: TreeStore) {
    this.theme = resolveTheme();
    this.rowHeight = this.theme.font.Height + ROW_VERTICAL_PADDING;
  }

  /** Call from on_colours_changed / on_font_changed once those callbacks
   *  are wired up - not yet done in this phase. */
  refreshTheme(): void {
    this.theme = resolveTheme();
    this.rowHeight = this.theme.font.Height + ROW_VERTICAL_PADDING;
  }

  onSize(_width: number, _height: number): void {
    // Nothing to precompute yet - paint() reads window.Width/Height
    // directly since on_paint doesn't receive them. Kept as a hook for
    // when scroll-offset clamping needs to react to resize (Phase 3+).
  }

  paint(gr: GdiGraphics): void {
    const viewportWidth = window.Width;
    const viewportHeight = window.Height;

    gr.FillSolidRect(0, 0, viewportWidth, viewportHeight, this.theme.backgroundColour);

    const rows = flattenVisibleNodes(this.treeStore.getDocument().nodes);
    const totalContentHeight = rows.length * this.rowHeight;

    const maxScroll = Math.max(0, totalContentHeight - viewportHeight);
    if (this.scrollOffsetPx > maxScroll) {
      this.scrollOffsetPx = maxScroll;
    }
    if (this.scrollOffsetPx < 0) {
      this.scrollOffsetPx = 0;
    }

    const needsScrollbar = totalContentHeight > viewportHeight;
    const textAreaWidth = viewportWidth - (needsScrollbar ? SCROLLBAR_WIDTH_PX + SCROLLBAR_MARGIN_PX : 0);

    const firstVisibleIndex = Math.floor(this.scrollOffsetPx / this.rowHeight);
    const textFormat = DT.VCENTER | DT.SINGLELINE | DT.NOPREFIX | DT.END_ELLIPSIS | DT.NOCLIP;

    for (let i = firstVisibleIndex; i < rows.length; i++) {
      const row = rows[i];
      if (!row) break;

      const y = i * this.rowHeight - this.scrollOffsetPx;
      if (y >= viewportHeight) break;

      const x = LEFT_PADDING_PX + row.depth * INDENT_PX;
      const label = isFolderNode(row.node)
        ? (row.node.expanded ? FOLDER_EXPANDED_PREFIX : FOLDER_COLLAPSED_PREFIX) + row.node.name
        : row.node.name;

      gr.GdiDrawText(
        label,
        this.theme.font,
        this.theme.textColour,
        x,
        y,
        Math.max(0, textAreaWidth - x),
        this.rowHeight,
        textFormat
      );
    }

    if (needsScrollbar) {
      this.drawScrollbar(gr, viewportWidth, viewportHeight, totalContentHeight, maxScroll);
    }
  }

  private drawScrollbar(
    gr: GdiGraphics,
    viewportWidth: number,
    viewportHeight: number,
    totalContentHeight: number,
    maxScroll: number
  ): void {
    const trackX = viewportWidth - SCROLLBAR_WIDTH_PX;
    const thumbHeight = Math.max(20, (viewportHeight * viewportHeight) / totalContentHeight);
    const scrollRatio = maxScroll > 0 ? this.scrollOffsetPx / maxScroll : 0;
    const thumbY = scrollRatio * (viewportHeight - thumbHeight);

    // Blend partway toward the text colour for a visible-but-subtle thumb,
    // without introducing a whole separate colour-scheme decision yet.
    const thumbColour = blendColours(this.theme.backgroundColour, this.theme.textColour, 0.35);

    gr.FillSolidRect(trackX, thumbY, SCROLLBAR_WIDTH_PX, thumbHeight, thumbColour);
  }
}

/** Linear-interpolates between two 0xAARRGGBB colours. `t` of 0 = a, 1 = b. */
function blendColours(a: number, b: number, t: number): number {
  const channel = (shift: number): number => {
    const av = (a >>> shift) & 0xff;
    const bv = (b >>> shift) & 0xff;
    return Math.round(av + (bv - av) * t) & 0xff;
  };
  return (0xff << 24) | (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
