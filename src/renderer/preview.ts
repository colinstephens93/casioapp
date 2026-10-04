/**
 * The browser preview page.
 *
 * This exists because the widget itself cannot be run in the development sandbox (see
 * docs/ENVIRONMENT.md). It renders the same face the widget will, into a standalone HTML file that
 * needs no server: it can simply be opened.
 *
 * It draws several scenarios rather than one, because the parts most likely to be wrong are the
 * conditional ones — the map band's Home City fallback, the DST indicator, the ±1 day marker, the
 * alarm field, and the amber backlight. Each scenario is a fixed instant so the output is
 * reproducible and can be compared against a photograph without waiting for the right time of day.
 */
import { renderFace, type DisplayState } from './face.ts';
import { FACE_CSS } from './preview-css.ts';
import { cityForZone, lcdCodeForZone } from '../shared/catalog.ts';
import { syncWatch, type WatchSettings } from '../shared/watch.ts';
import type { Clock, DstMode } from '../shared/time.ts';
import type { ScreenMode, FlashField } from '../shared/machine.ts';

export interface Scenario {
	/** Heading shown above the watch. */
	readonly title: string;
	/** One line explaining what this scenario is meant to demonstrate. */
	readonly note: string;
	/** The zone whose time is displayed. */
	readonly zone: string;
	/** The Home City zone. */
	readonly homeZone: string;
	/** The instant to draw. */
	readonly at: Date;
	/** Presentation format. */
	readonly clock: Clock;
	/** Which screen state to draw. */
	readonly mode: ScreenMode;
	/** DST override for the displayed zone. */
	readonly dst: DstMode;
	readonly multiTime?: number;
	/** Show the transient `T-n` register indicator in place of the city code. */
	readonly showRegister?: boolean;
	readonly alarmNumber?: number;
	readonly muted?: boolean;
	readonly alarmArmed?: boolean;
	readonly signalOn?: boolean;
	readonly battery?: number;
	readonly illuminated?: boolean;

	/** The field currently flashing on a setting screen. */
	readonly flash?: FlashField | null;
	/** True while an alarm or the countdown is sounding. */
	readonly alerting?: boolean;

	readonly alarmHour?: number;
	readonly alarmMinute?: number;
	readonly alarmMode?: 'daily' | 'once' | 'off';
	readonly signalScreen?: boolean;

	readonly timerMs?: number;
	readonly timerRunning?: boolean;
	readonly timerSet?: { hours: number; minutes: number; seconds: number };

	readonly stopwatchMs?: number;
	readonly stopwatchRunning?: boolean;
	readonly stopwatchSplit?: boolean;
	readonly stopwatchWrapped?: boolean;

	readonly pressed?: readonly string[];
	readonly chord?: boolean;
	readonly illuminationMs?: number;
}

/**
 * Builds the display state a scenario implies.
 *
 * Delegates every *derived* field to `syncWatch`, which is the same code path the live widget uses.
 * An earlier version recomputed the offsets, day marker and DST label here, which meant the preview
 * could disagree with the widget; there is now exactly one implementation of that maths.
 *
 * The screen-specific values — a timer reading, a stopwatch reading, an alarm time — are supplied by
 * the scenario, because they are inputs rather than derivations. Screens the scenario does not name
 * are left `null` rather than zero-filled: a rendering test can then assert that the fields which do
 * not belong to a screen are genuinely absent from it, which a zero would hide.
 */
export function stateFor(scenario: Scenario): DisplayState {
	const settings: WatchSettings = {
		slots: [
			{ zone: scenario.homeZone, dst: 'auto' },
			{ zone: scenario.homeZone, dst: 'auto' },
			{ zone: scenario.homeZone, dst: 'auto' },
			{ zone: scenario.zone, dst: scenario.dst },
		],
		clock: scenario.clock,
		selected: 4,
	};

	const state = syncWatch(settings, scenario.at);
	const timerMs = scenario.timerMs ?? (scenario.mode === 'timer' ? 24 * 3_600_000 : null);
	const stopwatchMs = scenario.stopwatchMs ?? (scenario.mode === 'stopwatch' ? 0 : null);

	return {
		at: state.at,
		wall: state.wall,
		displayedOffset: state.displayedOffset,
		homeOffset: state.homeOffset,
		diffFromHome: state.diffFromHome,
		dayDiff: state.dayDiff,
		cityCode: state.cityCode,
		clock: state.settings.clock,
		mode: scenario.mode,
		dst: scenario.dst,
		dstLabel: state.dstLabel,
		multiTime: scenario.multiTime ?? 1,
		showRegister: scenario.showRegister ?? false,
		muted: scenario.muted ?? false,
		alarmArmed: scenario.alarmArmed ?? false,
		signalOn: scenario.signalOn ?? false,
		battery: scenario.battery ?? 1,
		homeWall: state.homeWall,
		illuminated: scenario.illuminated ?? false,
		flash: scenario.flash ?? null,
		alerting: scenario.alerting ?? false,

		alarmNumber: scenario.alarmNumber ?? null,
		alarmHour: scenario.alarmHour ?? null,
		alarmMinute: scenario.alarmMinute ?? null,
		alarmMode: scenario.alarmMode ?? null,
		signalScreen: scenario.signalScreen ?? false,

		timerMs,
		timerRunning: scenario.timerRunning ?? timerMs !== null,
		timerSet: scenario.timerSet ?? null,

		stopwatchMs,
		stopwatchRunning: scenario.stopwatchRunning ?? false,
		stopwatchSplit: scenario.stopwatchSplit ?? false,
		stopwatchWrapped: scenario.stopwatchWrapped ?? false,

		// The city's *name*, not its code: the World Time screen's date row exists to say where the
		// time is from, and the code already has its own field. An earlier version passed the code,
		// which made the two fields redundant and hid the name-fitting logic from every scenario.
		worldCity: cityForZone(scenario.zone)?.name ?? scenario.zone,
		worldIsUtc: scenario.zone === 'Etc/UTC' || scenario.zone === 'UTC',

		pressed: scenario.pressed ?? [],
		chord: scenario.chord ?? false,
		illuminationMs: scenario.illuminationMs ?? 1500,
	};
}

/** The scenarios the preview draws, in reading order: the live one first, then the fixed gallery. */
export function scenarios(now: Date): Scenario[] {
	// A fixed northern-summer instant for the static cases, so the output never drifts.
	const summer = new Date(Date.UTC(2026, 6, 15, 22, 48, 37));
	const winter = new Date(Date.UTC(2026, 0, 15, 14, 5, 9));
	const local = Intl.DateTimeFormat().resolvedOptions().timeZone;

	return [
		{
			// First, because it is the only card the controls act on and the only one that moves. It used
			// to be last, so the page opened with nineteen frozen faces and the interactive watch was
			// 600 KB further down.
			title: 'Live',
			note: 'The system clock and zone, updating every second. The controls above drive this AE-1200 face. The desktop shortcut opens the world-time board.',
			zone: local,
			homeZone: local,
			at: now,
			clock: '24h',
			mode: 'timekeeping',
			dst: 'auto',
		},
		{
			title: 'Timekeeping, 24-hour',
			note: 'Tokyo at 24-hour. The subdial always tracks the Home City (T-1), and the map band follows the displayed zone.',
			zone: 'Asia/Tokyo',
			homeZone: 'Asia/Tokyo',
			at: summer,
			clock: '24h',
			mode: 'timekeeping',
			dst: 'auto',
			alarmArmed: true,
		},
		{
			title: 'World Time, New York from Tokyo',
			note: 'The band sits on New York while the subdial stays on Tokyo. The date row carries the city name, and the ±1 day marker appears because the civil dates differ.',
			zone: 'America/New_York',
			homeZone: 'Asia/Tokyo',
			at: summer,
			clock: '12h',
			mode: 'worldtime',
			dst: 'auto',
			multiTime: 2,
			showRegister: true,
			signalOn: true,
		},
		{
			title: 'DST forced on, London in winter',
			note: 'A manual override, shown as DST* — the documented extension over the watch, whose city default is off.',
			zone: 'Europe/London',
			homeZone: 'Europe/London',
			at: winter,
			clock: '24h',
			mode: 'worldtime',
			dst: 'on',
			muted: true,
		},
		{
			title: 'Kathmandu, +05:45',
			note: 'A quarter-hour offset, which the watch lists but the reference catalogue shrank to a whole hour. The band is placed from the true offset.',
			zone: 'Asia/Kathmandu',
			homeZone: 'Asia/Kathmandu',
			at: summer,
			clock: '24h',
			mode: 'timekeeping',
			dst: 'auto',
		},
		{
			title: 'Alarm 3, daily',
			note: 'The centre-right field shows the alarm number instead of a city code (DIS-8), the date row shows its schedule, and the map reverts to the Home City rather than the displayed zone (MAP-4).',
			zone: 'America/Los_Angeles',
			homeZone: 'Europe/London',
			at: summer,
			clock: '12h',
			mode: 'alarm',
			dst: 'auto',
			alarmNumber: 3,
			alarmHour: 7,
			alarmMinute: 30,
			alarmMode: 'daily',
			alarmArmed: true,
			signalOn: true,
		},
		{
			title: 'Alarm, one-time and sounding',
			note: 'A One-time alarm shows 1TIME, and the ALM indicator blinks while it sounds (ALM-8, ALM-11).',
			zone: 'Europe/London',
			homeZone: 'Europe/London',
			at: summer,
			clock: '24h',
			mode: 'alarm',
			dst: 'auto',
			alarmNumber: 1,
			alarmHour: 22,
			alarmMinute: 48,
			alarmMode: 'once',
			alarmArmed: true,
			alerting: true,
		},
		{
			title: 'Hourly time signal',
			note: 'The sixth alarm screen is not an alarm: it has no time of its own, and its ADJUST press toggles the signal (ALM-9).',
			zone: 'Europe/London',
			homeZone: 'Europe/London',
			at: summer,
			clock: '24h',
			mode: 'alarm',
			dst: 'auto',
			signalScreen: true,
			signalOn: true,
			alarmArmed: true,
		},
		{
			title: 'Countdown Timer, 24 hours',
			note: "The timer's start value, printed as 24H rather than 24:00 (TMR-1), with the 1/10 s unit in the trailing block (TMR-2).",
			zone: 'Europe/London',
			homeZone: 'Europe/London',
			at: summer,
			clock: '24h',
			mode: 'timer',
			dst: 'auto',
			timerMs: 24 * 3_600_000,
			timerRunning: false,
		},
		{
			title: 'Countdown Timer, running',
			note: 'Mid-flight: 1 h 23 m 45.6 s to go, counting down. The map shows the Home City in Timer, as in Alarm and Stopwatch.',
			zone: 'Australia/Sydney',
			homeZone: 'Australia/Sydney',
			at: summer,
			clock: '24h',
			mode: 'timer',
			dst: 'auto',
			timerMs: 5_025_600,
			timerRunning: true,
			alarmArmed: true,
		},
		{
			title: 'Countdown Timer, setting the minutes',
			note: 'A setting screen: MODE moves the flashing field, SEARCH increments, LIGHT decrements, ADJUST exits (TMR-3). The flashing field is drawn faded here because a still page cannot blink.',
			zone: 'Europe/London',
			homeZone: 'Europe/London',
			at: summer,
			clock: '24h',
			mode: 'timer',
			dst: 'auto',
			timerMs: 1_140_000,
			timerRunning: false,
			flash: 'timer-minutes',
			timerSet: { hours: 0, minutes: 19, seconds: 0 },
		},
		{
			title: 'Stopwatch, running',
			note: "12 minutes 34.56 seconds. 1/100 s resolution needs the trailing block; the two bands together are the watch's own 23H59'59.99 display.",
			zone: 'Australia/Sydney',
			homeZone: 'Australia/Sydney',
			at: summer,
			clock: '24h',
			mode: 'stopwatch',
			dst: 'auto',
			stopwatchMs: 754_560,
			stopwatchRunning: true,
			battery: 0.62,
			alarmArmed: true,
		},
		{
			title: 'Stopwatch, split frozen',
			note: 'SPL shows while a split is held, and the reading is frozen while the watch keeps counting underneath (SW-4).',
			zone: 'Australia/Sydney',
			homeZone: 'Australia/Sydney',
			at: summer,
			clock: '24h',
			mode: 'stopwatch',
			dst: 'auto',
			stopwatchMs: 754_560,
			stopwatchRunning: true,
			stopwatchSplit: true,
			battery: 0.62,
		},
		{
			title: 'Stopwatch, rolled over',
			note: 'At 24 hours the reading resets to zero and keeps running until stopped (SW-8). The 24H marker is what keeps that from looking like a fault.',
			zone: 'Australia/Sydney',
			homeZone: 'Australia/Sydney',
			at: summer,
			clock: '24h',
			mode: 'stopwatch',
			dst: 'auto',
			stopwatchMs: 1_234,
			stopwatchRunning: true,
			stopwatchWrapped: true,
		},
		{
			title: 'Timekeeping, setting the hour',
			note: 'The Timekeeping setting screen: Seconds → City Code → DST → Hour → Minutes → 12/24 → Year → Month → Day → Illumination (TIM-5). The flashing field is faded.',
			zone: 'Europe/London',
			homeZone: 'Europe/London',
			at: summer,
			clock: '24h',
			mode: 'timekeeping',
			dst: 'auto',
			flash: 'hour',
			alarmArmed: true,
		},
		{
			title: 'Alarm, setting the hour',
			note: 'An alarm setting screen: Hour → Minutes → One-time/Daily, with SEARCH incrementing and LIGHT decrementing (ALM-4). Entering it arms the alarm as One-time (ALM-5), which is why the schedule field reads ONCE rather than OFF.',
			zone: 'Europe/London',
			homeZone: 'Europe/London',
			at: summer,
			clock: '24h',
			mode: 'alarm',
			dst: 'auto',
			alarmNumber: 1,
			alarmHour: 7,
			alarmMinute: 30,
			alarmMode: 'once',
			flash: 'hour',
			alarmArmed: true,
		},
		{
			title: 'World Time, the Local Time city picker',
			note: 'T-2..T-4 expose only the city code and DST, entered by a longer ADJUST hold (TIM-9). The city code is the flashing field; the date row carries the city name, which is what the picker is choosing.',
			zone: 'America/New_York',
			homeZone: 'Europe/London',
			at: summer,
			clock: '24h',
			mode: 'worldtime',
			dst: 'auto',
			multiTime: 2,
			flash: 'city',
			alarmArmed: true,
		},
		{
			title: 'Chord held',
			note: 'ADJUST + LIGHT promotes the displayed city to Home City (INT-6). Both pushers are drawn depressed while the chord is held (INT-8).',
			zone: 'Asia/Tokyo',
			homeZone: 'Europe/London',
			at: summer,
			clock: '24h',
			mode: 'worldtime',
			dst: 'auto',
			pressed: ['adjust', 'light'],
			chord: true,
		},
		{
			title: 'Illuminated',
			note: 'The amber LED wash from holding LIGHT, at the 1.5 s or 3 s duration set on the watch (LIT-1, LIT-2).',
			zone: 'Europe/London',
			homeZone: 'Europe/London',
			at: summer,
			clock: '24h',
			mode: 'timekeeping',
			dst: 'auto',
			battery: 0.31,
			illuminated: true,
		},
	];
}

/** The complete standalone HTML document. */
export function renderPreview(now: Date): string {
	const cards = scenarios(now)
		.map((scenario, index) => {
			const state = stateFor(scenario);
			const live = scenario.title === 'Live';
			return `
			<figure class="card${live ? ' live' : ''}" data-index="${index}">
				<div class="watch-slot">${renderFace(state)}</div>
				<figcaption>
					<strong>${escapeHtml(scenario.title)}</strong>
					<span>${escapeHtml(scenario.note)}</span>
					<code>${escapeHtml(describe(scenario))}</code>
				</figcaption>
			</figure>`;
		})
		.join('');

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>casioapp — face preview</title>
<style>${FACE_CSS}${PAGE_CSS}</style>
</head>
<body>
<header>
	<h1>casioapp — face preview</h1>
	<p>
		The Casio AE-1200WH face, drawn as SVG with no font and no raster image. Every letter and
		digit is built from the same seven segments. This preview exists because the widget cannot
		be launched in the development sandbox; it renders exactly the same code the widget will.
	</p>
	<p class="hint">
		What to judge: segment proportions and stroke weight, the LCD's yellow-green against the
		black case, whether the world map reads as a map, and whether the lit band is convincing.
	</p>
</header>
<section class="controls" id="controls">
	<h2>Live controls</h2>
	<p class="hint">
		These drive the <em>Live</em> card through the real <code>WatchController</code> — the same
		object, with the same gesture durations and the same screens, that the widget will run. The
		sliders exist because a mouse cannot hold a pusher for exactly one second; the card's own
		pushers can be clicked and held directly, and do the same thing.
	</p>
	<div class="control-row">
		<span class="control-label">Mode</span>
		<div class="buttons" id="mode-buttons"></div>
	</div>
	<div class="control-row">
		<span class="control-label">Gesture</span>
		<div class="buttons" id="gesture-buttons"></div>
	</div>
	<div class="control-row">
		<span class="control-label">Register</span>
		<div class="buttons" id="register-buttons"></div>
		<span class="control-label">Clock</span>
		<button type="button" data-action="clock">12 / 24 hour</button>
		<span class="control-label">Light</span>
		<div class="buttons" id="light-buttons"></div>
	</div>
	<div class="control-row">
		<span class="control-label">Zone</span>
		<div class="buttons" id="zone-buttons"></div>
	</div>
	<p class="status" id="status"></p>
	<p class="hint">Right-click the watch for the context menu the Electron shell will supply (INT-7).</p>
	<div class="context-menu" id="context-menu"></div>
</section>
<section class="gallery">
	<h2>Every screen</h2>
	<p class="hint">
		The same face at each mode and register it can reach, rendered from fixed instants so the
		images are stable. The <em>Live</em> card comes first and is the one the controls above drive.
	</p>
	<div class="cards">${cards}</div>
</section>
<script src="./bundle.js"></script>
<script>${LIVE_SCRIPT}</script>
</body>
</html>`;
}

/** A compact machine-readable line, useful when comparing two runs. */
function describe(scenario: Scenario): string {
	return [
		scenario.zone,
		lcdCodeForZone(scenario.zone),
		scenario.clock,
		scenario.mode,
		`dst:${scenario.dst}`,
	].join(' · ');
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

const PAGE_CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
	margin: 0;
	padding: 32px 24px 64px;
	background: #101210;
	color: #d8ded2;
	font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
header { max-width: 1100px; margin: 0 auto 28px; }
h1 { margin: 0 0 12px; font-size: 20px; font-weight: 600; letter-spacing: 0.02em; }
header p { margin: 0 0 8px; max-width: 76ch; color: #a9b3a2; }
header .hint { color: #8c9686; font-style: italic; }
/* The controls come first and the gallery below them. They used to sit at the very foot of the page,
   behind nineteen static cards — about 600 KB into a 612 KB document — and the user had to be told to
   scroll past everything to find them, which is a layout that hides the page's only interactive part. */
.gallery { max-width: 1400px; margin: 44px auto 0; }
.gallery h2 { margin: 0 0 6px; font-size: 15px; font-weight: 600; }
.gallery .hint { margin: 0 0 18px; max-width: 76ch; color: #8c9686; font-size: 12.5px; }
.cards {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(430px, 1fr));
	gap: 28px;
}
.card {
	margin: 0;
	background: #191c18;
	border: 1px solid #2a2f27;
	border-radius: 12px;
	overflow: hidden;
}
.watch-slot { display: grid; place-items: center; padding: 22px 18px; background: #0c0e0b; }
.card figcaption { padding: 12px 16px 16px; display: grid; gap: 4px; }
.card figcaption strong { font-size: 13px; letter-spacing: 0.01em; }
.card figcaption span { color: #9aa394; font-size: 12.5px; }
.card figcaption code { color: #6f7a68; font-size: 11.5px; font-family: ui-monospace, monospace; }
.watch { width: 100%; max-width: 380px; height: auto; display: block; }

/* ---- live controls -------------------------------------------------------------------- */

.controls {
	max-width: 1100px;
	margin: 0 auto;
	padding: 18px 20px 20px;
	background: #191c18;
	border: 1px solid #2a2f27;
	border-radius: 12px;
}
.controls h2 { margin: 0 0 6px; font-size: 15px; font-weight: 600; }
.controls .hint { margin: 0 0 14px; color: #8c9686; font-size: 12.5px; }
.controls code { font-family: ui-monospace, monospace; color: #b9c4b0; }
.control-row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	margin-bottom: 10px;
}
.control-label {
	color: #8c9686;
	font-size: 11.5px;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	min-width: 60px;
}
.buttons { display: flex; flex-wrap: wrap; gap: 6px; }
.controls button {
	background: #23271f;
	color: #d8ded2;
	border: 1px solid #3a4034;
	border-radius: 6px;
	padding: 5px 10px;
	font: inherit;
	font-size: 12.5px;
	cursor: pointer;
}
.controls button:hover { background: #2c3127; border-color: #4a5242; }
.controls button:active { background: #1b1f18; }
.status {
	margin: 12px 0 0;
	padding-top: 12px;
	border-top: 1px solid #2a2f27;
	color: #9aa394;
	font-family: ui-monospace, monospace;
	font-size: 12px;
}
/* The context menu's stand-in: the Electron shell will pop a native one. Hidden until the case is
   right-clicked, and positioned inline because the preview page has no popup layer. */
.context-menu {
	display: none;
	gap: 6px;
	margin-top: 10px;
	padding: 10px;
	background: #23271f;
	border: 1px solid #3a4034;
	border-radius: 8px;
}
.context-menu.open { display: flex; flex-wrap: wrap; }
.context-menu button {
	background: #2c3127;
	color: #d8ded2;
	border: 1px solid #4a5242;
	border-radius: 6px;
	padding: 5px 10px;
	font: inherit;
	font-size: 12.5px;
	cursor: pointer;
}
.context-menu button:disabled { opacity: 0.45; cursor: default; }
`;

/**
 * Drives the live card through the real `Watch` object.
 *
 * It re-renders the SVG wholesale on every change rather than diffing, because the face is a few
 * hundred elements and redrawing once a second costs nothing measurable. That also keeps the preview
 * honest: there is no separate update path that could drift from the widget's.
 */
const LIVE_SCRIPT = `
(function () {
	var modules = window.__modules;
	var controllerModule = modules.require('shared/controller');
	var face = modules.require('renderer/face');
	var machine = modules.require('shared/machine');
	var catalog = modules.require('shared/catalog');
	var time = modules.require('shared/time');

	var slot = document.querySelector('.card.live .watch-slot');
	if (!slot) { return; }

	// The preview binds the controller to real time, because that is the point of the live card: a
	// fixed instant would show the screens but never the transitions.
	var store = null;
	try {
		if (window.localStorage) {
			store = {
				load: function () { return window.localStorage.getItem('casioapp.controller'); },
				save: function (value) { window.localStorage.setItem('casioapp.controller', value); }
			};
		}
	} catch (error) { store = null; }

	var watch = new controllerModule.WatchController({
		now: function () { return Date.now(); },
		mono: function () { return (window.performance && window.performance.now) ? window.performance.now() : Date.now(); },
		setTimer: function (fn, ms) {
			var handle = setTimeout(fn, ms);
			return function () { clearTimeout(handle); };
		},
		store: store
	});

	var QUICK_ZONES = [
		'Europe/London', 'America/New_York', 'America/Los_Angeles',
		'Asia/Tokyo', 'Asia/Kathmandu', 'Australia/Adelaide',
		'Pacific/Chatham', 'Pacific/Kiritimati', 'Etc/UTC'
	];

	// The four pushers, in the order the case prints them.
	var PUSHERS = ['adjust', 'light', 'mode', 'search'];

	function render() {
		slot.innerHTML = face.renderFace(watch.faceState());
		setStatus();
	}

	function setStatus() {
		var status = document.getElementById('status');
		if (!status) { return; }
		var faceState = watch.faceState();
		var parts = [
			faceState.mode,
			faceState.cityCode,
			time.formatOffset(faceState.displayedOffset),
			faceState.clock,
			'flash ' + (faceState.flash === null ? 'none' : faceState.flash),
			'alert ' + (faceState.alert === null ? 'none' : faceState.alert.kind),
			'mute ' + (faceState.muted ? 'on' : 'off'),
			'battery ' + watch.batteryPercent() + '%'
		];
		if (faceState.mode === 'timer' && faceState.timerMs !== null) {
			parts.push('timer ' + (faceState.timerMs / 1000).toFixed(1) + 's');
		}
		if (faceState.mode === 'stopwatch' && faceState.stopwatchMs !== null) {
			parts.push('stopwatch ' + (faceState.stopwatchMs / 1000).toFixed(2) + 's');
		}
		status.textContent = parts.join('  \\u00b7  ');
	}

	/**
	 * Clicks one of the card's own pushers.
	 *
	 * The SVG pushers are found by class, and the hold is produced by the *gesture reader's* own
	 * clock rather than by a synthesised sequence — pressing and releasing really does go through
	 * down() and up(), which is what makes the live card a test of the gesture code as well as of
	 * the drawing.
	 */
	function pusherElement(name) {
		return slot.querySelector('.pusher-' + name);
	}

	PUSHERS.forEach(function (name) {
		var element = pusherElement(name);
		if (!element) { return; }
		element.style.cursor = 'pointer';
		element.addEventListener('mousedown', function (event) {
			event.preventDefault();
			watch.down(name);
		});
		element.addEventListener('mouseup', function () { watch.up(name); });
		element.addEventListener('mouseleave', function () { watch.up(name); });
	});

	// A convenience row: a full gesture in one click. A mouse cannot hold a pusher for exactly one
	// second, and the durations are the thing M7 is about, so they are offered directly.
	function buildGestureButtons() {
		var box = document.getElementById('gesture-buttons');
		if (!box) { return; }
		var gestures = [
			{ label: 'ADJUST press', run: function () { tap('adjust'); } },
			{ label: 'ADJUST hold 1s', run: function () { hold('adjust', 1000); } },
			{ label: 'ADJUST hold 2s', run: function () { hold('adjust', 2000); } },
			{ label: 'MODE press', run: function () { tap('mode'); } },
			{ label: 'MODE hold 1s (mute)', run: function () { hold('mode', 1000); } },
			{ label: 'SEARCH press', run: function () { tap('search'); } },
			{ label: 'SEARCH hold 3s', run: function () { hold('search', 3000); } },
			{ label: 'LIGHT press', run: function () { tap('light'); } },
			{ label: 'ADJUST + LIGHT', run: function () { chord(); } }
		];
		gestures.forEach(function (gesture) {
			var button = document.createElement('button');
			button.type = 'button';
			button.textContent = gesture.label;
			button.addEventListener('click', gesture.run);
			box.appendChild(button);
		});
	}

	function tap(name) { watch.down(name); watch.up(name); }

	/**
	 * A hold, driven through the controller's own tick loop.
	 *
	 * The clock is not faked: the controller is started and its scheduled timer runs. What this does
	 * is press, wait, and release — exactly what a finger does — so the durations under test are the
	 * real ones.
	 */
	function hold(name, ms) {
		watch.down(name);
		window.setTimeout(function () { watch.up(name); }, ms + 120);
	}

	function chord() {
		watch.down('adjust');
		window.setTimeout(function () {
			watch.down('light');
			window.setTimeout(function () {
				watch.up('light');
				watch.up('adjust');
			}, 60);
		}, 60);
	}

	function buildModeButtons() {
		var box = document.getElementById('mode-buttons');
		if (!box) { return; }
		machine.MODE_CYCLE.forEach(function (mode) {
			var button = document.createElement('button');
			button.type = 'button';
			button.textContent = mode;
			// Straight to the screen, through the controller's own cycle walk, so the departure rules
			// apply (SW-7 clears a frozen split on the way out of the stopwatch) and the sub-screens
			// survive the trip.
			button.addEventListener('click', function () { watch.setMode(mode); });
			box.appendChild(button);
		});

		var lightBox = document.getElementById('light-buttons');
		if (lightBox) {
			[1500, 3000].forEach(function (ms) {
				var button = document.createElement('button');
				button.type = 'button';
				button.textContent = (ms / 1000).toFixed(1) + ' s light';
				button.addEventListener('click', function () { watch.setIlluminationMs(ms); });
				lightBox.appendChild(button);
			});
		}
	}

	/**
	 * The context menu (requirement INT-7).
	 *
	 * A widget has no native menu of its own — the Electron shell will supply one through its own
	 * popup call — so this is a stand-in that exercises the same four actions through the same
	 * controller method. The two actions the controller does not own (settings, quit) are shown and
	 * disabled rather than omitted, so the menu is complete and the boundary is visible.
	 *
	 * No backticks anywhere in this script: it is emitted inside a template literal, and one would end
	 * the string and break the page. The build's verifier catches that, which is the point of it.
	 */
	function buildContextMenu() {
		var menu = document.getElementById('context-menu');
		if (!menu) { return; }

		var actions = [
			{ label: 'Switch mode', action: 'mode', owned: true },
			{ label: 'Settings…', action: 'settings', owned: false },
			{ label: 'Reset battery', action: 'battery-reset', owned: true },
			{ label: 'Quit', action: 'quit', owned: false }
		];

		actions.forEach(function (entry) {
			var button = document.createElement('button');
			button.type = 'button';
			button.textContent = entry.label;
			if (entry.owned) {
				button.addEventListener('click', function () {
					watch.contextAction(entry.action);
					hideContextMenu();
				});
			} else {
				button.disabled = true;
				button.title = 'the Electron shell owns this one';
			}
			menu.appendChild(button);
		});

		slot.addEventListener('contextmenu', function (event) {
			event.preventDefault();
			menu.classList.add('open');
		});
		document.addEventListener('click', function (event) {
			if (menu.classList.contains('open') && !menu.contains(event.target)) {
				hideContextMenu();
			}
		});
	}

	function hideContextMenu() {
		var menu = document.getElementById('context-menu');
		if (menu) { menu.classList.remove('open'); }
	}

	function buildRegisterButtons() {
		var box = document.getElementById('register-buttons');
		if (!box) { return; }
		for (var i = 1; i <= 4; i++) {
			(function (index) {
				var button = document.createElement('button');
				button.type = 'button';
				button.textContent = 'T-' + index;
				button.addEventListener('click', function () { watch.selectRegister(index); });
				box.appendChild(button);
			})(i);
		}
	}

	function buildZoneButtons() {
		var box = document.getElementById('zone-buttons');
		if (!box) { return; }
		QUICK_ZONES.forEach(function (zone) {
			var button = document.createElement('button');
			button.type = 'button';
			button.textContent = catalog.lcdCodeForZone(zone);
			button.title = zone;
			button.addEventListener('click', function () {
				watch.setZone(watch.getState().register, zone);
			});
			box.appendChild(button);
		});
	}

	var controls = document.getElementById('controls');
	if (controls) {
		controls.addEventListener('click', function (event) {
			var action = event.target && event.target.getAttribute
				? event.target.getAttribute('data-action')
				: null;
			if (action === 'clock') { watch.toggleClock(); }
		});
	}

	buildModeButtons();
	buildGestureButtons();
	buildRegisterButtons();
	buildZoneButtons();
	buildContextMenu();

	watch.subscribe(function () { render(); });
	watch.start();
})();
`;
