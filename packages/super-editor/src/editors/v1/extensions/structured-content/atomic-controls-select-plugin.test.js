import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { initTestEditor } from '@tests/helpers/helpers.js';

function findNode(doc, nodeType) {
  let result = null;

  doc.descendants((node, pos) => {
    if (node.type.name === nodeType) {
      result = { node, pos };
      return false;
    }
  });

  return result;
}

/**
 * True when the plugin returned the caret to a legal text position that is not
 * inside any structured-content wrapper.
 */
function selectionIsInsideStructuredContent(selection) {
  for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
    const nodeName = selection.$from.node(depth).type.name;
    if (nodeName === 'structuredContent' || nodeName === 'structuredContentBlock') {
      return true;
    }
  }
  return false;
}

describe('AtomicControlsSelectPlugin', () => {
  let editor;
  let schema;

  beforeEach(() => {
    ({ editor } = initTestEditor());
    ({ schema } = editor);
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;
    schema = null;
  });

  function applyDoc(doc) {
    editor.setState(
      EditorState.create({
        schema,
        doc,
        plugins: editor.state.plugins,
      }),
    );
  }

  /**
   * Build a paragraph `A [SDT] Z` with a single inline control of the given type
   * and return the located control node/pos.
   *
   * `leadingSlot` / `trailingSlot` optionally insert a zero-width editable-slot
   * character immediately inside the surrounding text at the control's boundary,
   * so we can prove the arrow handler steps over slots when detecting adjacency.
   */
  function buildInlineControlDoc(controlType, { leadingSlot = false, trailingSlot = false } = {}) {
    const inlineSdt = schema.nodes.structuredContent.create({ id: 'inline-1', controlType }, schema.text('Field'));

    const leading = leadingSlot ? 'A ​' : 'A ';
    const trailing = trailingSlot ? '​ Z' : ' Z';
    const paragraph = schema.nodes.paragraph.create(null, [schema.text(leading), inlineSdt, schema.text(trailing)]);

    applyDoc(schema.nodes.doc.create(null, [paragraph]));
    return findNode(editor.state.doc, 'structuredContent');
  }

  function setCaret(pos) {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
  }

  /**
   * Drive the REAL ProseMirror keydown chain: dispatch the arrow through
   * `handleKeyDown` exactly the way the view would, using a real KeyboardEvent.
   * This exercises the proactive handler (which preventDefaults + dispatches
   * explicitly), so the result is deterministic in jsdom and does NOT rely on
   * native caret movement.
   *
   * @returns {boolean} whether a handler claimed the key.
   */
  function pressArrow(key) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true });
    let handled = false;
    editor.view.someProp('handleKeyDown', (handler) => {
      handled = handler(editor.view, event);
      return handled;
    });
    return handled;
  }

  describe('proactive arrow traversal (handleKeyDown)', () => {
    it('ArrowRight from just BEFORE an inline checkbox hops the caret past it in one press', () => {
      const sdt = buildInlineControlDoc('checkbox');
      expect(sdt).not.toBeNull();

      setCaret(sdt.pos); // caret parked on the leading boundary
      const handled = pressArrow('ArrowRight');

      expect(handled).toBe(true);
      expect(editor.state.selection.empty).toBe(true);
      expect(selectionIsInsideStructuredContent(editor.state.selection)).toBe(false);
      expect(editor.state.selection.from).toBe(sdt.pos + sdt.node.nodeSize);
    });

    it('ArrowLeft from just AFTER an inline checkbox hops the caret before it in one press', () => {
      const sdt = buildInlineControlDoc('checkbox');
      expect(sdt).not.toBeNull();

      setCaret(sdt.pos + sdt.node.nodeSize); // caret parked on the trailing boundary
      const handled = pressArrow('ArrowLeft');

      expect(handled).toBe(true);
      expect(editor.state.selection.empty).toBe(true);
      expect(selectionIsInsideStructuredContent(editor.state.selection)).toBe(false);
      expect(editor.state.selection.from).toBe(sdt.pos);
    });

    it('steps over a trailing editable-slot char when hopping right past the control', () => {
      const sdt = buildInlineControlDoc('checkbox', { leadingSlot: true });
      expect(sdt).not.toBeNull();

      // Caret sits before the ZWSP that precedes the control; the handler must
      // treat the slot as transparent and still find the adjacent control.
      setCaret(sdt.pos - 1);
      const handled = pressArrow('ArrowRight');

      expect(handled).toBe(true);
      expect(selectionIsInsideStructuredContent(editor.state.selection)).toBe(false);
      expect(editor.state.selection.from).toBe(sdt.pos + sdt.node.nodeSize);
    });

    it('steps over a leading editable-slot char when hopping left past the control', () => {
      const sdt = buildInlineControlDoc('checkbox', { trailingSlot: true });
      expect(sdt).not.toBeNull();

      // Caret sits after the ZWSP that follows the control.
      setCaret(sdt.pos + sdt.node.nodeSize + 1);
      const handled = pressArrow('ArrowLeft');

      expect(handled).toBe(true);
      expect(selectionIsInsideStructuredContent(editor.state.selection)).toBe(false);
      expect(editor.state.selection.from).toBe(sdt.pos);
    });

    it('hops past a dropDownList control just like a checkbox', () => {
      const sdt = buildInlineControlDoc('dropDownList');
      expect(sdt).not.toBeNull();

      setCaret(sdt.pos);
      const handled = pressArrow('ArrowRight');

      expect(handled).toBe(true);
      expect(editor.state.selection.from).toBe(sdt.pos + sdt.node.nodeSize);
    });

    it('hops past a comboBox control just like a checkbox', () => {
      const sdt = buildInlineControlDoc('comboBox');
      expect(sdt).not.toBeNull();

      setCaret(sdt.pos + sdt.node.nodeSize);
      const handled = pressArrow('ArrowLeft');

      expect(handled).toBe(true);
      expect(editor.state.selection.from).toBe(sdt.pos);
    });

    it('does NOT hop an editable text control (returns false, native arrow proceeds)', () => {
      const sdt = buildInlineControlDoc('text');
      expect(sdt).not.toBeNull();

      setCaret(sdt.pos);
      const handled = pressArrow('ArrowRight');

      expect(handled).toBe(false);
      // Selection is untouched by our handler.
      expect(editor.state.selection.from).toBe(sdt.pos);
    });

    it('does NOT hop an editable date control (returns false, native arrow proceeds)', () => {
      const sdt = buildInlineControlDoc('date');
      expect(sdt).not.toBeNull();

      setCaret(sdt.pos + sdt.node.nodeSize);
      const handled = pressArrow('ArrowLeft');

      expect(handled).toBe(false);
      expect(editor.state.selection.from).toBe(sdt.pos + sdt.node.nodeSize);
    });

    it('does not act on modified arrows (shift extends selection natively)', () => {
      const sdt = buildInlineControlDoc('checkbox');
      expect(sdt).not.toBeNull();

      setCaret(sdt.pos);
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true });
      let handled = false;
      editor.view.someProp('handleKeyDown', (handler) => {
        handled = handler(editor.view, event);
        return handled;
      });

      expect(handled).toBe(false);
    });

    it('does not act in viewing mode', () => {
      const sdt = buildInlineControlDoc('checkbox');
      expect(sdt).not.toBeNull();

      editor.setDocumentMode('viewing');
      setCaret(sdt.pos);
      pressArrow('ArrowRight');

      // A read-only viewing plugin may claim the arrow, but OUR handler must not
      // hop the caret past the control: the selection stays put on the boundary.
      expect(editor.state.selection.from).toBe(sdt.pos);
    });
  });

  describe('reactive click backstop (appendTransaction)', () => {
    it('snaps a caret placed inside an inline checkbox to the nearest boundary', () => {
      const sdt = buildInlineControlDoc('checkbox');
      expect(sdt).not.toBeNull();

      const insideControl = sdt.pos + 1 + 1; // one text position into the content
      setCaret(insideControl);

      expect(editor.state.selection.empty).toBe(true);
      expect(selectionIsInsideStructuredContent(editor.state.selection)).toBe(false);
      // Nearer the start of the control, so it exits before the wrapper.
      expect(editor.state.selection.from).toBe(sdt.pos);
    });

    it('snaps toward the trailing boundary when the caret is nearer the control end', () => {
      const sdt = buildInlineControlDoc('checkbox');
      expect(sdt).not.toBeNull();

      const contentTo = sdt.pos + sdt.node.nodeSize - 1;
      const nearEnd = contentTo - 1; // one text position before the closing boundary
      setCaret(nearEnd);

      expect(editor.state.selection.empty).toBe(true);
      expect(selectionIsInsideStructuredContent(editor.state.selection)).toBe(false);
      expect(editor.state.selection.from).toBe(sdt.pos + sdt.node.nodeSize);
    });

    it('leaves a caret just BEFORE the control unchanged', () => {
      const sdt = buildInlineControlDoc('checkbox');
      expect(sdt).not.toBeNull();

      const beforeControl = sdt.pos;
      setCaret(beforeControl);

      expect(editor.state.selection.empty).toBe(true);
      expect(editor.state.selection.from).toBe(beforeControl);
    });

    it('leaves a caret just AFTER the control unchanged', () => {
      const sdt = buildInlineControlDoc('checkbox');
      expect(sdt).not.toBeNull();

      const afterControl = sdt.pos + sdt.node.nodeSize;
      setCaret(afterControl);

      expect(editor.state.selection.empty).toBe(true);
      expect(editor.state.selection.from).toBe(afterControl);
    });

    it('leaves a caret inside an editable text control unchanged', () => {
      const sdt = buildInlineControlDoc('text');
      expect(sdt).not.toBeNull();

      const insideControl = sdt.pos + 1 + 1;
      setCaret(insideControl);

      expect(editor.state.selection.empty).toBe(true);
      expect(selectionIsInsideStructuredContent(editor.state.selection)).toBe(true);
      expect(editor.state.selection.from).toBe(insideControl);
    });

    it('leaves a caret inside an editable date control unchanged', () => {
      const sdt = buildInlineControlDoc('date');
      expect(sdt).not.toBeNull();

      const insideControl = sdt.pos + 1 + 1;
      setCaret(insideControl);

      expect(editor.state.selection.empty).toBe(true);
      expect(selectionIsInsideStructuredContent(editor.state.selection)).toBe(true);
      expect(editor.state.selection.from).toBe(insideControl);
    });

    it('snaps a caret inside a dropDownList control like a checkbox', () => {
      const sdt = buildInlineControlDoc('dropDownList');
      expect(sdt).not.toBeNull();

      const insideControl = sdt.pos + 1 + 1;
      setCaret(insideControl);

      expect(editor.state.selection.empty).toBe(true);
      expect(selectionIsInsideStructuredContent(editor.state.selection)).toBe(false);
      expect(editor.state.selection.from).toBe(sdt.pos);
    });

    it('snaps a caret inside a comboBox control like a checkbox', () => {
      const sdt = buildInlineControlDoc('comboBox');
      expect(sdt).not.toBeNull();

      const insideControl = sdt.pos + 1 + 1;
      setCaret(insideControl);

      expect(editor.state.selection.empty).toBe(true);
      expect(selectionIsInsideStructuredContent(editor.state.selection)).toBe(false);
      expect(editor.state.selection.from).toBe(sdt.pos);
    });

    it('collapses a text selection overlapping the control to a boundary outside it', () => {
      const sdt = buildInlineControlDoc('checkbox');
      expect(sdt).not.toBeNull();

      // Range from surrounding text into the control content.
      const outsideStart = sdt.pos - 1; // inside the leading "A " text
      const insideControl = sdt.pos + 2;
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, outsideStart, insideControl)),
      );

      expect(editor.state.selection.empty).toBe(true);
      expect(selectionIsInsideStructuredContent(editor.state.selection)).toBe(false);
    });
  });
});
