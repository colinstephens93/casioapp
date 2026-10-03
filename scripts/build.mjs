// Full build: clean, main/preload, shared/renderer, the preview bundle and page.
//
// Every step is in-process or uses inherited stdio, because this sandbox forbids spawning a child
// with piped stdio. See docs/ENVIRONMENT.md.
import { clean, compileMain, compileRenderer, root } from './steps.mjs';
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function run(script, label) {
	const result = spawnSync(process.execPath, [join(root, 'scripts', script)], {
		cwd: root,
		stdio: 'inherit',
	});
	if (result.status !== 0) {
		console.error(`${label} failed with status ${result.status}`);
		process.exit(result.status ?? 1);
	}
}

clean();
compileMain();
await compileRenderer();

// The TypeScript step emits only .js; the HTML and CSS travel alongside it.
const from = join(root, 'src', 'renderer');
const to = join(root, 'dist', 'renderer');
mkdirSync(to, { recursive: true });
for (const file of ['index.html', 'styles.css']) {
	cpSync(join(from, file), join(to, file));
}
console.log('static renderer assets copied');

run('bundle-preview.mjs', 'preview bundle');
run('make-preview.mjs', 'preview page');

// The preview's inline script is emitted inside a template string, so neither `tsc` nor the unit
// tests ever parse it. This is the only thing standing between a typo there and a page that
// silently does nothing, so it runs as part of every build.
run('verify-preview.mjs', 'preview verification');
