import type { Node as ProseMirrorNode } from 'prosemirror-model';
import type { Editor } from '../../core/Editor.js';
import { buildInlineIndex, type InlineIndex } from './inline-address-resolver.js';
import { buildBlockIndex, type BlockIndex } from './node-address-resolver.js';
import { findAllSdtNodes, type ResolvedSdt } from './content-controls/target-resolution.js';

/**
 * Cached lookup structures for all SDT (content-control) nodes in one document
 * snapshot. Built once per snapshot from a single `doc.descendants()` walk and
 * reused by every per-keystroke caller (list, findAnchorsById, resolve-by-id).
 *
 * - `all`   — every SDT in document order (same shape/order `findAllSdtNodes`
 *             returns, so callers that walked the whole doc can swap to this
 *             with identical results).
 * - `byTag` — SDTs grouped by their `attrs.tag`. Stores ALL matches per tag as
 *             an array (never deduped), so callers that must detect duplicate
 *             ids/tags keep exact multiplicity.
 */
export type SdtIndex = {
  all: ResolvedSdt[];
  byTag: Map<string, ResolvedSdt[]>;
};

type CacheEntry = {
  doc: ProseMirrorNode;
  blockIndex: BlockIndex;
  inlineIndex: InlineIndex | null;
  sdtIndex: SdtIndex | null;
};

const cacheByEditor = new WeakMap<Editor, CacheEntry>();

function createCacheEntry(editor: Editor): CacheEntry {
  return {
    doc: editor.state.doc,
    blockIndex: buildBlockIndex(editor),
    inlineIndex: null,
    sdtIndex: null,
  };
}

/**
 * Build the SDT index from a single full-document walk.
 *
 * We reuse `findAllSdtNodes` for the walk so the `all` list is byte-for-byte
 * what the old callers produced, then bucket the same entries by `attrs.tag`.
 * Example: two inline anchors both tagged "abc" produce
 * `byTag.get("abc") === [sdtA, sdtB]` in document order.
 */
function buildSdtIndex(doc: ProseMirrorNode): SdtIndex {
  const all = findAllSdtNodes(doc);

  const byTag = new Map<string, ResolvedSdt[]>();
  for (const sdt of all) {
    const tag = sdt.node.attrs?.tag;
    if (typeof tag !== 'string') continue;

    const bucket = byTag.get(tag);
    if (bucket) {
      bucket.push(sdt);
    } else {
      byTag.set(tag, [sdt]);
    }
  }

  return { all, byTag };
}

function getCacheEntry(editor: Editor): CacheEntry {
  const doc = editor.state.doc;
  const existing = cacheByEditor.get(editor);
  if (existing && existing.doc === doc) return existing;

  const next = createCacheEntry(editor);
  cacheByEditor.set(editor, next);
  return next;
}

/**
 * Returns the cached block index for the editor's current document.
 * Rebuilds automatically when the document snapshot changes.
 *
 * @param editor - The editor instance.
 * @returns The block-level positional index.
 */
export function getBlockIndex(editor: Editor): BlockIndex {
  return getCacheEntry(editor).blockIndex;
}

/**
 * Returns the cached inline index for the editor's current document.
 * Lazily built on first access; rebuilt when the document snapshot changes.
 *
 * @param editor - The editor instance.
 * @returns The inline-level positional index.
 */
export function getInlineIndex(editor: Editor): InlineIndex {
  const entry = getCacheEntry(editor);
  if (!entry.inlineIndex) {
    entry.inlineIndex = buildInlineIndex(editor, entry.blockIndex);
  }
  return entry.inlineIndex;
}

/**
 * Returns the cached SDT index for the editor's current document.
 * Lazily built on first access; rebuilt when the document snapshot changes.
 *
 * Replaces the per-call `findAllSdtNodes(editor.state.doc)` full-document walk
 * on the typing hot path (content-controls list, metadata anchor lookups,
 * resolve-by-id). Results are identical to that walk — this is purely a cache.
 *
 * @param editor - The editor instance.
 * @returns The SDT index (`all` + `byTag`).
 */
export function getSdtIndex(editor: Editor): SdtIndex {
  const entry = getCacheEntry(editor);
  if (!entry.sdtIndex) {
    entry.sdtIndex = buildSdtIndex(editor.state.doc);
  }
  return entry.sdtIndex;
}

/**
 * Removes cached indexes for the given editor instance.
 *
 * @param editor - The editor whose cache entry should be cleared.
 */
export function clearIndexCache(editor: Editor): void {
  cacheByEditor.delete(editor);
}
