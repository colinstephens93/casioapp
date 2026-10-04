// Launches the widget.
//
// Why this exists instead of calling `electron` directly: this environment sets
// ELECTRON_RUN_AS_NODE=1. With it set, electron.exe runs as plain Node — no GUI initialises
// and `require('electron')` resolves to the npm wrapper package, whose export is a path
// string, producing "Cannot read properties of undefined (reading 'commandLine')". Clearing
// the variable for the child process is the whole fix.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const binary = join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const pathTxt = join(root, 'node_modules', 'electron', 'path.txt');

if (!existsSync(pathTxt)) {
	console.error('the electron binary is missing — run `npm run fetch:electron` first');
	process.exit(1);
}

if (!existsSync(binary)) {
	console.error(`expected the electron binary at ${binary}`);
	process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

/**
 * The entry point, with its extension read from the build rather than hard-coded.
 *
 * `.cjs`, not `.js` — Electron's main process is CommonJS, so `tsconfig.main.json` emits `main.cjs`.
 * This was hard-coded to `.js`, which means the launcher's own existsSync check failed on every run and
 * printed "run `npm run build` first" *after* the build had just succeeded. A launcher that misdirects
 * on its first use is the worst possible first impression, so the extension is discovered and the error
 * names what it actually looked for.
 */
function findEntry() {
	for (const name of ['main.cjs', 'main.js']) {
		const candidate = join(root, 'dist', 'main', name);
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

const entry = findEntry();

if (!entry) {
	console.error('missing dist/main/main.cjs — run `npm run build` first');
	process.exit(1);
}

console.log(
	`starting electron ${readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf-8').match(/"version":\s*"([^"]+)"/)?.[1] ?? ''}`,
);
console.log(`entry: ${entry.replace(root + '\\', '').replace(root + '/', '')}`);

const result = spawnSync(binary, [entry], { stdio: 'inherit', cwd: root, env });

if (result.error) {
	console.error(`failed to start electron: ${result.error.message}`);
	process.exit(1);
}

process.exit(result.status ?? 0);
