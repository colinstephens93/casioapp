// Fetches the Electron binary as an explicit step.
//
// Why this is not a postinstall hook: DSH runs commands in a file sandbox that forbids
// spawning a child process with piped stdio, which is exactly how npm executes install
// scripts. So `npm install` cannot download the Electron binary here — it dies with
// `spawn EPERM`. Running install.js as a direct child with inherited stdio works, and that
// is all this script does. See .npmrc for the matching configuration.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// @electron/get caches to %LOCALAPPDATA%\electron by default, which is outside the sandbox.
const cache = join(root, '.electron-cache');

const installer = join(dirname(require.resolve('electron/package.json')), 'install.js');

// .npmrc sets ELECTRON_SKIP_BINARY_DOWNLOAD=1 so that npm's blocked postinstall cannot be
// triggered. This script is the intended replacement for that install script, so the flag
// must be cleared here or install.js exits immediately without fetching anything.
const env = { ...process.env, electron_config_cache: cache };
delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;

const result = spawnSync(process.execPath, [installer], {
	stdio: 'inherit',
	cwd: root,
	env,
});

if (result.error) {
	console.error(`failed to run the electron installer: ${result.error.message}`);
	process.exit(1);
}

if (result.status !== 0) {
	console.error(`electron installer exited with status ${result.status}`);
	process.exit(result.status ?? 1);
}

console.log('electron binary is installed');
