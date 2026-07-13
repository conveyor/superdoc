import { useEffect, useState } from 'react';
import { createClient } from '@liveblocks/client';
import { LiveblocksYjsProvider } from '@liveblocks/yjs';
import * as Y from 'yjs';

/**
 * The Yjs pair SuperDoc's collaboration module expects. Passing this as
 * `modules.collaboration = { ydoc, provider }` tells SuperDoc to route the
 * document through the shared Yjs doc instead of keeping edits local, so any
 * change that lives in ProseMirror state (including metadata anchors) syncs to
 * every other client in the same room. See docs.superdoc.dev — Liveblocks.
 */
export type Collaboration = {
  ydoc: Y.Doc;
  provider: LiveblocksYjsProvider;
};

export type LiveblocksRoomState =
  /** No `VITE_LIVEBLOCKS_PUBLIC_KEY` set — run the editor standalone. */
  | { status: 'disabled' }
  /** Key present; still opening the room / waiting for the first sync. */
  | { status: 'connecting' }
  /** Room synced — hand `collaboration` to SuperDoc and mount the editor. */
  | { status: 'ready'; collaboration: Collaboration };

/**
 * Internal state also remembers which room the pair belongs to. When the caller
 * switches rooms, the state briefly still points at the previous room (the
 * effect that rebuilds it runs after render), so we tag it and reconcile below.
 */
type InternalState =
  | { status: 'disabled' }
  | { status: 'connecting'; roomId: string }
  | { status: 'ready'; roomId: string; collaboration: Collaboration };

/**
 * Opens a Liveblocks room and builds the Yjs document + provider SuperDoc needs
 * for real-time collaboration, following the official Liveblocks guide.
 *
 * We hold the editor back until the provider fires its first `sync` event. On a
 * fresh room the Yjs doc is empty, so mounting SuperDoc before sync would let it
 * seed the doc from the local `.docx` — and two tabs each seeding their own copy
 * would collide. Waiting for sync means the first tab seeds, the rest inherit.
 *
 * Example:
 *   const room = useLiveblocksRoom('metadata-demo-room');
 *   if (room.status === 'ready') {
 *     <EditorMount collaboration={room.collaboration} />
 *   }
 */
export function useLiveblocksRoom(roomId: string): LiveblocksRoomState {
  const publicApiKey = import.meta.env.VITE_LIVEBLOCKS_PUBLIC_KEY;

  const [state, setState] = useState<InternalState>(() =>
    publicApiKey ? { status: 'connecting', roomId } : { status: 'disabled' },
  );

  useEffect(() => {
    // Without a key there's nothing to connect to — stay standalone.
    if (!publicApiKey) {
      setState({ status: 'disabled' });
      return;
    }

    setState({ status: 'connecting', roomId });

    const client = createClient({ publicApiKey });
    const { room, leave } = client.enterRoom(roomId);

    const ydoc = new Y.Doc();
    const provider = new LiveblocksYjsProvider(room, ydoc);

    // `sync` fires with `true` once this client has the room's current state.
    const handleSync = (isSynced: boolean) => {
      if (!isSynced) return;
      setState({ status: 'ready', roomId, collaboration: { ydoc, provider } });
    };
    provider.on('sync', handleSync);

    return () => {
      provider.off('sync', handleSync);
      provider.destroy();
      ydoc.destroy();
      leave();
    };
  }, [publicApiKey, roomId]);

  // Reconcile during render: only report 'ready' when the synced pair actually
  // belongs to the room being requested. Right after `roomId` changes (e.g. an
  // Import that spins up a new room), `state` still holds the previous room's
  // pair — which the effect is about to tear down. Reporting 'connecting' here
  // keeps that stale/soon-to-be-destroyed ydoc from ever reaching the editor.
  if (!publicApiKey) {
    return { status: 'disabled' };
  }
  if (state.status === 'ready' && state.roomId === roomId) {
    return { status: 'ready', collaboration: state.collaboration };
  }
  return { status: 'connecting' };
}
