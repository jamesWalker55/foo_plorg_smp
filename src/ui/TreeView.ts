import { TreeStore } from '../data/TreeStore';
import { isFolderNode, isPlaylistNode, TreeNode } from '../types/tree';
import {
  clampScrollOffset,
  ensureRowVisible,
  FlatRow,
  flattenVisibleNodes,
  rowAtY,
  rowY,
} from './TreeLayout';
import { Selection } from './Selection';
import { resolveTheme, Theme } from './Theme';
import { DT, KeyMask, MouseMask, VK } from '../types/flags';

const ROW_VERTICAL_PADDING = 6;
const INDENT_PX = 16;
const LEFT_PADDING_PX = 8;
const SCROLLBAR_WIDTH_PX = 8;
const SCROLLBAR_MARGIN_PX = 2;
const ACTIVE_FRAME_PX = 1;

/** Width of the clickable area in front of each row that toggles a
 *  folder's expanded state when the row is a folder. Roughly one indent
 *  unit, so the hit zone lines up with the disclosure marker. */
const DISCLOSURE_HIT_WIDTH_PX = 16;

/** How many row heights a single wheel notch scrolls. 3 is a common
 *  Windows default and feels right for a tree. */
const WHEEL_LINES_PER_NOTCH = 3;

/** Mouse-movement (in window pixels) past which a held left button
 *  becomes a drag rather than a click. 5 is a common Windows default
 *  and is forgiving of small mouse jiggles during a deliberate click. */
const DRAG_THRESHOLD_PX = 5;

/** Vertical split of a folder row for drop-position detection. Top
 *  zone = "insert before", middle zone = "into this folder", bottom
 *  zone = "insert after". Matches Windows Explorer semantics. */
const FOLDER_BEFORE_FRAC = 0.25;
const FOLDER_AFTER_FRAC = 0.75;

/** Height of the horizontal line painted at an insertion drop
 *  position. 2px reads as a "here" indicator without dominating the
 *  row's text. */
const DROP_INDICATOR_PX = 2;

// Plain-text disclosure indicators, since icons are out of scope for now
// (see project decisions - plain text, clean indent, no icons/connector
// lines). Revisit if/when Phase 7 (colour/state polish) adds real icons.
const FOLDER_EXPANDED_PREFIX = '\u25BE '; // '▾ '
const FOLDER_COLLAPSED_PREFIX = '\u25B8 '; // '▸ '

/** Where a click landed. `null` means "below the last row" / "past the
 *  scrollbar" / "outside any row" - used by the input handlers to
 *  distinguish "click on the disclosure triangle of a folder" from
 *  "click on the rest of the row" from "click on empty space below." */
interface HitResult {
  rowIndex: number;
  isDisclosure: boolean;
  row: FlatRow;
}

/**
 * Where a drag-and-drop should land. `rowIndex === -1` means "append
 * to root" (drag is over empty space below all rows). `position` is
 * only meaningful for valid in-row targets; for `append` it's
 * always `'after'` but the rowIndex check is what tells the caller.
 */
interface DropTarget {
  rowIndex: number;
  position: 'before' | 'after' | 'into' | 'into-start';
}

/**
 * Drag-and-drop state for an INTERNAL drag (user dragging rows
 * within our tree). The state machine has three meaningful states:
 *
 *   - `null` (no drag in progress) - the idle case
 *   - `active: false` - lbutton down, not yet past the drag threshold.
 *     We're "maybe dragging"; a mouseup with no movement commits a
 *     click, not a drop.
 *   - `active: true` - lbutton down AND past the drag threshold. The
 *     selection has been updated to reflect the dragged set, and
 *     `dropTarget` is updated on every mouse move. A mouseup commits
 *     a drop.
 *
 * `sourceRows` is snapshotted at drag start and never mutated during
 * the drag - even if the user mouses over other rows, the dragged
 * set stays the same. `forbiddenTargets` is the set of nodes the
 * drop target cannot be (the source nodes themselves, plus every
 * descendant of any source folder - a drop there would either be a
 * no-op or create a cycle).
 */
interface InternalDragState {
  sourceRows: number[];
  forbiddenTargets: Set<TreeNode>;
  dropTarget: DropTarget | null;
  startX: number;
  startY: number;
  active: boolean;
  /** The hit result from the lbutton-down, used to commit a click
   *  if the user releases without dragging. */
  clickHit: HitResult | null;
  /** True when onMouseLbtnDown already applied the click's selection
   *  change (the common case - see onMouseLbtnDown). False only for
   *  the deferred case (plain click on an already-selected row),
   *  where onMouseLbtnUp still needs to apply it if no drag occurred. */
  selectionAlreadyApplied: boolean;
}

export class TreeView {
  private theme: Theme;
  private rowHeight: number;
  private scrollOffsetPx = 0;

  /** Cached so we don't pay a tree walk for it on every paint. */
  private lastFlattened: FlatRow[] = [];

  private readonly selection: Selection = new Selection();

  /** Cached "row index in lastFlattened" of the playlist that is
   *  currently active, or null if no playlist in the tree is the
   *  active one (e.g. an autoplaylist that was just removed). Updated
   *  during paint, so it always reflects what we just drew. */
  private activeRowIndex: number | null = null;

  /** Internal drag state. null when no drag is in progress. */
  private internalDrag: InternalDragState | null = null;

  constructor(private readonly treeStore: TreeStore) {
    this.theme = resolveTheme();
    this.rowHeight = this.theme.font.Height + ROW_VERTICAL_PADDING;
  }

  /** Call from on_colours_changed / on_font_changed once those callbacks
   *  are wired up. */
  refreshTheme(): void {
    this.theme = resolveTheme();
    this.rowHeight = this.theme.font.Height + ROW_VERTICAL_PADDING;
  }

  onSize(_width: number, _height: number): void {
    // Nothing precomputed here; paint() reads window.Width/Height and
    // clamps the scroll offset on every draw, which catches resize.
  }

  // ---------------------------------------------------------------------
  // Painting
  // ---------------------------------------------------------------------

  paint(gr: GdiGraphics): void {
    const viewportWidth = window.Width;
    const viewportHeight = window.Height;

    gr.FillSolidRect(0, 0, viewportWidth, viewportHeight, this.theme.backgroundColour);

    const rows = flattenVisibleNodes(this.treeStore.getDocument().nodes);
    this.lastFlattened = rows;

    const totalContentHeight = rows.length * this.rowHeight;
    this.scrollOffsetPx = clampScrollOffset(
      this.scrollOffsetPx,
      viewportHeight,
      totalContentHeight
    );

    const needsScrollbar = totalContentHeight > viewportHeight;
    const textAreaWidth = viewportWidth - (needsScrollbar ? SCROLLBAR_WIDTH_PX + SCROLLBAR_MARGIN_PX : 0);

    this.activeRowIndex = this.findActivePlaylistRow(rows);

    const firstVisibleIndex = Math.max(0, Math.floor(this.scrollOffsetPx / this.rowHeight));
    const lastVisibleIndex = Math.min(
      rows.length - 1,
      Math.ceil((this.scrollOffsetPx + viewportHeight) / this.rowHeight) - 1
    );

    if (lastVisibleIndex >= firstVisibleIndex) {
      for (let i = firstVisibleIndex; i <= lastVisibleIndex; i++) {
        const row = rows[i];
        if (!row) continue;
        this.paintRow(gr, row, i, textAreaWidth, viewportHeight);
      }
    }

    if (needsScrollbar) {
      this.drawScrollbar(gr, viewportWidth, viewportHeight, totalContentHeight);
    }

    // Drop indicator on top of everything else so the user always
    // sees where the current drag will land.
    if (this.internalDrag?.active && this.internalDrag.dropTarget !== null) {
      this.paintDropIndicator(gr, this.internalDrag.dropTarget, textAreaWidth);
    }
  }

  /**
   * Paints the visual feedback for an active internal drag: a 2px
   * line above/below a row for "insert before/after", or a border
   * around a folder row for "into". The colour is the same as the
   * active-playlist frame - both are "this is the target"
   * affordances and matching them keeps the visual vocabulary tight.
   */
  private paintDropIndicator(gr: GdiGraphics, target: DropTarget, textAreaWidth: number): void {
    const colour = this.theme.activeItemFrameColour;

    if (target.rowIndex === -1) {
      // Append to root - paint a line at the bottom of the last row
      // (or at the top of the panel if the tree is empty, but we
      // wouldn't be in a drag in that case).
      const lastIndex = this.lastFlattened.length - 1;
      if (lastIndex < 0) return;
      const lastY = rowY(lastIndex, this.rowHeight) - this.scrollOffsetPx;
      const lineY = lastY + this.rowHeight - DROP_INDICATOR_PX;
      gr.FillSolidRect(0, lineY, textAreaWidth, DROP_INDICATOR_PX, colour);
      return;
    }

    const row = this.lastFlattened[target.rowIndex];
    if (!row) return;
    const y = rowY(target.rowIndex, this.rowHeight) - this.scrollOffsetPx;

    if (target.position === 'into' && isFolderNode(row.node)) {
      // Highlight the folder row with a frame. We use a 2px frame
      // (thicker than the active-playlist frame) to distinguish
      // "this is the drop target" from "this is the active playlist".
      const frame = 2;
      gr.DrawRect(
        frame / 2,
        y + frame / 2,
        Math.max(0, textAreaWidth - frame),
        Math.max(0, this.rowHeight - frame),
        frame,
        colour
      );
      return;
    }

    const lineY = target.position === 'before' ? y : y + this.rowHeight - DROP_INDICATOR_PX;
    gr.FillSolidRect(0, lineY, textAreaWidth, DROP_INDICATOR_PX, colour);
  }

  private paintRow(
    gr: GdiGraphics,
    row: FlatRow,
    rowIndex: number,
    textAreaWidth: number,
    viewportHeight: number
  ): void {
    const y = rowY(rowIndex, this.rowHeight) - this.scrollOffsetPx;
    if (y + this.rowHeight <= 0 || y >= viewportHeight) {
      return;
    }

    const isSelected = this.selection.isSelected(rowIndex);
    const isActive = rowIndex === this.activeRowIndex;

    const textAreaLeft = LEFT_PADDING_PX;
    const textAreaRight = textAreaWidth;

    if (isSelected) {
      gr.FillSolidRect(0, y, textAreaRight, this.rowHeight, this.theme.selectionBackgroundColour);
    }

    if (isActive) {
      gr.DrawRect(
        ACTIVE_FRAME_PX / 2,
        y + ACTIVE_FRAME_PX / 2,
        Math.max(0, textAreaRight - ACTIVE_FRAME_PX),
        Math.max(0, this.rowHeight - ACTIVE_FRAME_PX),
        ACTIVE_FRAME_PX,
        this.theme.activeItemFrameColour
      );
    }

    const textColour = isSelected ? this.theme.selectionTextColour : this.theme.textColour;

    const labelX = textAreaLeft + row.depth * INDENT_PX;
    const labelWidth = Math.max(0, textAreaRight - labelX);

    let label: string;
    if (isFolderNode(row.node)) {
      label = (row.node.expanded ? FOLDER_EXPANDED_PREFIX : FOLDER_COLLAPSED_PREFIX) + row.node.name;
    } else {
      label = row.node.name;
    }

    gr.GdiDrawText(
      label,
      this.theme.font,
      textColour,
      labelX,
      y,
      labelWidth,
      this.rowHeight,
      DT.VCENTER | DT.SINGLELINE | DT.NOPREFIX | DT.END_ELLIPSIS | DT.NOCLIP
    );
  }

  private findActivePlaylistRow(rows: FlatRow[]): number | null {
    const activeIndex = plman.ActivePlaylist;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (isPlaylistNode(row.node) && row.node.index === activeIndex) {
        return i;
      }
    }
    return null;
  }

  private drawScrollbar(
    gr: GdiGraphics,
    viewportWidth: number,
    viewportHeight: number,
    totalContentHeight: number
  ): void {
    const maxScroll = Math.max(1, totalContentHeight - viewportHeight);
    const trackX = viewportWidth - SCROLLBAR_WIDTH_PX;
    const thumbHeight = Math.max(20, (viewportHeight * viewportHeight) / totalContentHeight);
    const scrollRatio = this.scrollOffsetPx / maxScroll;
    const thumbY = Math.max(0, scrollRatio * (viewportHeight - thumbHeight));

    // Blend partway toward the text colour for a visible-but-subtle thumb,
    // without introducing a whole separate colour-scheme decision yet.
    const thumbColour = blendColours(this.theme.backgroundColour, this.theme.textColour, 0.35);

    gr.FillSolidRect(trackX, thumbY, SCROLLBAR_WIDTH_PX, thumbHeight, thumbColour);
  }

  // ---------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------

  /** Currently selected rows, in display order. Read-only view. */
  getSelection(): Selection {
    return this.selection;
  }

  /** Current scroll offset, in pixels. Exposed for tests. */
  getScrollOffset(): number {
    return this.scrollOffsetPx;
  }

  /** Applies a plain/ctrl/shift click's selection change. Shared between
   *  the immediate-apply path (onMouseLbtnDown) and the deferred-apply
   *  path (onMouseLbtnUp, for the one case where we hold off - see
   *  onMouseLbtnDown's comment on `deferSelectionChange`). */
  private applyClickSelection(hit: HitResult, isCtrl: boolean, isShift: boolean): void {
    if (isShift) {
      const target = this.selection.extendRangeTo(hit.rowIndex);
      this.scrollSelectionIntoView(target);
    } else if (isCtrl) {
      this.selection.toggle(hit.rowIndex);
    } else {
      this.selection.setSingle(hit.rowIndex);
    }
  }

  onMouseLbtnDown(x: number, y: number, mask: number): void {
    const hit = this.hitTest(x, y);

    if (hit === null) {
      // Click on empty area below the last row / on the scrollbar. Clear
      // the selection so a stray click doesn't leave a stale row
      // highlighted. (Scrollbar is hit by the scrollOffsetPx math - it's
      // outside the text area but inside the viewport; rowAtY still
      // returns null there because rowWidth > textAreaWidth is not
      // enforced, but the scrollbar x is well to the right of any row.)
      this.selection.clear();
      this.internalDrag = null;
      window.Repaint();
      return;
    }

    if (hit.isDisclosure && isFolderNode(hit.row.node)) {
      // Toggling the disclosure triangle is a structural edit and is
      // NEVER ctrl/shift-modified - those modifiers belong to selection
      // operations. The click also doesn't change the selection, so
      // users can collapse a folder while keeping their current pick.
      // Disclosure clicks never initiate a drag - the row wasn't
      // "picked up" so there's nothing to drop.
      hit.row.node.expanded = !hit.row.node.expanded;
      this.treeStore.scheduleSave();
      this.internalDrag = null;
      window.Repaint();
      return;
    }

    const isCtrl = (mask & MouseMask.CONTROL) !== 0;
    const isShift = (mask & MouseMask.SHIFT) !== 0;

    // Explorer semantics: a plain click (no modifier) on a row that's
    // already part of a multi-selection does NOT change the selection
    // yet - it might turn into a drag of the whole set, and collapsing
    // to a single row here would make that impossible. Every other
    // click (a row outside the current selection, or any ctrl/shift
    // click) has an unambiguous outcome regardless of what happens
    // next, so it applies immediately - the user sees the highlight
    // change the instant they press down, not on release.
    const deferSelectionChange =
      !isCtrl && !isShift && this.selection.getSize() > 0 && this.selection.isSelected(hit.rowIndex);

    let sourceRows: number[];
    if (deferSelectionChange) {
      sourceRows = [...this.selection.iter()];
    } else {
      this.applyClickSelection(hit, isCtrl, isShift);
      const options = this.treeStore.getDocument().options;
      if (options.activateOnSingleClick && isPlaylistNode(hit.row.node)) {
        plman.ActivePlaylist = hit.row.node.index;
      }
      // Drag source is always just the clicked row here: ctrl/shift
      // clicks build up a selection the user didn't necessarily mean
      // to drag as a set, and a plain click on a previously-unselected
      // row has already collapsed the selection to that one row.
      sourceRows = [hit.rowIndex];
      window.Repaint();
    }

    this.internalDrag = {
      sourceRows,
      forbiddenTargets: this.computeForbiddenTargets(sourceRows),
      dropTarget: null,
      startX: x,
      startY: y,
      selectionAlreadyApplied: !deferSelectionChange,
      active: false,
      clickHit: hit,
    };
  }

  onMouseLbtnDblClick(x: number, y: number, _mask: number): void {
    const hit = this.hitTest(x, y);
    if (hit === null) return;

    if (isFolderNode(hit.row.node)) {
      // Double-click on a folder toggles it - same as the disclosure
      // triangle. The single-click on the row body (not the triangle)
      // selects without toggling, so this is the "I clicked the folder
      // name twice" gesture.
      hit.row.node.expanded = !hit.row.node.expanded;
      this.treeStore.scheduleSave();
    } else if (isPlaylistNode(hit.row.node)) {
      plman.ActivePlaylist = hit.row.node.index;
    }
    window.Repaint();
  }

  onMouseMove(x: number, y: number, mask: number): void {
    const drag = this.internalDrag;
    if (drag === null) return;

    // Mouse moved with no button held - the user released the
    // button outside our panel (we'd normally get a mouseup
    // too, but defensive: clear state if we somehow don't).
    if ((mask & MouseMask.LBUTTON) === 0) {
      this.internalDrag = null;
      return;
    }

    if (!drag.active) {
      // Threshold gate: only commit to a real drag once the user
      // has moved the mouse a non-trivial distance. This keeps
      // ordinary clicks (which have a few pixels of mouse
      // jiggle) from accidentally starting a drag.
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        return;
      }
      drag.active = true;
      // Update the selection to match the dragged set. The
      // selection wasn't changed in lbtn_down precisely so this
      // transition can also act as a "select what I'm dragging"
      // affordance - the user sees the source rows highlight as
      // the drag begins.
      this.selection.clear();
      for (const row of drag.sourceRows) {
        this.selection.toggle(row);
      }
    }

    drag.dropTarget = this.computeDropTarget(x, y, drag.forbiddenTargets);
    window.Repaint();
  }

  onMouseLeave(): void {
    // Cancel any in-progress potential drag. We can't reliably
    // detect a mouseup outside the panel, so cancelling here is
    // the safest behaviour - the user can simply click again to
    // restart the drag.
    this.internalDrag = null;
  }

  onMouseLbtnUp(x: number, y: number, mask: number): void {
    const drag = this.internalDrag;
    this.internalDrag = null;

    if (drag !== null && drag.active) {
      // Drag commit. If the drop target is null (e.g. the user
      // released over the scrollbar, or no valid target), the
      // drop is silently aborted - the source selection is left
      // as the last `mousemove` set it, which the user can clear
      // with Esc.
      if (drag.dropTarget !== null) {
        this.performInternalDrop(drag);
      }
      window.Repaint();
      return;
    }

    // Click commit (no drag occurred). If onMouseLbtnDown already
    // applied the selection change (the common case now), there's
    // nothing left to do - repainting isn't even needed since nothing
    // changed between down and up. Only the deferred case (plain click
    // on an already-selected row, held for a possible multi-drag that
    // didn't happen) still needs its selection collapse applied here.
    const hit = drag?.clickHit ?? null;
    if (hit === null || drag?.selectionAlreadyApplied) {
      return;
    }

    const isCtrl = (mask & MouseMask.CONTROL) !== 0;
    const isShift = (mask & MouseMask.SHIFT) !== 0;

    this.applyClickSelection(hit, isCtrl, isShift);

    const options = this.treeStore.getDocument().options;
    if (options.activateOnSingleClick && isPlaylistNode(hit.row.node)) {
      plman.ActivePlaylist = hit.row.node.index;
    }

    window.Repaint();
  }

  onMouseRbtnUp(_x: number, _y: number, _mask: number): void {
    // Phase 6 will build and track a ContextMenuManager here. For now,
    // we explicitly DO NOT track the right-click - returning without
    // calling any selection-changing code means SMP's default behaviour
    // applies (no menu, no selection change), which matches "no right-
    // click menu exists yet" better than a state mutation that we then
    // have to undo.
  }

  onMouseWheel(step: number): void {
    // SMP's documented convention: positive step = wheel rolled forward
    // = scroll content up = decrease scroll offset. Multiply by rows
    // per notch for a usable per-notch amount.
    const deltaPx = -step * WHEEL_LINES_PER_NOTCH * this.rowHeight;
    const totalContentHeight = this.lastFlattened.length * this.rowHeight;
    this.scrollOffsetPx = clampScrollOffset(
      this.scrollOffsetPx + deltaPx,
      window.Height,
      totalContentHeight
    );
    window.Repaint();
  }

  onKeyDown(vkey: number, mask: number): void {
    const totalRows = this.lastFlattened.length;
    if (totalRows === 0) {
      return;
    }

    const isShift = (mask & KeyMask.SHIFT) !== 0;

    // Note: Ctrl+A select-all is intentionally not bound - per the
    // owner's preference, the panel doesn't grab that shortcut.

    if (vkey === VK.ESCAPE) {
      if (!this.selection.isEmpty()) {
        this.selection.clear();
        window.Repaint();
      }
      return;
    }

    if (vkey === VK.RETURN) {
      this.activateAnchor();
      return;
    }

    if (vkey === VK.F2) {
      this.onRenameRequested();
      return;
    }

    const currentAnchor = this.selection.getAnchor();
    const cursor: number = currentAnchor !== null
      ? currentAnchor
      : (this.selection.first() ?? 0);

    let next: number | null = null;

    switch (vkey) {
      case VK.DOWN:
        next = cursor + 1 < totalRows ? cursor + 1 : cursor;
        break;
      case VK.UP:
        next = cursor - 1 >= 0 ? cursor - 1 : cursor;
        break;
      case VK.HOME:
        next = 0;
        break;
      case VK.END:
        next = totalRows - 1;
        break;
      case VK.PRIOR: {
        const page = Math.max(1, Math.floor(window.Height / this.rowHeight));
        next = Math.max(0, cursor - page);
        break;
      }
      case VK.NEXT: {
        const page = Math.max(1, Math.floor(window.Height / this.rowHeight));
        next = Math.min(totalRows - 1, cursor + page);
        break;
      }
      case VK.LEFT:
        next = this.handleLeftKey(cursor);
        break;
      case VK.RIGHT:
        next = this.handleRightKey(cursor);
        break;
      default:
        return;
    }

    if (next === null) return;

    if (isShift) {
      this.selection.extendRangeTo(next);
    } else {
      this.selection.setSingle(next);
    }
    this.scrollSelectionIntoView(next);
    window.Repaint();
  }

  /**
   * Sets plman.ActivePlaylist to the index of the first selected
   * playlist node, if any. Folders are skipped (Enter on a folder-only
   * selection is a no-op, matching the original foo_plorg).
   */
  private activateAnchor(): void {
    for (const rowIndex of this.selection.iter()) {
      if (rowIndex >= this.lastFlattened.length) continue;
      const row = this.lastFlattened[rowIndex];
      if (!row) continue;
      if (isPlaylistNode(row.node)) {
        plman.ActivePlaylist = row.node.index;
        return;
      }
    }
  }

  /**
   * Prompts the user for a new name and applies it.
   */
  onRenameRequested(): void {
    if (this.selection.getSize() === 0) {
      return;
    }
    if (this.selection.getSize() > 1) {
      fb.ShowPopupMessage('Select a single item to rename.');
      return;
    }

    const rowIndex = this.selection.getAnchor();
    if (rowIndex === null) return;
    const row = this.lastFlattened[rowIndex];
    if (!row) return;

    const prompt = isFolderNode(row.node)
      ? 'New folder name:'
      : 'New playlist name:';

    let raw: string;
    try {
      raw = utils.InputBox(window.ID, prompt, 'Rename', row.node.name, true);
    } catch {
      return; // user cancelled
    }

    const newName = raw.trim();
    if (newName === row.node.name) {
      return; // no change
    }

    if (isFolderNode(row.node)) {
      this.treeStore.renameFolder(row.node, newName);
    } else if (isPlaylistNode(row.node)) {
      // plman enforces its own playlist-name uniqueness and may also
      // reject the rename for other reasons (lock, etc.). Empty new
      // names are allowed here per the "sibling collisions + empty
      // names allowed" design - plman may or may not accept them; if
      // it doesn't, we surface a generic failure popup.
      const ok = plman.RenamePlaylist(row.node.index, newName);
      if (!ok) {
        fb.ShowPopupMessage(
          'Rename failed. foobar2000 may have rejected the new name (duplicate or locked playlist).'
        );
        return;
      }
      // Optimistically update the cached name so the tree shows the
      // new name immediately. on_playlists_changed will fire
      // asynchronously and reconcile, but this avoids a brief flicker.
      row.node.name = newName;
      this.treeStore.scheduleSave();
    }

    window.Repaint();
  }

  /**
   * LEFT in Explorer convention: collapse an expanded folder, otherwise
   * jump to the parent. Returns the new cursor row, or null if the
   * cursor doesn't move (e.g. we're already on a root-level leaf and
   * there's no parent to jump to).
   */
  private handleLeftKey(cursor: number): number | null {
    const row = this.lastFlattened[cursor];
    if (!row) return null;
    if (isFolderNode(row.node) && row.node.expanded) {
      row.node.expanded = false;
      this.treeStore.scheduleSave();
      return cursor;
    }
    // Find the nearest ancestor by walking up while decreasing depth.
    for (let i = cursor - 1; i >= 0; i--) {
      const candidate = this.lastFlattened[i];
      if (!candidate) continue;
      if (candidate.depth < row.depth) {
        return i;
      }
    }
    return null;
  }

  /**
   * RIGHT in Explorer convention: expand a collapsed folder, otherwise
   * jump to the first child (or stay put if the row has no children).
   */
  private handleRightKey(cursor: number): number | null {
    const row = this.lastFlattened[cursor];
    if (!row) return null;
    if (isFolderNode(row.node)) {
      if (!row.node.expanded) {
        row.node.expanded = true;
        this.treeStore.scheduleSave();
      } else if (cursor + 1 < this.lastFlattened.length) {
        const child = this.lastFlattened[cursor + 1];
        if (child && child.depth === row.depth + 1) {
          return cursor + 1;
        }
      }
      return cursor;
    }
    // Playlist leaf - jump to next sibling if there is one.
    if (cursor + 1 < this.lastFlattened.length) {
      const next = this.lastFlattened[cursor + 1];
      if (next && next.depth === row.depth) {
        return cursor + 1;
      }
    }
    return null;
  }

  private scrollSelectionIntoView(rowIndex: number): void {
    const totalContentHeight = this.lastFlattened.length * this.rowHeight;
    this.scrollOffsetPx = ensureRowVisible(
      rowIndex,
      this.scrollOffsetPx,
      window.Height,
      this.rowHeight,
      totalContentHeight
    );
  }

  /**
   * Map a window-space (x, y) to a row index and whether the click
   * landed on the disclosure-triangle column. Returns null when the
   * click was on the scrollbar or below the last row.
   */
  private hitTest(x: number, y: number): HitResult | null {
    if (this.lastFlattened.length === 0) {
      return null;
    }

    // The scrollbar lives on the right edge; clicks on it shouldn't
    // count as "click on the bottom-most row" or anything.
    const needsScrollbar = this.lastFlattened.length * this.rowHeight > window.Height;
    if (needsScrollbar && x >= window.Width - SCROLLBAR_WIDTH_PX - SCROLLBAR_MARGIN_PX) {
      return null;
    }

    const rowIndex = rowAtY(y, this.scrollOffsetPx, this.rowHeight, this.lastFlattened.length);
    if (rowIndex === null) {
      return null;
    }

    const row = this.lastFlattened[rowIndex];
    if (!row) {
      return null;
    }

    const disclosureX = LEFT_PADDING_PX + row.depth * INDENT_PX;
    const isDisclosure =
      isFolderNode(row.node) && x >= disclosureX && x < disclosureX + DISCLOSURE_HIT_WIDTH_PX;

    return { rowIndex, isDisclosure, row };
  }

  /**
   * Build the set of nodes that the current drag cannot land on:
   * the source nodes themselves, plus every descendant of any
   * source folder. Used to short-circuit the drop-position search
   * so we never suggest an "into folder" that would create a cycle,
   * and so we never suggest "before/after X" on a row whose node
   * is forbidden (rare for siblings, but possible for the source
   * nodes themselves - which would be a no-op anyway).
   */
  private computeForbiddenTargets(sourceRows: number[]): Set<TreeNode> {
    const forbidden = new Set<TreeNode>();
    for (const rowIndex of sourceRows) {
      const row = this.lastFlattened[rowIndex];
      if (!row) continue;
      forbidden.add(row.node);
      if (isFolderNode(row.node)) {
        this.collectDescendants(row.node.children, forbidden);
      }
    }
    return forbidden;
  }

  private collectDescendants(nodes: TreeNode[], into: Set<TreeNode>): void {
    for (const node of nodes) {
      into.add(node);
      if (isFolderNode(node)) {
        this.collectDescendants(node.children, into);
      }
    }
  }

  /**
   * Translate a (x, y) into a drop target for the current drag.
   * Returns null when the position is over the scrollbar, over a
   * forbidden node, or otherwise not a valid drop site.
   *
   * Position semantics:
   *   - Folder row, top FOLDER_BEFORE_FRAC: insert before
   *   - Folder row, middle: into (append at end of folder's children)
   *   - Folder row, bottom FOLDER_AFTER_FRAC: insert after
   *   - Playlist row, top half: insert before
   *   - Playlist row, bottom half: insert after
   *   - Empty space below all rows: append to root (rowIndex === -1)
   */
  private computeDropTarget(x: number, y: number, forbidden: Set<TreeNode>): DropTarget | null {
    if (this.lastFlattened.length === 0) {
      return null;
    }

    // Same scrollbar exclusion as hitTest.
    const needsScrollbar = this.lastFlattened.length * this.rowHeight > window.Height;
    if (needsScrollbar && x >= window.Width - SCROLLBAR_WIDTH_PX - SCROLLBAR_MARGIN_PX) {
      return null;
    }

    const rowIndex = rowAtY(y, this.scrollOffsetPx, this.rowHeight, this.lastFlattened.length);
    if (rowIndex === null) {
      // Below the last row - append to root. The caller treats
      // rowIndex === -1 as "append"; we don't need a forbidden
      // check because root never contains the source nodes during
      // a drag (they're snapshotted into drag.sourceRows before
      // any move can happen).
      return { rowIndex: -1, position: 'after' };
    }

    const row = this.lastFlattened[rowIndex];
    if (!row) {
      return null;
    }

    const rowTop = rowY(rowIndex, this.rowHeight);
    const relativeY = y - rowTop;

    if (isFolderNode(row.node)) {
      // The folder itself can't be a forbidden target (a source
      // folder is in `forbidden`, but we still want to offer
      // "insert before / after" the folder, just not "into" it).
      const intoForbidden = forbidden.has(row.node);

      if (relativeY < this.rowHeight * FOLDER_BEFORE_FRAC) {
        return { rowIndex, position: 'before' };
      } else if (relativeY < this.rowHeight * FOLDER_AFTER_FRAC) {
        // Middle: prefer "into", but fall back to "before" if the
        // folder is forbidden (dragging a folder into itself or
        // one of its own descendants would create a cycle).
        return intoForbidden ? { rowIndex, position: 'before' } : { rowIndex, position: 'into' };
      } else {
        // Bottom band. If the folder is forbidden (cycle risk),
        // fall back to "before" - same reasoning as the middle
        // zone. Otherwise: an expanded folder with visible children
        // has no gap between its own row and its first child's row,
        // so this band reads as "insert right here" - which means
        // *first child of this folder*, not "sibling after the
        // folder's entire subtree" (that reading only makes sense
        // when the folder is collapsed or empty, where the next
        // visual row genuinely is the next sibling).
        if (intoForbidden) {
          return { rowIndex, position: 'before' };
        }
        if (row.node.expanded && row.node.children.length > 0) {
          return { rowIndex, position: 'into-start' };
        }
        return { rowIndex, position: 'after' };
      }
    }

    // Playlist row. Refuse if the playlist itself is forbidden
    // (i.e. it's one of the dragged rows - moving a row to
    // before/after itself is a no-op we don't want to perform).
    if (forbidden.has(row.node)) {
      return null;
    }

    return relativeY < this.rowHeight * 0.5
      ? { rowIndex, position: 'before' }
      : { rowIndex, position: 'after' };
  }

  /**
   * Translate a resolved drop target into the (parent array, index)
   * pair the TreeStore expects, and dispatch to moveNodes.
   */
  private performInternalDrop(drag: InternalDragState): void {
    if (drag.dropTarget === null) return;
    const target = drag.dropTarget;

    let targetParent: TreeNode[];
    let targetIndex: number;

    if (target.rowIndex === -1) {
      // Append to root.
      targetParent = this.treeStore.getDocument().nodes;
      targetIndex = targetParent.length;
    } else {
      const row = this.lastFlattened[target.rowIndex];
      if (!row) return;
      if (target.position === 'into') {
        if (!isFolderNode(row.node)) return; // shouldn't happen
        targetParent = row.node.children;
        targetIndex = targetParent.length;
      } else if (target.position === 'into-start') {
        if (!isFolderNode(row.node)) return; // shouldn't happen
        targetParent = row.node.children;
        targetIndex = 0;
      } else {
        targetParent = row.parent;
        const idxInParent = targetParent.indexOf(row.node);
        if (idxInParent === -1) return;
        targetIndex = target.position === 'before' ? idxInParent : idxInParent + 1;
      }
    }

    // Resolve source rows to (node, parent, indexInParent) tuples.
    // The parent reference is used to remove the source from its
    // current location, so it must be the array the source node
    // currently lives in - not the post-move parent.
    const sources: Array<{ node: TreeNode; parent: TreeNode[]; indexInParent: number }> = [];
    for (const flatIndex of drag.sourceRows) {
      const row = this.lastFlattened[flatIndex];
      if (!row) continue;
      const idxInParent = row.parent.indexOf(row.node);
      if (idxInParent === -1) continue;
      sources.push({ node: row.node, parent: row.parent, indexInParent: idxInParent });
    }
    if (sources.length === 0) return;

    this.treeStore.moveNodes(sources, { parent: targetParent, index: targetIndex });

    // After the move, the previously-selected rows now live at
    // different flat indices. The simplest correct thing is to
    // clear the selection - the user can re-select what they
    // just moved if they want to keep acting on it. Trying to
    // re-resolve the same nodes to their new flat indices is
    // fiddly and not obviously more useful.
    this.selection.clear();
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
