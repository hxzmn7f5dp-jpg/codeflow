# CodeFlow — guide for AI assistants

CodeFlow is a **single-file, zero-build browser SPA** that turns a GitHub repository, a
pull request, or a folder of local files into an interactive architecture map: a D3
dependency graph plus blast-radius, code-ownership, security-scan, pattern-detection,
health-score, and churn-heatmap views. It also reads Obsidian/markdown vaults, treating
`[[wiki-links]]` and `[text](./rel.md)` links as graph edges. Everything runs client-side;
code never leaves the browser, and GitHub API calls go straight from the browser to GitHub.

The whole application is **`index.html`** (~5,100 lines). There is no bundler, no
`node_modules`, no framework scaffolding. React 18, ReactDOM, Babel-standalone (JSX is
transpiled in the browser), D3 7 + d3-sankey, Acorn, web-tree-sitter, and jsrsasign are all
loaded from CDNs via `<script>` tags (`index.html:19-26`). The app code lives in a single
`<script type="text/babel">` block (`index.html:437-5092`).

## Layout

- `index.html` — the entire app. Key regions: the `Parser` object (`index.html:544`) holding
  extension tables (`codeExts`/`textExts`/`binExts`) and the language/link/AST extraction
  helpers; the top-level `calcBlast` function (`index.html:2213`); and the `App` React
  component (`index.html:2466`) with the GitHub scan path (`processFile`) and the Local Files
  scan path — two near-identical orchestrators that must be kept in step.
- `tests/` — Node's built-in `node --test` suite (`.test.mjs`), zero dependencies.
- `tests/fixtures/vault/` — small markdown fixtures for the wiki-link parser.
- `docs/2026-04-19-md-wikilink-parser-design.md` — design note for the markdown/wiki-link
  graph feature; good background on how edges are built.
- `README.md` — user-facing feature/usage docs. `screenshot.png`, `codeflow-social.png` — assets.

## Run, build, test

There is **no dev server and no build step** — open `index.html` in a browser (`open index.html`
or a `file://` URL) and the app runs. `package.json` defines exactly one script:

```bash
npm test          # node --test "tests/**/*.test.mjs"
```

Requires a Node with the built-in test runner (Node 18+). The suite is **30 tests across the
files below** and currently passes clean. There is no lint or format script and no TypeScript.
CI (`.github/workflows/ci.yml`) runs `npm test` on Node 22 for every push to `main` and every
PR — checkout → setup-node → `npm test`, no install since the suite is dependency-free.

`tests/verify-brain-vault.mjs` is an optional, manual end-to-end script (not part of `npm test`):
it runs the extractor against a real markdown vault via `BRAIN_VAULT=/path/to/vault`.

## The duplication invariant (read before editing core logic)

Because the app is a single static HTML file, the core pure functions exist **twice**: once
inside `index.html` and once as an ES-module reference under `tests/`. **If you edit one copy,
edit the other** — the headers in those files say so, and `sync-*` tests enforce it:

- `Parser.extractMarkdownLinks` / `Parser.resolveMarkdownLink` (`index.html:585`, `:607`)
  mirror `tests/md-extractors.mjs`. `tests/sync-with-html.test.mjs` extracts the method bodies
  from `index.html` via a brace-matching slicer, runs them in a `vm` sandbox, and asserts the
  output matches the reference for shared fixtures.
- `calcBlast` and `detectCircular` (`index.html:2213`) mirror `tests/blast.mjs`.
  `tests/sync-blast-with-html.test.mjs` does the same structural comparison.

So a change to blast-radius or link-parsing logic is a **three-file edit**: the `index.html`
copy, the `tests/*.mjs` reference, and (if behavior changes) the `*.test.mjs` cases. Run
`npm test` afterward — the sync tests will catch drift between the copies.

Edge/connection format throughout: `{source, target, fn, count}` where an edge means `target`
imports/uses something from `source`; a file's *dependents* are edges where it is the `source`.
Markdown notes add `kind: 'wikilink'|'mdlink'` and live on the `note` layer.

## Conventions

Plain ES5-flavored JavaScript inside the Babel block (`var`, `function` expressions, no JSX
build tooling beyond browser Babel) — match the surrounding style rather than introducing
modern syntax inconsistently. No TypeScript anywhere. The `tests/` modules are `.mjs` ES
modules. Keep new pure logic testable and mirrored per the invariant above; the project favors
dependency-free Node tests over adding a test framework.

When adding a language, extend `Parser.codeExts`/`textExts` and the extraction helpers, and
update the README's "Supported Languages" table to stay accurate.

## Git workflow

`origin` is `hxzmn7f5dp-jpg/codeflow`. History shows the standard flow here: develop on a
`claude/*` branch and land via PR to `main` (e.g. `Merge pull request #3 … claude/test-coverage-analysis`).
Do **not** commit directly to `main`. Earlier history also carries `braedonsaunders/*` and
`codex/*` PR branches from the upstream project this was mirrored from. Commit in small,
focused chunks; before pushing, run `npm test` (CI runs it too, but it's the human gate) and
— for anything visual — actually open `index.html` in a browser and look at the rendered
result, since CI only covers the JS logic, not the rendered UI.
