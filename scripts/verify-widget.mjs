// Verifies the built widget page: the part of the shell a test cannot otherwise reach.
//
// `npm run typecheck` checks the renderer's *types*, and the unit tests check its logic. Neither sees
// the two things that decide whether the widget actually appears: whether the HTML references files
// that exist, and whether the emitted JavaScript has a chance of running at all. Both are silent when
// wrong — a bad `src` gives a blank transparent window, and a syntax error gives the same — which is
// exactly the class of failure this file exists for, and the same reasoning as `verify-preview.mjs`.
//
// This is an inspection, not a substitute for running it. `docs/ENVIRONMENT.md` §4 establishes that
// the widget cannot be launched in this sandbox.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const rendererDir = join(dist, 'renderer');

let failures = 0;
function fail(message) {
	console.error(`  FAIL  ${message}`);
	failures += 1;
}
function ok(message) {
	console.log(`  ok    ${message}`);
}

// ---------------------------------------------------------------------------------------------
// 1. The page and everything it names must exist.
// ---------------------------------------------------------------------------------------------
const htmlPath = join(rendererDir, 'index.html');
if (!existsSync(htmlPath)) {
	fail('dist/renderer/index.html is missing — the build did not copy the static renderer assets');
	process.exit(1);
}
const html = readFileSync(htmlPath, 'utf-8');

for (const [what, relative] of [
	['stylesheet', './styles.css'],
	['entry script', './index.js'],
]) {
	const name = relative.replace('./', '');
	if (!html.includes(relative)) {
		fail(`index.html does not reference its ${what} (${relative})`);
	} else if (!existsSync(join(rendererDir, name))) {
		fail(`index.html references ${relative}, which was not built`);
	} else {
		ok(`the ${what} is referenced and present`);
	}
}

// The board is what the entry point draws into. Without it the script returns and the window stays
// a blank transparent rectangle, which looks like a crash.
if (!html.includes('id="desk"') || !html.includes('id="board"')) {
	fail('index.html has no #desk/#board — the entry point would find nothing to draw into');
} else {
	ok('the board is present');
}

// ---------------------------------------------------------------------------------------------
// 2. The emitted entry must parse, and must not reach for anything a sandboxed page cannot have.
// ---------------------------------------------------------------------------------------------
//
// The entry is **ESM**, because the renderer is bundled for the browser — so `vm.Script`, which parses
// scripts, refuses it on its first `import`. Node's own loader parses ESM properly, but resolves the
// imports: they name `./face.js` and `../shared/controller.js` relative to `dist/renderer`, and the
// shared half lives in `dist/shared`, so resolution is expected to fail.
//
// That gives a clean separation. A *resolution* failure means the module parsed and the import graph is
// simply not laid out for Node; anything else — a syntax error, a bad token — is a real failure. The
// check is therefore "does the loader get past parsing", which is exactly the question.
const entryPath = join(rendererDir, 'index.js');
const entry = readFileSync(entryPath, 'utf-8');

const { pathToFileURL } = await import('node:url');
try {
	await import(pathToFileURL(entryPath).href);
	ok('the entry script parses and loads');
} catch (error) {
	const code = error && typeof error === 'object' ? error.code : undefined;
	const isResolutionFailure = code === 'ERR_MODULE_NOT_FOUND' || code === 'ERR_UNSUPPORTED_DIR_IMPORT';
	if (isResolutionFailure) {
		ok('the entry script parses (its imports are browser-resolved, so Node stops at resolution)');
	} else {
		fail(`the entry script failed to parse or evaluate: ${code ?? ''} ${error.message}`);
	}
}

// NFR-6. These are the constructs that would mean context isolation had been defeated: a page that can
// `require` or read `process.env` is not a page any more.
//
// The needles are escaped with `RegExp.escape` rather than by hand: `require(` contains a group-opening
// parenthesis, and hand-escaping only the dot produced an invalid pattern that threw *inside the
// verifier*. A verifier that crashes on its own check is worse than no check, because the build then
// reports a failure that is not the code's fault.
for (const forbidden of ['require(', 'process.env', '__dirname']) {
	if (new RegExp(`(^|[^.\\w])${RegExp.escape(forbidden)}`).test(entry)) {
		fail(`the entry script uses ${forbidden}, which a sandboxed renderer cannot have`);
	}
}
if (failures === 0) {
	ok('the entry script stays inside the sandbox');
}

// ---------------------------------------------------------------------------------------------
// 3. Every module the entry imports must have been built, and the renderer must not have reached
//    into the main process — the one-way dependency rule the whole architecture rests on.
// ---------------------------------------------------------------------------------------------
const imports = [...entry.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
if (imports.length === 0) {
	fail('the entry script imports nothing, which cannot be right');
}
for (const specifier of imports) {
	if (specifier.startsWith('node:') || specifier === 'electron') {
		fail(`the renderer imports ${specifier}, which the sandbox forbids (NFR-6)`);
		continue;
	}
	if (!specifier.startsWith('.')) {
		continue;
	}
	const resolved = join(rendererDir, specifier);
	if (!existsSync(resolved)) {
		fail(`the renderer imports ${specifier}, which was not built as ${resolved}`);
	}
}
if (failures === 0) {
	ok(`every import resolves (${imports.length} module${imports.length === 1 ? '' : 's'})`);
}

// ---------------------------------------------------------------------------------------------
// 4. The main process's own entry must exist alongside, because a missing preload is a blank window
//    with a console error nobody is watching.
// ---------------------------------------------------------------------------------------------
const preloadPath = join(dist, 'preload', 'preload.cjs');
if (!existsSync(preloadPath)) {
	fail('dist/preload/preload.cjs is missing — the window would open with no bridge');
} else {
	ok('the preload bridge was built');
}

const mainCjs = join(dist, 'main', 'main.cjs');
if (!existsSync(mainCjs)) {
	fail('dist/main/main.cjs is missing — there is nothing to launch');
} else {
	// The main process reaches its pure ESM modules with a dynamic `import()`. TypeScript's plain
	// CommonJS target *downlevels that to `require()`*, which cannot load ESM — so a build that emits
	// `require('./config.js')` here would fail at startup with ERR_REQUIRE_ESM. `tsconfig.main.json`
	// sets `module: Node16` for that reason, and this asserts the emitted form rather than trusting it.
	const mainSource = readFileSync(mainCjs, 'utf-8');
	if (/require\(\s*["']\.\/config\.js["']\s*\)/.test(mainSource)) {
		fail('main.cjs requires its ESM config module — the dynamic import() was downlevelled');
	} else if (!/import\(\s*["']\.\/config\.js["']\s*\)/.test(mainSource)) {
		fail('main.cjs neither imports nor requires its config module; one of the two should be there');
	} else {
		ok('main.cjs keeps a real dynamic import() for its ESM modules');
	}
}

// The shortcut opens widget.html, not the Electron page. It has to be a classic script: the
// module page cannot be double-clicked, because file:// module imports are blocked.
const widgetHtmlPath = join(rendererDir, 'widget.html');
const widgetJsPath = join(rendererDir, 'widget.js');
if (!existsSync(widgetHtmlPath) || !existsSync(widgetJsPath)) {
	fail('dist/renderer/widget.html or widget.js is missing — the desktop shortcut would open nothing');
} else {
	const widgetHtml = readFileSync(widgetHtmlPath, 'utf-8');
	if (!widgetHtml.includes('id="desk"') || !widgetHtml.includes('id="board"') || !widgetHtml.includes('./widget.js')) {
		fail('widget.html is not the board page');
	} else if (!widgetHtml.includes('./styles.css') || !existsSync(join(rendererDir, 'styles.css'))) {
		fail('widget.html is missing its stylesheet');
	} else {
		ok('the shortcut page is present');
	}
	const widgetJs = readFileSync(widgetJsPath, 'utf-8');
	if (!widgetJs.includes("window.__modules.require('renderer/index')")) {
		fail('widget.js never starts the board');
	} else {
		try {
			new (await import('node:vm')).Script(widgetJs);
			ok('the shortcut script parses');
		} catch (error) {
			fail(`widget.js failed to parse: ${error.message}`);
		}
	}
}

console.log(
	failures === 0
		? '\nwidget page verification passed'
		: `\nwidget page verification FAILED (${failures} problem${failures === 1 ? '' : 's'})`,
);
process.exit(failures === 0 ? 0 : 1);
