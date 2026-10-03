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

const entry = join(root, 'dist', 'main', 'main.js');

if (!existsSync(entry)) {
	console.error(`missing ${entry} — run \`npm run build\` first`);
	process.exit(1);
}

console.log(`starting electron ${readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf-8').match(/"version":\s*"([^"]+)"/)?.[1] ?? ''}`);

const result = spawnSync(binary, [entry], { stdio: 'inherit', cwd: root, env });

if (result.error) {
	console.error(`failed to start electron: ${result.error.message}`);
	process.exit(1);
}

process.exit(result.status ?? 0);
