// Bundles the renderer and the shared logic into ONE classic script, for the browser preview.
//
// Why not just emit ES modules: the preview must work when the file is double-clicked, and Chrome
// blocks ES module imports over `file://` for CORS reasons. A bundled classic script has no such
// restriction, so the preview needs no server and no build step for the user.
//
// The technique is a miniature CommonJS runtime: TypeScript transpiles each module to CommonJS,
// every module is wrapped in a registry entry, and a tiny `require` resolves between them. That
// needs no bundler dependency and cannot hit this sandbox's spawn restriction, since everything
// runs in process through the compiler API.
import { readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Module ids are relative to `src/`, with **forward slashes**.
 *
 * The separator normalisation matters: `path.relative` returns backslashes on Windows, so without
 * it the registry keys are `shared\watch` while the inline script (and `resolveId`) use
 * `shared/watch`. The mismatch is invisible on disk and makes every `require` fail at runtime, which
 * is how it was found — by asserting the bundle contains the ids the page asks for.
 */
function moduleId(file) {
	return relative(join(root, 'src'), file).replace(/\.ts$/, '').split(sep).join('/');
}

function walk(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...walk(full));
		} else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
			out.push(full);
		}
	}
	return out;
}

/** Resolves a require specifier against the requiring module's directory, as CommonJS would. */
function resolveId(fromId, specifier) {
	const parts = fromId.split('/');
	parts.pop();
	// Source imports keep their `.ts` extension. The registry id has none, so both
	// `.ts` and the `.js` TypeScript sometimes emits have to come off or the board
	// throws "module not found" the moment the shortcut page loads.
	for (const segment of specifier.replace(/\.(js|mjs|cjs|ts|cts|mts)$/, '').split('/')) {
		if (segment === '.' || segment === '') {
			continue;
		}
		if (segment === '..') {
			parts.pop();
		} else {
			parts.push(segment);
		}
	}
	return parts.join('/');
}

const files = [...walk(join(root, 'src', 'shared')), ...walk(join(root, 'src', 'renderer'))];

const modules = [];
for (const file of files) {
	const source = await readFile(file, 'utf-8');
	const id = moduleId(file);
	const result = ts.transpileModule(source, {
		compilerOptions: {
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.CommonJS,
			esModuleInterop: true,
			sourceMap: false,
		},
		fileName: file,
	});

	// Rewrite relative requires to absolute module ids, so resolution does not depend on cwd.
	const code = result.outputText.replace(
		/require\((['"])([^'"]+)\1\)/g,
		(match, _quote, specifier) => {
			if (!specifier.startsWith('.')) {
				return match;
			}
			return `__require(${JSON.stringify(resolveId(id, specifier))})`;
		},
	);

	modules.push({ id, code });
}

const runtime = `
(function () {
	'use strict';
	var registry = {};
	var cache = {};
	function define(id, factory) { registry[id] = factory; }
	function __require(id) {
		if (cache[id]) { return cache[id].exports; }
		var factory = registry[id];
		if (!factory) { throw new Error('module not found: ' + id); }
		var module = { exports: {} };
		cache[id] = module;
		factory(module, module.exports, __require);
		return module.exports;
	}
	window.__modules = { define: define, require: __require, registry: registry };
})();
`;

const moduleBlock = modules
	.map(
		({ id, code }) =>
			`window.__modules.define(${JSON.stringify(id)}, function (module, exports, __require) {\n${code}\n});`,
	)
	.join('\n');

const outDir = join(root, 'dist', 'preview');
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'bundle.js'), `${runtime}\n${moduleBlock}\n`, 'utf-8');

// The desktop shortcut opens this file directly. Chrome blocks the renderer's ES module
// imports on file://, and on this PC electron.exe crashes before it can show a window,
// so the shortcut cannot depend on either. One classic script has the same board.
const widgetDir = join(root, 'dist', 'renderer');
await mkdir(widgetDir, { recursive: true });
await writeFile(
	join(widgetDir, 'widget.js'),
	`${runtime}\n${moduleBlock}\nwindow.__modules.require('renderer/index');\n`,
	'utf-8',
);
await writeFile(
	join(widgetDir, 'widget.html'),
	`<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta
			http-equiv="Content-Security-Policy"
			content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:"
		/>
		<title>World time</title>
		<link rel="stylesheet" href="./styles.css" />
	</head>
	<body>
		<div id="desk">
			<div id="board"></div>
			<div id="resize" title="Resize"></div>
		</div>
		<script src="./widget.js"></script>
	</body>
</html>
`,
	'utf-8',
);

console.log(`bundled ${modules.length} module(s) into dist/preview/bundle.js`);
