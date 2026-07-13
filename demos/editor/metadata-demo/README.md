# Metadata Demo

A SuperDoc editor demo for applying invisible **metadata ranges** to a document —
including cross-block anchors (one logical annotation fanned out across several
blocks, sharing a single id).

## Run it

From this directory:

```bash
pnpm install   # first time only (run from the repo root or here)
pnpm dev
```

Then open the printed URL. The demo loads `public/sample-review.docx`; use the
**Import** button to load your own `.docx`.

## Collaboration (optional)

The editor can run through a shared [Liveblocks](https://liveblocks.io) Yjs
document so edits — and metadata anchors — replicate across clients. This is also
how you verify whether metadata persists into Yjs.

1. Grab a public API key from the Liveblocks dashboard (your project → API keys).
   Make sure **Yjs** is enabled for the project.
2. Create `.env.local` in this directory:

   ```
   VITE_LIVEBLOCKS_PUBLIC_KEY=pk_your_public_key
   ```

3. `pnpm dev`, then open the URL in **two tabs**. Apply metadata in one tab; if it
   shows up in the other, it synced through Yjs.

Without `VITE_LIVEBLOCKS_PUBLIC_KEY` set, the editor runs standalone with no
collaboration.

### Rooms and testing your own file

The room id lives in the URL (`?room=<id>`); every tab on the same URL shares one
Yjs document. A room seeds its content from the `document` only while its Yjs doc
is still empty; after that, joiners inherit whatever is in the room. So to test
collaboration on your **own** file:

1. Click **Import** and pick a `.docx`. This spins up a fresh room seeded from your
   file and updates the URL to `?room=<new-id>`.
2. Copy that URL into another tab. The second tab inherits your uploaded file over
   Yjs — only the importing tab needs the file.
3. Apply metadata in either tab and watch it replicate.
