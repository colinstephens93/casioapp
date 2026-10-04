/**
 * The tray icon and its menu.
 *
 * Requirements WIN-3 (Show/Hide, Quit), INT-7 (mode switch, settings, reset battery, quit) and NFR-9
 * (the tray menu is the accessibility floor — it is keyboard-reachable, so it is the only way to
 * operate the widget without a mouse).
 *
 * ## Why the icon is drawn rather than shipped
 *
 * DIS-1 forbids raster assets *on the face*, and this is not the face — but a tray icon has to be an
 * image, and the project has no binary assets and no image toolchain. Electron's `nativeImage` can be
 * built from a **data URL**, so the icon is a small seven-segment glyph rendered to an SVG string and
 * passed as an image. That keeps the repository free of binaries and means the icon cannot drift from
 * the face's own geometry, because it is drawn from the same principle: lit segments on a dark ground.
 *
 * A tray icon also has no text, so it cannot say "casioapp" — hence the tooltip.
 */
import { Menu, Tray, app, nativeImage } from 'electron';

/**
 * The tooltip.
 *
 * `notify.ts` holds the canonical title and is **ESM**, while this file is CommonJS, so it cannot be
 * imported statically without making the whole tray asynchronous for one string. The literal is
 * duplicated here and the export's shape is asserted in `test/shell.test.ts`; the duplication is named
 * rather than left to be discovered.
 */
const TOOLTIP = 'casioapp — world clock';

export interface TrayActions {
	readonly onToggleVisibility: () => void;
	readonly onResetPosition: () => void;
	readonly onSettings: () => void;
	readonly onQuit: () => void;
	/** True while the window is visible, so the Show/Hide item can be labelled correctly. */
	readonly isVisible: () => boolean;
}

/**
 * Builds the tray icon as a data URL.
 *
 * 16×16 is the Windows tray's nominal small-icon size; Electron scales it for high-DPI displays, and
 * an SVG source scales without the blur a PNG would show. The glyph is a lit `8`-like figure — the
 * densest seven-segment character — on the LCD's own green, so it is recognisable at 16 pixels and
 * does not pretend to be anything other than this widget.
 */
function trayIconDataUrl(): string {
	const segments = [
		// a, b, c, d, e, f — every segment except `g`, which at this size fills the glyph solid.
		'<rect x="3" y="1" width="10" height="2" rx="1"/>',
		'<rect x="11" y="3" width="2" height="5" rx="1"/>',
		'<rect x="11" y="8" width="2" height="5" rx="1"/>',
		'<rect x="3" y="13" width="10" height="2" rx="1"/>',
		'<rect x="3" y="8" width="2" height="5" rx="1"/>',
		'<rect x="3" y="3" width="2" height="5" rx="1"/>',
	].join('');

	const svg = [
		'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">',
		'<rect width="16" height="16" rx="3" fill="#cfd8a0"/>',
		`<g fill="#1b2410">${segments}</g>`,
		'</svg>',
	].join('');

	// `encodeURIComponent` rather than base64: it keeps the data URL readable in a debugger, and an
	// SVG data URL does not need base64.
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * The tray.
 *
 * One instance for the process lifetime. The tray is the widget's recovery path — a frameless window
 * with no taskbar entry can be hidden, moved off-screen or covered, and the tray is the only way back —
 * so "reset position" is offered even though the requirements' minimum menu does not list it.
 */
export class WidgetTray {
	private tray: Tray | null = null;
	private readonly actions: TrayActions;

	constructor(actions: TrayActions) {
		this.actions = actions;
	}

	create(): Tray {
		const image = nativeImage.createFromDataURL(trayIconDataUrl());
		const tray = new Tray(image);
		tray.setToolTip(TOOLTIP);
		this.tray = tray;
		this.rebuild();

		// A left click on the tray toggles the widget, which is the behaviour every other tray widget
		// has and therefore the one a user will try first.
		tray.on('click', () => {
			this.actions.onToggleVisibility();
			this.rebuild();
		});

		return tray;
	}

	/**
	 * Rebuilds the menu.
	 *
	 * Called whenever the window's visibility changes, because the Show/Hide item's *label* depends on
	 * it. Rebuilding rather than mutating keeps the menu a pure function of the current state, so it
	 * cannot fall out of step with what the user sees.
	 */
	rebuild(): void {
		if (!this.tray) {
			return;
		}
		const visible = this.actions.isVisible();

		const menu = Menu.buildFromTemplate([
			{
				label: visible ? 'Hide' : 'Show',
				click: () => {
					this.actions.onToggleVisibility();
					this.rebuild();
				},
			},
			{ type: 'separator' },
			// The config file is still the settings. Mode and battery belonged to the watch face.
			{ label: 'Settings…', click: () => this.actions.onSettings() },
			{ type: 'separator' },
			// Beyond the requirements, and the reason is in the class comment: this is the only way out
			// of a window that has been dragged onto a monitor that no longer exists.
			{ label: 'Reset window position', click: () => this.actions.onResetPosition() },
			{ type: 'separator' },
			{ label: 'Quit casioapp', click: () => this.actions.onQuit() },
		]);

		this.tray.setContextMenu(menu);
	}

	destroy(): void {
		this.tray?.destroy();
		this.tray = null;
	}

	/** True when the tray actually exists, which the quit path checks before assuming it can restore. */
	get exists(): boolean {
		return this.tray !== null;
	}

	/** The app's display name, for the tray's own label on some platforms. */
	static appName(): string {
		return app.getName();
	}
}
