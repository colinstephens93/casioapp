// Rebuilds shared, renderer and static assets whenever a source file changes.
//
// Main and preload are watched too, but `tsc` handles those in one long-lived process rather
// than a full recompile per change. Nothing here spawns with piped stdio, so it is safe in the
// sandbox. See docs/ENVIRONMENT.md.
import { watch } from 'node:fs';
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { compileRenderer, root } from './steps.mjs';

const staticFiles = ['index.html', 'styles.css'];

export function copyStatic() {
	for (const file of staticFiles) {
		cpSync(join(root, 'src', 'renderer', file), join(root, 'dist', 'renderer', file));
	}
	console.log('static assets copied');
}

async function rebuild(changed) {
	try {
		await compileRenderer();
		copyStatic();
		console.log(`rebuilt after change: ${changed}`);
	} catch (error) {
		// A syntax error mid-edit is normal; report it and keep watching.
		console.error(`rebuild failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

let pending = false;
for (const dir of ['src/shared', 'src/renderer']) {
	watch(join(root, dir), { recursive: true }, (_event, filename) => {
		if (!filename) {
			return;
		}
		if (pending) {
			return;
		}
		// Coalesce the burst of events a single save produces.
		pending = true;
		setTimeout(() => {
			pending = false;
			void rebuild(filename);
		}, 120);
	});
}

console.log('watching src/shared and src/renderer (Ctrl+C to stop)');
