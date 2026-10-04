/**
 * The Electron main process.
 *
 * Owns the window, the tray, the config file and the notifications. It owns **no clock and no watch
 * logic**: the renderer runs `WatchController`, which is the same object the browser preview runs, and
 * this process only supplies the things a browser page cannot have — a window, a tray, a file, and a
 * Windows toast.
 *
 * That split is plan decision 1, and it is what makes nearly everything verifiable in a sandbox with
 * no desktop: the renderer is the whole watch, and it runs in a page.
 *
 * ## What the renderer sends up, and why so little
 *
 * Three things, and nothing else:
 *
 * 1. **An alert** — "alarm 3 fired at this instant, and the Home City reads +09:00". The renderer
 *    decides *that* an alarm fired; this process only needs enough to phrase a toast. Sending the zone
 *    rather than re-deriving it means the notification and the face cannot disagree about the time.
 * 2. **The watch's serialised state** — opaque to this process, which stores it verbatim. Persisting it
 *    *here* rather than in the renderer is what makes the settings a real file a human can edit
 *    (PRS-4), and what keeps `localStorage` out of the widget.
 * 3. **A context-menu request** — so the menu can be a native one (INT-7).
 *
 * Electron integration is the one part of this project that cannot be verified in the development
 * sandbox. `docs/ENVIRONMENT.md` §4 has the three diagnostics that established that, and §9 lists what
 * a human should check on a real desktop.
 */
import { BrowserWindow, Menu, app, dialog, ipcMain, shell } from 'electron';

// `resolution-mode` is required, not decorative: this file is CommonJS and the target is ESM, so
// TypeScript needs to be told which resolution rules to use for the *type* side. The runtime side is
// the dynamic `import()` below, which is the only construct that crosses that boundary.
import type { ConfigFile, WidgetConfig } from './config.ts' with { 'resolution-mode': 'import' };
import { Notifier } from './notifications.cjs';
import { WidgetTray } from './tray.cjs';
import { WidgetWindow } from './window.cjs';

/**
 * The pure modules, loaded dynamically.
 *
 * `config.ts` and `notify.ts` are **ESM** — that is what makes them unit-testable with no desktop —
 * while this file is CommonJS, because Electron's main process is. A dynamic `import()` is the one
 * construct that works in both directions, so the pure half is reached this way rather than by a
 * static `import`. The load starts here, at module scope, and is awaited in `whenReady`; the app's own
 * `commandLine` and AppUserModelID calls below are the only things that must happen synchronously.
 */
const pure = Promise.all([import('./config.js'), import('./notify.js')]);

let config: ConfigFile;
let widgetWindow: WidgetWindow | null = null;
let tray: WidgetTray | null = null;
let notifier: Notifier | null = null;

/**
 * A transparent window with no GPU compositing renders black on Windows, so this is a precondition
 * for WIN-1 rather than a tuning flag.
 *
 * The AppUserModelID for ALM-10 is set in `whenReady` instead, because it comes from the `notify.ts`
 * module that is loaded with a dynamic `import()`. Electron's documentation asks for it "before the app
 * is ready"; what actually matters is that it is set before the first toast, which is what the
 * sequencing below guarantees — nothing can raise one before `whenReady` completes.
 */
app.commandLine.appendSwitch('enable-transparent-visuals');

/** Set once the user has chosen Quit, so a window `close` event stops being intercepted. */
let quitting = false;
/** The renderer's last reported state, so a window move does not lose it (PRS-1). */
let watchState = '';

/** The current configuration, or the defaults when the file could not be read. */
let current: WidgetConfig | null = null;

/**
 * The current configuration, never null after startup.
 *
 * A getter rather than a plain variable so the type cannot be "possibly null" in a dozen places that
 * all run after `loadOrCreate`.
 */
function settings(): WidgetConfig {
	if (!current) {
		throw new Error('the configuration was read before startup');
	}
	return current;
}

function loadOrCreate(ConfigFileClass: typeof ConfigFile, fallback: WidgetConfig): WidgetConfig {
	config = new ConfigFileClass({ directory: app.getPath('userData') });
	const result = config.load();
	current = result.config;

	if (result.readOnly) {
		// A file from a newer build. Running with defaults and leaving the file alone is the only
		// option that does not destroy settings the user's other install understands; saying so out
		// loud is the difference between that and a bug report about lost alarms.
		void dialog.showMessageBox({
			type: 'info',
			title: 'casioapp',
			message: 'Your settings file was written by a newer version of casioapp.',
			detail: `It has been left untouched at:\n${config.filePath}\n\nThis session is running with default settings and will not save over it.`,
			buttons: ['OK'],
		});
	} else if (result.repaired) {
		// Silently repaired is the right default (PRS-4 asks for a fallback, not a prompt), but the
		// first-run case is indistinguishable from a corrupt file at this point, so nothing is written
		// until something actually changes.
		console.log('casioapp: settings were missing or partial; defaults in use');
	}

	return current;
}

/** Writes the configuration, swallowing failure: a widget that cannot save is still a clock. */
function save(overrides: Partial<WidgetConfig> = {}): void {
	if (!current) {
		return;
	}
	current = { ...current, ...overrides, watch: watchState };
	if (!config.save(current)) {
		console.warn('casioapp: could not save the configuration');
	}
}

/**
 * Records the window's rectangle.
 *
 * Called on `moved` and `resized`, which fire continuously during a drag. Writing on every one would
 * be hundreds of writes and would defeat NFR-11's caution about truncation by sheer volume, so the
 * write is debounced. `save` on quit flushes it, which is why the timer does not need to be exact.
 */
let boundsTimer: ReturnType<typeof setTimeout> | null = null;
function rememberBounds(): void {
	if (boundsTimer !== null) {
		clearTimeout(boundsTimer);
	}
	boundsTimer = setTimeout(() => {
		boundsTimer = null;
		const bounds = widgetWindow?.bounds();
		if (bounds) {
			save({ bounds });
		}
	}, 400);
}

async function createWindow(configuration: WidgetConfig, startHidden: boolean): Promise<WidgetWindow> {
	const window = new WidgetWindow({
		onVisibilityChanged: () => tray?.rebuild(),
		// WIN-3: closing hides. The tray is the way out, and a widget with no taskbar entry that really
		// closed would be unreachable until the next login.
		onCloseRequested: () => widgetWindow?.hide(),
	});

	// Asynchronous because the pure configuration module is ESM and is reached by a dynamic `import()`.
	const browser = await window.create(configuration, startHidden);

	// WIN-9: persist the rectangle. Both events, because a move without a resize and a resize without
	// a move are the two ordinary cases.
	browser.on('moved', rememberBounds);
	browser.on('resized', rememberBounds);

	return window;
}

/** The tray menu's "Settings…": reveal the config file rather than opening a settings UI. */
function openSettings(): void {
	// Out of scope item 4: there is deliberately no settings UI inside the widget. The file *is* the
	// settings, and showing the user where it lives is more useful than a window that reimplements it.
	void shell.showItemInFolder(config.filePath);
}

function createTray(): WidgetTray {
	const created = new WidgetTray({
		onToggleVisibility: () => widgetWindow?.toggle(),
		onResetPosition: () => {
			widgetWindow?.resetPosition();
			rememberBounds();
		},
		onSettings: openSettings,
		onQuit: () => {
			quitting = true;
			app.quit();
		},
		isVisible: () => widgetWindow?.isVisible ?? false,
	});

	created.create();
	return created;
}

/**
 * The IPC surface (NFR-6).
 *
 * Three channels, and each one is a requirement rather than a convenience. There is no channel that
 * lets the renderer run a command, read a file, or reach Node — the renderer is a page, and it stays
 * one.
 */
function registerIpc(): void {
	// ALM-10. The renderer says an alarm fired and what the Home City reads; the toast is phrased here.
	ipcMain.on('widget:alert', (_event, payload: unknown) => {
		const request = parseAlert(payload);
		if (!request) {
			return;
		}
		notifier?.show(request.request, request.at, request.homeOffset);
	});

	// PRS-1. The watch's state, opaque to this process, stored verbatim.
	ipcMain.on('widget:state', (_event, value: unknown) => {
		if (typeof value !== 'string') {
			return;
		}
		watchState = value;
		save();
	});

	// INT-7. The page asks for the native menu rather than popping an HTML one: a widget with no window
	// chrome should not grow a second chrome when right-clicked.
	ipcMain.on('widget:menu', () => {
		showContextMenu();
	});

	// The corner grip. A transparent frameless window has no edge to drag, so the page asks for a
	// size and `resizeTo` refuses anything outside the limit. It cannot move or close the window.
	ipcMain.on('widget:size', (_event, value: unknown) => {
		if (typeof value !== 'object' || value === null) {
			return;
		}
		const candidate = value as { width?: unknown; height?: unknown };
		if (typeof candidate.width !== 'number' || typeof candidate.height !== 'number') {
			return;
		}
		widgetWindow?.resizeTo(candidate.width, candidate.height);
	});

	// The renderer's restored state on startup, so it can resume the mode it was left in (MOD-6).
	ipcMain.handle('widget:restore', () => {
		const stored = settings();
		return {
			watch: stored.watch,
			battery: stored.battery,
			configPath: config.filePath,
		};
	});

	// NFR-6: no renderer-initiated window control. Quit and Show/Hide live in the tray, which is the
	// requirements' own model, so there is no `widget:quit` channel to abuse.
	void BrowserWindow;
}

/** Validates an alert message from the renderer, which is untrusted input like any other. */
function parseAlert(
	payload: unknown,
): { request: { kind: 'alarm' | 'timer'; alarmId?: number }; at: Date; homeOffset: number } | null {
	if (typeof payload !== 'object' || payload === null) {
		return null;
	}
	const candidate = payload as {
		kind?: unknown;
		alarmId?: unknown;
		at?: unknown;
		homeOffset?: unknown;
	};

	if (candidate.kind !== 'alarm' && candidate.kind !== 'timer') {
		return null;
	}
	if (typeof candidate.at !== 'number' || !Number.isFinite(candidate.at)) {
		return null;
	}
	if (typeof candidate.homeOffset !== 'number' || !Number.isFinite(candidate.homeOffset)) {
		return null;
	}

	const alarmId = typeof candidate.alarmId === 'number' ? candidate.alarmId : undefined;
	return {
		request: alarmId === undefined ? { kind: candidate.kind } : { kind: candidate.kind, alarmId },
		at: new Date(candidate.at),
		homeOffset: candidate.homeOffset,
	};
}

/**
 * The context menu (INT-7).
 *
 * A native menu rather than an HTML one, because a widget with no window chrome should not grow a
 * second chrome when right-clicked. The four items are the requirement's, and two of them are
 * forwarded to the renderer because the watch state they change lives there.
 */
function showContextMenu(): void {
	const menu = Menu.buildFromTemplate([
		{ label: 'Settings…', click: openSettings },
		{ type: 'separator' },
		{ label: 'Hide', click: () => widgetWindow?.hide() },
		{
			label: 'Quit casioapp',
			click: () => {
				quitting = true;
				app.quit();
			},
		},
	]);

	const window = widgetWindow?.browserWindow;
	if (window) {
		menu.popup({ window });
	}
}

// A second instance would fight the first over the config file and produce two clocks, so it raises
// the existing window instead. The tray can hide the widget, so this is the only way back for someone
// who launches the app again rather than finding the tray icon.
if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on('second-instance', () => {
		widgetWindow?.show();
		tray?.rebuild();
	});

	void app.whenReady().then(async () => {
		const [configModule, notifyModule] = await pure;

		// ALM-10. Windows attributes a toast to an AppUserModelID; without one the toast is dropped, or
		// shown as `electron.exe` — in which case Focus Assist and the notification settings that the
		// requirement wants respected belong to the wrong application. It is set here rather than at
		// module scope only because it comes from the dynamically-loaded module; nothing can raise a
		// toast before this line runs.
		app.setAppUserModelId(notifyModule.APP_USER_MODEL_ID);

		const configuration = loadOrCreate(configModule.ConfigFile, configModule.defaultConfig());

		notifier = new Notifier({
			onClick: () => {
				widgetWindow?.show();
				tray?.rebuild();
			},
			onUnsupported: (reason) => {
				// ALM-11 pairs the toast with an on-face animation precisely so the alarm is visible when
				// the toast is not — so a refusal is logged rather than swallowed.
				console.warn(`casioapp: the notification was not shown (${reason})`);
			},
		});

		widgetWindow = await createWindow(configuration, configuration.hidden);
		tray = createTray();
		registerIpc();

		// A second window after the first was closed needs the same wiring, which is why this creates
		// one rather than re-showing a destroyed object.
		app.on('activate', () => {
			if (BrowserWindow.getAllWindows().length === 0) {
				void createWindow(settings(), false).then((created) => {
					widgetWindow = created;
					registerIpc();
				});
			}
		});
	});
}

/** Flushes the pending write and records the final state before the process ends (PRS-1). */
app.on('before-quit', () => {
	quitting = true;
	if (boundsTimer !== null) {
		clearTimeout(boundsTimer);
		boundsTimer = null;
	}
	const bounds = widgetWindow?.bounds();
	const hidden = !(widgetWindow?.isVisible ?? true);
	save(bounds ? { bounds, hidden } : { hidden });
});

app.on('window-all-closed', () => {
	// Deliberately *not* quitting: WIN-3 makes the widget tray-resident, so closing the window hides
	// it and the tray keeps the process alive. The tray's Quit is the way out.
	void quitting;
});

app.on('will-quit', () => {
	tray?.destroy();
	widgetWindow?.destroy();
});

// `showContextMenu` is deliberately not exported: it closes over `widgetWindow`, so it only means
// anything inside a running app. The pure rules it depends on — the window clamping, the notification
// phrasing — live in `config.ts` and `notify.ts` and *are* exported, because those are the parts a test
// can drive without a desktop.
export { showContextMenu };
