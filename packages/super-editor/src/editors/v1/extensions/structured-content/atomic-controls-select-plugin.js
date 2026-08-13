import { Plugin, PluginKey, Selection, TextSelection } from 'prosemirror-state';

import { applyEditableSlotAtInlineBoundary } from '@helpers/ensure-editable-slot-inline-boundary.js';

/**
 * Control types (ECMA-376 §17.5.2 structured document tags) that Word treats as
 * atomic to the text caret. The user interacts with these controls — ticking a
 * checkbox, opening a dropdown — but never types into their content the way they
 * would with a plain-text or rich-text field.
 *
 * text / date / richText and every other control type keep a normal editable
 * caret and are intentionally left untouched by this plugin.
 */
const ATOMIC_CONTROL_TYPES = new Set(['checkbox', 'comboBox', 'dropDownList']);

const STRUCTURED_CONTENT_NODE_TYPES = new Set(['structuredContent', 'structuredContentBlock']);

/**
 * Zero-width, invisible characters SuperDoc parks at the edges of an inline
 * control so the text cursor has a legal spot to sit right next to it. They
 * render as nothing and aren't real content, so when we check "is the cursor
 * right next to a control?" we skip over them as if they weren't there.
 *
 * If we didn't skip them, arrowing past a checkbox would feel broken: the
 * first arrow press would look like it did nothing (the cursor just quietly
 * lands on the invisible character), and you'd have to press the arrow again
 * to actually get past the control.
 */
const ZERO_WIDTH_SPACE = '\u200B'; // inserted by applyEditableSlotAtInlineBoundary
const ZERO_WIDTH_NO_BREAK_SPACE = '\uFEFF'; // legacy boundary filler
const OBJECT_REPLACEMENT_CHARACTER = '\uFFFC'; // leaf marker the select plugin uses

const EDITABLE_SLOT_CHARS = new Set([ZERO_WIDTH_SPACE, ZERO_WIDTH_NO_BREAK_SPACE, OBJECT_REPLACEMENT_CHARACTER]);

function isEditableSlotOnly(text) {
  for (const character of text) {
    if (!EDITABLE_SLOT_CHARS.has(character)) return false;
  }
  return text.length > 0;
}

/**
 * Walk the ancestors of a resolved position looking for the innermost
 * structured-content node whose control type is atomic (checkbox / dropdown).
 *
 * We walk from the deepest depth outward (mirroring the ancestor walks in
 * `structured-content-select-plugin` and the lock plugin) so a caret that lands
 * inside nested content still resolves the enclosing control.
 *
 * @param {import('prosemirror-model').ResolvedPos} $pos Resolved position to inspect.
 * @returns {{ before: number, after: number } | null}
 *   The wrapper's outer boundaries (`before` = position just before the node,
 *   `after` = position just after it), or `null` when `$pos` is not inside an
 *   atomic control.
 */
function findEnclosingAtomicControl($pos) {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (!STRUCTURED_CONTENT_NODE_TYPES.has(node.type.name)) continue;
    if (!ATOMIC_CONTROL_TYPES.has(node.attrs.controlType)) continue;

    const nodeStart = $pos.before(depth);
    return {
      before: nodeStart,
      after: nodeStart + node.nodeSize,
    };
  }

  return null;
}

/**
 * Returns true when the node is an inline atomic control (checkbox / dropdown).
 * Block controls are handled only by the reactive backstop below.
 */
function isInlineAtomicControl(node) {
  if (!node) return false;
  if (node.type.name !== 'structuredContent') return false;
  return ATOMIC_CONTROL_TYPES.has(node.attrs.controlType);
}

/**
 * Decide whether a checkbox/dropdown control sits right next to the cursor in
 * the direction of an arrow press — and if so, where the cursor should land to
 * be just past it. This is what lets us hop the cursor over a control in a
 * single press.
 *
 * "Right next to" ignores the invisible editable-slot characters that can sit
 * between the cursor and the control (see EDITABLE_SLOT_CHARS above): we step
 * over those as if they weren't there, then look at what is really there.
 *
 * @param {import('prosemirror-model').Node} doc The current document.
 * @param {number} caretPos Where the cursor is. This is a single, collapsed
 *   cursor (not a highlighted range).
 * @param {'left' | 'right'} direction Which way the arrow key moves.
 * @returns {number | null}
 *   The spot just past the control (after it for Right, before it for Left) so
 *   the cursor can jump over it, or `null` when there is no adjacent control.
 */
function findAdjacentAtomicControlExit(doc, caretPos, direction) {
  let scanPos = caretPos;

  // Walk over editable-slot-only text toward the control. Each step advances one
  // position past a slot character; anything else stops the scan.
  while (true) {
    const $scan = doc.resolve(scanPos);

    if (direction === 'right') {
      const nodeAfter = $scan.nodeAfter;
      if (isInlineAtomicControl(nodeAfter)) {
        // Land just past the control's trailing boundary.
        return scanPos + nodeAfter.nodeSize;
      }
      // Only keep scanning across purely-slot text; otherwise there is no
      // adjacent control to hop.
      if (nodeAfter && nodeAfter.isText && isEditableSlotOnly(nodeAfter.text)) {
        scanPos += nodeAfter.nodeSize;
        continue;
      }
      return null;
    }

    const nodeBefore = $scan.nodeBefore;
    if (isInlineAtomicControl(nodeBefore)) {
      // Land just past the control's leading boundary.
      return scanPos - nodeBefore.nodeSize;
    }
    if (nodeBefore && nodeBefore.isText && isEditableSlotOnly(nodeBefore.text)) {
      scanPos -= nodeBefore.nodeSize;
      continue;
    }
    return null;
  }
}

/**
 * Selection-normalization plugin for atomic content controls.
 *
 * Word treats checkbox and dropdown structured document tags (ECMA-376 §17.5.2)
 * as atomic to the caret: the user toggles or picks a value, they never place a
 * text cursor inside the control's content. This plugin keeps the caret out of
 * those controls two ways:
 *
 *  1. PROACTIVELY (`handleKeyDown`): when the moving end of the selection sits
 *     just outside an inline atomic control and an arrow key would step into it,
 *     we jump the whole control in a SINGLE press — moving the caret for a plain
 *     arrow, or extending the selection across it for Shift+arrow. This owns arrow
 *     traversal so the movement is symmetric (each direction takes one press) and
 *     never fights the isolating boundary, which would otherwise stall the caret
 *     or refuse to grow the highlight past the control.
 *
 *  2. REACTIVELY (`appendTransaction`): a backstop for everything else — a click
 *     or programmatic jump that lands a caret INSIDE a control (inline or block)
 *     gets snapped to the nearest boundary outside the wrapper. A range selection
 *     (shift-select / drag) whose endpoint falls inside a control is kept: only
 *     the offending endpoint is pushed out to the control's far edge so the whole
 *     control is engulfed, never collapsing the user's selection. Disabled in
 *     viewing mode, where there is no caret to protect.
 *
 * Only the selection is ever changed here; the document is only touched to insert
 * a zero-width editable slot at a boundary (via `applyEditableSlotAtInlineBoundary`,
 * matching the sibling select plugin), never to alter the control's value.
 *
 * @param {import('@core/Editor.js').Editor} [editor] Editor instance, used to read
 *   `documentMode` (arrow traversal is disabled in viewing mode).
 */
export function createAtomicControlsSelectPlugin(editor) {
  return new Plugin({
    key: new PluginKey('atomicControlsSelect'),

    props: {
      /**
       * Proactive single-press arrow traversal across an inline atomic control —
       * for both a plain arrow (move the caret) and Shift+arrow (extend the
       * selection).
       *
       * The control is an `isolating` node, so native cursor/selection movement
       * cannot cross it: a plain arrow steps INTO it (and the reactive backstop
       * below shoves the caret back out to the edge it came from, so it bounces
       * and never crosses), and Shift+arrow stalls the head at the boundary so the
       * highlight refuses to grow past the control. Owning both here — jumping the
       * whole control in one press — is the only way to traverse it cleanly.
       *
       *  - PLAIN arrow, collapsed caret parked just outside the control: hop the
       *    caret clean to the far side (ensuring a legal editable slot there).
       *  - SHIFT + arrow, head parked just outside the control: keep the anchor and
       *    move the head to the far side, engulfing the whole control in one press.
       *
       * For anything else we return false and let the sibling select plugin /
       * native movement proceed.
       */
      handleKeyDown(view, event) {
        // Keep word/line jumps (Alt/Ctrl/Cmd + arrow) native; we only own bare and
        // Shift + Left/Right. Never act in viewing mode.
        if (editor?.options?.documentMode === 'viewing') return false;
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return false;
        if (event.altKey || event.ctrlKey || event.metaKey) return false;

        const { state } = view;
        const { selection } = state;

        // A plain arrow with an active range collapses that range natively — leave
        // it. We only own the collapsed-caret hop and Shift-extension.
        if (!event.shiftKey && !selection.empty) return false;

        const direction = event.key === 'ArrowRight' ? 'right' : 'left';

        // The moving end is the head (head === from for a collapsed caret). Look
        // for an atomic control sitting right next to it in the direction of travel.
        const exitPos = findAdjacentAtomicControlExit(state.doc, selection.head, direction);
        if (exitPos == null) return false;

        try {
          if (event.shiftKey) {
            // EXTEND: keep the anchor fixed and jump the head to the far side of
            // the control. No editable slot is inserted — the boundary is already
            // a legal selection endpoint, and we must not mutate the document just
            // to grow a selection.
            const extended = TextSelection.create(state.doc, selection.anchor, exitPos);
            view.dispatch(state.tr.setSelection(extended));
            event.preventDefault();
            return true;
          }

          // MOVE: land the caret just past the control, ensuring a legal editable
          // slot at that boundary — parity with how the select plugin exits an
          // inline SDT.
          const boundarySide = direction === 'right' ? 'after' : 'before';
          const tr = applyEditableSlotAtInlineBoundary(state.tr, exitPos, boundarySide);
          view.dispatch(tr);
          event.preventDefault();
          return true;
        } catch {
          return false;
        }
      },
    },

    appendTransaction(transactions, oldState, newState) {
      // In a read-only viewer there is no caret to protect — the user is only
      // selecting text to read or copy, and a keydown never reaches a plugin in a
      // read-only view (it is gated behind `view.editable`). `appendTransaction`
      // has no such gate: it runs on the selection-only transactions a read-only
      // view still dispatches, so without this guard selecting across a control
      // would corrupt the user's selection. Mirror the sibling select plugin.
      if (editor?.options?.documentMode === 'viewing') return undefined;

      const { selection } = newState;

      // Only react to selection moves. If the document changed, another
      // transaction is doing real work (typing, paste, a programmatic value
      // update); we must not fight it or re-home the caret mid-edit.
      if (transactions.some((tr) => tr.docChanged)) return undefined;

      // Nothing to do if the selection did not move.
      if (oldState.selection.eq(selection)) return undefined;

      // --- Empty caret that landed inside a control (click / programmatic jump) ---
      // Snap the lone caret to the NEAREST boundary outside the wrapper and keep it
      // collapsed. Arrow traversal is owned by handleKeyDown above.
      if (selection.empty) {
        const control = findEnclosingAtomicControl(selection.$from);
        if (!control) return undefined;

        const distanceToStart = selection.from - control.before;
        const distanceToEnd = control.after - selection.from;
        const targetBoundary = distanceToStart <= distanceToEnd ? control.before : control.after;

        // Resolve to the nearest *valid* text position at that boundary. Selection.near
        // steps over the wrapper if the exact boundary is not a legal caret spot.
        const $boundary = newState.doc.resolve(targetBoundary);
        const normalizedCaret = Selection.near($boundary, targetBoundary === control.before ? -1 : 1);

        // Guard against loops / no-op churn: if we would land back on the current
        // selection (or still inside an atomic control), do nothing.
        if (normalizedCaret.eq(selection)) return undefined;
        if (findEnclosingAtomicControl(normalizedCaret.$from)) return undefined;

        return newState.tr.setSelection(TextSelection.create(newState.doc, normalizedCaret.from));
      }

      // --- Range selection with an endpoint inside a control (shift-select / drag) ---
      // Don't destroy the selection. A checkbox / dropdown is atomic to a
      // selection — you cannot grab half of it — so push only the endpoint that
      // sits inside a control out to that control's far edge, engulfing the whole
      // control while keeping the anchor, and the range, intact.
      const fromControl = findEnclosingAtomicControl(selection.$from);
      const toControl = findEnclosingAtomicControl(selection.$to);
      if (!fromControl && !toControl) return undefined;

      // `$from` is the lower end and `$to` the higher end. Extend each end that is
      // inside a control outward: the lower end to the control's leading edge, the
      // higher end to its trailing edge.
      const expandedFrom = fromControl ? fromControl.before : selection.from;
      const expandedTo = toControl ? toControl.after : selection.to;

      // Preserve selection direction so a follow-up Shift+Arrow keeps extending
      // the same end the user was already moving.
      const anchorIsLowerEnd = selection.anchor <= selection.head;
      const anchorPos = anchorIsLowerEnd ? expandedFrom : expandedTo;
      const headPos = anchorIsLowerEnd ? expandedTo : expandedFrom;

      // TextSelection.between snaps each end to the nearest valid text position,
      // so a boundary that is not itself a legal caret spot still resolves cleanly.
      const expandedSelection = TextSelection.between(newState.doc.resolve(anchorPos), newState.doc.resolve(headPos));

      // Guard against loops / no-op churn: bail if nothing changed or an endpoint
      // is still trapped inside a control after snapping (rare block-control
      // geometry) rather than emit a selection the backstop would just re-process.
      if (expandedSelection.eq(selection)) return undefined;
      if (findEnclosingAtomicControl(expandedSelection.$from)) return undefined;
      if (findEnclosingAtomicControl(expandedSelection.$to)) return undefined;

      return newState.tr.setSelection(expandedSelection);
    },
  });
}
