# Markdown / wiki-link parser for CodeFlow

Date: 2026-04-19
Branch: `claude/md-wikilink-parser-4b0c68`
Fixture: `~/Documents/Claude/Projects/Brain/` — 68 `.md` files with `[[wiki-links]]`; a handful of `[text](./file.md)` links we'll add to test.

## Goal

Make CodeFlow treat an Obsidian (or any markdown) vault as a graph: each `.md` is a node, each `[[wiki-link]]` or `[text](./rel.md)` is an edge.

## Current state (from reading `index.html`)

- `Parser.codeExts` (line 572): files that get AST-parsed for functions. Drives graph edges via `Parser.findCalls`.
- `Parser.textExts` (line 573): **already includes `.md`**. These files enter `analyzed[]` as nodes with `functions:[]` and `isCode:false`, but contribute **zero edges**.
- `conns[]` (edge list): today only populated by function-call detection. Shape: `{source, target, fn, count}`.
- `analyzed[]` (node list): `{path, name, folder, content, functions, lines, layer, churn, isCode}`. No `dependencies` field.
- `exportJSON` (line 3882): emits `files:[{path,fns,layer,lines}], connections, ...`. No per-file deps.
- Two identical scan paths: GitHub `processFile` (line 2596) and Local `processFile` (line 2868). Both will need the same branch.

The user's framing — "add `.md` to the extension list" — is slightly off: `.md` is already scanned, but it produces no edges. The real gap is link extraction.

## Design

Four changes, all scoped to the `Parser` object and the two scan orchestrators.

### 1. `Parser.isMarkdown(name)` — new helper

Returns true for `.md`/`.markdown`. Companion to `isCode`, `isText`, `isBinary`.

### 2. `Parser.extractMarkdownLinks(content)` — new pure function

Returns `[{kind:'wikilink'|'mdlink', raw, target}]`. Regex shape:

- **Wiki-link:** `/\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g` — strips `#heading` and `|alias`, keeps the note name. Matches `[[Foo]]`, `[[Foo|display]]`, `[[Foo#Section]]`, `[[Path/To/Foo]]`.
- **Markdown-link:** `/\[([^\]]*)\]\(([^)\s]+?)(?:\s+"[^"]*")?\)/g` — captures URL. Skip if `^(https?|mailto|#):`. Strip `#anchor` and `?query`. Keep relative paths.
- **Code-block immunity:** strip ```fenced blocks``` and `inline code` before matching.

### 3. `Parser.resolveMarkdownLink(rawTarget, fromPath, allPaths, kind)` — new pure function

Resolves against the scanned set. Returns a path or `null`.

- Md-link: first try path-relative from `fromPath` (handles `.`/`..`). Fall through to basename match.
- Wiki-link: basename match only. `[[Foo]]` → find any file whose basename is `Foo.md` (case-insensitive).
- If no `.md` extension on the target, append `.md` for lookup.

### 4. Graph wiring — new "Phase 2.5" in both `finishAnalysis` blocks

After function-call detection, before the existing `content=null` cleanup:

```js
var allPaths = analyzed.map(f => f.path);
analyzed.forEach(function(file){
    if(!Parser.isMarkdown(file.name) || !file.content) return;
    var links = Parser.extractMarkdownLinks(file.content);
    var deps = [];
    links.forEach(function(link){
        var resolved = Parser.resolveMarkdownLink(link.target, file.path, allPaths, link.kind);
        deps.push({kind:link.kind, raw:link.raw, target:link.target, resolved:resolved});
        if(resolved && resolved !== file.path){
            conns.push({source:file.path, target:resolved, fn:link.raw, count:1, kind:link.kind});
        }
    });
    file.dependencies = deps;
    file.layer = 'note';  // distinct color in graph
});
analyzed.forEach(function(f){ if(!f.dependencies) f.dependencies = []; });
```

Edge direction: `source = the note containing the link`, `target = the referenced note`. Matches the user's mental model ("A links to B").

### 5. Export surface

`exportJSON` gains `dependencies` in the per-file payload so vault scans surface links in the exported artifact.

## Test strategy (TDD, real fixtures)

Node's built-in `node --test` runner, no deps.

Fixtures in `tests/fixtures/vault/`:
1. `note-with-wikilink.md` — contains `[[target-note]]`
2. `target-note.md` — empty
3. `note-with-mdlink.md` — contains `[click](./target-note.md)`
4. `note-with-both.md` — one of each
5. `note-with-dead-link.md` — `[[does-not-exist]]` and `[x](./also-missing.md)`

Failing tests first:
- `extractMarkdownLinks` finds 1 wikilink in fixture 1
- `extractMarkdownLinks` finds 1 mdlink in fixture 3
- `extractMarkdownLinks` finds 2 links in fixture 4
- `resolveMarkdownLink` resolves `target-note` wikilink to `target-note.md`
- `resolveMarkdownLink` resolves `./target-note.md` mdlink to `target-note.md`
- `resolveMarkdownLink` returns `null` for dead links
- `extractMarkdownLinks` ignores links inside code fences

Because the parser lives inside a `<script>` tag in a single HTML file, the test file re-declares the two pure functions (exported via `tests/md-extractors.mjs` and copied verbatim into `index.html`). A header comment in both files calls out the duplication and points at the source of truth.

## Verification (before claiming done)

1. Open `index.html` in Chrome via `file://`.
2. "Local Files" → pick `~/Documents/Claude/Projects/Brain`.
3. Visually confirm the graph has edges between notes.
4. Export JSON.
5. `grep -c '"kind":"wikilink"' codeflow-analysis.json` ≥ 1.
6. `grep -c '"kind":"mdlink"'  codeflow-analysis.json` ≥ 1.
7. Spot-check that at least one resolved target is an actual path in the scanned set.

## Out of scope

- Full CommonMark. Regex is good enough for link detection.
- Image links `![alt](x.png)`.
- Reference-style links (`[text][id]` with `[id]: url` elsewhere).
- Frontmatter parsing.
- Transitive blast radius across note edges (the existing blast logic will just pick them up because they're in `conns`).
