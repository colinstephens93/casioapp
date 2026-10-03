// Build steps shared by `npm run build` and `npm run watch`.
//
// Two compilers are involved, for one reason each:
//
//   `tsc`                        src/main, src/preload -> CommonJS `.cjs`, because Electron's
//                                main and preload environments are CommonJS.
//   this module (compiler API)   src/shared, src/renderer -> ESM `.js`, rewriting the `.ts`
//                                import specifiers to `.js` so a browser can load them.
//
// Shared logic is emitted next to the renderer because the renderer imports it directly.
// Everything runs in-process: this sandbox forbids spawning a child with piped stdio, so
// shelling out to `tsc` is not an option. See docs/ENVIRONMENT.md.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Removes dist entirely. Stale output is worse than none: a leftover `.js` from a renamed
 * `.cts` source looks authoritative while no longer corresponding to any source file. */
export function clean() {
	rmSync(join(root, 'dist'), { recursive: true, force: true });
	// The incremental fingerprints refer to files that no longer exist, so a full build must forget them
	// or it would skip every file it thinks it has already written.
	fingerprints.clear();
}

/** @param {string} dir @returns {string[]} */
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

/**
 * @param {object} options
 * @param {string} options.srcDir
 * @param {string} options.outDir
 */
/**
 * The last-seen fingerprint of every source file, so an unchanged file is not recompiled.
 *
 * Without this, a watcher rebuild recompiles *every* file in a tree because one file changed — and each
 * write bumps the mtime of an output that nothing consumes, which makes the log say "compiled 4 file(s)"
 * on every keystroke and hides which file actually triggered the rebuild. The fingerprint is size plus
 * mtime, which is what `tsc` and every other watcher use; content hashing would be more robust and is
 * unnecessary for a dev loop.
 */
const fingerprints = new Map();

/** @returns {string} */
function fingerprint(file) {
	const stats = statSync(file);
	return `${stats.size}:${stats.mtimeMs}`;
}

/** @returns {Promise<number>} */
async function transpileDir({ srcDir, outDir }) {
	const files = walk(srcDir);
	let count = 0;

	for (const file of files) {
		const current = fingerprint(file);
		if (fingerprints.get(file) === current) {
			continue;
		}

		const source = await readFile(file, 'utf-8');
		const result = ts.transpileModule(source, {
			compilerOptions: {
				target: ts.ScriptTarget.ES2022,
				module: ts.ModuleKind.ES2022,
				sourceMap: false,
			},
			fileName: file,
		});

		// `from './x.ts'` -> `from './x.js'`, including the dynamic import form.
		const output = result.outputText
			.replace(/(from\s+['"][^'"]+)\.ts(['"])/g, '$1.js$2')
			.replace(/(import\s*\(\s*['"][^'"]+)\.ts(['"]\s*\))/g, '$1.js$2');

		const rel = relative(srcDir, file).replace(/\.ts$/, '.js');
		const target = join(outDir, rel);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, output, 'utf-8');
		fingerprints.set(file, current);
		count += 1;
	}

	// Only reported when something happened. `clean()` clears the cache, so a full build always emits
	// its counts and a watcher only speaks up when it has actually written a file.
	if (count > 0) {
		console.log(`compiled ${count} file(s): ${relative(root, srcDir)} -> ${relative(root, outDir)}`);
	}
	return count;
}

/** Compiles main and preload to CommonJS via `tsc`, in process. */
export function compileMain() {
	// tsconfig.main.json rather than the root config: the root carries
	// allowImportingTsExtensions for typechecking, and that flag is emit-incompatible.
	execFileSync(
		process.execPath,
		[join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.main.json'],
		{ cwd: root, stdio: 'inherit' },
	);
}

/** Compiles shared and renderer to ESM with rewritten specifiers. */
export async function compileRenderer() {
	await transpileDir({
		srcDir: join(root, 'src', 'shared'),
		outDir: join(root, 'dist', 'shared'),
	});
	await transpileDir({
		srcDir: join(root, 'src', 'renderer'),
		outDir: join(root, 'dist', 'renderer'),
	});
}

/** The renderer's static assets. The TypeScript step emits only `.js`, so these travel alongside it. */
export function copyStatic() {
	const from = join(root, 'src', 'renderer');
	const to = join(root, 'dist', 'renderer');
	mkdirSync(to, { recursive: true });
	for (const file of ['index.html', 'styles.css']) {
		cpSync(join(from, file), join(to, file));
	}
	console.log('static renderer assets copied');
}

/**
 * Compiles the main process's *pure* modules to ESM.
 *
 * `src/main` holds two kinds of file, and the extension is the discriminator:
 *
 *   `.cts`  Electron-facing, CommonJS, compiled by `tsc` alongside preload. Imports Electron, so it
 *           cannot be unit-tested here at all.
 *   `.ts`   Pure logic — the config schema, the notification phrasing. Imports only Node built-ins,
 *           so it is unit-tested directly with no build step.
 *
 * The pure ones are emitted as **ESM** because that is the only format Node's type stripping and the
 * test runner can load: a `.cts` file is CommonJS by extension, and the ESM loader refuses it, while
 * `createRequire` refuses its `import` statements. Emitting ESM is what makes them testable, and the
 * CommonJS main process reaches them with a dynamic `import()`, which works in both directions.
 *
 * `tsc` never sees these files: `tsconfig.main.json` includes only `**\/*.cts`, and the root config
 * excludes `src/main` so that the renderer's emit cannot collide with this. If a `.ts` file is ever
 * added to `src/main` that *does* want to be CommonJS, it belongs in `.cts`.
 */
export async function compileMainPure() {
	await transpileDir({
		srcDir: join(root, 'src', 'main'),
		outDir: join(root, 'dist', 'main'),
	});
}
