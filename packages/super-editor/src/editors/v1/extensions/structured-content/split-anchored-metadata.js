import { TextSelection } from 'prosemirror-state';
import { generateRandomSigned32BitIntStrId } from '@core/helpers/generateDocxRandomId.js';

// Alias stamped on every anchored-metadata SDT.
const ANCHORED_METADATA_ALIAS = 'Anchored metadata';

// Checkbox / dropdown controls are atomic: their value is a whole-node choice,
// so a block break inside them is meaningless. They share the
// structuredContent node type with anchored-metadata anchors, so exclude them.
const ATOMIC_CONTROL_TYPES = new Set(['checkbox', 'comboBox', 'dropDownList']);

/**
 * True when `node` is an anchored-metadata anchor: the inline structuredContent
 * SDT that wraps highlighted text. Anchors are stamped with the "Anchored
 * metadata" alias; as a fallback, a hidden-appearance SDT carrying a payload
 * `tag` is treated as one too. Atomic controls are never anchors.
 * @param {import('prosemirror-model').Node} node
 * @returns {boolean}
 */
function isAnchoredMetadataNode(node) {
  if (!node || node.type.name !== 'structuredContent') return false;
  if (ATOMIC_CONTROL_TYPES.has(node.attrs?.controlType)) return false;
  if (node.attrs?.alias === ANCHORED_METADATA_ALIAS) return true;

  const tag = node.attrs?.tag;
  return typeof tag === 'string' && tag.length > 0 && node.attrs?.appearance === 'hidden';
}

/**
 * Depth of the nearest anchored-metadata anchor enclosing a resolved position,
 * or null when the position is not inside one.
 * @param {import('prosemirror-model').ResolvedPos} $pos
 * @returns {number | null}
 */
function anchoredMetadataDepth($pos) {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if (isAnchoredMetadataNode($pos.node(depth))) return depth;
  }
  return null;
}

/**
 * True when the cursor sits at the very start of the anchor's content — before
 * the first character, with nothing but wrapper-node openings (e.g. `run`)
 * between the anchor and the cursor.
 *
 * We check this so we can avoid splitting straight through the anchor at a
 * boundary, which would leave an empty leading half behind.
 *
 * @param {import('prosemirror-model').ResolvedPos} $from
 * @param {number} anchorDepth  Depth of the enclosing anchor node.
 * @returns {boolean}
 */
function isAtAnchorStart($from, anchorDepth) {
  // The cursor's immediate parent must be at its own start...
  if ($from.parentOffset !== 0) return false;

  // ...and every wrapper between the anchor and the cursor must be a first
  // child, so there is no earlier content anywhere inside the anchor.
  for (let depth = anchorDepth; depth < $from.depth; depth += 1) {
    if ($from.index(depth) !== 0) return false;
  }
  return true;
}

/**
 * True when the cursor sits at the very end of the anchor's content — after the
 * last character, with nothing but wrapper-node closings between the cursor and
 * the anchor's end.
 *
 * @param {import('prosemirror-model').ResolvedPos} $from
 * @param {number} anchorDepth  Depth of the enclosing anchor node.
 * @returns {boolean}
 */
function isAtAnchorEnd($from, anchorDepth) {
  // The cursor's immediate parent must be at its own end...
  if ($from.parentOffset !== $from.parent.content.size) return false;

  // ...and every wrapper between the anchor and the cursor must be a last child,
  // so there is no later content anywhere inside the anchor.
  for (let depth = anchorDepth; depth < $from.depth; depth += 1) {
    if ($from.index(depth) !== $from.node(depth).childCount - 1) return false;
  }
  return true;
}

/**
 * Break the current block through an anchored-metadata anchor at the cursor.
 *
 * Anchored-metadata highlights are inline `structuredContent` SDTs marked
 * `isolating: true`. `isolating` makes ProseMirror's `splitBlock` — and
 * therefore Enter — refuse to split, so a cursor inside a highlight cannot start
 * a new paragraph or list item; the keypress is otherwise a no-op.
 *
 * With the cursor *inside* the anchor's content, this splits the anchor and its
 * textblock together at the cursor: the one anchor becomes two adjacent anchors,
 * one in each block, sharing the same payload `tag`. The trailing anchor is
 * given a fresh `w:id` so the two halves never collide; both keep the same
 * `tag`, so they still resolve to the one payload.
 *
 * With the cursor at the anchor's first or last position, splitting *through*
 * the anchor would leave an empty anchor half behind — an invisible zero-width
 * SDT that survives export/re-import and cannot be selected or deleted. So at a
 * boundary we split the block *outside* the anchor instead, keeping the whole
 * anchor (and all its content) on one side and a plain empty block on the other.
 *
 * Returns false (a no-op) when the selection is not a collapsed cursor inside an
 * anchored-metadata anchor, so callers can fall through to normal Enter handling.
 *
 * @type {import('prosemirror-state').Command}
 */
export function splitAnchoredMetadataAt(state, dispatch) {
  const { selection } = state;
  if (!selection.empty) return false;

  const { $from } = selection;
  const anchorDepth = anchoredMetadataDepth($from);
  if (anchorDepth === null) return false;

  // Splitting through the anchor is only safe when there is content on both
  // sides of the cursor. At a boundary, break the block just outside the anchor.
  const atAnchorStart = isAtAnchorStart($from, anchorDepth);
  const atAnchorEnd = isAtAnchorEnd($from, anchorDepth);

  if (dispatch && (atAnchorStart || atAnchorEnd)) {
    const { tr } = state;

    // Split the paragraph immediately before the anchor (cursor at its start) or
    // immediately after it (cursor at its end). Either way the anchor stays whole
    // in one block, so there is no duplicate anchor and no `w:id` to refresh.
    const splitPos = atAnchorStart ? $from.before(anchorDepth) : $from.after(anchorDepth);
    tr.split(splitPos);

    // Land the cursor the way a normal Enter would: at the anchor's start we keep
    // the caret with the content that moved down (the trailing block); at its end
    // we drop the caret into the new empty block that now follows the anchor.
    const cursorPos = atAnchorStart ? tr.mapping.map($from.pos) : tr.mapping.map(splitPos);
    tr.setSelection(TextSelection.create(tr.doc, cursorPos));
    tr.scrollIntoView();
    dispatch(tr);
    return true;
  }

  if (dispatch) {
    const { tr } = state;
    const splitPos = $from.pos;

    // We need to split every level from the cursor's immediate parent
    // ($from.depth) up to and including the paragraph that holds the anchor.
    // The paragraph sits one level above the anchor, at depth anchorDepth - 1.
    //
    // Subtracting the two depths ($from.depth - (anchorDepth - 1)) gives the
    // distance between them, but that undercounts by one, so add 1.
    //
    // Example: say the cursor's immediate parent is depth 5 and the paragraph
    // holding the anchor is depth 3. Distance is 5 - 3 = 2, but the levels we
    // must split are depths 3, 4, and 5 — that's 3 levels, not 2. The + 1 puts
    // back the level the subtraction drops.
    const levelsToSplit = $from.depth - (anchorDepth - 1) + 1;
    tr.split(splitPos, levelsToSplit);

    // The cursor now sits at the start of the trailing block's anchor. Give that
    // anchor a fresh integer id so it no longer duplicates the leading half's.
    const trailingPos = tr.mapping.map(splitPos);
    const $trailing = tr.doc.resolve(trailingPos);
    for (let depth = $trailing.depth; depth > 0; depth -= 1) {
      if (!isAnchoredMetadataNode($trailing.node(depth))) continue;
      const anchorNode = $trailing.node(depth);
      tr.setNodeMarkup($trailing.before(depth), undefined, {
        ...anchorNode.attrs,
        id: generateRandomSigned32BitIntStrId(),
      });
      break;
    }

    tr.setSelection(TextSelection.create(tr.doc, trailingPos));
    tr.scrollIntoView();
    dispatch(tr);
  }

  return true;
}
