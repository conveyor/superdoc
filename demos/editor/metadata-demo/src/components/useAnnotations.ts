import { useCallback, useEffect, useState } from 'react';
import { useSuperDocContentControls, useSuperDocHost } from 'superdoc/ui/react';
import type { SelectionTarget, TextSegment } from './citations-types';

/** Namespace for annotation metadata entries. */
export const ANNOTATIONS_NAMESPACE = 'urn:demo:annotations:1';

/** Payload stored with each annotation. */
export type AnnotationPayload = {
  annotationId: string;
  createdAt: string;
  /**
   * 0-based order of this fragment within its annotation. Only set for
   * cross-block annotations (see `attachAcrossBlocks`), where one logical
   * annotation is stored as several single-block fragments sharing an
   * `annotationId`.
   */
  segmentIndex?: number;
};

/** Full annotation info including metadata wrapper fields. */
export type AnnotationInfo = {
  id: string;
  namespace: string;
  partName: string;
  payload: AnnotationPayload;
};

/** Minimal shape of the metadata API we need. */
type MetadataDocApi = {
  list(opts: { namespace?: string }): { items: Array<{ id: string }> };
  get(opts: { id: string }): { id: string; namespace: string; partName: string; payload: unknown } | null;
  attach(opts: {
    target: SelectionTarget;
    namespace: string;
    payload: AnnotationPayload;
    id?: string;
  }): { success: true; id: string } | { success: false; failure: { message: string } };
  remove(opts: { id: string }): { success: true } | { success: false; failure: { message: string } };
  resolve(opts: { id: string }): { target: SelectionTarget } | null;
};

function isAnnotationPayload(payload: unknown): payload is AnnotationPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return typeof p.annotationId === 'string' && typeof p.createdAt === 'string';
}

/**
 * Reach into `editor.doc.metadata` even though the published type stub
 * doesn't expose it yet.
 */
function readMetadataApi(host: ReturnType<typeof useSuperDocHost>): MetadataDocApi | null {
  if (!host) return null;
  const editor = (host as unknown as { activeEditor?: { doc?: { metadata?: MetadataDocApi } } }).activeEditor;
  return editor?.doc?.metadata ?? null;
}

/** Hydrate a list of annotation entries by fetching their payloads. */
function hydrate(api: MetadataDocApi): AnnotationInfo[] {
  const result = api.list({ namespace: ANNOTATIONS_NAMESPACE });
  const out: AnnotationInfo[] = [];
  for (const summary of result.items) {
    const info = api.get({ id: summary.id });
    if (!info || !isAnnotationPayload(info.payload)) continue;
    out.push({ id: info.id, namespace: info.namespace, partName: info.partName, payload: info.payload });
  }
  return out;
}

export type UseAnnotationsResult = {
  /** Current list of annotations. */
  annotations: AnnotationInfo[];
  /** True until SuperDoc is ready. */
  loading: boolean;
  /** Attach an annotation to the current selection. Returns the new ID or an error. */
  attach(target: SelectionTarget): { id: string } | { error: string };
  /**
   * Attach ONE logical annotation across MULTIPLE blocks. `metadata.attach`
   * is single-block in v1, so we fan out: one anchor per block-segment, all
   * sharing the same `annotationId` in their payload. Group by that id on read
   * to treat the fragments as a single annotation. Returns the shared id and
   * how many fragments were attached, or an error.
   */
  attachAcrossBlocks(segments: TextSegment[]): { annotationId: string; count: number } | { error: string };
  /** Remove an annotation by ID. */
  remove(id: string): { error?: string };
  /** Resolve an annotation ID to its current SelectionTarget. */
  resolve(id: string): SelectionTarget | null;
  /** Force a refresh. */
  refresh(): void;
};

/**
 * Hook for managing annotation metadata. Wraps `editor.doc.metadata.*`
 * and re-lists whenever the content-controls slice changes.
 */
export function useAnnotations(): UseAnnotationsResult {
  const host = useSuperDocHost();
  const cc = useSuperDocContentControls();
  const [annotations, setAnnotations] = useState<AnnotationInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    const api = readMetadataApi(host);
    if (!api) return;
    setAnnotations(hydrate(api));
    setLoading(false);
  }, [host]);

  useEffect(() => {
    refresh();
  }, [refresh, cc.items, cc.activeId]);

  const attach = useCallback(
    (target: SelectionTarget): { id: string } | { error: string } => {
      const api = readMetadataApi(host);
      if (!api) return { error: 'Editor not ready.' };

      const annotationId = `ann-${Math.random().toString(36).slice(2, 10)}`;
      const payload: AnnotationPayload = {
        annotationId,
        createdAt: new Date().toISOString(),
      };

      const result = api.attach({
        target,
        namespace: ANNOTATIONS_NAMESPACE,
        payload,
        id: `annotation-${Date.now()}`,
      });

      if (!result.success) {
        return { error: (result as { success: false; failure: { message: string } }).failure.message };
      }
      refresh();
      return { id: result.id };
    },
    [host, refresh],
  );

  const attachAcrossBlocks = useCallback(
    (segments: TextSegment[]): { annotationId: string; count: number } | { error: string } => {
      const api = readMetadataApi(host);
      if (!api) return { error: 'Editor not ready.' };

      // One shared id ties the per-block fragments into a single logical
      // annotation. Each fragment is its own single-block metadata entry.
      const annotationId = `ann-${Math.random().toString(36).slice(2, 10)}`;
      const createdAt = new Date().toISOString();

      let count = 0;
      let firstError: string | null = null;
      segments.forEach((segment, segmentIndex) => {
        // Skip empty segments — metadata.attach rejects empty ranges.
        if (segment.range.end <= segment.range.start) return;

        const target: SelectionTarget = {
          kind: 'selection',
          start: { kind: 'text', blockId: segment.blockId, offset: segment.range.start },
          end: { kind: 'text', blockId: segment.blockId, offset: segment.range.end },
        };
        const payload: AnnotationPayload = { annotationId, createdAt, segmentIndex };
        const result = api.attach({
          target,
          namespace: ANNOTATIONS_NAMESPACE,
          payload,
          id: `annotation-${Date.now()}-${segmentIndex}`,
        });
        if (result.success) count += 1;
        else if (!firstError) firstError = result.failure.message;
      });

      if (count === 0) return { error: firstError ?? 'Nothing to annotate.' };
      refresh();
      return { annotationId, count };
    },
    [host, refresh],
  );

  const remove = useCallback(
    (id: string) => {
      const api = readMetadataApi(host);
      if (!api) return { error: 'Editor not ready.' };
      const result = api.remove({ id });
      if (!result.success) {
        return { error: (result as { success: false; failure: { message: string } }).failure.message };
      }
      refresh();
      return {};
    },
    [host, refresh],
  );

  const resolve = useCallback(
    (id: string): SelectionTarget | null => {
      const api = readMetadataApi(host);
      if (!api) return null;
      return api.resolve({ id })?.target ?? null;
    },
    [host],
  );

  return { annotations, loading, attach, attachAcrossBlocks, remove, resolve, refresh };
}
