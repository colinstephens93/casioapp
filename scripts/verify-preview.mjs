// Verifies the preview's inline live script.
//
// The script is emitted inside a TypeScript template string, so neither `tsc` nor the unit tests
// ever parse it. A syntax error there would produce a page that silently does nothing, which is
// exactly the kind of failure worth catching before it reaches a browser.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'dist', 'preview', 'index.html'), 'utf-8');

// The last inline script is the live one; the first is the bundle reference.
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
if (scripts.length === 0) {
	console.error('no inline scripts found in the preview page');
	process.exit(1);
}

const source = scripts[scripts.length - 1] ?? '';
console.log(`inline script: ${source.length} characters`);

// 1. It must parse.
try {
	new vm.Script(source, { filename: 'preview-inline.js' });
	console.log('parses          : OK');
} catch (error) {
	console.error(`parses          : FAILED — ${error.message}`);
	process.exit(1);
}

// 2. It must not reference the dead code that an earlier revision left behind.
for (const forbidden of ['zoneLabel', 'mapModule', 'registerShownAt']) {
	if (source.includes(forbidden)) {
		console.error(`stale reference : FAILED — still mentions "${forbidden}"`);
		process.exit(1);
	}
}
console.log('stale refs      : none');

// 3. The bundle must define every module the script requires.
const bundle = readFileSync(join(root, 'dist', 'preview', 'bundle.js'), 'utf-8');
const required = [...source.matchAll(/modules\.require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
for (const id of required) {
	if (!bundle.includes(`define(${JSON.stringify(id)}`)) {
		console.error(`missing module  : FAILED — the bundle has no "${id}"`);
		process.exit(1);
	}
}
console.log(`modules required: ${required.join(', ')} — all present in the bundle`);

// 4. The page must expose the control elements the script looks for.
for (const id of ['controls', 'register-buttons', 'zone-buttons', 'status']) {
	if (!html.includes(`id="${id}"`)) {
		console.error(`missing element : FAILED — no #${id}`);
		process.exit(1);
	}
}
console.log('control elements: all present');

// 5. Structural sanity on the whole page.
const counts = {
	svgs: (html.match(/<svg class="watch"/g) ?? []).length,
	nan: (html.match(/NaN/g) ?? []).length,
	undefinedWords: (html.match(/undefined/g) ?? []).length,
};
console.log(`faces rendered  : ${counts.svgs}`);
if (counts.nan > 0 || counts.undefinedWords > 0) {
	console.error(`numeric hygiene : FAILED — NaN ${counts.nan}, undefined ${counts.undefinedWords}`);
	process.exit(1);
}
console.log('numeric hygiene : clean');

console.log('\npreview verification passed');
