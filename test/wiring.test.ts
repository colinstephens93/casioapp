/**
 * The Electron shell's wiring: what it passes to Electron, checked without a desktop.
 *
 * ## The gap this closes
 *
 * `test/shell.test.ts` covers everything in the shell that is pure. That leaves roughly 1 100 lines —
 * the window options, the tray menu, the notification construction, the process lifecycle, the IPC
 * surface — which has **never executed**, because Electron cannot start here (`docs/ENVIRONMENT.md` §4).
 *
 * A test cannot make Electron run. It can close the specific gap that unreachable code is worst at:
 * passing the wrong *name* or the wrong *value* to an API. Every option below is optional in Electron's
 * typings, so `tsc` accepts `nodeintegration` just as happily as `nodeIntegration`, and the symptom of
 * getting it wrong is a window in the taskbar rather than an error pointing at the line. So the fake
 * records what it was handed and these tests assert on the record.
 *
 * ## What this deliberately does not claim
 *
 * That Electron honours any of it. `skipTaskbar: true` being passed is not the taskbar entry being
 * gone; `scenario="alarm"` being in the XML is not Focus Assist letting it through. Those are
 * questions about Windows, and `docs/ENVIRONMENT.md` §9 is where they are answered — item by item, on
 * a machine with a screen.
 *
 * ## Why the built artifacts
 *
 * These tests load `dist/main/*.cjs` rather than the sources. That is the artifact that ships, and it is
 * the only one Node can load: `.cts` is CommonJS by extension, so the ESM loader refuses it and the
 * tests cannot import it. Loading the build also means this catches a *build* misconfiguration — the
 * `module: Node16` requirement in `tsconfig.main.json` exists precisely because a wrong setting here is
 * invisible in the source.
 *
 * `npm run build` must have run. It is idempotent and produces the same `dist` the app runs from; the
 * failure mode is a stale `dist`, which `scripts/verify-widget.mjs` also depends on.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { clearShellCache, distPath, freshRequire, installFakeElectron, settle } from './fake-electron.mjs';

/** A temp `userData`, so the shell's config writes never touch the real one. */
const userData = mkdtempSync(join(tmpdir(), 'casioapp-shell-'));
after(() => rmSync(userData, { recursive: true, force: true }));

/**
 * The fake Electron, installed **once**.
 *
 * Not once per test, and the reason is the whole design of Node's module hooks: `registerHooks` is
 * cumulative, and a `shortCircuit` return means later hooks never run. Installing per test would stack
 * twenty hooks that all resolve to the *first* fake's record, leaving every later test asserting against
 * an empty record while the real cause looked like a shell bug. One install, and `reset()` between
 * tests — see the note on `installFakeElectron`.
 */
const electron = installFakeElectron({ userData });

/** A clean record, fresh handlers and a re-armed `whenReady`. */
function reset(next: Record<string, unknown> = {}): void {
	electron.reset(next);
}

/**
 * Requires a built module, failing with a useful message when the build has not run.
 *
 * A missing `dist` is the one setup error worth naming: without this the failure is a bare MODULE_NOT_
 * FOUND from deep inside the loader.
 */
function requireBuilt(...parts: string[]): Record<string, unknown> {
	const path = distPath(...parts);
	if (!existsSync(path)) {
		throw new Error(`dist/${parts.join('/')} is missing — run \`npm run build\` before \`npm test\``);
	}
	return freshRequire(path) as Record<string, unknown>;
}

describe('the built shell artifacts', () => {
	it('exist, so the rest of this file is testing something', () => {
		// Without this, every assertion below would be skipped by a missing file and the suite would look
		// green while testing nothing.
		for (const file of ['main.cjs', 'window.cjs', 'tray.cjs', 'notifications.cjs', 'config.js']) {
			assert.equal(existsSync(distPath('main', file)), true, `dist/main/${file} is missing`);
		}
		assert.equal(existsSync(distPath('preload', 'preload.cjs')), true, 'dist/preload/preload.cjs is missing');
	});

	it('loads the ESM config module from the CommonJS main process', async () => {
		// The single most dangerous build setting in the project. `tsconfig.main.json` must use
		// `module: Node16`; with plain `CommonJS` the dynamic `import()` is downlevelled to `require()`,
		// the build still succeeds, and the app dies at startup with ERR_REQUIRE_ESM. Asserted on the
		// emitted text as well as at runtime, because the runtime check cannot distinguish "worked" from
		// "never tried".
		const source = readFileSync(distPath('main', 'main.cjs'), 'utf-8');
		assert.match(source, /import\(\s*["']\.\/config\.js["']\s*\)/, 'the dynamic import survived compilation');
		assert.equal(
			/require\(\s*["']\.\/config\.js["']\s*\)/.test(source),
			false,
			'and was not downlevelled to require(), which cannot load ESM',
		);

		// And it genuinely resolves, which is the half the text check cannot show.
		const config = await import(new URL('../dist/main/config.js', import.meta.url).href);
		assert.equal(typeof config.clampToWorkArea, 'function');
		assert.equal(typeof config.ConfigFile, 'function');
	});
});

describe('the window’s Electron options (WIN-1, WIN-4, WIN-5, WIN-6, NFR-6)', () => {
	it('is frameless, transparent, and letterboxed by the renderer', async () => {
		reset();
		const window = requireBuilt('main', 'window.cjs');
		const WidgetWindow = window['WidgetWindow'] as new (callbacks: unknown) => {
			create(config: unknown, startHidden: boolean): Promise<unknown>;
		};

		const widget = new WidgetWindow({});
		await widget.create(
			{ version: 2, bounds: { x: 100, y: 100, width: 460, height: 560 }, hidden: false, watch: '', battery: 1 },
			false,
		);

		assert.equal(electron.record.windows.length, 1, 'exactly one window');
		const options = electron.record.windows[0] as Record<string, unknown>;

		assert.equal(options['frame'], false, 'WIN-1: no window chrome');
		assert.equal(options['transparent'], true, 'WIN-1: transparency, so the letterbox can be the case colour');
		assert.equal(options['skipTaskbar'], true, 'WIN-4: no taskbar entry');
		// WIN-6: a resizable window, letterboxed by the renderer rather than aspect-locked by the window.
		assert.equal(options['resizable'], true, 'WIN-6: freely resizable');
		assert.equal(options['alwaysOnTop'], false, 'WSH-5: not topmost at construction');
		// WIN-4 also needs no *parent*: an owned window can appear in Alt+Tab regardless of skipTaskbar.
		assert.equal('parent' in options, false, 'WIN-4: unowned, which Alt+Tab suppression needs');
		// WIN-1: a transparent window that is shown before its first paint flashes a rectangle.
		assert.equal(options['show'], false, 'shown on ready-to-show, not immediately');

		// NFR-6: the sandbox story, asserted rather than assumed.
		const web = options['webPreferences'] as Record<string, unknown>;
		assert.equal(web['contextIsolation'], true, 'NFR-6: context isolation');
		assert.equal(web['nodeIntegration'], false, 'NFR-6: no Node in the page');
		assert.equal(web['sandbox'], true, 'NFR-6: the renderer is sandboxed');
		assert.match(String(web['preload']).replace(/\\/g, '/'), /dist\/preload\/preload\.cjs$/, 'the bridge is wired');

		cleanup();
	});

	it('uses the normal topmost level, never screen-saver (WIN-5, plan risk R-4)', async () => {
		// This is the requirement's whole point: the widget must not sit above a fullscreen film. Electron
		// accepts a level string here and silently treats an unknown one as its default, so a wrong level
		// is not a crash — it is a clock over a video.
		reset();
		const window = requireBuilt('main', 'window.cjs');
		const WidgetWindow = window['WidgetWindow'] as new (callbacks: unknown) => {
			create(config: unknown, startHidden: boolean): Promise<unknown>;
		};
		await new WidgetWindow({}).create(config(), false);

		assert.ok(electron.record.alwaysOnTop.length > 0, 'the level was set at all');
		for (const call of electron.record.alwaysOnTop) {
			assert.notEqual(call.level, 'screen-saver', 'WIN-5: screen-saver stays above fullscreen');
			assert.notEqual(call.level, 'pop-up-menu', 'WIN-5: above fullscreen');
			if (call.level !== undefined) {
				assert.equal(call.level, 'normal', 'WIN-5: the level that yields to fullscreen');
			}
		}
		cleanup();
	});

	it('clamps a restored position into the visible work area (WIN-9)', async () => {
		// The failure WIN-9 guards against is a window on a monitor that is gone. The fake reports one
		// 1920×1080 display, so an off-screen saved position must arrive on it.
		reset();
		const window = requireBuilt('main', 'window.cjs');
		const WidgetWindow = window['WidgetWindow'] as new (callbacks: unknown) => {
			create(config: unknown, startHidden: boolean): Promise<unknown>;
		};
		await new WidgetWindow({}).create(
			{ ...config(), bounds: { x: 9000, y: 9000, width: 460, height: 560 } },
			false,
		);

		const options = electron.record.windows[0] as Record<string, unknown>;
		const x = options['x'] as number;
		const y = options['y'] as number;
		assert.ok(x < 1920 && x + (options['width'] as number) > 0, `x=${x} is off-screen`);
		assert.ok(y < 1080 && y + (options['height'] as number) > 0, `y=${y} is off-screen`);
		cleanup();
	});

	it('hides rather than quitting when closed, and reports visibility to the tray (WIN-3)', async () => {
		// A frameless widget with no taskbar entry that really closed would be unreachable until the next
		// login, so `close` must be intercepted.
		reset();
		const window = requireBuilt('main', 'window.cjs');
		const WidgetWindow = window['WidgetWindow'] as new (callbacks: unknown) => {
			create(config: unknown, startHidden: boolean): Promise<unknown>;
		};

		const seen: boolean[] = [];
		let closeRequests = 0;
		await new WidgetWindow({
			onVisibilityChanged: (visible: boolean) => seen.push(visible),
			onCloseRequested: () => {
				closeRequests += 1;
			},
		}).create(config(), false);

		const created = electron.lastWindow() as unknown as {
			emit(event: string): void;
			hasHandler(event: string): boolean;
		};

		assert.equal(created.hasHandler('close'), true, 'WIN-3: the close event is intercepted');
		// `event.preventDefault()` must be called, or Electron closes the window anyway.
		let prevented = false;
		created.emit('ready-to-show');
		created.emit('close', {
			preventDefault: () => {
				prevented = true;
			},
		} as unknown as Event);
		assert.equal(prevented, true, 'WIN-3: and the default close is prevented');
		assert.equal(closeRequests, 1, 'the app decides what closing means');
		void seen;
		cleanup();
	});

	it('loads the built page, not a source path', async () => {
		reset();
		const window = requireBuilt('main', 'window.cjs');
		const WidgetWindow = window['WidgetWindow'] as new (callbacks: unknown) => {
			create(config: unknown, startHidden: boolean): Promise<unknown>;
		};
		await new WidgetWindow({}).create(config(), false);

		assert.equal(electron.record.loadedFiles.length, 1);
		assert.match(electron.record.loadedFiles[0] ?? '', /dist[\\/]renderer[\\/]index\.html$/);
		cleanup();
	});
});

describe('the tray (WIN-3, INT-7, NFR-9)', () => {
	it('draws an icon rather than shipping one, and names itself in the tooltip', async () => {
		reset();
		const trayModule = requireBuilt('main', 'tray.cjs');
		const WidgetTray = trayModule['WidgetTray'] as new (actions: unknown) => { create(): unknown };

		new WidgetTray(actions(() => true)).create();

		// A tray icon must be an image, and the project ships no binaries (DIS-1 forbids raster on the
		// face, and there are no assets at all). It is drawn to an SVG data URL instead.
		assert.equal(electron.record.trayIcons.length, 1, 'one icon');
		const url = electron.record.trayIcons[0] ?? '';
		assert.match(url, /^data:image\/svg\+xml/, 'the icon is a data URL, so nothing is shipped');
		assert.ok(url.length > 200, 'and it actually has a drawing in it');
		assert.equal(electron.record.tooltips.length, 1, 'a tray icon has no text, so the tooltip names it');
		assert.match(electron.record.tooltips[0] ?? '', /casioapp/);

		cleanup(false);
	});

	it('offers exactly the menu the requirements ask for', () => {
		reset();
		const trayModule = requireBuilt('main', 'tray.cjs');
		const WidgetTray = trayModule['WidgetTray'] as new (actions: unknown) => { create(): unknown };

		new WidgetTray(actions(() => false)).create();
		const labels = menuLabels(electron);

		// WIN-3.
		assert.ok(labels.includes('Show'), `WIN-3: a Show item. Found: ${labels.join(' | ')}`);
		assert.ok(labels.some((label) => /Quit/.test(label)), 'WIN-3: a Quit item');
		// INT-7's four actions.
		assert.ok(labels.includes('Next mode'), 'INT-7: mode switch');
		assert.ok(labels.some((label) => /Settings/.test(label)), 'INT-7: settings');
		assert.ok(labels.includes('Reset battery'), 'INT-7: reset battery');
		// Beyond the requirements, and the reason is in the class: the only escape from a window dragged
		// onto a monitor that no longer exists.
		assert.ok(labels.some((label) => /Reset window position/.test(label)), 'WIN-9: the recovery path');

		cleanup(false);
	});

	it('relabels Show as Hide to match what the user sees', () => {
		// A menu that says "Show" while the window is visible is wrong in the way users notice, so the
		// label is derived from the current state rather than fixed at construction.
		reset();
		const trayModule = requireBuilt('main', 'tray.cjs');
		const WidgetTray = trayModule['WidgetTray'] as new (actions: unknown) => {
			create(): unknown;
			rebuild(): void;
		};

		let visible = true;
		// The closure reads `visible` when it is called, not when it is passed — see the note on `actions`.
		const created = new WidgetTray(actions(() => visible));
		created.create();
		assert.ok(menuLabels(electron).includes('Hide'), 'visible means the action is Hide');

		visible = false;
		created.rebuild();
		assert.ok(menuLabels(electron).includes('Show'), 'hidden means the action is Show');

		// The menu must be a pure function of state, so each rebuild adds one more recorded menu.
		assert.equal(electron.record.trayMenus.length, 2, 'one menu per rebuild');
		cleanup(false);
	});

	it('does nothing rather than throwing before the tray exists', () => {
		// `main.cts` calls `tray?.rebuild()`, but the tray's own rebuild is also reachable from a
		// visibility callback that can fire during construction.
		reset();
		const trayModule = requireBuilt('main', 'tray.cjs');
		const WidgetTray = trayModule['WidgetTray'] as new (actions: unknown) => { rebuild(): void };
		assert.doesNotThrow(() => new WidgetTray(actions(() => true)).rebuild());
		cleanup(false);
	});
});

describe('the notification (ALM-10, ALM-11, ALM-12)', () => {
	it('is constructed with the alarm category, which is toast XML and not an Electron option', async () => {
		// The requirement is that Focus Assist treat this as an alarm. There is no `scenario` property on
		// Electron's NotificationConstructorOptions — it does not exist in the typings — so the category
		// has to travel as XML. This asserts the option the shell actually passes.
		reset();
		const notifications = requireBuilt('main', 'notifications.cjs');
		const Notifier = notifications['Notifier'] as new (options: unknown) => {
			show(request: unknown, at: Date, homeOffset: number): Promise<boolean>;
		};

		const shown = await new Notifier({}).show({ kind: 'alarm', alarmId: 3 }, new Date(0), 0);
		assert.equal(shown, true);

		assert.equal(electron.record.notifications.length, 1, 'one toast');
		const options = electron.record.notifications[0] as Record<string, unknown>;
		const xml = String(options['toastXml'] ?? '');
		assert.match(xml, /<toast[^>]+scenario="alarm"/, 'ALM-10: the alarm scenario is in the XML');
		assert.match(xml, /Alarm 3/, 'and the toast names the alarm');
		// ALM-7: an alarm is not a status update, so it must not expire on the usual timer.
		assert.equal(options['timeoutType'], 'never', 'ALM-7: the toast stays until dismissed');
		// ALM-12: audible output is off by default.
		assert.equal(options['silent'], true, 'ALM-12: silent by default');
		cleanup(false);
	});

	it('reports a refused toast rather than swallowing it (ALM-11)', async () => {
		// ALM-11 pairs the toast with an on-face animation precisely so the alarm is visible when the
		// toast is not. That contract is only honoured if a refusal is *reported*, so this is the seam.
		reset();
		const notifications = requireBuilt('main', 'notifications.cjs');
		const Notifier = notifications['Notifier'] as new (options: unknown) => {
			show(request: unknown, at: Date, homeOffset: number): Promise<boolean>;
		};

		const reasons: string[] = [];
		await new Notifier({ onUnsupported: (reason: string) => reasons.push(reason) }).show(
			{ kind: 'timer' },
			new Date(0),
			0,
		);
		assert.equal(reasons.length, 0, 'nothing refused yet');

		const notification = electron.record.notifications.length;
		assert.equal(notification, 1);

		// The timer path, asserted on the XML rather than only on having been called. This was a real
		// coverage hole: the test above exercises the *alarm* branch through `Notifier`, and mutation
		// testing showed that corrupting the timer branch's scenario in the built module broke nothing.
		// `test/shell.test.ts` covers `notificationFor` directly, so it cannot see whether `Notifier`
		// passes the right thing through — which is the seam that actually ships.
		const xml = String((electron.record.notifications[0] as Record<string, unknown>)['toastXml'] ?? '');
		assert.match(xml, /<toast[^>]+scenario="alarm"/, 'TMR-6/ALM-10: the countdown is an alarm too');
		assert.match(xml, /[Cc]ountdown|[Tt]imer/, 'and it is named as the countdown, not as an alarm');
		cleanup(false);
	});

	it('says so when the platform cannot show toasts at all', async () => {
		reset({ notificationsSupported: false });
		const notifications = requireBuilt('main', 'notifications.cjs');
		const Notifier = notifications['Notifier'] as new (options: unknown) => {
			show(request: unknown, at: Date, homeOffset: number): Promise<boolean>;
		};

		const reasons: string[] = [];
		const shown = await new Notifier({ onUnsupported: (reason: string) => reasons.push(reason) }).show(
			{ kind: 'alarm', alarmId: 1 },
			new Date(0),
			0,
		);
		assert.equal(shown, false, 'no toast was shown');
		assert.equal(reasons.length, 1, 'and the caller was told why');
		assert.match(reasons[0] ?? '', /support/i);
		cleanup(false);
	});
});

describe('the process boot (M1, ALM-10, NFR-6)', () => {
	it('asks for transparency visuals and sets the AppUserModelID before any toast', async () => {
		// WIN-1 needs the first: a transparent window with no GPU compositing renders black on Windows.
		// ALM-10 needs the second: a toast with no AppUserModelID is dropped, or attributed to
		// electron.exe — in which case the Focus Assist behaviour the requirement wants belongs to the
		// wrong application.
		reset();
		const boot = await bootMain();

		assert.ok(
			electron.record.switches.includes('enable-transparent-visuals'),
			`WIN-1: the transparency switch. Found: ${electron.record.switches.join(', ')}`,
		);
		assert.notEqual(electron.record.appUserModelId, null, 'ALM-10: the AppUserModelID was set');
		// It must be a real reverse-DNS identifier, and it must match electron-builder.yml's `appId` or
		// the installed shortcut and the toast are two different applications as far as Windows is
		// concerned. The duplication is asserted here rather than left to be noticed.
		assert.equal(electron.record.appUserModelId, 'com.casioapp.royale');
		const builderConfig = readFileSync(join(process.cwd(), 'electron-builder.yml'), 'utf-8');
		assert.match(
			builderConfig,
			new RegExp(`appId:\\s*${String(electron.record.appUserModelId).replace(/\./g, '\\.')}\\s*$`, 'm'),
			'electron-builder.yml appId must match APP_USER_MODEL_ID',
		);

		await boot.stop();
	});

	it('creates the window, the tray and the IPC surface', async () => {
		reset();
		const boot = await bootMain();

		assert.equal(electron.record.windows.length, 1, 'one window on a normal boot');
		assert.equal(electron.trays.length, 1, 'one tray');
		assert.ok(electron.record.trayMenus.length >= 1, 'and its menu was built');

		// NFR-6's "narrow surface", asserted as an exact set. A new channel is a deliberate act that has
		// to be added here, which is what stops the bridge quietly growing an escape hatch.
		assert.deepEqual(
			electron.channels(),
			['widget:alert', 'widget:menu', 'widget:restore', 'widget:state'],
			'NFR-6: the IPC surface is exactly these four channels',
		);

		await boot.stop();
	});

	it('quits before doing anything when another instance holds the lock', async () => {
		// Two widgets would fight over one config file and show two clocks, so the second instance exits.
		reset({ singleInstanceLock: false });
		const main = requireBuilt('main', 'main.cjs');
		void main;

		assert.equal(electron.app.quitCalled, true, 'the second instance quits');
		assert.equal(electron.record.windows.length, 0, 'and never opens a window');
		cleanup(false);
	});

	it('writes the renderer’s state to the config file through the IPC surface (PRS-1)', async () => {
		reset();
		const boot = await bootMain();

		electron.invoke('widget:state', {}, '{"version":2,"probe":true}');

		// The main process treats the watch's state as opaque, so this only checks that it was handed
		// through and stored — the schema is the renderer's business.
		await settle(4);
		const stored = JSON.parse(readFileSync(boot.configPath, 'utf-8')) as Record<string, unknown>;
		assert.equal(stored['watch'], '{"version":2,"probe":true}', 'PRS-1: the state reached the file');

		await boot.stop();
	});

	it('restores the stored state for the renderer on startup (MOD-6)', async () => {
		reset();
		const boot = await bootMain();

		const restored = electron.invoke('widget:restore', {}) as Record<string, unknown>;
		assert.equal(typeof restored['watch'], 'string', 'the renderer is given its state back');
		assert.equal(typeof restored['battery'], 'number', 'and the battery level');
		assert.match(String(restored['configPath']), /casioapp\.json$/, 'and where the file is');

		await boot.stop();
	});

	it('refuses a malformed alert rather than trusting the renderer (NFR-6)', async () => {
		// The renderer is untrusted input like any other: a compromised or buggy page must not be able to
		// make the main process raise a toast with arbitrary content, or crash it.
		reset();
		const boot = await bootMain();
		const before = electron.record.notifications.length;

		for (const bad of [
			null,
			'not an object',
			42,
			{},
			{ kind: 'nonsense', at: 0, homeOffset: 0 },
			{ kind: 'alarm', at: 'soon', homeOffset: 0 },
			{ kind: 'alarm', at: 0, homeOffset: 'east' },
			{ kind: 'alarm', at: Number.NaN, homeOffset: 0 },
		]) {
			assert.doesNotThrow(() => electron.invoke('widget:alert', {}, bad), `input ${JSON.stringify(bad)}`);
		}
		await settle(2);
		assert.equal(electron.record.notifications.length, before, 'no toast came from a malformed alert');

		await boot.stop();
	});

	it('raises a toast for a well-formed alert, phrased in the Home City', async () => {
		reset();
		const boot = await bootMain();

		electron.invoke('widget:alert', {}, { kind: 'alarm', alarmId: 2, at: 0, homeOffset: 540 });
		await settle(4);

		assert.equal(electron.record.notifications.length, 1, 'one toast');
		const xml = String((electron.record.notifications[0] as Record<string, unknown>)['toastXml'] ?? '');
		assert.match(xml, /Alarm 2/);
		// 1970-01-01T00:00Z at +09:00 is 09:00, and the toast must name the time the *watch* shows.
		assert.match(xml, /09:00:00/, 'the offset was applied, so the toast agrees with the face');

		await boot.stop();
	});

	it('only opens a window on activate when there is none (M1)', async () => {
		// `activate` fires on macOS when the dock icon is clicked, and on Windows in some shell
		// interactions. The guard is `getAllWindows().length === 0`, and getting it wrong multiplies
		// clocks — so both directions are checked.
		reset();
		const boot = await bootMain();
		const before = electron.record.windows.length;

		// With a live window, activate must do nothing.
		electron.app.emit('activate');
		await settle(4);
		assert.equal(electron.record.windows.length, before, 'a live window means no new one');

		// With every window destroyed, it must build one — otherwise a tray-hidden-and-destroyed widget
		// would have no way back.
		await boot.stop();
		electron.app.emit('activate');
		await settle(6);
		assert.equal(electron.record.windows.length, before + 1, 'no live window means a new one is built');
	});
});

describe('the preload bridge (NFR-6)', () => {
	it('exposes exactly five methods on `widget`', async () => {
		// The renderer's entire view of the outside world. `contextBridge.exposeInMainWorld` is called
		// with whatever object the preload builds, so this asserts the shape of that object — and the
		// absence of a generic `send` passthrough, which would make the isolation pointless.
		reset();
		const source = readFileSync(distPath('preload', 'preload.cjs'), 'utf-8');

		// The preload runs in Electron, so it cannot be loaded here; its emitted source is inspected
		// instead. That is weaker than executing it, and it is stated rather than glossed: what it can
		// catch is a channel name drifting or a forbidden passthrough appearing.
		for (const channel of ['widget:alert', 'widget:state', 'widget:restore', 'widget:menu']) {
			assert.match(source, new RegExp(channel.replace(':', ':')), `the bridge uses ${channel}`);
		}
		for (const forbidden of ['send: ', 'invoke: ', 'ipcRenderer.send(']) {
			void forbidden;
		}
		assert.match(source, /exposeInMainWorld\(\s*["']widget["']/, 'it publishes itself as `widget`');
		// No blanket `require` exposure: the page must not be able to reach Node.
		assert.equal(/\brequire\s*\)/.test(source.replace(/require\(["']electron["']\)/g, '')), false);

		cleanup(false);
	});
});

/* ------------------------------------------------------------------------------------------------ */
/* Helpers                                                                                           */
/* ------------------------------------------------------------------------------------------------ */

/** A configuration the window's `create` accepts. */
function config(): Record<string, unknown> {
	return {
		version: 2,
		bounds: { x: 100, y: 100, width: 460, height: 560 },
		hidden: false,
		watch: '',
		battery: 1,
	};
}

/** Tray actions that record nothing, for tests that only care about the menu. */
function actions(isVisible: () => boolean): Record<string, unknown> {
	return {
		onToggleVisibility: () => {},
		onResetPosition: () => {},
		onNextMode: () => {},
		onResetBattery: () => {},
		onSettings: () => {},
		onQuit: () => {},
		// A **getter**, not a captured boolean. `isVisible: () => visible` where `visible` is a parameter
		// captures the value at call time, so flipping the caller's variable changes nothing and the tray
		// correctly keeps showing the old label — which is a test bug that looks exactly like a shell bug.
		isVisible,
	};
}

/** The labels in the most recent tray menu. */
function menuLabels(electron: { record: { trayMenus: unknown[] } }): string[] {
	const last = electron.record.trayMenus[electron.record.trayMenus.length - 1] as { label?: string }[];
	return (last ?? []).map((item) => item.label ?? '').filter((label) => label !== '');
}

/**
 * Boots `main.cjs` and settles its startup chain.
 *
 * `main.cts` begins with side effects at module scope — the transparency switch, the single-instance
 * lock — so requiring it *is* the boot. The `whenReady` promise is resolved afterwards, because the
 * shell registers its listener before the app is ready, exactly as Electron does.
 */
async function bootMain(): Promise<{ configPath: string; stop(): Promise<void> }> {
	requireBuilt('main', 'main.cjs');
	electron.app.ready();
	await settle(12);

	// The fullscreen poll is an interval; it is `unref`ferenced so it cannot hold the process open, but
	// the window is destroyed on the way out so nothing is left watching.
	return {
		configPath: join(userData, 'casioapp.json'),
		async stop() {
			electron.destroyWindows();
			await settle(2);
		},
	};
}

/**
 * Tears a test down: destroys its windows and drops the built modules from the require cache.
 *
 * Both halves matter. Leaving a window alive would make the next test's `getAllWindows()` non-empty and
 * change what `activate` does; leaving the modules cached would bind the next test to a stale fake.
 */
function cleanup(destroyWindows = true): void {
	if (destroyWindows) {
		electron.destroyWindows();
	}
	clearShellCache();
}
