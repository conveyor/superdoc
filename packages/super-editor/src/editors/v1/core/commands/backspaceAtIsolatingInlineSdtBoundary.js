import { TextSelection } from 'prosemirror-state';

/**
 * Final backspace fallback at the boundary of an isolating inline SDT (like anchored metadata).
 *
 * An inline `structuredContent` node is `isolating`, so ProseMirror's
 * `joinBackward` / `selectNodeBackward` both refuse to cross it, and the
 * run-aware handlers (backspaceAcrossRuns, backspaceNextToRun,
 * backspaceSkipEmptyRun) bail because there is no in-paragraph text between the
 * caret and the SDT. When every command in the chain declines, ProseMirror
 * falls through to the browser's native contentEditable Backspace. In a table
 * cell that native mutation is read back by `readDOMChange` as a single
 * table-spanning ReplaceAroundStep, which deletes the inline SDT and fabricates
 * a spurious nested table — a data-loss corruption.
 *
 * This command is placed LAST in the Backspace chain (after `selectNodeBackward`)
 * so it only fires at those two otherwise-unhandled boundary positions and never
 * preempts a real join:
 *
 *   1. Caret inside an isolating inline SDT at the very start of its content
 *      (parentOffset 0, ancestor structuredContent with `spec.isolating`).
 *      Move the selection to just before the SDT node. This is the same
 *      "step out of the isolating wrapper" move a user expects, and it deletes
 *      nothing.
 *   2. Caret at a textblock start whose `nodeAfter` is an isolating inline SDT.
 *      We only reach here when `joinBackward` already declined (no joinable
 *      previous block), so consume the key as a safe no-op to keep the browser
 *      from performing the corrupting native Backspace.
 *
 * Mirrors the intent of `selectInlineSdtBeforeRunStart` (which handles the
 * caret sitting just after an inline SDT); this handles the caret sitting at
 * or inside the SDT's leading boundary.
 *
 * @returns {import('./types/index.js').Command}
 */
export const backspaceAtIsolatingInlineSdtBoundary =
  () =>
  ({ state, dispatch }) => {
    const { selection } = state;
    if (!selection.empty) return false;

    const $from = selection.$from;

    // Branch 1: caret inside an isolating inline SDT at the start of its content.
    // Walk up the ancestor chain; if we are at parentOffset 0 the caret sits at
    // the very start of every ancestor between it and the SDT, so there is no
    // deletable content in between.
    if ($from.parentOffset === 0) {
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        const ancestor = $from.node(depth);
        const isIsolatingInlineSdt =
          ancestor.type.name === 'structuredContent' && ancestor.type.spec.isolating === true;
        if (isIsolatingInlineSdt) {
          if (dispatch) {
            // Position immediately before the isolating SDT node.
            const beforeSdt = $from.before(depth);
            dispatch(state.tr.setSelection(TextSelection.create(state.doc, beforeSdt)));
          }
          return true;
        }
      }
    }

    // Branch 2: caret at a textblock start whose next node is an isolating
    // inline SDT. Reaching this command means `joinBackward` already declined
    // (there is no previous block to join), so consume the key as a no-op.
    if ($from.parent.isTextblock && $from.parentOffset === 0) {
      const nodeAfter = $from.nodeAfter;
      const isIsolatingInlineSdt =
        nodeAfter?.type.name === 'structuredContent' && nodeAfter.type.spec.isolating === true;
      if (isIsolatingInlineSdt) {
        return true;
      }
    }

    return false;
  };
