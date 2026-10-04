/**
 * The window: frameless, transparent, tray-resident, and never above a fullscreen app.
 *
 * Requirements WIN-1...WIN-10 and PRS-1. The window is the one part of this project that cannot be
 * verified in the development sandbox — DSH runs on a non-interactive desktop and Chromium needs the
 * named pipes the sandbox forbids (see `docs/ENVIRONMENT.md` section 4) — so this file is written to be
 * *reviewable* rather than clever: every decision below cites the requirement it serves, and the parts
 * that are decidable without a desktop live in `config.ts`, where they are unit-tested.
 *
 * ## The Windows traps this file exists to avoid
 *
 * 1. **Alt+Tab and the taskbar** (WIN-4). `skipTaskbar: true` handles the taskbar. Alt+Tab additionally
 *    needs the window to be *unowned*, which it is: nothing here sets a `parent`.
 * 2. **Always-on-top that yields to fullscreen** (WIN-5). This is the one the plan flags as risk R-4.
 *    A `screen-saver` level stays above everything including games and films, which is exactly what
 *    WIN-5 forbids, so the `normal` level is used and the yield is *enforced* rather than assumed by
 *    `enforceFullscreenYield`.
 * 3. **A transparent window swallowing clicks** (plan risk R-3). A fully transparent frameless window
 *    is an invisible box that eats every click over its rectangle. The case is opaque but the letterbox
 *    around it is not, and that is handled where the geometry is known: the renderer.
 *
 * ## Why the page fills the window
 *
 * The board is a terminal panel, not a fixed-aspect watch case, so the page paints the whole
 * rectangle. Transparency stays on so the rounded corners show the desktop rather than a square
 * of window chrome. Size is clamped a little either side of the default: the panel has to stay
 * legible, and it is not meant to become a full-screen application.
 */
import { BrowserWindow, screen, shell } from 'electron';
import { join } from 'node:path';

// A type-only import from a CommonJS file to an ESM one needs `resolution-mode`, because TypeScript
// otherwise applies CommonJS resolution rules to the types and refuses the target. The runtime half is
// the dynamic `import()` below, which is the only construct that crosses that boundary.
import type { Bounds, WidgetConfig } from './config.ts' with { 'resolution-mode': 'import' };

/**
 * The pure configuration module, loaded dynamically.
 *
 * `config.ts` is **ESM** — that is what makes its clamping rules unit-testable with no desktop — while
 * this file is CommonJS, because Electron's main process is. A dynamic `import()` is the one construct
 * that works in both directions, so the pure half is reached this way rather than by a static
 * `import`. It resolves before the first window is created, which is the only point that needs it.
 */
const configModule = import('./config.js');

/** The board's own black, so a moment before the first paint is not a white flash. */
const LETTERBOX = '#070a08';

/**
 * How far the window may move from its default size.
 *
 * A transparent frameless window has no native edge to grab, so the page asks for a size and this
 * is the limit that request is allowed to reach.
 */
const WINDOW_LIMIT = { minWidth: 760, minHeight: 540, maxWidth: 1100, maxHeight: 780 } as const;

function clampDimension(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, Math.round(value)));
}

export interface WindowCallbacks {
	/** Fired when the window is hidden or shown, so the tray's label can follow. */
	onVisibilityChanged?(visible: boolean): void;
	/** Fired when the user asks to close, which means "hide" rather than "quit". */
	onCloseRequested?(): void;
}

/**
 * The widget's window.
 *
 * One instance, created once and hidden rather than destroyed, because WIN-3's tray toggle has to be
 * able to bring it back and re-creating a `BrowserWindow` would lose the renderer's live state.
 */
export class WidgetWindow {
	private window: BrowserWindow | null = null;
	/** True while the window level has been dropped for a fullscreen application (WIN-5). */
	private yieldedToFullscreen = false;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private readonly callbacks: WindowCallbacks;
	/** `clampToWorkAreas` and `MIN_SIZE`, resolved from the ESM module above. */
	private pure: typeof import('./config.ts', { with: { 'resolution-mode': 'import' } }) | null = null;

	constructor(callbacks: WindowCallbacks = {}) {
		this.callbacks = callbacks;
	}

	get browserWindow(): BrowserWindow | null {
		return this.window;
	}

	get isVisible(): boolean {
		return this.window?.isVisible() ?? false;
	}

	/**
	 * Creates the window.
	 *
	 * Asynchronous only because the pure module is loaded with a dynamic `import()`; the caller awaits
	 * it once, at startup.
	 *
	 * `show: false` with a `ready-to-show` handler rather than an immediate `show()`: a transparent
	 * window shown before its first paint flashes a black or white rectangle, which for a desktop
	 * widget is worse than a moment's delay.
	 */
	async create(config: WidgetConfig, startHidden: boolean): Promise<BrowserWindow> {
		const pure = await configModule;
		this.pure = pure;

		const sized = {
			...config.bounds,
			width: clampDimension(config.bounds.width, WINDOW_LIMIT.minWidth, WINDOW_LIMIT.maxWidth),
			height: clampDimension(config.bounds.height, WINDOW_LIMIT.minHeight, WINDOW_LIMIT.maxHeight),
		};
		const bounds = pure.clampToWorkAreas(sized, currentWorkAreas());

		const window = new BrowserWindow({
			...bounds,
			frame: false,
			transparent: true,
			resizable: true,
			hasShadow: false,
			show: false,
			// WIN-4: no taskbar entry.
			skipTaskbar: true,
			// WIN-5: the *normal* level, never `screen-saver`. R-4 is the risk this avoids.
			alwaysOnTop: false,
			minWidth: WINDOW_LIMIT.minWidth,
			minHeight: WINDOW_LIMIT.minHeight,
			maxWidth: WINDOW_LIMIT.maxWidth,
			maxHeight: WINDOW_LIMIT.maxHeight,
			backgroundColor: LETTERBOX,
			title: 'World time',
			webPreferences: {
				preload: join(__dirname, '..', 'preload', 'preload.cjs'),
				// NFR-6: context isolation on, node integration off. The preload is the only surface.
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				// The face repaints once a second and not at all when idle (WIN-10), so throttling would
				// only ever delay a tick that is already scheduled.
				backgroundThrottling: false,
			},
		});

		// WIN-5, first half: the ordinary level, which yields to fullscreen by itself in the common case.
		window.setAlwaysOnTop(true, 'normal');

		window.once('ready-to-show', () => {
			if (!startHidden) {
				window.show();
			}
			// The tray label is derived from this, so it must be told even when we started hidden.
			this.callbacks.onVisibilityChanged?.(window.isVisible());
		});

		window.on('show', () => this.callbacks.onVisibilityChanged?.(true));
		window.on('hide', () => this.callbacks.onVisibilityChanged?.(false));

		// Closing hides rather than quits, because WIN-3 makes the tray the way out and a widget with no
		// taskbar entry that really closed would be unrecoverable until the next login.
		window.on('close', (event) => {
			event.preventDefault();
			this.callbacks.onCloseRequested?.();
		});

		// A widget has no web content of its own; a link that navigated the window away would leave a
		// blank case with no way back.
		window.webContents.setWindowOpenHandler(({ url }) => {
			void shell.openExternal(url);
			return { action: 'deny' };
		});

		void window.loadFile(join(__dirname, '..', 'renderer', 'index.html'));

		this.window = window;
		this.startFullscreenWatch();
		return window;
	}

	/** The window's current rectangle, in screen coordinates. */
	bounds(): Bounds | null {
		return this.window?.getBounds() ?? null;
	}

	/**
	 * Resizes from the page's corner grip.
	 *
	 * The renderer is not allowed to put the window anywhere, only to change its size, and only
	 * inside `WINDOW_LIMIT`. Position stays where the user dragged it.
	 */
	resizeTo(width: number, height: number): void {
		const window = this.window;
		if (!window || !Number.isFinite(width) || !Number.isFinite(height)) {
			return;
		}
		const current = window.getBounds();
		window.setBounds({
			x: current.x,
			y: current.y,
			width: clampDimension(width, WINDOW_LIMIT.minWidth, WINDOW_LIMIT.maxWidth),
			height: clampDimension(height, WINDOW_LIMIT.minHeight, WINDOW_LIMIT.maxHeight),
		});
	}

	show(): void {
		this.window?.show();
	}

	hide(): void {
		this.window?.hide();
	}

	toggle(): void {
		if (!this.window) {
			return;
		}
		if (this.window.isVisible()) {
			this.window.hide();
		} else {
			this.window.show();
		}
	}

	/**
	 * Re-clamps the window into a visible work area, for the tray's "reset position".
	 *
	 * This is the recovery path for a window on a disconnected monitor, and it is offered beyond WIN-3
	 * because the requirements' minimum tray menu has no way out of that state.
	 */
	resetPosition(): void {
		const pure = this.pure;
		if (!this.window || !pure) {
			return;
		}
		const areas = currentWorkAreas();
		const primary = areas[0];
		if (!primary) {
			return;
		}
		const current = this.window.getBounds();
		const centred: Bounds = {
			x: primary.x + Math.round((primary.width - current.width) / 2),
			y: primary.y + Math.round((primary.height - current.height) / 2),
			width: current.width,
			height: current.height,
		};
		this.window.setBounds(pure.clampToWorkAreas(centred, areas));
	}

	/** True while the window level has been dropped because a fullscreen app is in front (WIN-5). */
	get isYielding(): boolean {
		return this.yieldedToFullscreen;
	}

	destroy(): void {
		this.stopFullscreenWatch();
		this.window?.destroy();
		this.window = null;
	}

	/**
	 * Watches for a fullscreen application and drops the window level while one is in front.
	 *
	 * WIN-5 is explicit that the widget must not remain above fullscreen, and the plan flags
	 * "always-on-top will not yield to fullscreen on Windows" as risk R-4. The `normal` level is usually
	 * enough, but not reliably: Windows keeps a topmost window above a fullscreen app in some
	 * configurations, and a clock covering a film is precisely the failure the requirement forbids. So
	 * the level is *enforced* rather than assumed.
	 *
	 * Polling is the honest description. Electron exposes no event for "a fullscreen window appeared",
	 * and the alternative — a `SetWinEventHook` through a native module — is a C++ dependency this
	 * project does not have. The poll is one cheap comparison every two seconds, and it returns
	 * immediately while the widget is hidden, so it costs nothing in the tray.
	 */
	private startFullscreenWatch(): void {
		this.stopFullscreenWatch();
		this.pollTimer = setInterval(() => this.enforceFullscreenYield(), 2000);
		// Node timers hold the event loop open; this one must not keep the process alive on quit.
		this.pollTimer.unref?.();
	}

	private stopFullscreenWatch(): void {
		if (this.pollTimer !== null) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}

	private enforceFullscreenYield(): void {
		const window = this.window;
		if (!window || !window.isVisible()) {
			return;
		}

		const shouldYield = foregroundLooksFullscreen(window);
		if (shouldYield === this.yieldedToFullscreen) {
			return;
		}
		this.yieldedToFullscreen = shouldYield;
		if (shouldYield) {
			// Drop the level entirely rather than lowering it: `normal` is already the lowest topmost
			// level, so "not on top" is the only setting that cannot win against a fullscreen app.
			window.setAlwaysOnTop(false);
		} else {
			window.setAlwaysOnTop(true, 'normal');
		}
	}
}

/** A work area, as `clampToWorkAreas` expects it. */
type WorkArea = ReturnType<typeof screen.getPrimaryDisplay>['workArea'];

/**
 * The work areas of every attached display, primary first.
 *
 * All of them, not a union: the union of two displays side by side also covers the gap between them,
 * and a window restored into that gap is invisible.
 */
function currentWorkAreas(): WorkArea[] {
	const primary = screen.getPrimaryDisplay();
	const others = screen.getAllDisplays().filter((display) => display.id !== primary.id);
	return [primary, ...others].map((display) => display.workArea);
}

/**
 * True when the display the window is on has no work area left, which is what a fullscreen app leaves.
 *
 * ## This is an approximation, and it is labelled as one
 *
 * Electron exposes no foreground-window handle: there is no `getForegroundWindow()` equivalent, and
 * `BrowserWindow.getFocusedWindow()` only ever returns *our* windows, so it cannot see the film the
 * user is watching. The reliable API is Windows' `GetForegroundWindow` plus `GetWindowRect`, reached
 * through a native module or `ffi`, and this project has no native dependency.
 *
 * So the test is a **proxy**, conservative in the direction that matters. A false *negative* leaves the
 * clock over a film; a false *positive* merely drops it behind other windows until the next poll. The
 * behaviour to verify by hand on a real desktop is in `docs/ENVIRONMENT.md` section 9.
 *
 * The one signal used: a display whose work area equals its full bounds has no taskbar showing, which
 * on Windows is what a fullscreen application produces. An auto-hidden taskbar produces the same
 * signal, which is the accepted false positive.
 */
function foregroundLooksFullscreen(window: BrowserWindow): boolean {
	const bounds = window.getBounds();
	const display = screen.getDisplayMatching(bounds);

	// If the user is working on another display, this one is not being covered.
	const cursor = screen.getCursorScreenPoint();
	if (screen.getDisplayNearestPoint(cursor).id !== display.id) {
		return false;
	}

	return (
		display.workArea.width >= display.bounds.width && display.workArea.height >= display.bounds.height
	);
}
