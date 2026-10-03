/**
 * Countdown timer tests.
 *
 * Every one of these drives the timer from an **injected instant**, so a 24-hour countdown is
 * tested in microseconds and no test waits for anything. That is the whole reason the timer takes
 * `now` as an argument instead of reading a clock.
 *
 * The cases that matter are the ones where accumulating ticks would drift: a jump forward past the
 * end, a jump past *two* days with the process suspended, and a paused timer that must be immune to
 * the passage of time entirely.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	TIMER_MAX_MS,
	TIMER_MIN_MS,
	clampTimerMs,
	defaultTimer,
	formatTimer,
	repairTimer,
	timerAcknowledge,
	timerDisplayMs,
	timerExpired,
	timerFire,
	timerParts,
	timerRemaining,
	timerReset,
	timerSetStart,
	timerStepField,
	timerToggle,
} from '../src/shared/timer.ts';

const T0 = 1_800_000_000_000;

describe('the settable range (TMR-1)', () => {
	it('runs from one second to 24 hours and no further', () => {
		assert.equal(clampTimerMs(0), TIMER_MIN_MS);
		assert.equal(clampTimerMs(500), TIMER_MIN_MS);
		assert.equal(clampTimerMs(1_000_000_000), TIMER_MAX_MS);
		assert.equal(clampTimerMs(60_000), 60_000);
	});

	it('starts at 24 hours, the watch out of the box', () => {
		assert.equal(defaultTimer().startMs, TIMER_MAX_MS);
		assert.equal(defaultTimer().running, false);
		assert.equal(defaultTimer().fired, false);
	});

	it('prints 24 hours as 24H, not 24:00', () => {
		assert.equal(formatTimer(TIMER_MAX_MS), "24H00'00.0");
		assert.equal(formatTimer(60_000), "00H01'00.0");
		assert.equal(formatTimer(1_000), "00H00'01.0");
	});
});

describe('counting down from an injected clock (TMR-4)', () => {
	it('reports the remainder by subtraction, never by accumulation', () => {
		const started = timerToggle(timerSetStart(defaultTimer(), 10_000), T0);
		assert.equal(timerRemaining(started, T0), 10_000);
		assert.equal(timerRemaining(started, T0 + 3_000), 7_000);
		assert.equal(timerRemaining(started, T0 + 9_999), 1);
	});

	it('is unaffected by a huge forward jump, because it reads the clock afresh', () => {
		// A suspended process returns a day later. The countdown has finished, and it says so once.
		const started = timerToggle(timerSetStart(defaultTimer(), 10_000), T0);
		assert.equal(timerExpired(started, T0 + 86_400_000), true);
		assert.equal(timerRemaining(started, T0 + 86_400_000), 0);
	});

	it('does not go negative at or past the end', () => {
		const started = timerToggle(timerSetStart(defaultTimer(), 5_000), T0);
		assert.equal(timerRemaining(started, T0 + 5_000), 0);
		assert.equal(timerRemaining(started, T0 + 500_000), 0);
	});

	it('rounds the display up, so 0.0 is only shown at zero (TMR-2)', () => {
		const started = timerToggle(timerSetStart(defaultTimer(), 10_000), T0);
		// 1.001 s remaining still reads 1.1, and only a true zero reads 0.0.
		assert.equal(timerDisplayMs(started, T0 + 8_999), 1_100);
		assert.equal(timerDisplayMs(started, T0 + 8_900), 1_100);
		assert.equal(timerDisplayMs(started, T0 + 9_000), 1_000);
		assert.equal(timerDisplayMs(started, T0 + 10_000), 0);
	});
});

describe('pause and resume (TMR-4, TMR-5)', () => {
	it('pauses without losing the remainder, and time stops for it', () => {
		const started = timerToggle(timerSetStart(defaultTimer(), 10_000), T0);
		const paused = timerToggle(started, T0 + 4_000);
		assert.equal(paused.running, false);
		assert.equal(timerRemaining(paused, T0 + 4_000), 6_000);
		// An hour later the paused timer is still at six seconds: that is what "paused" means.
		assert.equal(timerRemaining(paused, T0 + 3_600_000), 6_000);
		assert.equal(timerExpired(paused, T0 + 3_600_000), false);
	});

	it('resumes from where it paused, not from the start value', () => {
		const started = timerToggle(timerSetStart(defaultTimer(), 10_000), T0);
		const paused = timerToggle(started, T0 + 4_000);
		const resumed = timerToggle(paused, T0 + 100_000);
		assert.equal(resumed.running, true);
		assert.equal(timerRemaining(resumed, T0 + 100_000), 6_000);
		assert.equal(timerRemaining(resumed, T0 + 103_000), 3_000);
	});

	it('refuses to reset while running, so a stray press cannot discard a countdown (TMR-5)', () => {
		const started = timerToggle(timerSetStart(defaultTimer(), 10_000), T0);
		const attempted = timerReset(started);
		assert.equal(attempted, started, 'a running timer must be paused first');
	});

	it('returns to the start value once paused (TMR-5)', () => {
		const started = timerToggle(timerSetStart(defaultTimer(), 10_000), T0);
		const paused = timerToggle(started, T0 + 4_000);
		const reset = timerReset(paused);
		assert.equal(reset.running, false);
		assert.equal(reset.pausedMs, 10_000);
		assert.equal(timerRemaining(reset, T0 + 999_999), 10_000);
	});
});

describe('reaching zero (TMR-6, TMR-7)', () => {
	it('auto-resets to the start value and stops', () => {
		const started = timerToggle(timerSetStart(defaultTimer(), 10_000), T0);
		const fired = timerFire(started);
		assert.equal(fired.running, false);
		assert.equal(fired.endsAt, null);
		assert.equal(fired.pausedMs, 10_000, 'the countdown returns to its start value');
		assert.equal(fired.fired, true, 'and is flagged so nothing restarts it');
	});

	it('never auto-restarts', () => {
		// The tick loop keeps calling with later instants; the timer must stay stopped throughout.
		let state = timerFire(timerToggle(timerSetStart(defaultTimer(), 1_000), T0));
		for (let elapsed = 1_000; elapsed < 10_000; elapsed += 500) {
			assert.equal(state.running, false, `restarted at +${elapsed} ms`);
			assert.equal(state.pausedMs, 1_000);
		}
		state = timerAcknowledge(state);
		assert.equal(state.fired, false);
	});

	it('starts over from the full value, not from zero, on the next press', () => {
		// Without the `fired` flag this would restart a zero-length countdown and end instantly.
		const fired = timerFire(timerToggle(timerSetStart(defaultTimer(), 5_000), T0));
		const restarted = timerToggle(fired, T0 + 20_000);
		assert.equal(restarted.running, true);
		assert.equal(timerRemaining(restarted, T0 + 20_000), 5_000);
		assert.equal(restarted.fired, false);
	});
});

describe('setting the duration (TMR-1, TMR-3)', () => {
	it('steps each field within its own bounds rather than carrying', () => {
		// 1 h 00 m 00 s, decrement the minutes: the watch gives 1 h 59 m 00 s, not 0 h 59 m 00 s.
		let state = timerSetStart(defaultTimer(), 3_600_000);
		state = timerStepField(state, 'minutes', -1, T0);
		const parts = timerParts(state.pausedMs);
		assert.equal(parts.hours, 1);
		assert.equal(parts.minutes, 59);
		assert.equal(parts.seconds, 0);
	});

	it('adds an hour to the hour field without touching the minutes', () => {
		// The reason the fields are not a single millisecond total: +1 hour on 00H01'00 must give
		// 01H01'00, and adding an hour to the total would give exactly that but +1 *minute* on
		// 01H00'00 would give 01H01'00 either way — the fields only diverge on the wrap.
		let state = timerSetStart(defaultTimer(), 60_000);
		state = timerStepField(state, 'hours', 1, T0);
		const parts = timerParts(state.pausedMs);
		assert.equal(parts.hours, 1);
		assert.equal(parts.minutes, 1);
	});

	it('wraps hours at 24 back to 0', () => {
		let state = timerSetStart(defaultTimer(), TIMER_MAX_MS);
		state = timerStepField(state, 'hours', 1, T0);
		assert.equal(timerParts(state.pausedMs).hours, 0);
	});

	it('will not go below one second, jumping to one instead', () => {
		let state = timerSetStart(defaultTimer(), 1_000);
		state = timerStepField(state, 'seconds', -1, T0);
		assert.equal(state.startMs, TIMER_MIN_MS);
	});

	it('moves the start value while stopped, so the display and the reset target agree', () => {
		const state = timerSetStart(defaultTimer(), 90_000);
		assert.equal(state.startMs, 90_000);
		assert.equal(state.pausedMs, 90_000);
	});
});

describe('persistence: an absolute end instant (TMR-8, PRS-3)', () => {
	it('survives a restart still counting down', () => {
		const stored = timerToggle(timerSetStart(defaultTimer(), 600_000), T0);
		const restored = repairTimer(JSON.parse(JSON.stringify(stored)));

		assert.equal(restored.running, true);
		assert.equal(restored.endsAt, T0 + 600_000);
		// Ten minutes later, in a fresh process, it has finished on schedule.
		assert.equal(timerExpired(restored, T0 + 600_000), true);
		// And a minute in, it has nine minutes left — the time passed while it was not running.
		assert.equal(timerRemaining(restored, T0 + 60_000), 540_000);
	});

	it('refuses to trust a running timer with no end instant', () => {
		// Otherwise a corrupt file leaves a timer that can never finish.
		const restored = repairTimer({ startMs: 60_000, running: true, endsAt: null, pausedMs: 60_000 });
		assert.equal(restored.running, false);
		assert.equal(restored.pausedMs, 60_000);
	});

	it('repairs nonsense into a working timer', () => {
		for (const input of [null, undefined, 42, 'x', {}, { startMs: 'soon' }]) {
			const repaired = repairTimer(input);
			assert.equal(repaired.running, false, `input ${JSON.stringify(input)}`);
			assert.ok(repaired.startMs >= TIMER_MIN_MS && repaired.startMs <= TIMER_MAX_MS);
		}
	});

	it('clamps a stored out-of-range duration rather than accepting it', () => {
		assert.equal(repairTimer({ startMs: 5 }).startMs, TIMER_MIN_MS);
		assert.equal(repairTimer({ startMs: 10 ** 12 }).startMs, TIMER_MAX_MS);
	});
});
