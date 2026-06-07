// Source of truth for blast-radius / impact analysis. Mirror into index.html's
// top-level `calcBlast` function. If you edit one, edit the other — the copy
// lives inside a single-file static app. The `sync-with-html.test.mjs` test
// asserts the two stay byte-for-byte equivalent (function body extracted from
// index.html and compared structurally via this reference).
//
// Connection format: {source: fileDefiningFn, target: fileCallingFn, fn: fnName, count: callCount}
// i.e. an edge means `target` imports/uses something from `source`.
// So the *dependents* of a file are the connections where it is the `source`.

export function calcBlast(fileId, conns, files) {
    // Comprehensive impact analysis for a file

    // Build adjacency lists for fast lookups
    var exportedTo = {};   // fileId -> Set of files that import from it
    var importedFrom = {}; // fileId -> Set of files it imports from
    var exportedFns = {};  // fileId -> Map of fn -> count of external calls

    conns.forEach(function (c) {
        var src = typeof c.source === 'object' ? c.source.id : c.source;
        var tgt = typeof c.target === 'object' ? c.target.id : c.target;
        // src exports, tgt imports
        if (!exportedTo[src]) exportedTo[src] = new Set();
        exportedTo[src].add(tgt);
        if (!importedFrom[tgt]) importedFrom[tgt] = new Set();
        importedFrom[tgt].add(src);
        if (!exportedFns[src]) exportedFns[src] = new Map();
        var fnMap = exportedFns[src];
        fnMap.set(c.fn, (fnMap.get(c.fn) || 0) + (c.count || 1));
    });

    // 1. Direct dependents (files that directly import from this file)
    var directDeps = exportedTo[fileId] ? Array.from(exportedTo[fileId]) : [];

    // 2. Transitive dependents (BFS with depth tracking)
    var transitive = new Map(); // fileId -> depth
    var queue = directDeps.map(function (f) { return { file: f, depth: 1 }; });
    var visited = new Set([fileId].concat(directDeps));
    while (queue.length > 0) {
        var item = queue.shift();
        if (item.depth > 3) continue; // Limit depth to 3 for transitive
        transitive.set(item.file, item.depth);
        var nextDeps = exportedTo[item.file] || new Set();
        nextDeps.forEach(function (f) {
            if (!visited.has(f)) {
                visited.add(f);
                queue.push({ file: f, depth: item.depth + 1 });
            }
        });
    }

    // 3. Functions exported (how many of this file's functions are used)
    var fnUsage = exportedFns[fileId] || new Map();
    var fnsUsed = fnUsage.size;
    var totalCalls = 0;
    fnUsage.forEach(function (cnt) { totalCalls += cnt; });

    // 4. Dependencies (files this file imports from - its risk)
    var dependencies = importedFrom[fileId] ? Array.from(importedFrom[fileId]) : [];

    // 5. Calculate weighted impact score
    // Direct deps count fully, transitive count with decay
    var impactScore = directDeps.length;
    transitive.forEach(function (depth, f) {
        if (depth > 1) impactScore += 1 / depth; // 0.5 for depth 2, 0.33 for depth 3
    });

    // 6. Calculate centrality (how connected is this file)
    var centrality = directDeps.length + dependencies.length + fnsUsed;

    // Determine level based on direct dependents and functions used
    var level = 'low';
    var connectedFiles = files.filter(function (f) { return exportedTo[f.path] || importedFrom[f.path]; }).length;
    var relativePct = connectedFiles > 0 ? Math.round(directDeps.length / connectedFiles * 100) : 0;

    if (directDeps.length >= 8 || fnsUsed >= 5) level = 'critical';
    else if (directDeps.length >= 4 || fnsUsed >= 3) level = 'high';
    else if (directDeps.length >= 2 || fnsUsed >= 1) level = 'medium';

    return {
        affected: directDeps,
        transitive: Array.from(transitive.keys()),
        count: directDeps.length,
        transitiveCount: transitive.size,
        percent: relativePct,
        level: level,
        depth: transitive.size > 0 ? Math.max.apply(null, Array.from(transitive.values())) : 0,
        fnsUsed: fnsUsed,
        totalCalls: totalCalls,
        dependencies: dependencies,
        impactScore: Math.round(impactScore * 10) / 10,
        centrality: centrality
    };
}

// Detect circular dependencies among the connection edges, mirroring the inline
// logic in index.html's analysis pipeline (see the `connSet` / `circular` block).
// A cycle is a pair of files that import from each other (A->B and B->A).
// Returns a sorted array of "a|b" keys (each pair canonicalized, deduped).
export function detectCircular(conns) {
    var connSet = new Set();
    conns.forEach(function (c) {
        var src = typeof c.source === 'object' ? c.source.id : c.source;
        var tgt = typeof c.target === 'object' ? c.target.id : c.target;
        connSet.add(src + '|' + tgt);
    });
    var circular = [];
    conns.forEach(function (c) {
        var src = typeof c.source === 'object' ? c.source.id : c.source;
        var tgt = typeof c.target === 'object' ? c.target.id : c.target;
        if (connSet.has(tgt + '|' + src)) {
            var key = [src, tgt].sort().join('|');
            if (!circular.includes(key)) circular.push(key);
        }
    });
    return circular;
}
