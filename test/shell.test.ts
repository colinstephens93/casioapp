/**
 * The Electron main process's decidable half.
 *
 * Nothing here imports Electron. `config.ts` and `notify.ts` are deliberately self-contained — Node
 * built-ins only — so the parts of the shell with actual *rules* in them are tested here, in a sandbox
 * with no desktop, no window and no notification service. What is left untested genuinely cannot be
 * tested here: whether a tray icon appears, whether a toast survives Focus Assist.
 *
 * Those two files are `.ts` (ESM) rather than `.cts` (CommonJS) *because* of that: a `.cts` file is
 * CommonJS by extension, and neither the ESM loader nor `createRequire` can load one while it contains
 * `import` statements. The CommonJS main process reaches them with a dynamic `import()`, which is the
 * only construct that works in both directions. See `scripts/steps.mjs`.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
	CONFIG_VERSION,
	ConfigFile,
	DEFAULT_BOUNDS,
	MIN_SIZE,
	clampToWorkArea,
	clampToWorkAreas,
	defaultConfig,
	isFromTheFuture,
	parseConfig,
	serialiseConfig,
	type Bounds,
	type WorkArea,
} from '../src/main/config.ts';
import { APP_USER_MODEL_ID, notificationFor, toastXmlFor } from '../src/main/notify.ts';

/** A work area with a taskbar along the bottom, so clamping has something to avoid. */
const WORK: WorkArea = { x: 0, y: 0, width: 1920, height: 1040 };

/** A temporary directory that is removed when the tests finish. */
const scratch = mkdtempSync(join(tmpdir(), 'casioapp-config-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
function tempConfigFile(initial?: string): ConfigFile {
	counter += 1;
	const directory = join(scratch, `case-${counter}`);
	const file = new ConfigFile({ directory });
	if (initial !== undefined) {
		// The directory has to exist before a hand-written file can be placed in it; `ConfigFile.save`
		// creates it itself, but this path writes directly to simulate a file the user edited.
		mkdirSync(directory, { recursive: true });
		writeFileSync(join(directory, 'casioapp.json'), initial);
	}
	return file;
}

describe('the configuration schema', () => {
	it('starts with the documented defaults', () => {
		const config = defaultConfig();
		assert.equal(config.version, CONFIG_VERSION);
		assert.deepEqual(config.bounds, DEFAULT_BOUNDS);
		assert.equal(config.hidden, false);
		assert.equal(config.watch, '', 'no watch state until the renderer reports it');
		assert.equal(config.battery, 1, 'a new widget starts full (BAT-1)');
	});

	it('round-trips through serialisation', () => {
		const original = {
			...defaultConfig(),
			bounds: { x: 100, y: 200, width: 500, height: 600 },
			hidden: true,
			watch: '{"version":2}',
			battery: 0.42,
		};
		const restored = parseConfig(serialiseConfig(original));
		assert.deepEqual(restored.bounds, original.bounds);
		assert.equal(restored.hidden, true);
		assert.equal(restored.watch, '{"version":2}');
		assert.equal(restored.battery, 0.42);
	});

	it('stamps the current version when writing, not the stored one', () => {
		// A file migrated on read must be stored as current, or it is migrated again forever.
		const old = serialiseConfig({ ...defaultConfig(), version: 1 });
		assert.equal((JSON.parse(old) as { version: number }).version, CONFIG_VERSION);
	});
});

describe('configuration repair (PRS-4)', () => {
	it('falls back on every shape of unreadable input rather than throwing', () => {
		for (const raw of [null, '', '   ', 'not json', '[]', '42', 'null', 'true', '{"version":']) {
			const config = parseConfig(raw);
			assert.deepEqual(config.bounds, DEFAULT_BOUNDS, `input ${JSON.stringify(raw)}`);
			assert.equal(config.hidden, false, `input ${JSON.stringify(raw)}`);
			assert.equal(config.battery, 1, `input ${JSON.stringify(raw)}`);
		}
	});

	it('repairs each field independently, so one bad value costs one field', () => {
		// The unit of repair is the field, not the file. A user who mistypes a zone should not lose
		// their window position or their alarms, and a hand-edited file is the case this exists for.
		const config = parseConfig(
			JSON.stringify({
				version: CONFIG_VERSION,
				bounds: 'not a rectangle',
				hidden: false,
				watch: '{"slots":[]}',
				battery: 2.5,
			}),
		);
		assert.deepEqual(config.bounds, DEFAULT_BOUNDS, 'the broken field fell back');
		assert.equal(config.watch, '{"slots":[]}', 'and the good ones survived');
		assert.equal(config.battery, 1, 'an out-of-range battery is clamped, not rejected');
	});

	it('clamps a battery level rather than trusting it (BAT-4)', () => {
		assert.equal(parseConfig(JSON.stringify({ battery: -3 })).battery, 0);
		assert.equal(parseConfig(JSON.stringify({ battery: 99 })).battery, 1);
		assert.equal(parseConfig(JSON.stringify({ battery: Number.NaN })).battery, 1, 'NaN is not a level');
	});

	it('rejects a bounds rectangle with any non-finite number', () => {
		// `NaN` and `Infinity` survive a JSON round trip as `null`, so a hand-edited file produces them
		// only through arithmetic — but `JSON.parse('{"x":1e999}')` gives `Infinity`, and a window at
		// Infinity is invisible.
		for (const bad of [
			{ x: 1e999, y: 0, width: 100, height: 100 },
			{ x: 0, y: 0, width: 'wide', height: 100 },
			{ x: 0, y: 0 },
		]) {
			assert.deepEqual(parseConfig(JSON.stringify({ bounds: bad })).bounds, DEFAULT_BOUNDS);
		}
	});
});

describe('the version field', () => {
	it('reports a future file as future, so the caller can refuse to overwrite it', () => {
		assert.equal(isFromTheFuture(parseConfig(JSON.stringify({ version: CONFIG_VERSION }))), false);
		assert.equal(isFromTheFuture(parseConfig(JSON.stringify({ version: CONFIG_VERSION + 1 }))), true);
		assert.equal(isFromTheFuture(parseConfig(JSON.stringify({ version: 99 }))), true);
	});
});

describe('clamping a window into a work area (WIN-9)', () => {
	const size = { width: 400, height: 500 };

	it('leaves a window that is already visible exactly where it is', () => {
		const bounds: Bounds = { x: 200, y: 150, ...size };
		assert.deepEqual(clampToWorkArea(bounds, WORK), bounds);
	});

	it('keeps a window deliberately hung off an edge', () => {
		// Half off the right edge is a legitimate arrangement, and snapping it back would fight the
		// user. What must not happen is the window becoming unreachable.
		const bounds: Bounds = { x: WORK.width - 100, y: 100, ...size };
		assert.deepEqual(clampToWorkArea(bounds, WORK), bounds);
	});

	it('re-centres a window that is entirely off-screen', () => {
		// The disconnected-monitor case: the saved position refers to a display that is gone, so there
		// is no meaningful "nearest visible" and the only guaranteed-reachable answer is the centre.
		const bounds: Bounds = { x: 5000, y: 90, ...size };
		const clamped = clampToWorkArea(bounds, WORK);
		assert.equal(clamped.x, Math.round((WORK.width - size.width) / 2));
		assert.equal(clamped.y, 90, 'the axis that was fine is left alone');
	});

	it('shrinks a window larger than the screen', () => {
		const clamped = clampToWorkArea({ x: 0, y: 0, width: 5000, height: 5000 }, WORK);
		assert.equal(clamped.width, WORK.width);
		assert.equal(clamped.height, WORK.height);
	});

	it('enforces a usable minimum', () => {
		// Below this the case's letterboxing leaves no room for the device, so it is unreadable rather
		// than merely small.
		const clamped = clampToWorkArea({ x: 10, y: 10, width: 5, height: 5 }, WORK);
		assert.equal(clamped.width, MIN_SIZE.width);
		assert.equal(clamped.height, MIN_SIZE.height);
	});

	it('never leaves the window unreachable, whatever it is given', () => {
		// The property that matters, swept rather than spot-checked: for any starting rectangle there
		// must be a grab handle inside the work area.
		for (let x = -3000; x <= 3000; x += 137) {
			for (let y = -3000; y <= 3000; y += 211) {
				const clamped = clampToWorkArea({ x, y, ...size }, WORK);
				const visibleX = Math.min(clamped.x + clamped.width, WORK.x + WORK.width) - Math.max(clamped.x, WORK.x);
				const visibleY = Math.min(clamped.y + clamped.height, WORK.y + WORK.height) - Math.max(clamped.y, WORK.y);
				assert.ok(
					visibleX >= Math.min(48, clamped.width) && visibleY >= Math.min(24, clamped.height),
					`window at ${x},${y} clamped to ${clamped.x},${clamped.y} shows only ${visibleX}x${visibleY}`,
				);
			}
		}
	});

	it('clamps to the nearest of several displays, not to their union', () => {
		// Two displays side by side have a union that also covers the gap between them, and a window
		// restored into that gap is invisible. So each work area is tested on its own.
		const left: WorkArea = { x: 0, y: 0, width: 1920, height: 1040 };
		const right: WorkArea = { x: 1920, y: 0, width: 1920, height: 1040 };
		const onRight: Bounds = { x: 2000, y: 100, ...size };
		assert.deepEqual(clampToWorkAreas(onRight, [left, right]), onRight, 'left where it was');

		// A window on a display that is gone lands on the primary, centred.
		const gone: Bounds = { x: 9000, y: 100, ...size };
		const clamped = clampToWorkAreas(gone, [left]);
		assert.ok(clamped.x + clamped.width > left.x && clamped.x < left.x + left.width);
	});

	it('returns the bounds unchanged when there is no display at all', () => {
		// Not reachable in practice — Electron always reports at least one display — but returning the
		// input is better than throwing during startup.
		const bounds: Bounds = { x: 1, y: 2, ...size };
		assert.deepEqual(clampToWorkAreas(bounds, []), bounds);
	});
});

describe('the configuration file on disk (NFR-11)', () => {
	it('reports a missing file as repaired and produces the defaults', () => {
		const file = tempConfigFile();
		const result = file.load();
		assert.equal(result.repaired, true, 'a first run is a repair, not an error');
		assert.equal(result.readOnly, false);
		assert.deepEqual(result.config.bounds, DEFAULT_BOUNDS);
	});

	it('writes and reads back', () => {
		const file = tempConfigFile();
		const config = { ...defaultConfig(), bounds: { x: 40, y: 60, width: 460, height: 560 } };
		assert.equal(file.save(config), true);

		const result = file.load();
		assert.equal(result.repaired, false, 'what we wrote is not a repair');
		assert.deepEqual(result.config.bounds, config.bounds);
	});

	it('leaves no temporary file behind', () => {
		// A stray `.tmp` beside the config is how a half-written file becomes permanent: the next run
		// would find two files and no way to tell which is authoritative.
		const file = tempConfigFile();
		file.save(defaultConfig());
		assert.equal(existsSync(`${file.filePath}.tmp`), false);
	});

	it('replaces the file atomically rather than truncating it', () => {
		// The property NFR-11 asks for, tested the only way it can be from outside: the target file is
		// never observed in a partial state. The write goes to a sibling and is renamed over it, so a
		// reader always sees a complete document.
		const file = tempConfigFile(serialiseConfig({ ...defaultConfig(), battery: 0.5 }));
		for (let i = 0; i < 20; i += 1) {
			file.save({ ...defaultConfig(), battery: i / 20 });
			const raw = readFileSync(file.filePath, 'utf-8');
			assert.doesNotThrow(() => JSON.parse(raw) as unknown, `iteration ${i} left a partial file`);
			assert.equal((JSON.parse(raw) as { battery: number }).battery, i / 20);
		}
	});

	it('treats a file that only differs in formatting as intact', () => {
		// A human's editor will reindent or reorder the file. Reporting that as a repair would fire the
		// "your settings were reset" path on a file that was perfectly fine.
		const reordered = `{"battery":1,"watch":"","hidden":false,"version":${CONFIG_VERSION},"bounds":{"height":560,"width":460,"y":0,"x":0}}`;
		const file = tempConfigFile(reordered);
		const result = file.load();
		assert.equal(result.repaired, false, 'whitespace and key order are not damage');
		assert.deepEqual(result.config.bounds, DEFAULT_BOUNDS);
	});

	it('refuses to overwrite a file from a newer build, and keeps refusing', () => {
		// The next build's settings are not this build's to destroy. Refusing only the first write
		// would leave the file intact until the user moved the window, which is seconds away.
		//
		// The JSON is written by hand rather than through `serialiseConfig`, because that function
		// deliberately stamps the *current* version — so it cannot express a file from the future.
		const future = JSON.stringify({
			version: CONFIG_VERSION + 5,
			bounds: DEFAULT_BOUNDS,
			hidden: false,
			watch: '',
			battery: 0.9,
		});
		const file = tempConfigFile(future);

		const result = file.load();
		assert.equal(result.readOnly, true, 'a future file is read-only');
		assert.equal(file.isReadOnly, true);
		assert.equal(result.repaired, false, 'and it is not reported as damaged');

		assert.equal(file.save({ ...defaultConfig(), battery: 0.1 }), false, 'the write was refused');
		assert.equal(readFileSync(file.filePath, 'utf-8'), future, 'and the file is untouched');
	});

	it('resets, which is the tray menu’s only destructive action', () => {
		const file = tempConfigFile(serialiseConfig(defaultConfig()));
		assert.equal(existsSync(file.filePath), true);
		assert.equal(file.reset(), true);
		assert.equal(existsSync(file.filePath), false);
		assert.equal(file.reset(), false, 'resetting twice is not an error, just false');
	});
});

describe('the alarm notification (ALM-10)', () => {
	const at = new Date(Date.UTC(2026, 6, 15, 22, 48, 37));

	it('names the alarm and the time it fired, in the Home City', () => {
		const payload = notificationFor({ kind: 'alarm', alarmId: 3 }, at, 540);
		assert.equal(payload.title, 'Alarm 3');
		// 22:48:37 UTC + 09:00 is 07:48:37 the next morning in Tokyo, and the toast must say so — the
		// alarm is a wall-clock time, and the user reads the toast in that zone.
		assert.match(payload.body, /07:48:37/);
		assert.match(payload.body, /Alarm 3/);
	});

	it('uses the Home City’s offset rather than UTC', () => {
		// The whole point of passing the offset: the toast and the face cannot disagree about the time.
		const tokyo = notificationFor({ kind: 'alarm', alarmId: 1 }, at, 540);
		const london = notificationFor({ kind: 'alarm', alarmId: 1 }, at, 0);
		assert.notEqual(tokyo.body, london.body);
		assert.match(london.body, /22:48:37/);
	});

	it('names the countdown rather than an alarm (TMR-6)', () => {
		const payload = notificationFor({ kind: 'timer' }, at, 0);
		assert.match(payload.title, /[Cc]ountdown|[Tt]imer/);
		assert.match(payload.body, /22:48:37/);
	});

	it('defaults an unnamed alarm to number one rather than saying undefined', () => {
		const payload = notificationFor({ kind: 'alarm' }, at, 0);
		assert.match(payload.title, /Alarm 1/);
		assert.equal(payload.title.includes('undefined'), false);
	});

	it('is silent, because audible output is off by default (ALM-12)', () => {
		for (const request of [{ kind: 'alarm' as const }, { kind: 'timer' as const }]) {
			assert.equal(notificationFor(request, at, 0).silent, true);
		}
	});

	it('is an alarm toast, which is what Focus Assist respects (ALM-10)', () => {
		// The requirement is about *category*: a plain toast is suppressed by Focus Assist, an alarm
		// toast is not. There is no Electron option for it — `scenario` is a Windows toast XML
		// attribute — so this is the assertion that the XML actually carries it.
		const xml = toastXmlFor(notificationFor({ kind: 'alarm', alarmId: 2 }, at, 0));
		assert.match(xml, /<toast[^>]+scenario="alarm"/, 'the scenario attribute is the requirement');
		assert.match(xml, /^<toast/, 'and it is a whole toast document');
		assert.match(xml, /<\/toast>$/);
	});

	it('keeps the toast on screen until it is acted on (ALM-7)', () => {
		// An alarm is not a status update. Windows expires a toast that has nothing to act on, so the
		// `<actions>` element is what makes it persist.
		const xml = toastXmlFor(notificationFor({ kind: 'alarm', alarmId: 1 }, at, 0));
		assert.match(xml, /<actions>/, 'the action element is what stops the timeout');
	});

	it('escapes the text rather than trusting it', () => {
		// No field can contain markup today, and the escaping is what keeps that true rather than
		// assumed — a city name or a locale's alarm label is a future input.
		const xml = toastXmlFor({
			scenario: 'alarm',
			title: 'Alarm <1> & "friends"',
			body: "it's here",
			requireInteraction: true,
			silent: true,
		});
		assert.equal(xml.includes('Alarm <1>'), false, 'a raw angle bracket would break the document');
		assert.match(xml, /&lt;1&gt;/);
		assert.match(xml, /&amp;/);
		assert.match(xml, /&apos;/);
	});

	it('declares an AppUserModelID that the installer must match', () => {
		// A toast with no AppUserModelID is dropped or attributed to electron.exe, which means Focus
		// Assist applies to the wrong application. The value is duplicated in electron-builder.yml
		// because the build config cannot import TypeScript, so it is asserted here to be the shape the
		// installer expects rather than an empty string.
		assert.match(APP_USER_MODEL_ID, /^[a-z0-9]+(\.[a-z0-9-]+)+$/);
	});
});
