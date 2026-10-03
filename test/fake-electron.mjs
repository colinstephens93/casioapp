/**
 * A recording stand-in for Electron, for testing the shell's wiring without a desktop.
 *
 * ## Why this exists
 *
 * The Electron shell is ~1 100 lines that has never executed: DSH runs commands on a non-interactive
 * desktop and Chromium needs the named pipes the sandbox forbids (`docs/ENVIRONMENT.md` §4). A unit
 * test cannot fix that. What it *can* fix is the specific, likely, and otherwise invisible class of bug
 * in code that cannot be run: **the option was spelled wrong.**
 *
 * `nodeIntegration` versus `nodeintegration`; `skipTaskbar` set on the wrong object; an `alwaysOnTop`
 * level Electron does not accept. None of these is a type error — every option is optional — so none is
 * caught by `tsc`, and the symptom at runtime is "the window is in the taskbar" rather than a crash
 * pointing at a line. So the fake **records** what it is handed and the tests assert on the record.
 *
 * ## What this shows, and what it does not
 *
 * It shows the code passes the values it intends to the API it believes it is calling. It does not show
 * that Electron *honours* them: whether `skipTaskbar` really removes the taskbar entry, or whether
 * `scenario="alarm"` really survives Focus Assist, is a question about Windows. That half is on a
 * desktop, and `docs/ENVIRONMENT.md` §9 is the checklist.
 *
 * ## How the interception works
 *
 * `module.registerHooks` (Node 22.15+) hooks `require` as well as `import`, synchronously and
 * in-process. The `resolve` hook rewrites the specifier `electron` to a private URL; the `load` hook
 * returns the fake's source from that URL. The modules tested are the **built** `.cjs` files in `dist/`,
 * because those are what ship — testing the sources would test a different artifact.
 *
 * The ESM loader's `register()` cannot do this: `.cjs` files are CommonJS and the ESM loader refuses
 * them outright ("Unknown file extension .cjs"), so there is no way to import one in order to hook it.
 *
 * ## Why plain JavaScript
 *
 * A `load` hook must return its source **synchronously**, so it cannot import this file to get at the
 * classes — and a hook cannot return TypeScript, since nothing strips it. The fake is therefore plain
 * JS, and the classes are published on `globalThis` under a documented key so the hook's generated
 * source can reach them. That is the whole reason for the indirection, and it is the only reason.
 */

import { registerHooks, createRequire } from 'node:module';
import { join } from 'node:path';

/** `createRequire`, because these are `.cjs` files and the ESM loader refuses the extension outright. */
const require = createRequire(import.meta.url);

/**
 * Drops the built shell modules from the require cache.
 *
 * The fake's identity is fixed when a module is first required, so a test that installs a *different*
 * fake would otherwise keep seeing the previous one. Only `dist/main` and `dist/preload` are touched —
 * clearing the whole cache would re-evaluate unrelated modules mid-suite.
 */
export function clearShellCache() {
	for (const key of Object.keys(require.cache)) {
		if (key.includes('dist') && (key.includes('main') || key.includes('preload'))) {
			delete require.cache[key];
		}
	}
}

/** The private URL the `electron` specifier is rewritten to. */
const FAKE_URL = 'casioapp-fake:electron';
/** Where the fake's internals are published for the hook's generated source to find. */
const BRIDGE_KEY = '__casioappElectron';

/** A fresh record. */
export function newRecord() {
	return {
		/** Every `BrowserWindow` construction, in order. */
		windows: [],
		/** The path handed to `app.setAppUserModelId`, if it was called. */
		appUserModelId: null,
		/** Every `app.commandLine.appendSwitch` argument. */
		switches: [],
		/** Every `tray.setToolTip` argument. */
		tooltips: [],
		/** Every `tray.setContextMenu` template, in order — one per rebuild. */
		trayMenus: [],
		/** Every `nativeImage.createFromDataURL` argument. */
		trayIcons: [],
		/** Every `Notification` construction, as the options it was given. */
		notifications: [],
		/** Every `ipcMain.on` / `ipcMain.handle` channel, so the bridge's surface can be audited. */
		ipcChannels: [],
		/** Every `shell.*` call. */
		shellCalls: [],
		/** Every `dialog.showMessageBox` argument. */
		dialogs: [],
		/** The `url` of every `loadFile`, in order. */
		loadedFiles: [],
		/** Every `setAlwaysOnTop` call on any window, in order. */
		alwaysOnTop: [],
		/** How many times `Menu.popup` was called. */
		menusPopped: 0,
		/** Every `webContents.send`, so the renderer-facing messages can be checked. */
		messages: [],
	};
}

/**
 * A fake window. Records what it is told and lets a test fire the events Electron would.
 *
 * `emit` fires whatever handlers were registered, so a typo in the shell's own `on('ready-to-show')`
 * shows up as an event with no listeners rather than as a silently skipped step.
 */
class FakeBrowserWindow {
	constructor(options, record) {
		this.options = options;
		this.record = record;
		this.handlers = new Map();
		this.visible = false;
		this.destroyed = false;
		record.windows.push(options);

		this.webContents = {
			send: (channel, payload) => {
				record.messages.push({ channel, payload });
			},
			setWindowOpenHandler: (handler) => {
				this.webContents.openHandler = handler;
			},
			openHandler: null,
		};
	}

	static getAllWindows() {
		return [];
	}

	on(event, handler) {
		const list = this.handlers.get(event) ?? [];
		list.push(handler);
		this.handlers.set(event, list);
		return this;
	}

	once(event, handler) {
		const wrapped = (...args) => {
			this.handlers.set(
				event,
				(this.handlers.get(event) ?? []).filter((candidate) => candidate !== wrapped),
			);
			handler(...args);
		};
		return this.on(event, wrapped);
	}

	/** Fires every handler registered for an event, the way Electron would. */
	emit(event, ...args) {
		for (const handler of this.handlers.get(event) ?? []) {
			handler(...args);
		}
	}

	/** True when anything is listening, so a missing handler is assertable. */
	hasHandler(event) {
		return (this.handlers.get(event) ?? []).length > 0;
	}

	isVisible() {
		return this.visible;
	}

	show() {
		this.visible = true;
		this.emit('show');
	}

	hide() {
		this.visible = false;
		this.emit('hide');
	}

	getBounds() {
		const options = this.options;
		return {
			x: options.x ?? 0,
			y: options.y ?? 0,
			width: options.width ?? 0,
			height: options.height ?? 0,
		};
	}

	setBounds(bounds) {
		this.options.x = bounds.x;
		this.options.y = bounds.y;
		this.options.width = bounds.width;
		this.options.height = bounds.height;
	}

	setAlwaysOnTop(flag, level) {
		// Recorded rather than stored, so a test reads the *sequence*: WIN-5's yield is a transition, and
		// only the order of calls shows whether the level was dropped and then put back.
		this.record.alwaysOnTop.push(level === undefined ? { flag } : { flag, level });
	}

	destroy() {
		this.destroyed = true;
	}

	/**
	 * Electron exposes `isDestroyed()` as a **method**, not a property.
	 *
	 * This was a property here, which made `!window.isDestroyed` in the `getAllWindows` filter read an
	 * always-undefined value and therefore always be true — so a destroyed window kept counting as live
	 * and the shell's `activate` guard never fired. A fake that is subtly the wrong *shape* is worse than
	 * no fake, because the assertion still runs and still passes or fails for the wrong reason.
	 */
	isDestroyed() {
		return this.destroyed;
	}

	loadFile(url) {
		this.record.loadedFiles.push(url);
		return Promise.resolve();
	}
}

/** A fake tray. */
class FakeTray {
	constructor(record) {
		this.record = record;
		this.tooltip = null;
		this.menu = null;
		this.destroyed = false;
	}

	setToolTip(text) {
		this.tooltip = text;
		this.record.tooltips.push(text);
	}

	setContextMenu(menu) {
		this.menu = menu;
		// The template is what was passed to `Menu.buildFromTemplate`, which the fake returns verbatim,
		// so this is the menu's *shape* rather than an opaque object.
		this.record.trayMenus.push(menu);
	}

	on() {
		return this;
	}

	destroy() {
		this.destroyed = true;
	}
}

/** A fake `Notification`, recording the options it was constructed with. */
class FakeNotification {
	constructor(options, record) {
		this.options = options;
		this.handlers = new Map();
		this.shown = false;
		record.notifications.push(options);
	}

	static isSupported() {
		return (globalThis[BRIDGE_KEY]?.notificationsSupported ?? true);
	}

	on(event, handler) {
		const list = this.handlers.get(event) ?? [];
		list.push(handler);
		this.handlers.set(event, list);
		return this;
	}

	show() {
		this.shown = true;
	}

	/** Fires a handler, so a test can simulate the shell refusing the toast. */
	emit(event, ...args) {
		for (const handler of this.handlers.get(event) ?? []) {
			handler(...args);
		}
	}
}

/**
 * Installs the interception and returns the fake.
 *
 * ## Once per process, and that is not a suggestion
 *
 * `registerHooks` is **cumulative**: every call adds another hook to the chain, and a `shortCircuit`
 * return means the later hooks never run. So installing the fake once per test does not give each test
 * its own fake — it makes every test read the *first* fake's record while the others stay empty. The
 * symptoms are memorable and misleading: 20 failures with "the level was set at all" and "one window on
 * a normal boot", pointing at the shell rather than at the test.
 *
 * Install once, at module scope, and call `reset()` between tests. `reset()` clears the record and, most
 * importantly, re-arms `whenReady` — that promise resolves once, so a second boot of `main.cjs` without
 * re-arming would hang forever waiting for an app that is already ready.
 */
export function installFakeElectron(options = {}) {
	// Mutable, because a single install has to survive many tests: `reset()` swaps the record and
	// re-arms `whenReady`, and `options` can be re-pointed per test.
	let settings = { ...options };
	let record = newRecord();
	const trays = [];
	const appHandlers = new Map();
	const ipcHandlers = new Map();

	let lastWindow = null;
	let readyResolve = null;
	let readyPromise = makeReadyPromise();

	function makeReadyPromise() {
		return new Promise((resolve) => {
			readyResolve = resolve;
		});
	}

	const app = {
		whenReady: () => readyPromise,
		ready: () => readyResolve?.(),
		requestSingleInstanceLock: () => settings.singleInstanceLock ?? true,
		on(event, handler) {
			const list = appHandlers.get(event) ?? [];
			list.push(handler);
			appHandlers.set(event, list);
		},
		emit(event, ...args) {
			for (const handler of appHandlers.get(event) ?? []) {
				handler(...args);
			}
		},
		quitCalled: false,
		quit() {
			app.quitCalled = true;
		},
		getPath(name) {
			if (name === 'userData') {
				return settings.userData ?? process.cwd();
			}
			return process.cwd();
		},
		getName: () => 'casioapp',
		setAppUserModelId(id) {
			record.appUserModelId = id;
		},
		commandLine: {
			appendSwitch(name) {
				record.switches.push(name);
			},
		},
	};

	const bridge = {
		app,
		trays,
		ipcHandlers,
		/** Every window ever constructed, including destroyed ones. */
		liveWindows: [],
		FakeBrowserWindow,
		FakeTray,
		FakeNotification,
		/**
		 * Read dynamically by the generated module on every call, not captured.
		 *
		 * This is the difference between a fake that can be reset and one that cannot: the generated
		 * source is evaluated once and lives in the require cache, so anything it captured at that moment
		 * would be frozen for the whole run.
		 */
		get record() {
			return record;
		},
		get notificationsSupported() {
			return settings.notificationsSupported ?? true;
		},
		setLastWindow(window) {
			lastWindow = window;
		},
		getLastWindow() {
			return lastWindow;
		},
	};
	globalThis[BRIDGE_KEY] = bridge;

	// The source the loader evaluates for `require('electron')` inside the shell. It reads the bridge off
	// `globalThis` because a synchronously-built module has no closure over this function's locals — and
	// it reads the *record* through the bridge on every use rather than destructuring it once, because a
	// destructured `const record` would capture the first test's record and never see a reset.
	//
	// `getAllWindows` filters out destroyed windows, which is what Electron does and what `main.cts` uses
	// to decide whether an `activate` needs a new window. A fake that always answered "none" would make
	// the shell open a second window on every activate — the first version did, and it made a correct
	// guard look like a bug. No comment is written inside this literal: a backtick or a quote in one
	// terminates the template, which is how this broke the first time.
	const fakeSource = `
const b = globalThis[${JSON.stringify(BRIDGE_KEY)}];
const { app, trays, ipcHandlers, FakeBrowserWindow, FakeTray, FakeNotification } = b;

class BrowserWindow extends FakeBrowserWindow {
	constructor(options) { super(options, b.record); b.setLastWindow(this); b.liveWindows.push(this); }
	static getAllWindows() { return b.liveWindows.filter((window) => !window.isDestroyed()); }
}

class Tray extends FakeTray {
	constructor() { super(b.record); trays.push(this); }
}

class Notification extends FakeNotification {
	constructor(options) { super(options, b.record); }
	static isSupported() { return b.notificationsSupported; }
}

const display = () => ({
	id: 1,
	bounds: { x: 0, y: 0, width: 1920, height: 1080 },
	workArea: { x: 0, y: 0, width: 1920, height: 1040 },
});

module.exports = {
	app,
	BrowserWindow,
	Tray,
	Notification,
	Menu: {
		buildFromTemplate: (template) => template,
		popup: () => { b.record.menusPopped += 1; },
	},
	ipcMain: {
		on: (channel, handler) => { ipcHandlers.set(channel, handler); b.record.ipcChannels.push(channel); },
		handle: (channel, handler) => { ipcHandlers.set(channel, handler); b.record.ipcChannels.push(channel); },
	},
	dialog: {
		showMessageBox: (opts) => { b.record.dialogs.push(opts); return Promise.resolve({ response: 0 }); },
	},
	shell: {
		showItemInFolder: (p) => { b.record.shellCalls.push({ method: 'showItemInFolder', args: [p] }); },
		openExternal: (u) => { b.record.shellCalls.push({ method: 'openExternal', args: [u] }); },
	},
	nativeImage: {
		createFromDataURL: (url) => { b.record.trayIcons.push(url); return { isEmpty: () => false }; },
	},
	screen: {
		getPrimaryDisplay: display,
		getAllDisplays: () => [display()],
		getDisplayMatching: display,
		getDisplayNearestPoint: display,
		getCursorScreenPoint: () => ({ x: 10, y: 10 }),
	},
};
`;

	registerHooks({
		resolve(specifier, context, next) {
			if (specifier !== 'electron') {
				return next(specifier, context);
			}
			// Only our own compiled shell is intercepted. A hook that rewrote `electron` everywhere would
			// misrepresent anything else in the process that wanted the real module.
			const parent = (context.parentURL ?? '').replace(/\\/g, '/');
			if (!parent.includes('/dist/main/') && !parent.includes('/dist/preload/')) {
				return next(specifier, context);
			}
			return { url: FAKE_URL, shortCircuit: true };
		},
		load(url, context, next) {
			if (url === FAKE_URL) {
				return { format: 'commonjs', source: fakeSource, shortCircuit: true };
			}
			return next(url, context);
		},
	});

	return {
		/** The live record. A getter, because `reset()` replaces it. */
		get record() {
			return record;
		},
		app,
		trays,
		lastWindow: () => lastWindow,
		/** Fires the IPC listener registered for a channel, as the renderer's message would. */
		invoke(channel, ...args) {
			const handler = ipcHandlers.get(channel);
			if (!handler) {
				throw new Error(`no IPC handler is registered for ${channel}`);
			}
			return handler(...args);
		},
		/**
		 * Starts a test from a clean slate.
		 *
		 * Three things have to be cleared, and each has bitten: the **record**, or assertions see the
		 * previous test's calls; the **registered handlers**, or a re-boot adds a second set and one
		 * message fires two toasts; and **`whenReady`**, which resolves only once — a second boot against
		 * an already-resolved promise would hang rather than fail.
		 *
		 * `settings` is re-pointed too, so a test can toggle the single-instance lock or notification
		 * support without reinstalling the hooks.
		 */
		reset(next = {}) {
			settings = { ...options, ...next };
			record = newRecord();
			trays.length = 0;
			appHandlers.clear();
			ipcHandlers.clear();
			bridge.liveWindows.length = 0;
			lastWindow = null;
			app.quitCalled = false;
			readyPromise = makeReadyPromise();
			clearShellCache();
			return record;
		},
		/** The channels the shell registered, sorted, so the bridge's surface can be audited. */
		channels: () => [...ipcHandlers.keys()].sort(),
		/**
		 * Destroys every live window.
		 *
		 * The record holds the *options* each window was constructed with, not the windows themselves, so
		 * a test cannot reach them through it — the first version of this file tried and silently did
		 * nothing, which left a destroyed-window test asserting against a live window.
		 */
		destroyWindows() {
			for (const window of bridge.liveWindows) {
				if (!window.isDestroyed()) {
					window.destroy();
				}
			}
		},
	};
}

/**
 * Yields until the shell's startup chain has finished.
 *
 * `main.cts` boots through `app.whenReady().then(async () => …)` with several `await`s on dynamic
 * imports, so one tick is not enough. Real timers are drained rather than faked: the only timers on this
 * path are the config's debounce and the fullscreen poll, and the poll is `unref`ferenced so it cannot
 * hold the process open.
 */
export async function settle(ticks = 10) {
	for (let i = 0; i < ticks; i += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

/** The absolute path to a built artifact, for `require`. */
export function distPath(...parts) {
	return join(process.cwd(), 'dist', ...parts);
}

/**
 * Requires a built shell module with a fresh copy, so a test can re-boot `main.cjs`.
 *
 * `createRequire` is used rather than `import()`: these are `.cjs` files and the ESM loader refuses the
 * extension outright.
 */
export function freshRequire(path) {
	clearShellCache();
	return require(path);
}
