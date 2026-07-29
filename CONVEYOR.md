# Conveyor fork of SuperDoc

This is Conveyor's fork of [SuperDoc](https://github.com/superdoc-dev/superdoc). It
carries a small set of bug-fix patches on top of upstream. We distribute the fork to our own apps by publishing it to npm as
**`@conveyorhq/superdoc`**.

> This file (and everything under `scripts/conveyor/`, plus
> `.github/workflows/release-conveyor.yml`) is **fork infrastructure**. It lives on
> the fork so every dev has it, but it must never appear in an upstream PR. Cut
> upstream PRs as focused branches off **upstream main**, containing only the one
> fix — never push the whole fork branch upstream.

## Versioning scheme

Fork builds are versioned `<upstream-base>-conveyor.N`:

- `<upstream-base>` is whatever version `packages/superdoc/package.json` 
- `N` increments per fork build for that base. The publish script picks the next
  `N` automatically by checking what's already on npm.
- When upstream bumps the base (e.g. `1.46.0`), `N` resets to `1`.

This never collides with real upstream releases, and the suffix makes it obvious a
build came from our fork.

## Publishing

Publishing is always manually triggered. There is one engine —
`scripts/conveyor/publish-fork.sh` — invoked either from CI (the normal path) or
from your laptop (for the first-ever publish and as a fallback). The script:

1. Works out the fork version (`<base>-conveyor.N`, auto-incremented).
2. Temporarily renames the package to `@conveyorhq/superdoc` and sets the version.
3. Builds and packs from the current branch.
4. Publishes the tarball with `--access public`.
5. Restores `package.json` on exit — the rename is never committed.

### From CI (normal path)

`.github/workflows/release-conveyor.yml` runs that script on a GitHub runner and
authenticates via **npm trusted publishing (OIDC)** — no stored token, so whoever
cuts the release needs only repo access, not an npm account.

Actions tab → "Publish Conveyor fork" → **Run workflow** → pick the branch to ship
(usually `akhoo/patches`). Leave the version blank to auto-increment, or type an
exact one.

Requires two one-time setup steps:

- The workflow must exist on the repo's **default branch** (`main`), or the "Run
  workflow" button never appears — even though it publishes from whichever branch
  you pick.
- A _trusted publisher_ for `@conveyorhq/superdoc` configured on npmjs.com,
  pointing at this repo + `release-conveyor.yml`.

### From your laptop (bootstrap / fallback)

```bash
pnpm publish:conveyor              # auto-pick next -conveyor.N, prompts before publishing
pnpm publish:conveyor --dry-run    # build + pack only; publishes nothing (safe test)
pnpm publish:conveyor 1.45.0-conveyor.7   # publish an explicit version
```

Needs your own `npm login` + `@conveyorhq` publish access. Use it for:

- **The first-ever publish.** OIDC trusted publishing can only attach to a package
  that already exists, so the initial `@conveyorhq/superdoc` publish must be done
  this way to create it — then configure the trusted publisher and switch to CI.
- **A fallback** when CI/OIDC is unavailable.

It prints the exact consumer line to paste after publishing.

## Consuming the fork

In a consumer rep, point `superdoc` at
the published fork via an npm alias so imports stay `from 'superdoc'`:

Example:
```jsonc
// package.json
"superdoc": "npm:@conveyorhq/superdoc@1.45.0-conveyor.1"
```

Then reinstall to update the lockfile (`pnpm install` / `npm install` per repo).
Both the `superdoc` entry and subpath imports like `superdoc/super-editor` resolve
through the alias — no source changes needed.