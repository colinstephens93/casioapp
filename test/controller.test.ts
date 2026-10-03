/**
 * Controller tests.
 *
 * The state machine is tested exhaustively in `machine.test.ts`; this file is about everything that
 * happens *over time*, which is the controller's job and nobody else's. Every case drives an
 * injected clock and an injected scheduler, so nothing here waits for a real millisecond.
 *
 * The cases worth having are the ones the pure machine structurally cannot hold:
 *
 * - requirement TIM-8, where resetting a reading of 30–59 also advances the minute. That means
 *   moving the *displayed* clock, which only the controller may do;
 * - requirement TMR-8, where a running countdown survives a restart because its end is absolute;
 * - requirement NFR-4, where the cadence has to slow to a second on a screen that shows seconds.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WatchController, type ControllerStore } from '../src/shared/controller.ts';
import { ALERT_MS, IDLE_RETURN_MS, TICK_MS } from '../src/shared/machine.ts';
import { type TimerState, defaultTimer, timerRemaining } from '../src/shared/timer.ts';

/**
 * A driven clock.
 *
 * `now` and `mono` are separate because they are separate in the widget: the wall clock can be
 * corrected underneath a running stopwatch, and the stopwatch must not notice.
 */
class TestClock {
	wall = Date.UTC(2026, 6, 15, 22, 48, 37);
	monotonic = 1_000_000;
	/** Timer callbacks, with the monotonic instant each is due at. */
	private scheduled: { at: number; fn: () => void }[] = [];

	now = (): number => this.wall;
	mono = (): number => this.monotonic;

	setTimer = (fn: () => void, ms: number): (() => void) => {
		const entry = { at: this.monotonic + ms, fn };
		this.scheduled.push(entry);
		return () => {
			this.scheduled = this.scheduled.filter((item) => item !== entry);
		};
	};

	/** Pending timer callbacks, for asserting the cadence. */
	get pending(): number {
		return this.scheduled.length;
	}

	/**
	 * Advances both clocks by `ms`, running every callback that falls due on the way.
	 *
	 * Callbacks are run in due order and both clocks are moved to each one's instant first, because
	 * that is what a real scheduler does — and because a callback that reschedules itself (the
	 * controller's tick loop does) would otherwise see a clock that had already jumped past it.
	 */
	advance(ms: number): void {
		const target = this.monotonic + ms;

		for (let guard = 0; guard < 100_000; guard += 1) {
			const due = this.scheduled
				.filter((entry) => entry.at <= target)
				.sort((a, b) => a.at - b.at)[0];
			if (!due) {
				break;
			}
			this.step(due.at);
			this.scheduled = this.scheduled.filter((entry) => entry !== due);
			due.fn();
		}

		this.step(target);
	}

	/** Moves both clocks forward to a monotonic instant, keeping them in step. */
	private step(to: number): void {
		const delta = to - this.monotonic;
		if (delta <= 0) {
			return;
		}
		this.monotonic = to;
		this.wall += delta;
	}
}

function memoryStore(initial: string | null = null): ControllerStore & { value: string | null } {
	return {
		value: initial,
		load() {
			return this.value;
		},
		save(next: string) {
			this.value = next;
		},
	};
}

function controller(overrides: { store?: ControllerStore; clock?: TestClock } = {}) {
	const clock = overrides.clock ?? new TestClock();
	const notifications: unknown[] = [];
	const watch = new WatchController({
		now: clock.now,
		mono: clock.mono,
		setTimer: clock.setTimer,
		...(overrides.store ? { store: overrides.store } : {}),
		notify: (alert) => notifications.push(alert),
	});
	return { watch, clock, notifications };
}

/** Presses and releases a pusher at the clock's current instant. */
function tap(watch: WatchController, pusher: 'adjust' | 'light' | 'mode' | 'search'): void {
	watch.down(pusher);
	watch.up(pusher);
}

/**
 * Holds a pusher for `ms`, ticking on the way as the controller's own loop does.
 *
 * The stepping matters: a hold is recognised by a `tick` that falls *after* the threshold, so a
 * helper that jumped the clock straight to `ms` and ticked once would be testing a loop that does
 * not exist. This advances in the controller's own 50 ms cadence, which is what the real widget
 * does and what makes the durations meaningful.
 */
function pressHold(
	watch: WatchController,
	clock: TestClock,
	pusher: 'adjust' | 'light' | 'mode' | 'search',
	ms: number,
): void {
	watch.down(pusher);
	// A step of 50 ms lands on the threshold exactly when `ms` is a multiple of it, so the loop
	// deliberately runs one step past: at 1000 ms the hold is due at 1000 and must have fired.
	const step = TICK_MS;
	for (let elapsed = step; elapsed <= ms + step; elapsed += step) {
		clock.advance(step);
		watch.tick();
	}
	watch.up(pusher);
}

describe('the face state the renderer consumes', () => {
	it('derives every offset from one instant, so nothing can disagree', () => {
		const { watch } = controller();
		const face = watch.faceState();
		assert.equal(face.mode, 'timekeeping');
		assert.equal(face.multiTime, 1);
		// The wall clock is the instant plus the displayed offset, which is the one relationship the
		// digits, the map band and the day marker all depend on.
		assert.equal(face.wall.getTime() - face.at.getTime(), face.displayedOffset * 60_000);
		assert.equal(face.homeWall.getTime() - face.at.getTime(), face.homeOffset * 60_000);
		assert.equal(face.diffFromHome, face.displayedOffset - face.homeOffset);
	});

	it('shows the Home City in Alarm, Timer and Stopwatch and the display elsewhere (MAP-4)', () => {
		// The map band reverts to the Home City in three modes; it must be the same three the
		// controller reports, or the band and the digits would disagree.
		const { watch } = controller();
		// Move T-2 to Tokyo so the Home City and the displayed register differ.
		watch.getState();
		const homeZone = watch.faceState().cityCode;

		tap(watch, 'mode'); // world time
		assert.equal(watch.faceState().mode, 'worldtime');

		tap(watch, 'mode'); // alarm
		const alarm = watch.faceState();
		assert.equal(alarm.mode, 'alarm');
		assert.equal(alarm.cityCode, homeZone, 'alarm reverts to the Home City');

		tap(watch, 'mode'); // timer
		assert.equal(watch.faceState().mode, 'timer');
		assert.equal(watch.faceState().cityCode, homeZone);

		tap(watch, 'mode'); // stopwatch
		assert.equal(watch.faceState().mode, 'stopwatch');
		assert.equal(watch.faceState().cityCode, homeZone);
	});

	it('reports the world city and its code', () => {
		const { watch } = controller();
		tap(watch, 'mode');
		const face = watch.faceState();
		assert.equal(face.mode, 'worldtime');
		assert.ok(face.worldCity.length > 0);
	});

	it('exposes the stopwatch reading only on the stopwatch screen', () => {
		const { watch } = controller();
		assert.equal(watch.faceState().stopwatchMs, null);
		tap(watch, 'mode');
		tap(watch, 'mode');
		tap(watch, 'mode');
		tap(watch, 'mode');
		assert.equal(watch.faceState().mode, 'stopwatch');
		assert.equal(watch.faceState().stopwatchMs, 0);
	});

	it('exposes the alarm time only in Alarm mode', () => {
		const { watch } = controller();
		assert.equal(watch.faceState().alarmHour, null);
		tap(watch, 'mode');
		tap(watch, 'mode');
		const face = watch.faceState();
		assert.equal(face.mode, 'alarm');
		assert.equal(face.alarmHour, 7, 'the default alarm time');
		assert.equal(face.alarmMode, 'off');
	});
});

describe('the seconds reset (TIM-7, TIM-8)', () => {
	it('re-zeroes the display without moving the clock', () => {
		// The watch's seconds reset does not set the clock; it re-zeroes the *display*. Opening the
		// setting screen, stepping to Seconds and pressing SEARCH must therefore make the face read
		// `00` at the instant of the press — and the minute must be exactly one ahead, because the
		// reading was 37, which is in TIM-8's 30–59 range.
		const { watch, clock } = controller();
		const before = watch.faceState();
		assert.equal(before.wall.getUTCSeconds(), 37);

		// The reset is applied on the tick that follows the press, so both clocks are stopped at the
		// instant the reset takes effect. This is what makes the assertion exact rather than "close
		// to zero"; `pressHold` has already advanced the clock by a second to reach the hold.
		pressHold(watch, clock, 'adjust', 1050);
		assert.notEqual(watch.getState().edit, null, 'the setting screen should be open');
		assert.deepEqual(watch.getState().edit, { kind: 'timekeeping', field: 'seconds' });

		const resetWall = watch.faceState().wall;
		tap(watch, 'search');
		const after = watch.faceState().wall;

		assert.equal(after.getUTCSeconds(), 0, 'the displayed seconds were re-zeroed');
		assert.equal(
			after.getUTCMinutes(),
			resetWall.getUTCMinutes() + 1,
			'a reading in the 30-59 range advances the minute (TIM-8)',
		);
	});

	it('advances the minute when the reading was 30 or more (TIM-8)', () => {
		// The reason TIM-8 exists: zeroing a mechanical seconds hand at 37 s has to carry, or the
		// clock would lose the better part of a minute.
		const { watch, clock } = controller();
		pressHold(watch, clock, 'adjust', 1050);
		tap(watch, 'search');

		const displayed = watch.faceState().wall;
		assert.equal(displayed.getUTCSeconds(), 0);
		// The reading the reset saw was 22:48:38, so the displayed minute is one ahead of the real one.
		assert.equal(displayed.getUTCMinutes(), 49);
	});

	it('does not advance the minute when the reading was below 30', () => {
		const { watch, clock } = controller();
		// 22:48:12 — under 30, so the minute stays. A tenth of a second of hold drift cannot move it
		// across the boundary, which is why this is a real test of the rule and not of the timing.
		clock.wall = Date.UTC(2026, 6, 15, 22, 48, 12);
		pressHold(watch, clock, 'adjust', 1050);
		tap(watch, 'search');

		const displayed = watch.faceState().wall;
		assert.equal(displayed.getUTCSeconds(), 0);
		assert.equal(displayed.getUTCMinutes(), 48, '12 s does not round the minute up');
	});

	it('resumes counting at real speed rather than freezing at 00', () => {
		// After the reset the display reads `00` and then counts up from there at exactly real speed:
		// the offset is released when the minute's remainder elapses, so the display lands back in
		// step with the clock rather than running a minute behind forever.
		const { watch, clock } = controller();
		pressHold(watch, clock, 'adjust', 1050);
		tap(watch, 'search');
		const resetMinute = watch.faceState().wall.getUTCMinutes();
		assert.equal(watch.faceState().wall.getUTCSeconds(), 0);

		// A second of real time, advanced in the controller's own cadence so the tick loop runs.
		watch.start();
		clock.advance(1_000);
		assert.equal(watch.faceState().wall.getUTCSeconds(), 1, 'counting up from zero');
		assert.equal(watch.faceState().wall.getUTCMinutes(), resetMinute, 'on the advanced minute');
	});

	it('clears the request once it has been carried out', () => {
		const { watch, clock } = controller();
		pressHold(watch, clock, 'adjust', 1100);
		tap(watch, 'search');
		assert.equal(watch.getState().secondReset, false, 'the flag must not stay set');
	});
});

describe('the countdown across a restart (TMR-8, PRS-3)', () => {
	it('persists as running with an absolute end, and not the stopwatch (SW-10, PRS-2)', () => {
		const store = memoryStore();
		const { watch, clock } = controller({ store });

		// Go to the timer and start it.
		for (let i = 0; i < 3; i += 1) {
			tap(watch, 'mode');
		}
		assert.equal(watch.faceState().mode, 'timer');
		tap(watch, 'search');
		assert.equal(watch.getState().timer.running, true);
		void clock;

		watch.save();
		const stored = store.value;
		assert.notEqual(stored, null);

		const parsed = JSON.parse(stored ?? '{}') as { timer?: TimerState; stopwatch?: unknown };
		assert.equal(parsed.timer?.running, true, 'a running countdown persists as running');
		assert.equal(typeof parsed.timer?.endsAt, 'number', 'and with an absolute end instant');
		assert.equal(parsed.stopwatch, undefined, 'the stopwatch is not persisted at all');
	});

	it('carries a countdown across a restart and finishes on schedule', () => {
		const store = memoryStore();
		const base = {
			version: 2,
			clock: '24h',
			register: 1,
			mode: 'timer',
			screenIndex: { timekeeping: 0, worldtime: 0, alarm: 0, timer: 0, stopwatch: 0 },
			worldIndex: 0,
			slots: [
				{ zone: 'Europe/London', dst: 'off' },
				{ zone: 'Europe/London', dst: 'off' },
				{ zone: 'Europe/London', dst: 'off' },
				{ zone: 'Europe/London', dst: 'off' },
			],
			alarms: { defs: [], signal: false },
			muted: false,
			illuminationMs: 1500,
			battery: 1,
		};

		// A session that quit ten minutes into a twenty-minute countdown.
		const startedAt = Date.UTC(2026, 6, 15, 22, 48, 37);
		store.value = JSON.stringify({
			...base,
			timer: { startMs: 1_200_000, running: true, endsAt: startedAt + 1_200_000, pausedMs: 1_200_000, fired: false },
		});

		// The widget restarts a minute later.
		const clock = new TestClock();
		clock.wall = startedAt + 60_000;
		const watch = new WatchController({
			now: clock.now,
			mono: clock.mono,
			setTimer: clock.setTimer,
			store,
		});

		const face = watch.faceState();
		assert.equal(face.mode, 'timer');
		assert.equal(face.timerRunning, true, 'still running after the restart');
		assert.equal(face.timerMs, 1_140_000, 'eleven minutes left, not twenty');

		// Eleven minutes later it finishes, without ever having been ticked while it ran.
		watch.start();
		clock.advance(1_140_001);
		assert.equal(watch.getState().alert?.kind, 'timer');
		assert.equal(watch.getState().timer.running, false);
		assert.equal(timerRemaining(watch.getState().timer, clock.wall), 1_200_000);
	});
});

describe('the timer set value through the setting screen (TMR-1, TMR-3)', () => {
	it('changes the start value from the field, wrapping within the field', () => {
		// The default is 24 H, which is the hours field's maximum, so a decrement wraps to 23 rather
		// than carrying into the minutes — the fields wrap within themselves, as the watch's do.
		const { watch, clock } = controller();
		for (let i = 0; i < 3; i += 1) {
			tap(watch, 'mode');
		}
		assert.equal(watch.faceState().mode, 'timer');
		assert.equal(watch.getState().timer.startMs, 86_400_000, 'the watch default is 24 hours');

		pressHold(watch, clock, 'adjust', 1100);
		assert.deepEqual(watch.getState().edit, { kind: 'timer', field: 'hours' });
		tap(watch, 'light');
		assert.equal(watch.getState().timer.startMs, 82_800_000, '24 H decrements to 23 H');

		// And the display follows the setting while the countdown is stopped, because a stopped
		// countdown's reading *is* its start value.
		assert.equal(watch.faceState().timerMs, 82_800_000);

		// Stepping the minutes field leaves the hours alone, which is the property that makes the
		// fields fields rather than one millisecond total.
		tap(watch, 'mode');
		assert.deepEqual(watch.getState().edit, { kind: 'timer', field: 'minutes' });
		tap(watch, 'search');
		assert.equal(watch.getState().timer.startMs, 82_860_000, '23 H 01 M');

		tap(watch, 'adjust');
		assert.equal(watch.getState().edit, null);
	});
});

describe('the ticking cadence (NFR-4)', () => {
	it('is a second on an idle Timekeeping screen', () => {
		const { watch } = controller();
		assert.equal(watch.tickPeriodMs(), 1000);
	});

	it('speeds up for a running stopwatch, which shows hundredths', () => {
		const { watch } = controller();
		for (let i = 0; i < 4; i += 1) {
			tap(watch, 'mode');
		}
		assert.equal(watch.faceState().mode, 'stopwatch');
		assert.equal(watch.tickPeriodMs(), 500, 'an idle stopwatch is cheap');

		tap(watch, 'search'); // start it
		assert.equal(watch.tickPeriodMs(), 50, 'a running stopwatch needs the fine cadence');
	});

	it('speeds up for a running countdown, whose unit is a tenth', () => {
		const { watch } = controller();
		for (let i = 0; i < 3; i += 1) {
			tap(watch, 'mode');
		}
		assert.equal(watch.tickPeriodMs(), 200);
		tap(watch, 'search');
		assert.equal(watch.tickPeriodMs(), 50);
	});

	it('speeds up while a setting screen is flashing', () => {
		const { watch, clock } = controller();
		assert.equal(watch.tickPeriodMs(), 1000);
		pressHold(watch, clock, 'adjust', 1100);
		assert.equal(watch.tickPeriodMs(), 50, 'the flash needs a fine edge');
	});

	it('never runs faster than the stopwatch needs, on a clock showing whole seconds', () => {
		const { watch } = controller();
		// NFR-4: idle CPU below half a percent. A second-long period on the clock screen is the
		// whole reason the cadence is computed instead of fixed at the finest value.
		assert.ok(watch.tickPeriodMs() >= 1000);
	});

	it('costs at most a fifth of one core even at its fastest, by its own arithmetic (NFR-4)', () => {
		// The budget stated in the requirement is a fraction of one core, and the controller's cost
		// is set by exactly one number: how many times a second it wakes. This asserts the cadence
		// against the requirement rather than against a remembered value.
		//
		// The work per wake is not measured here — it is a redraw of a few hundred SVG elements, and
		// the honest statement is that the *wake rate* is bounded and the redraw is a separate
		// question. What this catches is a cadence being lowered to 1 ms "to be safe", which is the
		// change that would actually break the budget.
		const { watch } = controller();
		let fastest = watch.tickPeriodMs();

		for (const mode of ['worldtime', 'alarm', 'timer', 'stopwatch', 'timekeeping'] as const) {
			watch.setMode(mode);
			fastest = Math.min(fastest, watch.tickPeriodMs());
		}
		for (let i = 0; i < 4; i += 1) {
			tap(watch, 'mode');
			fastest = Math.min(fastest, watch.tickPeriodMs());
		}
		tap(watch, 'search'); // start the stopwatch, the finest consumer
		fastest = Math.min(fastest, watch.tickPeriodMs());

		assert.ok(fastest >= 20, `the fastest cadence is ${fastest} ms, which is more than 50 wakes a second`);
		assert.ok(fastest <= 50, `the finest screen should tick at 50 ms, not ${fastest} ms`);
	});

	it('does no idle work beyond its own wake rate (WIN-10)', () => {
		// WIN-10 asks for no polling beyond what the display needs, and the way to see that is to
		// count the scheduling calls rather than the ticks: a controller that scheduled two timers, or
		// rescheduled without cancelling, would wake twice as often as its period claims.
		const clock = new TestClock();
		let scheduled = 0;
		const watch = new WatchController({
			now: clock.now,
			mono: clock.mono,
			setTimer: (fn, ms) => {
				scheduled += 1;
				return clock.setTimer(fn, ms);
			},
		});

		watch.start();
		watch.start(); // a second start must not add a second loop
		assert.equal(scheduled, 1, 'starting twice scheduled twice');

		const period = watch.tickPeriodMs();
		clock.advance(period * 5 + 1);
		assert.ok(scheduled <= 7, `${scheduled} schedules over five periods, which is more than one per period`);
		assert.ok(watch.isRunning, 'the loop is still running');
		watch.stop();
		assert.equal(watch.isRunning, false, 'and stop actually stops it');
	});
});

describe('an alarm firing raises a notification once (ALM-10)', () => {
	it('notifies once per firing and not once per tick', () => {
		const store = memoryStore(
			JSON.stringify({
				version: 2,
				clock: '24h',
				register: 1,
				mode: 'timekeeping',
				screenIndex: { timekeeping: 0, worldtime: 0, alarm: 0, timer: 0, stopwatch: 0 },
				worldIndex: 0,
				slots: [
					{ zone: 'Europe/London', dst: 'off' },
					{ zone: 'Europe/London', dst: 'off' },
					{ zone: 'Europe/London', dst: 'off' },
					{ zone: 'Europe/London', dst: 'off' },
				],
				// 07:30 Home City, which is 07:30 UTC for London in July only in standard time — the
				// fixture forces `off`, so the Home City wall clock is UTC.
				alarms: { defs: [{ id: 1, hour: 7, minute: 30, mode: 'daily' }], signal: false },
				timer: defaultTimer(),
				muted: false,
				illuminationMs: 1500,
				battery: 1,
			}),
		);

		const clock = new TestClock();
		clock.wall = Date.UTC(2026, 6, 15, 7, 29, 59);
		const notifications: unknown[] = [];
		const watch = new WatchController({
			now: clock.now,
			mono: clock.mono,
			setTimer: clock.setTimer,
			store,
			notify: (alert) => notifications.push(alert),
		});

		// Tick across the minute boundary.
		watch.start();
		clock.advance(3_000);

		assert.ok(notifications.length >= 1, 'the alarm should have raised a notification');
		assert.equal(notifications.length, 1, `expected one notification, got ${notifications.length}`);
	});
});

describe('the backlight (LIT-1, LIT-2)', () => {
	it('lights for the configured duration and then goes out', () => {
		const { watch, clock } = controller();
		// A press lights the LCD; the gesture reader is what decides whether it is also a hold.
		watch.down('light');
		watch.up('light');
		assert.equal(watch.faceState().illuminated, true, 'lit as it is pressed');

		// The controller is started, so its own tick loop retires the backlight when the duration
		// expires. The advance is deliberately longer than both the duration and one tick period, so
		// a tick is guaranteed to fall after the deadline rather than exactly on it.
		watch.start();
		clock.advance(1_400);
		assert.equal(watch.faceState().illuminated, true, 'still lit at 1.5 s minus a tenth');

		clock.advance(600);
		assert.equal(watch.faceState().illuminated, false, 'out after its duration');
	});

	it('charges the battery only for the time it was actually lit (BAT-2)', () => {
		const { watch, clock } = controller();
		const before = watch.getBattery();
		watch.down('light');
		watch.up('light');
		watch.start();
		clock.advance(2_000);
		const after = watch.getBattery();
		assert.ok(after < before, 'the backlight must drain the cell');
		// 1.5 s out of a ~42 000-second life is a tiny but non-zero slice.
		assert.ok(before - after < 0.001, 'and only a tiny one');
	});

	it('resets the battery from the context menu (BAT-6)', () => {
		const { watch } = controller();
		watch.resetBattery();
		assert.equal(watch.getBattery(), 1);
		assert.equal(watch.batteryPercent(), 100);
	});
});

describe('persistence (PRS-1, PRS-4)', () => {
	it('round-trips the mode, the registers, the alarms and the mute state', () => {
		const store = memoryStore();
		const { watch } = controller({ store });
		tap(watch, 'mode'); // world time
		watch.save();

		const restored = new WatchController({
			now: () => Date.UTC(2026, 6, 15, 22, 48, 37),
			mono: () => 0,
			setTimer: () => () => {},
			store,
		});
		assert.equal(restored.getState().mode, 'worldtime', 'the mode was restored');
	});

	it('repairs a corrupt file rather than failing to start', () => {
		for (const raw of ['{ not json', '[]', 'null', '42', '{}']) {
			const store = memoryStore(raw);
			const watch = new WatchController({
				now: () => Date.UTC(2026, 6, 15, 22, 48, 37),
				mono: () => 0,
				setTimer: () => () => {},
				store,
			});
			assert.equal(watch.getState().slots.length, 4, `input ${raw}`);
			assert.equal(watch.faceState().cityCode.length, 3, `input ${raw}`);
		}
	});

	it('rejects an unrecognised stored zone instead of throwing on every frame (PRS-4)', () => {
		// Found by checking what the *old* reader accepted rather than by a test: `watch.ts` validated
		// stored zones and the controller did not, so moving persistence here lost the check. The
		// failure was total rather than cosmetic — an unknown zone reaches `offsetMinutes`, which
		// throws, and it throws inside both `faceState()` and `tick()`.
		const store = memoryStore(
			JSON.stringify({
				version: 1,
				clock: '24h',
				selected: 1,
				slots: [
					{ zone: 'Not/AZone', dst: 'off' },
					{ zone: 'Asia/Tokyo', dst: 'off' },
					{ zone: 'Asia/Tokyo', dst: 'off' },
					{ zone: 'Asia/Tokyo', dst: 'off' },
				],
			}),
		);
		const watch = new WatchController({
			now: () => Date.UTC(2026, 6, 15, 22, 48, 37),
			mono: () => 0,
			setTimer: () => () => {},
			store,
		});

		// The whole point: neither of these may throw.
		assert.doesNotThrow(() => watch.faceState());
		assert.doesNotThrow(() => watch.tick());
		assert.notEqual(watch.getState().slots[0]?.zone, 'Not/AZone', 'the bad zone was replaced');
		assert.ok(watch.faceState().cityCode.length === 3, 'and the face still has a city');
	});

	it('resolves a legacy ICU zone spelling rather than keeping it (ZON-7)', () => {
		// The catalogue stores `Asia/Kolkata`, so a file carrying `Asia/Calcutta` must come back
		// canonical — otherwise the same city appears twice in a picker and nowhere in the catalogue.
		const store = memoryStore(
			JSON.stringify({
				version: 1,
				clock: '24h',
				selected: 1,
				slots: [
					{ zone: 'Asia/Calcutta', dst: 'off' },
					{ zone: 'Asia/Tokyo', dst: 'off' },
					{ zone: 'Asia/Tokyo', dst: 'off' },
					{ zone: 'Asia/Tokyo', dst: 'off' },
				],
			}),
		);
		const watch = new WatchController({
			now: () => Date.UTC(2026, 6, 15, 22, 48, 37),
			mono: () => 0,
			setTimer: () => () => {},
			store,
		});
		assert.equal(watch.getState().slots[0]?.zone, 'Asia/Kolkata');
	});

	it('reads the older configuration’s register field (PRS-1)', () => {
		// M0–M4 wrote `selected`; M5 renamed it `register`. Reading only the new name silently reset
		// every existing widget's register to T-1, which is a data regression rather than a crash —
		// and therefore the kind that survives a green test suite unless it is asserted.
		const store = memoryStore(
			JSON.stringify({
				version: 1,
				clock: '24h',
				selected: 3,
				slots: [
					{ zone: 'Europe/London', dst: 'off' },
					{ zone: 'America/New_York', dst: 'off' },
					{ zone: 'Asia/Tokyo', dst: 'off' },
					{ zone: 'Australia/Sydney', dst: 'off' },
				],
			}),
		);
		const watch = new WatchController({
			now: () => Date.UTC(2026, 6, 15, 22, 48, 37),
			mono: () => 0,
			setTimer: () => () => {},
			store,
		});
		assert.equal(watch.getState().register, 3);
		assert.equal(watch.faceState().cityCode, 'TYO', 'and the register it names is the one showing');
	});

	it('does not write on a tick, only when something changed', () => {
		// WIN-10's "quiet when idle": a clock that wrote a file every second would defeat it.
		const store = memoryStore();
		const { watch, clock } = controller({ store });
		watch.start();
		clock.advance(5_000);
		assert.equal(store.value, null, 'ticking must not write');

		watch.save();
		assert.notEqual(store.value, null, 'an explicit save does');
	});
});

describe('the idle return and Auto Display reach the face (MOD-5, TIM-11)', () => {
	it('returns to Timekeeping after two minutes and reports it', () => {
		const { watch, clock } = controller();
		for (let i = 0; i < 3; i += 1) {
			tap(watch, 'mode');
		}
		assert.equal(watch.faceState().mode, 'timer');

		watch.start();
		clock.advance(IDLE_RETURN_MS + 1_000);
		assert.equal(watch.faceState().mode, 'timekeeping');
	});

	it('reports Auto Display when a SEARCH hold enables it', () => {
		const { watch, clock } = controller();
		pressHold(watch, clock, 'search', 3_100);
		assert.equal(watch.getState().autoDisplay, true);
	});
});

describe('the chord promotes a city (INT-6)', () => {
	it('swaps the displayed World Time city into the Home City', () => {
		const { watch, clock } = controller();
		tap(watch, 'mode'); // world time
		// Scroll east a few cities.
		for (let i = 0; i < 5; i += 1) {
			tap(watch, 'search');
		}

		watch.down('adjust');
		clock.advance(20);
		watch.down('light');
		clock.advance(20);
		watch.tick();

		// The displayed city is read *after* both pushers are down, because the leading LIGHT press
		// of a chord also decrements — it is a real press on the way in, as documented in gestures.ts.
		const promoted = watch.faceState().worldCity;
		assert.notEqual(promoted, null);

		watch.up('light');
		assert.equal(watch.getState().slots[0]?.zone, promoted, 'the city became the Home City');
	});
});

describe('a sounding alert silences on any button (ALM-7, TMR-6)', () => {
	it('stops a test alarm and reports the alert to the face', () => {
		const { watch, clock } = controller();
		tap(watch, 'mode');
		tap(watch, 'mode');
		assert.equal(watch.faceState().mode, 'alarm');

		pressHold(watch, clock, 'search', 3_100);
		assert.equal(watch.faceState().alert?.kind, 'test');

		tap(watch, 'light');
		assert.equal(watch.faceState().alert, null);
	});

	it('retires the alert on its own after ten seconds', () => {
		const { watch, clock } = controller();
		tap(watch, 'mode');
		tap(watch, 'mode');
		pressHold(watch, clock, 'search', 3_100);
		assert.notEqual(watch.faceState().alert, null);

		watch.start();
		clock.advance(ALERT_MS + 1_000);
		assert.equal(watch.faceState().alert, null);
	});
});

describe('the battery model (BAT-1..BAT-6)', () => {
	/**
	 * Casio's own rating assumption, restated here from the requirement rather than imported: ten
	 * seconds of alarm operation and 1.5 seconds of illumination per day, for about ten years.
	 *
	 * Derived rather than copied from the implementation on purpose. Importing the constant would make
	 * the test agree with whatever the code says, which is the one thing it must not do.
	 */
	const RATED_SECONDS_PER_DAY = 10 + 1.5;
	const DAYS_PER_DECADE = 3652.5;
	const CAPACITY_SECONDS = DAYS_PER_DECADE * RATED_SECONDS_PER_DAY;

	it('is calibrated so ten years of rated use empties the cell (BAT-3)', () => {
		const { watch } = controller();
		assert.equal(watch.getBattery(), 1, 'a new widget starts full (BAT-1)');

		// A full decade of exactly the rating's pattern: 10 s of alarm and 1.5 s of light every day.
		// The simulation is the model's own arithmetic rather than 3 652 days of ticked time, because
		// what BAT-3 calibrates is the *rate*, and the rate is what this asserts.
		for (let day = 0; day < DAYS_PER_DECADE; day += 1) {
			watch.setBattery(watch.getBattery() - 10 / CAPACITY_SECONDS);
			watch.setBattery(watch.getBattery() - 1.5 / CAPACITY_SECONDS);
		}

		assert.ok(
			watch.getBattery() <= 0.00001,
			`after ten years at the rated pattern the cell should be empty, but reads ${watch.getBattery()}`,
		);
	});

	it('shows the level visibly falling only once it is a real fraction of the cell (BAT-5)', () => {
		// Ten years is the whole point and also the awkward part: one day of rated use is 1/3652 of
		// the cell, so the readout is 100% for months. Requirement BAT-5 wants the reading to change
		// as the level falls, which means the *percentage* has to move — so the test works where the
		// percentage is not saturated.
		const { watch } = controller();
		watch.setBattery(0.5);
		assert.equal(watch.batteryPercent(), 50);

		// Half the cell is 21 001.875 seconds of operation, so a thousand seconds is about 2.4%.
		watch.setBattery(0.5 - 1000 / CAPACITY_SECONDS);
		assert.equal(watch.batteryPercent(), 48, 'a thousand seconds of use moves the reading');
	});

	it('charges the cell for exactly as long as an alarm sounded (BAT-2)', () => {
		// The alarm fires in Timekeeping and sounds for its full ten seconds.
		const store = memoryStore();
		const clock = new TestClock();
		clock.wall = Date.UTC(2026, 6, 15, 7, 29, 59);
		const notifications: unknown[] = [];
		const watch = new WatchController({
			now: clock.now,
			mono: clock.mono,
			setTimer: clock.setTimer,
			store,
			notify: (alert) => notifications.push(alert),
		});
		// A daily alarm one minute away.
		watch.setAlarms({ defs: [{ id: 1, hour: 7, minute: 30, mode: 'daily' }], signal: false });

		const before = watch.getBattery();
		watch.start();
		clock.advance(2_000); // across the minute boundary, and a second into the alert
		assert.equal(watch.getState().alert?.kind, 'alarm', 'the alarm should be sounding');

		clock.advance(9_000); // the alert's own ten seconds elapse
		assert.equal(watch.getState().alert, null, 'the alert should have stopped itself');
		watch.stop();

		const drained = before - watch.getBattery();
		// Ten seconds of alarm, to within a tick of tolerance on either end.
		const expected = 10 / CAPACITY_SECONDS;
		assert.ok(
			drained > 0,
			'the alarm must charge the cell — this was the open half of BAT-2',
		);
		assert.ok(
			Math.abs(drained - expected) / expected < 0.3,
			`expected about ${expected} of the cell for ten seconds, measured ${drained}`,
		);
	});

	it('charges less for an alarm silenced early (BAT-2, ALM-7)', () => {
		// The whole reason the meter is measured rather than assumed: stopping the sound after three
		// seconds must cost three seconds, not ten.
		const store = memoryStore();
		const clock = new TestClock();
		clock.wall = Date.UTC(2026, 6, 15, 7, 29, 59);
		const watch = new WatchController({ now: clock.now, mono: clock.mono, setTimer: clock.setTimer, store });
		watch.setAlarms({ defs: [{ id: 1, hour: 7, minute: 30, mode: 'daily' }], signal: false });

		const before = watch.getBattery();
		watch.start();
		clock.advance(2_000);
		assert.equal(watch.getState().alert?.kind, 'alarm');

		// Any button stops it (ALM-7). It stops inside `reduce`, so no tick ever sees the transition —
		// which is why the charge is settled on the state change and not on a tick.
		watch.down('light');
		watch.up('light');
		assert.equal(watch.getState().alert, null);

		clock.advance(60_000); // well past when the full alert would have ended
		watch.stop();

		const drained = before - watch.getBattery();
		const fullAlert = 10 / CAPACITY_SECONDS;
		assert.ok(drained > 0, 'a silenced alarm still cost something');
		assert.ok(
			drained < fullAlert * 0.9,
			`a silenced alarm must not cost the full ten seconds: ${drained} against ${fullAlert}`,
		);
	});

	it('does not charge the cell for a test alarm (ALM-6)', () => {
		// A test alarm is the operator exercising the alarm, not the alarm firing. Casio's rating
		// assumption is about firings, so metering the test would make the model wrong in the one
		// place a curious operator would notice.
		const { watch, clock } = controller();
		tap(watch, 'mode');
		tap(watch, 'mode');
		assert.equal(watch.faceState().mode, 'alarm');

		const before = watch.getBattery();
		pressHold(watch, clock, 'search', 3_100);
		assert.equal(watch.getState().alert?.kind, 'test');
		clock.advance(11_000);
		watch.tick();

		assert.equal(watch.getBattery(), before, 'the test alarm drained nothing');
	});

	it('persists the level and restores it (BAT-4)', () => {
		const store = memoryStore();
		const first = controller({ store });
		first.watch.setBattery(0.42);
		first.watch.save();

		const second = controller({ store });
		assert.ok(
			Math.abs(second.watch.getBattery() - 0.42) < 0.0001,
			`the level should have been restored, but reads ${second.watch.getBattery()}`,
		);
	});

	it('resets from the context menu and persists the reset (BAT-6)', () => {
		const store = memoryStore();
		const { watch } = controller({ store });
		watch.setBattery(0.05);
		watch.resetBattery();
		assert.equal(watch.getBattery(), 1);
		assert.equal(watch.batteryPercent(), 100);

		const restored = controller({ store });
		assert.equal(restored.watch.getBattery(), 1, 'the reset was written');
	});

	it('never falls below an empty cell, however long it sounds', () => {
		const { watch } = controller();
		watch.setBattery(0);
		// A decade of continuous sounding would be an absurd duty cycle; the model must floor rather
		// than go negative, because a negative level would render as a nonsense percentage.
		watch.setBattery(watch.getBattery() - 10 * CAPACITY_SECONDS);
		assert.equal(watch.getBattery(), 0);
		assert.equal(watch.batteryPercent(), 0);
	});
});

describe('the host’s own controls (INT-7, LIT-3)', () => {
	it('moves between the five screens through the real cycle (MOD-1)', () => {
		const { watch } = controller();
		for (const mode of ['worldtime', 'alarm', 'timer', 'stopwatch', 'timekeeping'] as const) {
			watch.setMode(mode);
			assert.equal(watch.faceState().mode, mode, `should have reached ${mode}`);
		}
	});

	it('applies the departure rules when it jumps a mode (SW-7)', () => {
		// The reason `setMode` steps rather than assigning: leaving the stopwatch has to clear a
		// frozen split, and a direct assignment of `mode` would skip that entirely.
		const { watch, clock } = controller();
		watch.setMode('stopwatch');
		tap(watch, 'search');
		clock.advance(500);
		watch.tick();
		tap(watch, 'adjust');
		assert.equal(watch.getState().stopwatch.splitMs, 500, 'a split is frozen');

		watch.setMode('timekeeping');
		assert.equal(watch.getState().stopwatch.splitMs, null, 'the split was cleared on the way out');
		assert.notEqual(watch.getState().stopwatch.startedAt, null, 'and it is still running');
	});

	it('accepts the two illumination durations and no others (LIT-2)', () => {
		const { watch } = controller();
		assert.equal(watch.getIlluminationMs(), 1500, 'the watch default');

		watch.setIlluminationMs(3000);
		assert.equal(watch.getIlluminationMs(), 3000);

		// A stored third value is a duration the watch cannot show, so it falls back rather than
		// being honoured. LIT-2 names exactly 1.5 s and 3 s.
		watch.setIlluminationMs(999);
		assert.equal(watch.getIlluminationMs(), 1500);
	});

	it('persists the illumination duration (LIT-3)', () => {
		const store = memoryStore();
		const first = controller({ store });
		first.watch.setIlluminationMs(3000);

		const second = controller({ store });
		assert.equal(second.watch.getIlluminationMs(), 3000);
	});

	it('uses the chosen duration for the backlight (LIT-1, LIT-2)', () => {
		// The setting has to *do* something, or it is a number in a file. At 3 s the wash is still lit
		// where the 1.5 s default would have gone out.
		const { watch, clock } = controller();
		watch.setIlluminationMs(3000);
		watch.down('light');
		watch.up('light');
		watch.start();

		clock.advance(2_000);
		assert.equal(watch.faceState().illuminated, true, 'still lit at two seconds');

		clock.advance(1_500);
		assert.equal(watch.faceState().illuminated, false, 'and out by three and a half');
	});

	it('handles the context menu actions it owns and defers the ones it does not (INT-7)', () => {
		const { watch } = controller();
		assert.equal(watch.faceState().mode, 'timekeeping');

		watch.contextAction('mode');
		assert.equal(watch.faceState().mode, 'worldtime', 'mode switching is the controller’s');

		watch.setBattery(0.1);
		watch.contextAction('battery-reset');
		assert.equal(watch.getBattery(), 1, 'so is resetting the battery');

		// `settings` and `quit` belong to the window. A headless component asked to quit must not
		// throw, and must not pretend to have done it — it returns and reports nothing.
		assert.doesNotThrow(() => watch.contextAction('settings'));
		assert.doesNotThrow(() => watch.contextAction('quit'));
		assert.equal(watch.faceState().mode, 'worldtime', 'and neither changed the watch');
	});
});

describe('the pressed state reaches the face (INT-8)', () => {
	it('reports the pushers that are down and the chord', () => {
		const { watch, clock } = controller();
		assert.deepEqual(watch.faceState().pressed, []);

		watch.down('adjust');
		assert.deepEqual(watch.faceState().pressed, ['adjust']);
		assert.equal(watch.faceState().chord, false);

		clock.advance(10);
		watch.down('light');
		assert.deepEqual(watch.faceState().pressed, ['adjust', 'light']);
		assert.equal(watch.faceState().chord, true, 'the chord state is visible (INT-8)');

		watch.up('light');
		watch.up('adjust');
		assert.deepEqual(watch.faceState().pressed, []);
		assert.equal(watch.faceState().chord, false);
	});
});
