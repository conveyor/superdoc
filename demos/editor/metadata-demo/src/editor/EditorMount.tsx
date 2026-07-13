import { useMemo } from 'react';
import { SuperDocEditor, type SuperDocModules } from '@superdoc-dev/react';
import '@superdoc-dev/react/style.css';
import { useSetSuperDoc } from 'superdoc/ui/react';
import type { Collaboration } from './useLiveblocksRoom';

const CURRENT_USER = { name: 'Alex Rivera', email: 'alex@example.com' };

// Disable SuperDoc's built-in floating-comment UI. The custom Activity
// sidebar drives comments through `ui.comments` instead, so the
// platform's bubble / floating composer / right-sidebar would just
// duplicate the consumer's UI surface.
//
// Imported comments still flow through the engine: `Editor.exportDocx`
// reads from `converter.comments` when no UI-store snapshot is
// passed, and `SuperDoc.exportEditorsToDOCX` no longer overrides
// that fallback with an empty array. The round-trip is preserved
// regardless of the UI flag.
//
// `trackChanges.replacements: 'independent'` opts out of the default
// 'paired' replacement model. With 'paired', a typed-over selection
// surfaces as a single review entity (the deletion half is folded
// into the insertion). With 'independent' each half gets its own id
// — matching the Word / ECMA-376 §17.13.5 revision model and what a
// review sidebar typically wants to render as two distinct rows.
const MODULES = {
  trackChanges: { replacements: 'independent' as const },
};

// Telemetry opt-out is the default the example demonstrates. The
// SuperDoc default is `enabled: true`; consumers building their own
// privacy / consent story typically want it disabled until that path
// is wired.
const TELEMETRY = { enabled: false as const };

interface EditorMountProps {
  document?: string | File;
  /**
   * When present, routes the editor through a shared Yjs document so edits
   * (and metadata anchors) replicate to other clients in the same room. Omit
   * to run the editor standalone. See {@link useLiveblocksRoom}.
   */
  collaboration?: Collaboration;
}

/**
 * Mounts `<SuperDocEditor>` and hands the running SuperDoc instance to
 * the {@link SuperDocUIProvider} once `onReady` fires. Everything
 * else in the demo (toolbar, sidebars, custom command registration)
 * binds to the controller from context — `useSuperDocUI()` returns
 * null until this component completes its first onReady callback.
 *
 * `contained` + `hideToolbar` let the wrapper sit inside a real
 * three-pane app layout instead of taking over the page. `style={{
 * height: '100%' }}` is part of that posture.
 */
export function EditorMount({ document: documentSource = '/sample-review.docx', collaboration }: EditorMountProps) {
  const setSuperDoc = useSetSuperDoc();

  // `<SuperDocEditor>` rebuilds when the `modules` reference changes, so fold
  // collaboration in once and keep it stable. SuperDoc reads
  // `modules.collaboration = { ydoc, provider }`. The cast bridges a narrower
  // awareness generic in SuperDoc's provider type vs `LiveblocksYjsProvider`.
  const modules = useMemo<SuperDocModules>(() => {
    if (!collaboration) return MODULES;
    return { ...MODULES, collaboration } as SuperDocModules;
  }, [collaboration]);

  // In collaboration mode SuperDoc treats the Yjs doc as the source of truth and,
  // unless the document is flagged `isNewFile`, assumes the room was seeded
  // elsewhere (e.g. a backend) — so it drops the `.docx` and renders the empty
  // room blank. This demo has no backend, so it flags `isNewFile: true` to seed
  // the room from the file. It's safe to always set: SuperDoc only seeds an empty
  // room (`isNewFile && !ydocHasContent`), so later joiners inherit instead.
  const documentConfig = useMemo(() => {
    if (!collaboration) {
      return documentSource;
    }
    if (typeof documentSource === 'string') {
      return { url: documentSource, type: 'docx', isNewFile: true };
    }
    return { data: documentSource, type: 'docx', name: documentSource.name, isNewFile: true };
  }, [documentSource, collaboration]);

  return (
    <SuperDocEditor
      document={documentConfig}
      documentMode="editing"
      user={CURRENT_USER}
      modules={modules}
      telemetry={TELEMETRY}
      hideToolbar
      contained
      // Suppress the editor's built-in right-click menu; the demo
      // renders its own via `ContextMenu`, which opens against the
      // bundle from `ui.viewport.contextAt(...)` and dispatches via
      // `item.invoke()`.
      disableContextMenu
      style={{ height: '100%' }}
      onReady={({ superdoc }: { superdoc: unknown }) => {
        setSuperDoc(superdoc);
      }}
    />
  );
}
