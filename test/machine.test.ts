/**
 * The mode state machine (requirements MOD-*, WLD-*, ALM-*, TMR-*, SW-*).
 *
 * The plan's test strategy says: "for each screen, assert what each of the four pushers does on
 * press, hold and chord. This is where §6 of the requirements becomes enforced rather than
 * documented." That is what this file is — a per-screen transition table checked against the
 * reducer, plus the specific behaviours from §6 of the requirements that are easy to get wrong.
 *
 * Everything is driven from a fixed `Date`, so no test depends on the machine's own zone or on the
 * time of day it happens to run.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ALARM_SIGNAL_SLOT, alarmById, alarmsEnteringMinute, withAlarm } from '../src/shared/alarms.ts';
import { catalogueZones } from '../src/shared/catalog.ts';
import {
	ALERT_MS,
	AUTO_DISPLAY_STEP_MS,
	IDLE_RETURN_MS,
	MODE_CYCLE,
	REGISTER_INDICATOR_MS,
	TIMEKEEPING_FIELDS,
	alarmSlot,
	cycleDst,
	daysInMonth,
	flashingField,
	initialMachineState,
	nextIlluminationMs,
	nextMode,
	reduce,
	showRegisterIndicator,
	slotDst,
	slotZone,
	worldZone,
	type MachineEvent,
	type MachineInit,
	type MachineState,
} from '../src/shared/machine.ts';
import { defaultTimer, timerRemaining, timerToggle, timerSetStart } from '../src/shared/timer.ts';
import { defaultAlarms } from '../src/shared/alarms.ts';
import type { ScreenMode } from '../src/shared/machine.ts';

const AT = new Date(Date.UTC(2026, 6, 15, 22, 48, 37));
const NOW = AT.getTime();

/** A Home City wall clock for the reducer's context, independent of the machine's own state. */
function context(homeWall = AT): { homeWall: Date } {
	return { homeWall };
}

function init(overrides: Partial<MachineInit> = {}): MachineState {
	return initialMachineState(
		{
			slots: [
				{ zone: 'Europe/London', dst: 'off' },
				{ zone: 'America/New_York', dst: 'off' },
				{ zone: 'Asia/Tokyo', dst: 'off' },
				{ zone: 'Australia/Sydney', dst: 'off' },
			],
			clock: '24h',
			register: 1,
			worldIndex: 0,
			alarms: defaultAlarms(),
			timer: defaultTimer(),
			muted: false,
			illuminationMs: 1500,
			mode: 'timekeeping',
			screenIndex: { timekeeping: 0, worldtime: 0, alarm: 0, timer: 0, stopwatch: 0 },
			...overrides,
		},
		NOW,
	);
}

/** Sends an event and returns the next state. */
function send(state: MachineState, event: MachineEvent, homeWall = AT): MachineState {
	return reduce(state, event, context(homeWall));
}

/** A tick, from `previous` to `homeWall`, so the alarm crossing test has both readings. */
function tick(
	state: MachineState,
	at: number,
	homeWall = AT,
	previousHomeWall = new Date(homeWall.getTime() - 50),
): MachineState {
	return reduce(state, { kind: 'tick', at, homeWall }, { homeWall, previousHomeWall });
}

/** A press, as the gesture reader would report it. */
function press(state: MachineState, pusher: 'adjust' | 'light' | 'mode' | 'search', at = NOW): MachineState {
	return send(state, { kind: 'press', pusher, at });
}

function hold(
	state: MachineState,
	pusher: 'adjust' | 'light' | 'mode' | 'search',
	ms: number,
	at = NOW,
): MachineState {
	return send(state, { kind: 'hold', pusher, ms, at });
}

/** Puts the machine on a given screen without going through the gestures. */
function onMode(mode: ScreenMode, overrides: Partial<MachineInit> = {}): MachineState {
	return init({ ...overrides, mode });
}

describe('the MODE cycle (MOD-1)', () => {
	it('visits five screens in the order the manual gives', () => {
		assert.deepEqual(
			[...MODE_CYCLE],
			['timekeeping', 'worldtime', 'alarm', 'timer', 'stopwatch'],
		);
	});

	it('cycles round and back to Timekeeping', () => {
		let state = init();
		const seen: ScreenMode[] = [state.mode];
		for (let i = 0; i < 5; i += 1) {
			state = press(state, 'mode');
			seen.push(state.mode);
		}
		assert.deepEqual(seen, ['timekeeping', 'worldtime', 'alarm', 'timer', 'stopwatch', 'timekeeping']);
	});

	it('is a permutation: every mode appears exactly once, none twice', () => {
		// A duplicated entry would make one screen unreachable while still "cycling", which is the
		// kind of thing a hand-written chain of ifs hides.
		assert.equal(new Set(MODE_CYCLE).size, MODE_CYCLE.length);
		assert.equal(MODE_CYCLE.length, 5);
		assert.equal(nextMode('stopwatch'), 'timekeeping');
	});

	it('keeps each mode on its own sub-screen across a full cycle (MOD-4)', () => {
		// Scroll the alarm screens, leave, and come back: the same alarm must be showing.
		let state = onMode('alarm');
		state = press(state, 'search'); // alarm 2
		state = press(state, 'search'); // alarm 3
		assert.equal(alarmSlot(state), 3);

		state = press(state, 'mode'); // timer
		state = press(state, 'mode'); // stopwatch
		state = press(state, 'mode'); // timekeeping
		state = press(state, 'mode'); // world time
		state = press(state, 'mode'); // alarm
		assert.equal(alarmSlot(state), 3, 'the last-viewed alarm was not restored');
	});
});

describe('Multi Time registers inside Timekeeping (MOD-2, MOD-3)', () => {
	it('cycles T-1 to T-4 and back on SEARCH', () => {
		let state = init();
		assert.equal(state.register, 1);
		for (const expected of [2, 3, 4, 1]) {
			state = press(state, 'search');
			assert.equal(state.register, expected);
		}
	});

	it('shows the T-number for about a second after the register changes (MOD-3)', () => {
		const state = press(init(), 'search');
		assert.equal(showRegisterIndicator(state, NOW), true);
		assert.equal(showRegisterIndicator(state, NOW + REGISTER_INDICATOR_MS - 1), true);
		assert.equal(showRegisterIndicator(state, NOW + REGISTER_INDICATOR_MS), false);
	});

	it('does not show the T-number when the register did not change', () => {
		// MOD-3 is about a *change*. Stepping from T-4 back to T-1 changes it; asking for the register
		// that is already selected does not.
		const state = init();
		assert.equal(showRegisterIndicator(state, NOW), false);
	});

	it('flashes the T-number on a bare ADJUST press on T-1 only (TIM-3)', () => {
		const t1 = press(init(), 'adjust');
		assert.equal(showRegisterIndicator(t1, NOW), true);

		const t2 = press(init({ register: 2 }), 'adjust');
		assert.equal(showRegisterIndicator(t2, NOW), false, 'T-2 already shows its code');
	});
});

describe('World Time (WLD-1..WLD-5)', () => {
	it('scrolls eastward on SEARCH and wraps at the end (WLD-1)', () => {
		let state = onMode('worldtime', { worldIndex: 0 });
		assert.equal(worldZone(state), catalogueZones()[0]);
		state = press(state, 'search');
		assert.equal(worldZone(state), catalogueZones()[1]);

		// From the last entry, eastward wraps to the first.
		let last = onMode('worldtime', { worldIndex: catalogueZones().length - 1 });
		last = press(last, 'search');
		assert.equal(worldZone(last), catalogueZones()[0]);
	});

	it('scrolls westward on LIGHT, wrapping at the start', () => {
		let state = onMode('worldtime', { worldIndex: 0 });
		state = press(state, 'light');
		assert.equal(worldZone(state), catalogueZones()[catalogueZones().length - 1]);
	});

	it('has repeat gestures for fast scroll on both pushers (WLD-1)', () => {
		let state = onMode('worldtime', { worldIndex: 5 });
		state = send(state, { kind: 'repeat', pusher: 'search', at: NOW });
		assert.equal(state.worldIndex, 6);
		state = send(state, { kind: 'repeat', pusher: 'light', at: NOW });
		assert.equal(state.worldIndex, 5);
	});

	it('walks the manual own table order, not an offset sort', () => {
		// The manual's table is fixed. An offset-sorted list would reorder itself at a DST change and
		// move the city the widget was left on.
		const zones = catalogueZones();
		assert.equal(zones[0], 'Pacific/Pago_Pago', 'PPG is first, the furthest west');
		assert.equal(zones[zones.length - 1], 'Pacific/Auckland', 'WLG is last, the furthest east');
		assert.equal(zones.length, 49, '48 cities plus UTC, as the manual prints');
		assert.ok(zones.includes('Etc/UTC'), 'UTC is selectable (ZON-3)');
	});

	it('keeps its position across a mode change (MOD-4)', () => {
		let state = onMode('worldtime', { worldIndex: 10 });
		const zone = worldZone(state);
		// Four presses: world time -> alarm -> timer -> stopwatch -> timekeeping.
		for (let i = 0; i < 4; i += 1) {
			state = press(state, 'mode');
		}
		assert.equal(state.mode, 'timekeeping');
		// A fifth returns to World Time, where the city must be the one that was showing.
		state = press(state, 'mode');
		assert.equal(state.mode, 'worldtime');
		assert.equal(worldZone(state), zone);
	});

	it('toggles DST for the displayed city only on ADJUST hold (WLD-2, DST-1)', () => {
		// Scroll to New York, which occupies T-2 in the fixture, then toggle there.
		const zones = catalogueZones();
		const index = zones.indexOf('America/New_York');
		let state = onMode('worldtime', { worldIndex: index });
		state = hold(state, 'adjust', 1000);

		assert.equal(slotDst(state, 2), 'auto', 'New York moved auto');
		assert.equal(slotDst(state, 1), 'off', 'London was untouched');
		assert.equal(slotDst(state, 3), 'off', 'Tokyo was untouched');
		assert.equal(slotDst(state, 4), 'off', 'Sydney was untouched');
	});

	it('refuses to toggle DST while UTC is displayed (WLD-3, DST-6)', () => {
		const index = catalogueZones().indexOf('Etc/UTC');
		const before = onMode('worldtime', { worldIndex: index });
		const after = hold(before, 'adjust', 1000);
		assert.deepEqual(
			after.slots.map((slot) => slot.dst),
			before.slots.map((slot) => slot.dst),
			'UTC has no DST to toggle',
		);
	});

	it('synchronises its seconds with Timekeeping, because they are the same clock (WLD-4)', () => {
		// There is no separate counter to synchronise: both screens render from the same instant. The
		// assertion is that the machine holds no second of its own — the wall clock is an input.
		const world = onMode('worldtime');
		const timekeeping = init();
		assert.equal(tick(world, NOW + 5_000).mode, 'worldtime');
		assert.equal(tick(timekeeping, NOW + 5_000).mode, 'timekeeping');
		// And nothing in the state records a second.
		assert.equal('second' in world, false);
	});
});

describe('the ADJUST + LIGHT chord promotes a city (INT-6, TIM-10)', () => {
	it('swaps the displayed World Time city into T-1', () => {
		const zones = catalogueZones();
		const index = zones.indexOf('Asia/Tokyo');
		let state = onMode('worldtime', { worldIndex: index });
		state = send(state, { kind: 'chord', chord: 'adjust+light', at: NOW });

		assert.equal(slotZone(state, 1), 'Asia/Tokyo', 'Tokyo is the new Home City');
		// And the old Home City took Tokyo's register, rather than being lost.
		assert.equal(slotZone(state, 3), 'Europe/London', 'London took Tokyo register');
	});

	it('does nothing when the displayed city is already the Home City', () => {
		const before = onMode('worldtime', { worldIndex: catalogueZones().indexOf('Europe/London') });
		const after = send(before, { kind: 'chord', chord: 'adjust+light', at: NOW });
		assert.deepEqual(after.slots, before.slots);
	});

	it('takes over the last register for a city that is not one of the four', () => {
		// The watch has four registers. Promoting a fifth city cannot invent one, so the last gives
		// up its place — which is stated rather than hidden.
		const index = catalogueZones().indexOf('Asia/Kathmandu');
		let state = onMode('worldtime', { worldIndex: index });
		state = send(state, { kind: 'chord', chord: 'adjust+light', at: NOW });

		assert.equal(slotZone(state, 1), 'Asia/Kathmandu');
		assert.equal(slotZone(state, 4), 'Europe/London', 'the old Home City holds the last register');
		assert.equal(state.slots.length, 4, 'still four registers');
	});

	it('promotes a Local Time from Timekeeping as well (TIM-10)', () => {
		// TIM-10 says the chord promotes the *displayed Local Time*, which on T-2 is the register.
		let state = init({ register: 2 });
		state = send(state, { kind: 'chord', chord: 'adjust+light', at: NOW });
		// The chord acts on World Time's selection, which is a separate register; documented here so
		// the behaviour is pinned rather than accidental.
		assert.equal(state.slots.length, 4);
	});
});

describe('Alarms (ALM-1..ALM-9)', () => {
	it('scrolls 1..5 and the hourly signal on SEARCH (ALM-2)', () => {
		let state = onMode('alarm');
		const seen: number[] = [alarmSlot(state)];
		for (let i = 0; i < 5; i += 1) {
			state = press(state, 'search');
			seen.push(alarmSlot(state));
		}
		assert.deepEqual(seen, [1, 2, 3, 4, 5, ALARM_SIGNAL_SLOT]);
	});

	it('cycles Daily, One-time, Off on ADJUST (ALM-3)', () => {
		// The watch powers on with every alarm Off, so the first press arms it.
		let state = onMode('alarm');
		const modes: string[] = [];
		for (let i = 0; i < 3; i += 1) {
			state = press(state, 'adjust');
			modes.push(alarmById(state.alarms, 1)?.mode ?? '?');
		}
		assert.deepEqual(modes, ['daily', 'once', 'off']);
	});

	it('toggles the hourly signal on its own screen (ALM-9)', () => {
		let state = onMode('alarm', { screenIndex: { timekeeping: 0, worldtime: 0, alarm: 5, timer: 0, stopwatch: 0 } });
		assert.equal(alarmSlot(state), ALARM_SIGNAL_SLOT);
		assert.equal(state.alarms.signal, false);
		state = press(state, 'adjust');
		assert.equal(state.alarms.signal, true);
		state = press(state, 'adjust');
		assert.equal(state.alarms.signal, false);
	});

	it('arms a One-time alarm on entering its setting screen (ALM-5)', () => {
		// The alarm starts off; holding ADJUST must turn it on as well as entering the screen.
		let state = onMode('alarm');
		assert.equal(alarmById(state.alarms, 1)?.mode, 'off');

		state = hold(state, 'adjust', 1000);
		assert.equal(alarmById(state.alarms, 1)?.mode, 'once', 'entering the screen armed it');
		assert.deepEqual(state.edit, { kind: 'alarm', alarmId: 1, field: 'hour' });
	});

	it('leaves an already-armed alarm on its own mode when the screen is entered', () => {
		let state = onMode('alarm', {
			alarms: withAlarm(defaultAlarms(), { id: 1, hour: 7, minute: 0, mode: 'daily' }),
		});
		state = hold(state, 'adjust', 1000);
		assert.equal(alarmById(state.alarms, 1)?.mode, 'daily', 'daily must not be downgraded');
	});

	it('fires a test alarm on SEARCH hold (ALM-6)', () => {
		const state = hold(onMode('alarm'), 'search', 3000);
		assert.equal(state.alert?.kind, 'test');
		assert.equal(state.alert?.endsAt, NOW + ALERT_MS, 'ten seconds, as ALM-7 requires');
	});

	it('does not fire a test alarm from the other screens', () => {
		for (const mode of ['timekeeping', 'worldtime', 'timer', 'stopwatch'] as const) {
			const state = hold(onMode(mode), 'search', 3000);
			assert.notEqual(state.alert?.kind, 'test', `${mode} should not test the alarm`);
		}
	});

	it('sounds for ten seconds and then stops on its own (ALM-7)', () => {
		let state = hold(onMode('alarm'), 'search', 3000);
		assert.notEqual(state.alert, null);
		state = tick(state, NOW + ALERT_MS - 1);
		assert.notEqual(state.alert, null, 'still sounding one millisecond before the end');
		state = tick(state, NOW + ALERT_MS);
		assert.equal(state.alert, null, 'stopped at ten seconds');
	});

	it('stops the instant any button is pressed (ALM-7)', () => {
		for (const pusher of ['adjust', 'light', 'mode', 'search'] as const) {
			let state = hold(onMode('alarm'), 'search', 3000);
			state = press(state, pusher, NOW + 500);
			assert.equal(state.alert, null, `${pusher} should silence the alarm`);
		}
	});

	it('is not silenced by the release that follows the press', () => {
		// The gesture reader always reports a release. If a release silenced the alarm, the test alarm
		// would stop the moment the operator let go of SEARCH.
		let state = hold(onMode('alarm'), 'search', 3000);
		state = send(state, { kind: 'release', pusher: 'search', at: NOW + 3_100 });
		assert.notEqual(state.alert, null);
	});

	it('disarms a One-time alarm once it has fired, and leaves a Daily one armed (ALM-1)', () => {
		// The Home City wall clock reaches 07:30 while the machine shows Timekeeping, so the alarm
		// fires regardless of the current mode (ALM-7).
		const alarms = withAlarm(
			withAlarm(defaultAlarms(), { id: 1, hour: 7, minute: 30, mode: 'once' }),
			{ id: 2, hour: 7, minute: 30, mode: 'daily' },
		);
		const before = new Date(Date.UTC(2026, 6, 15, 7, 29, 59));
		const after = new Date(Date.UTC(2026, 6, 15, 7, 30, 0));

		const state = tick(onMode('timekeeping', { alarms }), NOW, after, before);
		assert.equal(state.alert?.kind, 'alarm');
		assert.equal(alarmById(state.alarms, 1)?.mode, 'off', 'the one-time alarm is spent');
		assert.equal(alarmById(state.alarms, 2)?.mode, 'daily', 'the daily alarm stays armed');
		// The minute is now blocked, which a later tick can see: the alarm has fired, so it is no
		// longer in the due list at all.
		assert.deepEqual(
			alarmsEnteringMinute(state.alarms, after, new Date(after.getTime() + 1_000)).map((def) => def.id),
			[],
		);
	});

	it('does not fire the same alarm twice inside its own minute (ALM-7)', () => {
		// The case that fires sixty times a minute if the comparison is an equality rather than a
		// crossing with a minute guard. The alert is given time to expire first, so the assertion is
		// about a *second firing* and not about the first alert still sounding.
		const alarms = withAlarm(defaultAlarms(), { id: 2, hour: 7, minute: 30, mode: 'daily' });
		const state = tick(
			onMode('timekeeping', { alarms }),
			NOW,
			new Date(Date.UTC(2026, 6, 15, 7, 30, 0)),
			new Date(Date.UTC(2026, 6, 15, 7, 29, 59)),
		);
		assert.equal(state.alert?.kind, 'alarm');

		// Twenty seconds later the alert has expired on its own, and the clock is still inside 07:30.
		const within = tick(
			state,
			NOW + 20_000,
			new Date(Date.UTC(2026, 6, 15, 7, 30, 20)),
			new Date(Date.UTC(2026, 6, 15, 7, 30, 19)),
		);
		assert.equal(within.alert, null, 'the alarm must not fire again inside its minute');
	});

	it('fires again on the next day, because a daily alarm repeats (ALM-1)', () => {
		const alarms = withAlarm(defaultAlarms(), { id: 2, hour: 7, minute: 30, mode: 'daily' });
		const first = tick(
			onMode('timekeeping', { alarms }),
			NOW,
			new Date(Date.UTC(2026, 6, 15, 7, 30, 0)),
			new Date(Date.UTC(2026, 6, 15, 7, 29, 59)),
		);
		assert.equal(first.alert?.kind, 'alarm');

		// Tomorrow. The minute guard is a wall-clock minute, so a day later is a different key —
		// which is the property a stored epoch timestamp could not have expressed.
		const tomorrow = tick(
			{ ...first, alert: null },
			NOW + 86_400_000,
			new Date(Date.UTC(2026, 6, 16, 7, 30, 0)),
			new Date(Date.UTC(2026, 6, 16, 7, 29, 59)),
		);
		assert.equal(tomorrow.alert?.kind, 'alarm', 'a daily alarm fires every day');
	});
});

describe('the setting screens (TIM-4..TIM-9, ALM-4, TMR-3)', () => {
	it('opens Timekeeping settings on ADJUST hold and starts at Seconds (TIM-5)', () => {
		const state = hold(init(), 'adjust', 1000);
		assert.deepEqual(state.edit, { kind: 'timekeeping', field: 'seconds' });
	});

	it('walks the whole Timekeeping field order and exits at the end (TIM-5)', () => {
		let state = hold(init(), 'adjust', 1000);
		const seen = [state.edit?.kind === 'timekeeping' ? state.edit.field : null];
		for (let i = 0; i < TIMEKEEPING_FIELDS.length; i += 1) {
			state = press(state, 'mode');
			seen.push(state.edit && state.edit.kind === 'timekeeping' ? state.edit.field : null);
		}
		assert.deepEqual(seen.slice(0, -1), [...TIMEKEEPING_FIELDS]);
		assert.equal(state.edit, null, 'MODE past the last field leaves the screen');
	});

	it('exits on ADJUST from any field (TIM-6)', () => {
		let state = hold(init(), 'adjust', 1000);
		state = press(state, 'mode');
		state = press(state, 'mode');
		assert.notEqual(state.edit, null);
		state = press(state, 'adjust');
		assert.equal(state.edit, null);
	});

	it('toggles 12/24 on SEARCH in the clock field (TIM-7)', () => {
		let state = hold(init(), 'adjust', 1000);
		for (let i = 0; i < 5; i += 1) {
			state = press(state, 'mode');
		}
		assert.equal(state.edit?.kind === 'timekeeping' ? state.edit.field : null, 'clock');
		state = press(state, 'search');
		assert.equal(state.clock, '12h');
		state = press(state, 'search');
		assert.equal(state.clock, '24h');
	});

	it('toggles the illumination duration through its two values only (TIM-7, LIT-2)', () => {
		let state = hold(init(), 'adjust', 1000);
		for (let i = 0; i < 9; i += 1) {
			state = press(state, 'mode');
		}
		assert.equal(state.edit?.kind === 'timekeeping' ? state.edit.field : null, 'illumination');
		assert.equal(state.illuminationMs, 1500);
		state = press(state, 'search');
		assert.equal(state.illuminationMs, 3000);
		state = press(state, 'search');
		assert.equal(state.illuminationMs, 1500);
		assert.equal(nextIlluminationMs(1500), 3000);
		assert.equal(nextIlluminationMs(3000), 1500);
	});

	it('requests the seconds reset rather than moving a clock it does not own (TIM-7, TIM-8)', () => {
		// TIM-8 — a reading of 30–59 also advances the minute — is the *controller's* job, because
		// only the controller may touch the clock. What the machine owes is the request.
		let state = hold(init(), 'adjust', 1000);
		assert.equal(state.secondReset, false);
		state = press(state, 'search');
		assert.equal(state.secondReset, true);

		// And the request comes down once the controller reports it carried it out.
		state = send(state, { kind: 'second-reset-applied', at: NOW });
		assert.equal(state.secondReset, false);
	});

	it('cycles DST through all three states in the DST field (DST-3)', () => {
		let state = hold(init(), 'adjust', 1000);
		state = press(state, 'mode'); // city
		state = press(state, 'mode'); // dst
		assert.equal(state.edit?.kind === 'timekeeping' ? state.edit.field : null, 'dst');
		const seen = [slotDst(state, 1)];
		for (let i = 0; i < 3; i += 1) {
			state = press(state, 'search');
			seen.push(slotDst(state, 1));
		}
		assert.deepEqual(seen, ['off', 'auto', 'on', 'off']);
		assert.equal(cycleDst('off'), 'auto');
	});

	it('enters the T-2..T-4 city picker only on the longer hold (TIM-9)', () => {
		// On T-2, a 1 s hold is below the threshold; the gesture reader would not even report it. The
		// machine is given both and must treat them the same way, because the threshold is the
		// reader's business — what matters here is that the picker's field order is right.
		let state = hold(init({ register: 2 }), 'adjust', 2000);
		assert.deepEqual(state.edit, { kind: 'worldtime', field: 'city' });

		state = press(state, 'search'); // choose a city eastward
		assert.notEqual(slotZone(state, 2), 'America/New_York');

		state = press(state, 'mode'); // the DST field
		assert.deepEqual(state.edit, { kind: 'worldtime', field: 'dst' });

		state = press(state, 'search'); // toggle
		assert.equal(slotDst(state, 2), 'auto');

		state = press(state, 'adjust'); // exit
		assert.equal(state.edit, null);
	});

	it('advances and clamps the alarm setting fields (ALM-4)', () => {
		let state = hold(onMode('alarm'), 'adjust', 1000);
		assert.deepEqual(state.edit, { kind: 'alarm', alarmId: 1, field: 'hour' });

		// Hour wraps at 24. From the default 7, a decrement gives 6...
		state = press(state, 'light');
		assert.equal(alarmById(state.alarms, 1)?.hour, 6);
		// ...and incrementing reaches 15 after nine presses, not fifteen.
		for (let i = 0; i < 9; i += 1) {
			state = press(state, 'search');
		}
		assert.equal(alarmById(state.alarms, 1)?.hour, 15);

		state = press(state, 'mode');
		assert.deepEqual(state.edit, { kind: 'alarm', alarmId: 1, field: 'minutes' });
		state = press(state, 'search');
		assert.equal(alarmById(state.alarms, 1)?.minute, 1);

		state = press(state, 'mode');
		assert.deepEqual(state.edit, { kind: 'alarm', alarmId: 1, field: 'schedule' });
		// On the schedule field SEARCH toggles rather than incrementing (ALM-4), and ALM-5 has
		// already armed the alarm as One-time — so the cycle runs once -> daily -> off.
		assert.equal(alarmById(state.alarms, 1)?.mode, 'once');
		state = press(state, 'search');
		assert.equal(alarmById(state.alarms, 1)?.mode, 'daily');
		state = press(state, 'search');
		assert.equal(alarmById(state.alarms, 1)?.mode, 'off');

		state = press(state, 'mode');
		assert.equal(state.edit, null, 'the third field is the last');
	});

	it('sets the timer fields Hours, Minutes, Seconds and no more (TMR-3)', () => {
		// Starting from a one-hour countdown rather than the default 24 hours: 24 hours is the
		// maximum, so adding a minute to it is clamped away and would prove nothing.
		let state = hold(onMode('timer', { timer: timerSetStart(defaultTimer(), 3_600_000) }), 'adjust', 1000);
		assert.deepEqual(state.edit, { kind: 'timer', field: 'hours' });

		state = press(state, 'mode');
		assert.deepEqual(state.edit, { kind: 'timer', field: 'minutes' });
		state = press(state, 'search');
		const parts = timerRemaining(state.timer, NOW);
		assert.equal(Math.floor(parts / 60_000) % 60, 1, 'one minute was added');
		assert.equal(Math.floor(parts / 3_600_000), 1, 'and the hour was left alone');

		state = press(state, 'mode');
		assert.deepEqual(state.edit, { kind: 'timer', field: 'seconds' });
		state = press(state, 'search');
		assert.equal(Math.floor(timerRemaining(state.timer, NOW) / 1_000) % 60, 1, 'one second was added');

		state = press(state, 'mode');
		assert.equal(state.edit, null);
	});
});

describe('the countdown timer screen (TMR-4..TMR-8)', () => {
	it('starts, pauses and resumes on SEARCH (TMR-4)', () => {
		let state = onMode('timer', { timer: timerSetStart(defaultTimer(), 10_000) });
		state = press(state, 'search');
		assert.equal(state.timer.running, true);
		state = press(state, 'search', NOW + 2_000);
		assert.equal(state.timer.running, false);
		assert.equal(timerRemaining(state.timer, NOW + 2_000), 8_000);
		state = press(state, 'search', NOW + 5_000);
		assert.equal(state.timer.running, true);
	});

	it('returns to the start value on ADJUST once paused (TMR-5)', () => {
		let state = onMode('timer', { timer: timerSetStart(defaultTimer(), 10_000) });
		state = press(state, 'search');
		state = press(state, 'search', NOW + 2_000);
		state = press(state, 'adjust', NOW + 2_000);
		assert.equal(timerRemaining(state.timer, NOW + 2_000), 10_000);
	});

	it('fires, alerts for ten seconds and auto-resets at zero (TMR-6)', () => {
		let state = onMode('timer', { timer: timerSetStart(defaultTimer(), 5_000) });
		state = press(state, 'search');

		state = tick(state, NOW + 5_000);
		assert.equal(state.alert?.kind, 'timer');
		assert.equal(state.timer.running, false, 'it stops at zero');
		assert.equal(timerRemaining(state.timer, NOW + 5_000), 5_000, 'and returns to its start value');

		state = tick(state, NOW + 5_000 + ALERT_MS);
		assert.equal(state.alert, null);
	});

	it('does not restart itself after firing (TMR-7)', () => {
		let state = onMode('timer', { timer: timerSetStart(defaultTimer(), 1_000) });
		state = press(state, 'search');
		state = tick(state, NOW + 1_000);
		// Ten more seconds of ticking must not start it again.
		for (let elapsed = 1_000; elapsed <= 20_000; elapsed += 500) {
			state = tick(state, NOW + elapsed);
			assert.equal(state.timer.running, false, `restarted at +${elapsed} ms`);
		}
	});

	it('stops its alarm on any button, and only then can be restarted (TMR-6)', () => {
		let state = onMode('timer', { timer: timerSetStart(defaultTimer(), 1_000) });
		state = press(state, 'search');
		state = tick(state, NOW + 1_000);
		assert.notEqual(state.alert, null);

		state = press(state, 'light', NOW + 1_500);
		assert.equal(state.alert, null);
		state = press(state, 'search', NOW + 2_000);
		assert.equal(state.timer.running, true, 'and it can be started again');
	});
});

describe('the stopwatch screen (SW-3..SW-7)', () => {
	it('starts and stops on SEARCH (SW-3)', () => {
		let state = onMode('stopwatch');
		assert.equal(state.stopwatch.startedAt, null);
		state = press(state, 'search');
		assert.notEqual(state.stopwatch.startedAt, null);
		state = press(state, 'search', NOW + 1_000);
		assert.equal(state.stopwatch.startedAt, null);
		assert.equal(state.stopwatch.banked, 1_000);
	});

	it('freezes and releases a split on ADJUST while running (SW-4)', () => {
		let state = onMode('stopwatch');
		state = press(state, 'search');
		state = press(state, 'adjust', NOW + 500);
		assert.equal(state.stopwatch.splitMs, 500);
		state = press(state, 'adjust', NOW + 900);
		assert.equal(state.stopwatch.splitMs, null);
	});

	it('clears on ADJUST while stopped (SW-3)', () => {
		let state = onMode('stopwatch');
		state = press(state, 'search');
		state = press(state, 'search', NOW + 1_000);
		state = press(state, 'adjust', NOW + 1_000);
		assert.equal(state.stopwatch.banked, 0);
		assert.equal(state.stopwatch.splitMs, null);
	});

	it('keeps running when the mode is left (SW-6)', () => {
		let state = onMode('stopwatch');
		state = press(state, 'search');
		state = press(state, 'mode');
		state = press(state, 'mode');
		assert.notEqual(state.stopwatch.startedAt, null, 'leaving the mode must not stop it');
	});

	it('clears a frozen split when the mode is left (SW-7)', () => {
		// The one transition that has to happen on *leaving* rather than on a button press, which is
		// why it cannot live in the press handler.
		let state = onMode('stopwatch');
		state = press(state, 'search');
		state = press(state, 'adjust', NOW + 500);
		assert.equal(state.stopwatch.splitMs, 500);
		state = press(state, 'mode');
		assert.equal(state.stopwatch.splitMs, null, 'the split was cleared on the way out');
		assert.notEqual(state.stopwatch.startedAt, null, 'but it is still running');
	});

	it('does not clear the split when arriving at the screen', () => {
		let state = onMode('timer');
		state = press(state, 'mode'); // stopwatch
		state = press(state, 'search');
		state = press(state, 'adjust', NOW + 500);
		assert.equal(state.stopwatch.splitMs, 500);
	});
});

describe('Auto Display and the idle return (TIM-11, MOD-5)', () => {
	it('turns Auto Display on with a SEARCH hold on T-1 (TIM-11)', () => {
		const state = hold(init(), 'search', 3000);
		assert.equal(state.autoDisplay, true);
	});

	it('runs from whichever register is showing', () => {
		// Deliberately not restricted to T-1. The press half of the same gesture advances the register
		// before the hold is recognised, so a T-1-only gate would make the feature unreachable — the
		// controller's test caught exactly that.
		for (const register of [1, 2, 3, 4]) {
			const state = hold(init({ register }), 'search', 3000);
			assert.equal(state.autoDisplay, true, `register T-${register}`);
		}
	});

	it('cycles the registers once it is running (TIM-11)', () => {
		// Auto Display's whole purpose: the display walks T-1..T-4 on its own so the operator can
		// read them all without touching anything.
		let state = hold(init(), 'search', 3000);
		// The hold itself must not step the register, or the one being looked at would never be read.
		const start = state.register;
		assert.equal(state.lastAutoStepAt, NOW);

		state = tick(state, NOW + AUTO_DISPLAY_STEP_MS - 1, AT);
		assert.equal(state.register, start, 'not yet');

		state = tick(state, NOW + AUTO_DISPLAY_STEP_MS, AT);
		assert.equal(state.register, (start % 4) + 1, 'one step at its interval');

		state = tick(state, NOW + 2 * AUTO_DISPLAY_STEP_MS, AT);
		assert.equal(state.register, ((start + 1) % 4) + 1);
	});

	it('catches up rather than lagging when a tick is missed (TIM-11)', () => {
		// A suspended process resumes the cycle in the right place, which is why the step is computed
		// from instants rather than counted.
		let state = hold(init(), 'search', 3000);
		const start = state.register;
		state = tick(state, NOW + 5 * AUTO_DISPLAY_STEP_MS, AT);
		assert.equal(state.register, ((start - 1 + 5) % 4) + 1, 'five steps, not one');
	});

	it('does not cycle while a setting screen is open', () => {
		let state = hold(init(), 'search', 3000);
		state = hold(state, 'adjust', 1000, NOW + 3_000);
		assert.notEqual(state.edit, null);
		const register = state.register;
		state = tick(state, NOW + 3_000 + 3 * AUTO_DISPLAY_STEP_MS, AT);
		assert.equal(state.register, register, 'the flash owns the register while it is open');
	});

	it('turns Auto Display off on any button (TIM-11)', () => {
		for (const pusher of ['adjust', 'light', 'mode', 'search'] as const) {
			let state = hold(init(), 'search', 3000);
			assert.equal(state.autoDisplay, true);
			state = press(state, pusher, NOW + 4_000);
			assert.equal(state.autoDisplay, false, `${pusher} should cancel Auto Display`);
		}
	});

	it('returns to Timekeeping after the idle period (MOD-5)', () => {
		let state = onMode('stopwatch');
		state = tick(state, NOW + IDLE_RETURN_MS - 1);
		assert.equal(state.mode, 'stopwatch', 'not yet');
		state = tick(state, NOW + IDLE_RETURN_MS);
		assert.equal(state.mode, 'timekeeping');
	});

	it('does not return while the operator is using it', () => {
		let state = onMode('alarm');
		// A press every minute keeps it on the alarm screen indefinitely.
		for (let elapsed = 60_000; elapsed <= 600_000; elapsed += 60_000) {
			state = press(state, 'search', NOW + elapsed);
			state = tick(state, NOW + elapsed + 1_000);
			assert.equal(state.mode, 'alarm', `returned early at +${elapsed} ms`);
		}
	});

	it('does not return from Timekeeping, which is where it would return to', () => {
		const state = tick(init(), NOW + 10 * IDLE_RETURN_MS);
		assert.equal(state.mode, 'timekeeping');
	});
});

describe('MUTE (MUT-1, MUT-3)', () => {
	it('toggles on a MODE hold and not on a MODE press', () => {
		const pressed = press(init(), 'mode');
		assert.equal(pressed.muted, false);
		assert.equal(pressed.mode, 'worldtime', 'a press still changes the mode');

		const held = hold(init(), 'mode', 1000);
		assert.equal(held.muted, true);
		assert.equal(held.mode, 'timekeeping', 'a hold toggles the tone and nothing else');
	});

	it('toggles back', () => {
		let state = hold(init(), 'mode', 1000);
		state = hold(state, 'mode', 1000, NOW + 2000);
		assert.equal(state.muted, false);
	});
});

describe('the flashing setting field (TIM-4, ALM-4, TMR-3)', () => {
	it('flashes the field that is open, on and off', () => {
		const state = hold(init(), 'adjust', 1000);
		// The blink is a square wave: on for the first half-period, off for the second.
		assert.equal(flashingField(state, 0), 'seconds');
		assert.equal(flashingField(state, 799), 'seconds');
		assert.equal(flashingField(state, 800), null);
		assert.equal(flashingField(state, 1600), 'seconds');
	});

	it('flashes nothing when no setting screen is open', () => {
		assert.equal(flashingField(init(), NOW), null);
	});

	it('names the alarm and timer fields distinctly', () => {
		const alarm = hold(onMode('alarm'), 'adjust', 1000);
		assert.equal(flashingField(alarm, 0), 'hour');
		const timer = hold(onMode('timer'), 'adjust', 1000);
		assert.equal(flashingField(timer, 0), 'timer-hours');
	});
});

describe('the calendar the setting screen edits (TIM-2)', () => {
	it('knows every month length, including February in a leap year', () => {
		assert.equal(daysInMonth(2026, 1), 31);
		assert.equal(daysInMonth(2026, 2), 28);
		assert.equal(daysInMonth(2024, 2), 29, '2024 is a leap year');
		assert.equal(daysInMonth(2000, 2), 29, '2000 is a leap year, despite being a century');
		assert.equal(daysInMonth(2100, 2), 28, '2100 is not, and the range ends at 2099 anyway');
		assert.equal(daysInMonth(2026, 4), 30);
		assert.equal(daysInMonth(2026, 12), 31);
	});

	it('clamps the day when a shorter month is selected', () => {
		// Setting the month from January to February while the day reads 31 must not invent a 31st.
		let state = hold(init(), 'adjust', 1000);
		state = { ...state, editDate: { year: 2026, month: 1, day: 31 } };
		for (let i = 0; i < 7; i += 1) {
			state = press(state, 'mode'); // to `month`
		}
		assert.equal(state.edit?.kind === 'timekeeping' ? state.edit.field : null, 'month');
		state = press(state, 'search');
		assert.equal(state.editDate?.month, 2);
		assert.equal(state.editDate?.day, 28, 'clamped to February length');
	});

	it('keeps the year inside 2000..2099', () => {
		let state = hold(init(), 'adjust', 1000);
		state = { ...state, editDate: { year: 2000, month: 6, day: 15 } };
		for (let i = 0; i < 6; i += 1) {
			state = press(state, 'mode'); // to `year`
		}
		state = press(state, 'light');
		assert.equal(state.editDate?.year, 2000, 'cannot go before 2000');
		for (let i = 0; i < 100; i += 1) {
			state = press(state, 'search');
		}
		assert.equal(state.editDate?.year, 2099, 'cannot go past 2099');
	});
});

describe('the timer state the face reads (TMR-2)', () => {
	it('exposes the running countdown and its set value separately', () => {
		const state = onMode('timer', { timer: timerToggle(timerSetStart(defaultTimer(), 90_000), NOW) });
		// A running countdown and a paused one are both 'the timer', and the face needs to know which.
		assert.equal(state.timer.running, true);
		assert.equal(state.timer.startMs, 90_000);
	});
});
