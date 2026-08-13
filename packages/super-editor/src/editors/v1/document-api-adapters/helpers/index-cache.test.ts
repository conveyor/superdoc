import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { Editor } from '../../core/Editor.js';
import { getBlockIndex, getInlineIndex, getSdtIndex } from './index-cache.js';

function createTextNode(text: string): ProseMirrorNode {
  return {
    type: { name: 'text' },
    attrs: {},
    marks: [],
    text,
    nodeSize: text.length,
    content: { size: 0 },
    isText: true,
    isInline: true,
    isBlock: false,
    isLeaf: true,
    childCount: 0,
    child() {
      throw new Error('Text nodes do not have children.');
    },
    forEach() {
      // Text nodes do not expose children.
    },
  } as unknown as ProseMirrorNode;
}

function createParagraphNode(nodeId: string, text = 'Hello'): ProseMirrorNode {
  const textNode = createTextNode(text);
  return {
    type: { name: 'paragraph' },
    attrs: { sdBlockId: nodeId },
    marks: [],
    nodeSize: textNode.nodeSize + 2,
    content: { size: textNode.nodeSize },
    isText: false,
    isInline: false,
    isBlock: true,
    inlineContent: true,
    isTextblock: true,
    isLeaf: false,
    childCount: 1,
    child(index: number) {
      if (index !== 0) throw new Error('Paragraph has only one child.');
      return textNode;
    },
    forEach(callback: (node: ProseMirrorNode, offset: number) => void) {
      callback(textNode, 0);
    },
  } as unknown as ProseMirrorNode;
}

/**
 * Minimal inline SDT (content-control) node stub. Only the fields the SDT
 * index reads are populated: `type.name` (to classify block vs inline) and
 * `attrs` (to bucket by `tag`).
 */
function createInlineSdtNode(id: string, tag: string | undefined): ProseMirrorNode {
  return {
    type: { name: 'structuredContent' },
    attrs: { id, tag },
    marks: [],
    nodeSize: 2,
    content: { size: 0 },
    isText: false,
    isInline: true,
    isBlock: false,
    isLeaf: false,
    childCount: 0,
    forEach() {
      // No inner content needed for these tests.
    },
  } as unknown as ProseMirrorNode;
}

/** A doc whose `descendants` walk yields the given SDT nodes in order at pos 0,1,2,... */
function createDocWithSdts(sdtNodes: ProseMirrorNode[]): ProseMirrorNode {
  return {
    type: { name: 'doc' },
    attrs: {},
    marks: [],
    nodeSize: sdtNodes.length + 2,
    content: { size: sdtNodes.length },
    isBlock: false,
    isLeaf: false,
    childCount: sdtNodes.length,
    descendants(callback: (node: ProseMirrorNode, pos: number) => void) {
      sdtNodes.forEach((node, index) => callback(node, index));
    },
  } as unknown as ProseMirrorNode;
}

function createDocNode(paragraph: ProseMirrorNode): ProseMirrorNode {
  return {
    type: { name: 'doc' },
    attrs: {},
    marks: [],
    nodeSize: paragraph.nodeSize + 2,
    content: { size: paragraph.nodeSize },
    isText: false,
    isInline: false,
    isBlock: false,
    isLeaf: false,
    childCount: 1,
    child(index: number) {
      if (index !== 0) throw new Error('Doc has only one child.');
      return paragraph;
    },
    forEach(callback: (node: ProseMirrorNode, offset: number) => void) {
      callback(paragraph, 0);
    },
    descendants(callback: (node: ProseMirrorNode, pos: number) => void) {
      callback(paragraph, 0);
    },
  } as unknown as ProseMirrorNode;
}

function makeEditor(doc: ProseMirrorNode): Editor {
  return {
    state: {
      doc,
    },
  } as unknown as Editor;
}

describe('index-cache', () => {
  it('reuses block index for the same document snapshot', () => {
    const editor = makeEditor(createDocNode(createParagraphNode('p1')));

    const first = getBlockIndex(editor);
    const second = getBlockIndex(editor);

    expect(second).toBe(first);
  });

  it('lazily builds and reuses inline index for the same document snapshot', () => {
    const editor = makeEditor(createDocNode(createParagraphNode('p1')));

    const block = getBlockIndex(editor);
    const firstInline = getInlineIndex(editor);
    const secondInline = getInlineIndex(editor);

    expect(secondInline).toBe(firstInline);
    expect(getBlockIndex(editor)).toBe(block);
  });

  it('invalidates block and inline indexes when the document snapshot changes', () => {
    const firstDoc = createDocNode(createParagraphNode('p1'));
    const secondDoc = createDocNode(createParagraphNode('p2'));
    const editor = makeEditor(firstDoc) as Editor & { state: { doc: ProseMirrorNode } };

    const firstBlock = getBlockIndex(editor);
    const firstInline = getInlineIndex(editor);

    editor.state.doc = secondDoc;

    const secondBlock = getBlockIndex(editor);
    const secondInline = getInlineIndex(editor);

    expect(secondBlock).not.toBe(firstBlock);
    expect(secondInline).not.toBe(firstInline);
  });

  it('builds an SDT index with all nodes in document order and grouped by tag', () => {
    // Two anchors share tag "dup" — byTag must keep BOTH (no dedupe) so callers
    // can detect duplicates. One SDT has no tag and must not appear in byTag.
    const editor = makeEditor(
      createDocWithSdts([
        createInlineSdtNode('1', 'alpha'),
        createInlineSdtNode('2', 'dup'),
        createInlineSdtNode('3', 'dup'),
        createInlineSdtNode('4', undefined),
      ]),
    );

    const index = getSdtIndex(editor);

    expect(index.all.map((sdt) => sdt.node.attrs.id)).toEqual(['1', '2', '3', '4']);
    expect(index.byTag.get('alpha')?.map((sdt) => sdt.node.attrs.id)).toEqual(['1']);
    expect(index.byTag.get('dup')?.map((sdt) => sdt.node.attrs.id)).toEqual(['2', '3']);
    expect(index.byTag.has('4')).toBe(false);
  });

  it('lazily builds and reuses the SDT index for the same document snapshot', () => {
    const editor = makeEditor(createDocWithSdts([createInlineSdtNode('1', 'alpha')]));

    const first = getSdtIndex(editor);
    const second = getSdtIndex(editor);

    expect(second).toBe(first);
  });

  it('rebuilds the SDT index when the document snapshot changes', () => {
    const firstDoc = createDocWithSdts([createInlineSdtNode('1', 'alpha')]);
    const secondDoc = createDocWithSdts([createInlineSdtNode('2', 'beta')]);
    const editor = makeEditor(firstDoc) as Editor & { state: { doc: ProseMirrorNode } };

    const first = getSdtIndex(editor);
    editor.state.doc = secondDoc;
    const second = getSdtIndex(editor);

    expect(second).not.toBe(first);
    expect(second.all.map((sdt) => sdt.node.attrs.tag)).toEqual(['beta']);
  });
});
