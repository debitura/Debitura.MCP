# devtools

Isolated `node_modules` for `eslint`/`typescript-eslint` and `openapi-typescript`, pinned to `typescript@5.9.3`.

Why this exists: the root project runs on `typescript@7.0.2`, but `typescript-eslint` (peer range `<6.1.0`) and
`openapi-typescript` (peer range `^5.x`) both crash at runtime against TS7 — it rewrote the compiler in Go and
removed/restructured public API surface (`ts.factory`, program-creation internals) these tools reach into directly.
Neither has shipped a TS7-compatible release yet (see DEB-5306).

A single `typescript@5.9.3` install here satisfies both tools' peer ranges at once, so this is one shared
toolchain, not two. `npm overrides` can't achieve this same isolation in a single install — it can only rewrite
a peer's _declared_ requirement, not manufacture a separate physical install to satisfy it — so this had to be a
real separate `package.json`/`node_modules`.

Root `npm run lint` / `npm run generate:types` shell out to this directory's binaries against the root source
tree. Run `npm install` in here whenever `devtools/package.json` changes; it has its own lockfile.

Revert to a single root toolchain once `typescript-eslint` and `openapi-typescript` both support TS7 — bump
`typescript` here to match root, delete `devtools/`, move `eslint.config.js` back to root, and restore the
original `lint`/`generate:types` scripts.
