import { useState, useRef, useCallback } from 'react';
import { SuperDocUIProvider, useSuperDocHost } from 'superdoc/ui/react';
import { EditorMount } from './editor/EditorMount';
import { useLiveblocksRoom } from './editor/useLiveblocksRoom';
import { Toolbar, MetadataButton, CrossBlockMetadataButton, HighlightToggle } from './components/Toolbar';
import { MetadataPanel } from './components/MetadataPanel';
import { MetadataHighlights } from './components/MetadataHighlights';

// The room id lives in the URL (`?room=<id>`) so every tab on the same URL
// shares one Yjs document. No `?room=` param lands on this default room.
const DEFAULT_ROOM_ID = 'metadata-demo-room';

/** Read the room id from `?room=` on load, falling back to the default. */
function getInitialRoomId(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('room') ?? DEFAULT_ROOM_ID;
}

/** Reflect the active room id into the URL without a page reload. */
function writeRoomIdToUrl(roomId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  window.history.replaceState(null, '', url);
}

export function App() {
  return (
    <SuperDocUIProvider>
      <AppInner />
    </SuperDocUIProvider>
  );
}

function AppInner() {
  const [highlightEnabled, setHighlightEnabled] = useState(false);
  const [documentSource, setDocumentSource] = useState<string | File>('/sample-review.docx');
  const [editorKey, setEditorKey] = useState(0);
  const [roomId, setRoomId] = useState<string>(getInitialRoomId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const host = useSuperDocHost();
  const room = useLiveblocksRoom(roomId);

  // True whenever a Liveblocks key is configured (connecting or ready).
  const collaborationEnabled = room.status !== 'disabled';

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        setDocumentSource(file);

        if (collaborationEnabled) {
          // A room only seeds from `document` while its Yjs doc is empty, so the
          // imported file needs a fresh room. The URL updates to it; open that
          // URL in another tab to collaborate on the imported file.
          const freshRoomId = `metadata-demo-${crypto.randomUUID().slice(0, 8)}`;
          writeRoomIdToUrl(freshRoomId);
          setRoomId(freshRoomId);
        } else {
          setEditorKey((k) => k + 1); // force remount to load the new file
        }
      }
      // Reset input so the same file can be re-selected
      e.target.value = '';
    },
    [collaborationEnabled],
  );

  const handleExport = useCallback(async () => {
    const superdoc = host as { activeEditor?: { exportDocx?: () => Promise<ArrayBuffer> } } | null;
    if (!superdoc?.activeEditor?.exportDocx) {
      alert('Editor not ready');
      return;
    }
    try {
      const buffer = await superdoc.activeEditor.exportDocx();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `metadata-demo-${Date.now()}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed. See console for details.');
    }
  }, [host]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Metadata Demo</h1>
        <span className="subtitle">Invisible ranges with metadata</span>
        <div className="header-actions">
          <button
            className="header-btn"
            onClick={handleImport}
            title={
              collaborationEnabled
                ? 'Import a .docx into a new collaboration room'
                : 'Import a .docx'
            }
          >
            <UploadIcon /> Import
          </button>
          <button className="header-btn" onClick={handleExport}>
            <DownloadIcon /> Export
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </div>
      </header>

      <div className="app-body">
        <section className="editor-area">
          <div className="toolbar-shell">
            <Toolbar />
          </div>
          <div className="editor-shell">
            <div className="editor-canvas">
              {/* Hold the editor back until the room has synced, so the shared
                  Yjs doc (not a per-tab copy) drives the initial content. The
                  key remounts on room change (Import) or standalone file load. */}
              {room.status === 'connecting' ? (
                <div className="editor-connecting">Connecting to collaboration room…</div>
              ) : (
                <EditorMount
                  key={`${roomId}-${editorKey}`}
                  document={documentSource}
                  collaboration={room.status === 'ready' ? room.collaboration : undefined}
                />
              )}
            </div>
          </div>
          {highlightEnabled && <MetadataHighlights />}
        </section>

        <aside className="sidebar">
          <div className="sidebar-toolbar">
            <MetadataButton />
            <CrossBlockMetadataButton />
            <HighlightToggle
              enabled={highlightEnabled}
              onToggle={() => setHighlightEnabled((v) => !v)}
            />
          </div>
          <div className="sidebar-header">Metadata Ranges</div>
          <div className="sidebar-panel">
            <MetadataPanel />
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---- Icons ----

const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function UploadIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
