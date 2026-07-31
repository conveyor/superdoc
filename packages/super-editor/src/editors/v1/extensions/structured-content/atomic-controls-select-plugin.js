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
 *  1. PROACTIVELY (`handleKeyDown`): when a collapsed caret sits just outside an
 *     inline atomic control and an arrow key would step into it, we hop the caret
 *     clean to the far side in a SINGLE press. This owns arrow traversal so the
 *     movement is symmetric (ArrowRight from the left and ArrowLeft from the right
 *     each take one press) and never fights the isolating boundary.
 *
 *  2. REACTIVELY (`appendTransaction`): a backstop for everything else — a click
 *     or programmatic jump that lands the selection INSIDE a control (inline or
 *     block) gets snapped to the nearest boundary outside the wrapper.
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
       * Proactive single-press arrow traversal across an inline atomic control.
       *
       * The sibling select plugin runs first; it returns false whenever the caret
       * is outside a structuredContent node (its boundary-exit walk finds nothing),
       * which is exactly the case we handle here — a caret parked just OUTSIDE the
       * control about to arrow into it. We take over that case and hop the caret to
       * the far side; for anything else we return false and let the select plugin /
       * native movement proceed.
       *
       * Without this, arrowing toward the control falls through to native cursor
       * movement, which steps INTO it — and the reactive backstop below then shoves
       * the cursor back out to the NEAREST edge, which is the one it just came from.
       * So the cursor bounces off the control's edge and never crosses it (you can't
       * arrow past the control). Jumping the whole control in one press, before the
       * cursor ever enters, is the only way to traverse it cleanly.
       */
      handleKeyDown(view, event) {
        // Mirror the select plugin's guards: only bare Left/Right arrows on a
        // collapsed caret, and never in viewing mode.
        if (editor?.options?.documentMode === 'viewing') return false;
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return false;
        if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;

        const { state } = view;
        const { selection } = state;
        if (!selection.empty) return false;

        const direction = event.key === 'ArrowRight' ? 'right' : 'left';
        const exitPos = findAdjacentAtomicControlExit(state.doc, selection.from, direction);
        if (exitPos == null) return false;

        try {
          // Land just past the control, ensuring a legal editable slot at that
          // boundary — parity with how the select plugin exits an inline SDT.
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
      const { selection } = newState;

      // Only react to selection moves. If the document changed, another
      // transaction is doing real work (typing, paste, a programmatic value
      // update); we must not fight it or re-home the caret mid-edit.
      if (transactions.some((tr) => tr.docChanged)) return undefined;

      // Nothing to do if the selection did not move.
      if (oldState.selection.eq(selection)) return undefined;

      // Backstop for clicks / programmatic jumps that land the selection inside an
      // atomic control (arrow traversal is owned by handleKeyDown above). A
      // selection can have its endpoints in different controls (or one inside, one
      // outside); snap toward whichever atomic control an endpoint sits in and
      // collapse to a single caret at the NEAREST boundary outside that control.
      const fromControl = findEnclosingAtomicControl(selection.$from);
      const toControl = findEnclosingAtomicControl(selection.$to);
      const control = fromControl ?? toControl;
      if (!control) return undefined;

      const anchorInsideControl = fromControl ? selection.from : selection.to;

      const distanceToStart = anchorInsideControl - control.before;
      const distanceToEnd = control.after - anchorInsideControl;
      const targetBoundary = distanceToStart <= distanceToEnd ? control.before : control.after;

      // Resolve to the nearest *valid* text position at that boundary. Selection.near
      // steps over the wrapper if the exact boundary is not a legal caret spot.
      const $boundary = newState.doc.resolve(targetBoundary);
      const normalizedSelection = Selection.near($boundary, targetBoundary === control.before ? -1 : 1);

      // Guard against loops / no-op churn: if we would land back on the current
      // selection (or still inside an atomic control), do nothing.
      if (normalizedSelection.eq(selection)) return undefined;
      if (findEnclosingAtomicControl(normalizedSelection.$from)) return undefined;

      const collapsed = TextSelection.create(newState.doc, normalizedSelection.from);
      return newState.tr.setSelection(collapsed);
    },
  });
}
