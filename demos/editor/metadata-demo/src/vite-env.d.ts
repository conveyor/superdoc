/// <reference types="vite/client" />

// Typed env vars this demo reads. `VITE_`-prefixed vars are the only ones
// Vite exposes to client code (see https://vite.dev/guide/env-and-mode).
interface ImportMetaEnv {
  /**
   * Liveblocks public API key (starts with `pk_`). When set, the demo runs
   * the editor through a shared Yjs document so you can watch edits — and
   * metadata anchors — replicate across tabs. Leave it unset to run the
   * editor standalone with no collaboration.
   */
  readonly VITE_LIVEBLOCKS_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
