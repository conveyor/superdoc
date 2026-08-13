import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { initTestEditor } from '@tests/helpers/helpers.js';
import { splitAnchoredMetadataAt } from './split-anchored-metadata.js';

const ANCHOR_ATTRS = {
  alias: 'Anchored metadata',
  appearance: 'hidden',
  controlType: 'richText',
  tag: 'meta-1',
  id: '111',
};

describe('splitAnchoredMetadataAt', () => {
  let editor;
  let schema;

  beforeEach(() => {
    ({ editor } = initTestEditor({ mode: 'text', content: '<p></p>' }));
    ({ schema } = editor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    editor?.destroy();
    editor = null;
    schema = null;
  });

  // Build: <p>{before}<sc {attrs}>{inside}</sc>{after}</p> and put a collapsed
  // cursor `cursorInInside` characters into the anchor's text.
  const stateWithCursorInAnchor = ({
    before = 'before ',
    inside = 'highlighted',
    after = ' after',
    cursorInInside = 4,
    attrs = ANCHOR_ATTRS,
  } = {}) => {
    const anchor = schema.nodes.structuredContent.create(attrs, schema.text(inside));
    const content = [];
    if (before) content.push(schema.text(before));
    content.push(anchor);
    if (after) content.push(schema.text(after));
    const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, content));

    // +1 to enter the paragraph, +before.length to pass leading text, +1 to enter
    // the anchor, then `cursorInInside` into the anchor's text.
    const cursor = 1 + before.length + 1 + cursorInInside;
    const state = EditorState.create({ schema, doc });
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, cursor)));
  };

  const anchorsIn = (doc) => {
    const found = [];
    doc.descendants((node) => {
      if (node.type.name === 'structuredContent') found.push(node);
    });
    return found;
  };

  const applyCommand = (state) => {
    let next = state;
    const handled = splitAnchoredMetadataAt(state, (tr) => {
      next = state.apply(tr);
    });
    return { handled, next };
  };

  it('splits the block into two, one anchor half in each', () => {
    const { handled, next } = applyCommand(stateWithCursorInAnchor());

    expect(handled).toBe(true);
    expect(next.doc.childCount).toBe(2);

    const anchors = anchorsIn(next.doc);
    expect(anchors).toHaveLength(2);
    expect(anchors[0].textContent).toBe('high');
    expect(anchors[1].textContent).toBe('lighted');

    // Leading text stays in the first block, trailing text in the second.
    expect(next.doc.child(0).textContent).toBe('before high');
    expect(next.doc.child(1).textContent).toBe('lighted after');
  });

  it('keeps the shared payload tag but gives the trailing half a fresh id', () => {
    const { next } = applyCommand(stateWithCursorInAnchor());
    const [leading, trailing] = anchorsIn(next.doc);

    expect(leading.attrs.tag).toBe('meta-1');
    expect(trailing.attrs.tag).toBe('meta-1');
    expect(leading.attrs.id).toBe('111');
    expect(trailing.attrs.id).not.toBe('111');
    expect(trailing.attrs.id).toMatch(/^\d+$/);
  });

  it('places the cursor at the start of the trailing anchor', () => {
    const { next } = applyCommand(stateWithCursorInAnchor());
    const { $from } = next.selection;

    expect(next.selection.empty).toBe(true);
    expect($from.parent.type.name).toBe('structuredContent');
    expect($from.parent.textContent).toBe('lighted');
    expect($from.parentOffset).toBe(0);
  });

  it('splits through inline run wrappers (the shape the live editor produces)', () => {
    // In the running editor an anchor's text is wrapped in `run` nodes, so the
    // cursor sits one level deeper than bare text. The split must still break the
    // block through both the run and the anchor.
    const anchor = schema.nodes.structuredContent.create(
      ANCHOR_ATTRS,
      schema.nodes.run.create(null, schema.text('highlighted')),
    );
    const doc = schema.nodes.doc.create(
      null,
      schema.nodes.paragraph.create(null, [schema.text('before '), anchor, schema.text(' after')]),
    );
    // 1 (enter paragraph) + 7 (before) + 1 (enter anchor) + 1 (enter run) + 4.
    let state = EditorState.create({ schema, doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 14)));

    const { handled, next } = applyCommand(state);

    expect(handled).toBe(true);
    expect(next.doc.childCount).toBe(2);
    const anchors = anchorsIn(next.doc);
    expect(anchors).toHaveLength(2);
    expect(anchors[0].textContent).toBe('high');
    expect(anchors[1].textContent).toBe('lighted');
    expect(anchors[1].attrs.tag).toBe('meta-1');
    expect(anchors[1].attrs.id).not.toBe('111');
  });

  it('is a no-op with no dispatch but still reports it would handle Enter', () => {
    const state = stateWithCursorInAnchor();
    const handled = splitAnchoredMetadataAt(state, undefined);
    expect(handled).toBe(true);
  });

  it('returns false when the cursor is outside any anchor', () => {
    const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text('plain text')));
    let state = EditorState.create({ schema, doc });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));

    const { handled, next } = applyCommand(state);
    expect(handled).toBe(false);
    expect(next.doc.childCount).toBe(1);
  });

  it('does not split atomic controls (checkbox / dropdown)', () => {
    const state = stateWithCursorInAnchor({
      attrs: { ...ANCHOR_ATTRS, controlType: 'checkbox', alias: undefined },
    });
    const { handled, next } = applyCommand(state);

    expect(handled).toBe(false);
    expect(next.doc.childCount).toBe(1);
  });

  it('returns false for a non-collapsed selection', () => {
    let state = stateWithCursorInAnchor();
    const { $from } = state.selection;
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, $from.pos, $from.pos + 3)));

    const { handled } = applyCommand(state);
    expect(handled).toBe(false);
  });
});
