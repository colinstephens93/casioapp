// Rebuilds on change, for all four source trees.
//
// ## Why the watched set is what it is
//
// Every directory the build compiles has to be watched, or `npm run watch` quietly produces a `dist`
// that does not match `src` — and a stale build looks exactly like a working one. That is not
// hypothetical: `src/main` was missing from this list, so editing `config.ts` or `notify.ts` left
// `dist/main/*.js` at its last-built content, `npm start` and `npm test` ran the old module, and
// nothing said so. It was confirmed by touching `src/main/config.ts` and watching the built file's
// timestamp not move while a `src/renderer` change rebuilt normally.
//
// The four trees, and what each needs:
//
//   src/shared, src/renderer   in-process transpile to ESM (`compileRenderer`)
//   src/main/*.ts              in-process transpile to ESM (`compileMainPure`)
//   src/main/*.cts, src/preload `tsc` to CommonJS (`compileMain`)
//   src/renderer/*.html, *.css copied verbatim (`copyStatic`)
//
// ## The one synchronous step
//
// `tsc` is spawned with **inherited** stdio rather than piped, because this sandbox forbids piping a
// child's output (docs/ENVIRONMENT.md §2) — so `compileMain` blocks the event loop while it runs, and
// the coalescing below is what keeps a burst of saves from queueing several compiles. Everything else
// is in-process and fast.
import { watch } from 'node:fs';
import { statSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
	compileMain,
	compileMainPure,
	compileRenderer,
	copyStatic,
	root,
} from './steps.mjs';

/** The trees to watch, and what a change in each one means. */
const TREES = [
	{ dir: 'src/shared', step: 'renderer' },
	{ dir: 'src/renderer', step: 'renderer' },
	{ dir: 'src/main', step: 'main' },
	{ dir: 'src/preload', step: 'main' },
];

/**
 * Rebuilds whatever a change affects.
 *
 * `src/main` is the interesting case, because it is really two build steps over one directory: the
 * `.ts` files go through the in-process transpiler, and the `.cts` files through `tsc`. Both are run
 * rather than picking by extension, since each only touches its own files — `compileMainPure` walks
 * `.ts` only, and `tsconfig.main.json` includes `.cts` only. Guessing from the filename would be an
 * optimisation that gets it wrong the first time a file is renamed.
 */
async function rebuild(file) {
	const name = file.replace(/\\/g, '/');

	try {
		if (name.endsWith('.ts') || name.endsWith('.cts') || name.endsWith('.mts')) {
			await compileRenderer();
			await compileMainPure();
			// Only re-run `tsc` for a `.cts` change: it is the synchronous step, and a `.ts` edit does not
			// affect anything `tsc` emits.
			if (name.endsWith('.cts')) {
				compileMain();
			}
		} else if (name.endsWith('.html') || name.endsWith('.css')) {
			copyStatic();
		}
		console.log(`rebuilt: ${relative(root, file)}`);
	} catch (error) {
		// A syntax error mid-edit is the normal case for a watcher, so report it and keep watching rather
		// than exiting — losing the watcher on the first typo is the most annoying possible behaviour.
		console.error(`rebuild failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Coalesces the burst of events a single save produces, and drops them while a rebuild is running. */
let pending = null;

/**
 * What each file looked like the last time we rebuilt because of it.
 *
 * Windows `fs.watch` fires more than once per save — a write, then a metadata event — and it also
 * reports events for changes we did not make, such as a tool touching a file's timestamp. Without this
 * check one edit produced four rebuild cycles, which is how it was found. The fingerprint makes the
 * watcher idempotent: an event for a file whose bytes and mtime are unchanged does nothing.
 */
const lastSeen = new Map();

function changedSinceLastRebuild(file) {
	let stats;
	try {
		stats = statSync(file);
	} catch {
		// A deleted file has nothing to rebuild. Reporting it once is enough; the next event for a real
		// change will carry on as normal.
		return false;
	}
	const fingerprint = `${stats.size}:${stats.mtimeMs}`;
	if (lastSeen.get(file) === fingerprint) {
		return false;
	}
	lastSeen.set(file, fingerprint);
	return true;
}

function schedule(file) {
	if (pending !== null) {
		clearTimeout(pending);
	}
	pending = setTimeout(() => {
		pending = null;
		if (changedSinceLastRebuild(file)) {
			void rebuild(file);
		}
	}, 120);
}

for (const { dir } of TREES) {
	watch(join(root, dir), { recursive: true }, (_event, filename) => {
		if (filename) {
			schedule(join(dir, filename));
		}
	});
}

console.log(`watching ${TREES.map((tree) => tree.dir).join(', ')} (Ctrl+C to stop)`);
