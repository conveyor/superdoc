import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import { loadTestDataForEditorTests, initTestEditor } from '@tests/helpers/helpers.js';
import { createTable } from '../../extensions/table/tableHelpers/createTable.js';
import { handleBackspace } from '../extensions/keymap.js';
import { backspaceAtIsolatingInlineSdtBoundary } from './backspaceAtIsolatingInlineSdtBoundary.js';

/**
 * A schema mirroring the real editor's shape closely enough to reproduce the
 * isolating inline-SDT boundary: `structuredContent` is inline + isolating, and
 * runs wrap text inside both paragraphs and the SDT.
 */
const makeSchema = () =>
  new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'inline*' },
      structuredContent: {
        inline: true,
        group: 'inline',
        content: 'inline*',
        isolating: true,
        attrs: { id: { default: null } },
      },
      run: { inline: true, group: 'inline', content: 'inline*' },
      text: { group: 'inline' },
    },
    marks: {},
  });

const findNode = (doc, typeName, predicate = () => true) => {
  let result = null;
  doc.descendants((node, pos) => {
    if (result) return false;
    if (node.type.name === typeName && predicate(node)) {
      result = { node, pos, end: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  return result;
};

describe('backspaceAtIsolatingInlineSdtBoundary', () => {
  it('moves the selection to just before the SDT when the caret sits inside it at offset 0', () => {
    const schema = makeSchema();
    const sdtRun = schema.nodes.run.create(null, schema.text('Vendor Contact '));
    const sdt = schema.nodes.structuredContent.create({ id: 'sdt-1' }, sdtRun);
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [sdt])]);

    const sdtNode = findNode(doc, 'structuredContent');
    // Caret inside the SDT's inner run at offset 0: SDT open token (+1) → run open token (+1).
    const caretInsideSdt = sdtNode.pos + 2;
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, caretInsideSdt) });

    let dispatched;
    const ok = backspaceAtIsolatingInlineSdtBoundary()({ state, dispatch: (tr) => (dispatched = tr) });

    expect(ok).toBe(true);
    expect(dispatched).toBeDefined();
    expect(dispatched.selection).toBeInstanceOf(TextSelection);
    // Selection moved to the position immediately before the SDT node.
    expect(dispatched.selection.from).toBe(sdtNode.pos);
    // No content deleted: node counts unchanged.
    expect(dispatched.doc.childCount).toBe(doc.childCount);
    const countType = (targetDoc, name) => {
      let count = 0;
      targetDoc.descendants((node) => {
        if (node.type.name === name) count += 1;
      });
      return count;
    };
    expect(countType(dispatched.doc, 'structuredContent')).toBe(countType(doc, 'structuredContent'));
    expect(countType(dispatched.doc, 'text')).toBe(countType(doc, 'text'));
  });

  it('returns true without dispatching when no dispatch is provided', () => {
    const schema = makeSchema();
    const sdt = schema.nodes.structuredContent.create(
      { id: 'sdt-1' },
      schema.nodes.run.create(null, schema.text('Content')),
    );
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [sdt])]);
    const sdtNode = findNode(doc, 'structuredContent');
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, sdtNode.pos + 2) });

    expect(backspaceAtIsolatingInlineSdtBoundary()({ state })).toBe(true);
  });

  it('consumes the key as a no-op at a textblock start whose next node is an isolating SDT', () => {
    const schema = makeSchema();
    const sdt = schema.nodes.structuredContent.create(
      { id: 'sdt-1' },
      schema.nodes.run.create(null, schema.text('Content')),
    );
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [sdt])]);
    const paragraph = findNode(doc, 'paragraph');
    // Caret at paragraph offset 0, directly before the SDT.
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, paragraph.pos + 1) });
    const dispatch = vi.fn();

    const ok = backspaceAtIsolatingInlineSdtBoundary()({ state, dispatch });

    expect(ok).toBe(true);
    // Safe no-op: nothing dispatched, so nothing deleted.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('returns false for an ordinary mid-paragraph caret', () => {
    const schema = makeSchema();
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.nodes.run.create(null, schema.text('Hello world'))]),
    ]);
    const run = findNode(doc, 'run');
    // Caret in the middle of the run text.
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, run.pos + 4) });
    const dispatch = vi.fn();

    const ok = backspaceAtIsolatingInlineSdtBoundary()({ state, dispatch });

    expect(ok).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('returns false at a textblock start whose next node is a plain run (not an SDT)', () => {
    const schema = makeSchema();
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.nodes.run.create(null, schema.text('Plain'))]),
    ]);
    const paragraph = findNode(doc, 'paragraph');
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, paragraph.pos + 1) });
    const dispatch = vi.fn();

    const ok = backspaceAtIsolatingInlineSdtBoundary()({ state, dispatch });

    expect(ok).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

/**
 * Regression guard: pressing Backspace next to an isolating inline
 * structured-content (SDT) node must not destroy the SDT or the surrounding
 * table.
 *
 * Why this position is fragile: an inline `structuredContent` node is
 * `isolating`, so ProseMirror's built-in join/select commands will not merge
 * across it. If no command in the Backspace keymap handles the keypress,
 * ProseMirror lets the browser perform a native contentEditable deletion
 * instead — and inside a table cell that native edit can be read back as a
 * step that removes the SDT and introduces a stray table, corrupting the
 * document.
 *
 * These tests build a table cell whose paragraph begins with an isolating SDT,
 * place the caret at that boundary (both inside the SDT and immediately before
 * it), press Backspace, and assert the SDT and the table structure survive
 * intact — and that the caret never widens into a table-cell selection.
 */
describe('backspaceAtIsolatingInlineSdtBoundary — table-cell regression', () => {
  let cachedBlankDoc = null;

  beforeAll(async () => {
    cachedBlankDoc = await loadTestDataForEditorTests('blank-doc.docx');
  });

  const countNodes = (doc, typeName) => {
    let count = 0;
    doc.descendants((node) => {
      if (node.type.name === typeName) count += 1;
    });
    return count;
  };

  /**
   * Build doc > table > row > cell > [ para1(run "​"), para2(structuredContent(run)) ]
   * and place a collapsed caret at `caretMode`:
   *   - 'inside-sdt': inside the SDT's inner run at offset 0
   *   - 'before-sdt': at para2 offset 0, directly before the SDT
   */
  const setup = (caretMode) => {
    const { docx, media, mediaFiles, fonts } = cachedBlankDoc;
    const { editor } = initTestEditor({ content: docx, media, mediaFiles, fonts });
    const { schema } = editor;

    const para1 = schema.nodes.paragraph.create(null, [schema.nodes.run.create(null, schema.text('​'))]);
    const sdtRun = schema.nodes.run.create(null, schema.text('Vendor Contact '));
    const sdt = schema.nodes.structuredContent.create({ id: 'sdt-1', tag: 'inline_text_sdt', alias: 'A' }, sdtRun);
    const para2 = schema.nodes.paragraph.create(null, [sdt]);

    const outerTable = createTable(schema, 1, 1, false);
    const outerRow = outerTable.firstChild;
    const outerCell = outerRow.firstChild;
    const filledCell = outerCell.type.create({ ...outerCell.attrs }, [para1, para2]);
    const filledRow = outerRow.type.create(outerRow.attrs, [filledCell]);
    const table = outerTable.type.create(outerTable.attrs, [filledRow]);
    const doc = schema.nodes.doc.create(null, [table]);
    editor.setState(EditorState.create({ schema, doc, plugins: editor.state.plugins }));

    let para2Pos = null;
    editor.state.doc.descendants((node, pos) => {
      if (para2Pos !== null) return false;
      if (node.type.name === 'paragraph' && node.firstChild?.type.name === 'structuredContent') {
        para2Pos = pos;
        return false;
      }
      return true;
    });
    expect(para2Pos).not.toBeNull();

    const caretPos = caretMode === 'inside-sdt' ? para2Pos + 3 : para2Pos + 1;
    editor.setState(editor.state.apply(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, caretPos))));

    return { editor };
  };

  it('preserves the SDT and table structure when Backspacing inside the isolating SDT', () => {
    const { editor } = setup('inside-sdt');
    const before = {
      sdt: countNodes(editor.state.doc, 'structuredContent'),
      table: countNodes(editor.state.doc, 'table'),
    };

    // First press steps the caret out of the isolating SDT; a follow-up press
    // (which would otherwise trigger the native corruption) stays structural.
    handleBackspace(editor);
    handleBackspace(editor);

    expect(editor.state.selection instanceof CellSelection).toBe(false);
    expect(countNodes(editor.state.doc, 'structuredContent')).toBe(before.sdt);
    expect(countNodes(editor.state.doc, 'table')).toBe(before.table);
  });

  it('lets joinBackward own the merge when the caret is before the SDT with a joinable previous paragraph', () => {
    const { editor } = setup('before-sdt');
    const paragraphsBefore = countNodes(editor.state.doc, 'paragraph');

    // joinBackward precedes our command in the chain and handles this case, so
    // the two paragraphs merge and no structure is lost.
    handleBackspace(editor);

    expect(editor.state.selection instanceof CellSelection).toBe(false);
    expect(countNodes(editor.state.doc, 'paragraph')).toBe(paragraphsBefore - 1);
    expect(countNodes(editor.state.doc, 'structuredContent')).toBe(1);
    expect(countNodes(editor.state.doc, 'table')).toBe(1);
  });
});
