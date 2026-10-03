/**
 * Stopwatch tests.
 *
 * The stopwatch is the piece the plan's risk R-6 singles out: "accumulated-tick timing drifts,
 * making the stopwatch wrong — precisely what SW-1 forbids". So every test here drives it from an
 * injected monotonic instant and checks the arithmetic against an independent calculation rather
 * than against another call into the same code.
 *
 * The cases worth having are the three behaviours (elapsed, split, two finishes), which are all
 * the *same* control layout read differently, and the 24-hour rollover, which must reset the
 * reading to zero while continuing to run.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	STOPWATCH_LIMIT_MS,
	defaultStopwatch,
	formatStopwatch,
	stopwatchAdjust,
	stopwatchClear,
	stopwatchDisplayMs,
	stopwatchElapsedMs,
	stopwatchParts,
	stopwatchRawMs,
	stopwatchRunning,
	stopwatchSearch,
	stopwatchWraps,
} from '../src/shared/stopwatch.ts';

const T0 = 5_000_000;

/** Runs the stopwatch forward to an absolute monotonic instant. */
const at = (ms: number): number => T0 + ms;

describe('elapsed time (SW-3)', () => {
	it('starts at zero and is not running', () => {
		const state = defaultStopwatch();
		assert.equal(stopwatchRunning(state), false);
		assert.equal(stopwatchElapsedMs(state, at(0)), 0);
		assert.equal(stopwatchDisplayMs(state, at(0)), 0);
	});

	it('measures from the injected instant, to a hundredth', () => {
		let state = stopwatchSearch(defaultStopwatch(), at(0));
		assert.equal(stopwatchRunning(state), true);
		assert.equal(stopwatchElapsedMs(state, at(1)), 1);
		assert.equal(stopwatchElapsedMs(state, at(10)), 10);
		assert.equal(stopwatchElapsedMs(state, at(3_600_000)), 3_600_000);
	});

	it('stop, re-start, stop — accumulating the runs and excluding the gap', () => {
		let state = stopwatchSearch(defaultStopwatch(), at(0));
		state = stopwatchSearch(state, at(2_000)); // stop after 2 s
		assert.equal(stopwatchElapsedMs(state, at(2_000)), 2_000);
		// The gap while stopped must not count.
		assert.equal(stopwatchElapsedMs(state, at(600_000)), 2_000);

		state = stopwatchSearch(state, at(600_000)); // re-start
		state = stopwatchSearch(state, at(601_500)); // stop after another 1.5 s
		assert.equal(stopwatchElapsedMs(state, at(601_500)), 3_500);
	});

	it('ADJUST clears it, but only when it is stopped', () => {
		let state = stopwatchSearch(defaultStopwatch(), at(0));
		state = stopwatchSearch(state, at(5_000));
		state = stopwatchClear(state);
		assert.equal(stopwatchElapsedMs(state, at(5_000)), 0);
		assert.equal(stopwatchRunning(state), false);
	});

	it('holds the reading against an independent calculation over an hour (SW-1)', () => {
		// Risk R-6: an implementation that accumulated per-tick deltas would drift. This asserts the
		// reading is exactly `now - startedAt`, which cannot.
		const state = stopwatchSearch(defaultStopwatch(), at(0));
		for (let elapsed = 0; elapsed <= 3_600_000; elapsed += 997) {
			assert.equal(stopwatchElapsedMs(state, at(elapsed)), elapsed, `at +${elapsed} ms`);
		}
	});
});

describe('split time (SW-4)', () => {
	it('freezes the display while the watch keeps counting', () => {
		let state = stopwatchSearch(defaultStopwatch(), at(0));
		state = stopwatchAdjust(state, at(12_340));

		// The display is frozen at the split...
		assert.equal(stopwatchDisplayMs(state, at(12_340)), 12_340);
		assert.equal(stopwatchDisplayMs(state, at(20_000)), 12_340);
		// ...while the elapsed time underneath carries on, which is what makes the next split right.
		assert.equal(stopwatchElapsedMs(state, at(20_000)), 20_000);
		assert.equal(stopwatchRunning(state), true);
	});

	it('releases the split and returns to the live reading (SW-7)', () => {
		let state = stopwatchSearch(defaultStopwatch(), at(0));
		state = stopwatchAdjust(state, at(12_340));
		state = stopwatchAdjust(state, at(20_000));
		assert.equal(stopwatchDisplayMs(state, at(20_000)), 20_000);
	});

	it('does nothing when the watch is stopped, since the display is already still', () => {
		let state = stopwatchSearch(defaultStopwatch(), at(0));
		state = stopwatchSearch(state, at(5_000));
		const adjusted = stopwatchAdjust(state, at(9_000));
		assert.equal(adjusted.splitMs, null);
		assert.equal(stopwatchDisplayMs(adjusted, at(9_000)), 5_000);
	});
});

describe('two finishes (SW-5)', () => {
	it('shows the first finisher while stopped, and the second after the split is released', () => {
		let state = stopwatchSearch(defaultStopwatch(), at(0));
		state = stopwatchAdjust(state, at(10_000)); // first finisher: 10.00
		state = stopwatchSearch(state, at(10_800)); // second finisher: 10.80

		// Stopped with the split still frozen: the first finisher's time is on screen.
		assert.equal(stopwatchDisplayMs(state, at(10_800)), 10_000);
		assert.equal(stopwatchRunning(state), false);

		// Releasing the split reveals the second finisher's time.
		state = stopwatchAdjust(state, at(11_000));
		assert.equal(stopwatchDisplayMs(state, at(11_000)), 10_800);

		// And ADJUST again clears it.
		state = stopwatchClear(state);
		assert.equal(stopwatchDisplayMs(state, at(11_000)), 0);
	});

	it('keeps both times: the frozen split and the final elapsed', () => {
		let state = stopwatchSearch(defaultStopwatch(), at(0));
		state = stopwatchAdjust(state, at(10_000));
		state = stopwatchSearch(state, at(10_800));
		assert.equal(state.splitMs, 10_000, "the first finisher's time");
		assert.equal(state.banked, 10_800, "the second finisher's time");
	});
});

describe('the 24-hour rollover (SW-8)', () => {
	it('resets the reading to zero and keeps running', () => {
		const state = stopwatchSearch(defaultStopwatch(), at(0));

		// One hundredth short of the limit, it still reads the limit minus a hundredth.
		assert.equal(stopwatchElapsedMs(state, at(STOPWATCH_LIMIT_MS - 10)), STOPWATCH_LIMIT_MS - 10);

		// At the limit the reading has already returned to zero. The watch's smallest displayed unit
		// is a hundredth, so there is no hundredth in which `23'59'59.99` is a *settled* reading: the
		// requirement is that the limit resets to zero, and this is where it happens.
		assert.equal(stopwatchElapsedMs(state, at(STOPWATCH_LIMIT_MS)), 0);

		// Past it, the reading counts up from zero again and the watch is still running.
		assert.equal(stopwatchElapsedMs(state, at(STOPWATCH_LIMIT_MS + 10)), 10);
		assert.equal(stopwatchElapsedMs(state, at(STOPWATCH_LIMIT_MS + 1_000)), 1_000);
		assert.equal(stopwatchRunning(state), true);
	});

	it('counts the wraps rather than losing them', () => {
		const state = stopwatchSearch(defaultStopwatch(), at(0));
		assert.equal(stopwatchWraps(state, at(0)), 0);
		assert.equal(stopwatchWraps(state, at(STOPWATCH_LIMIT_MS)), 0);
		assert.equal(stopwatchWraps(state, at(STOPWATCH_LIMIT_MS + 1)), 1);
		assert.equal(stopwatchWraps(state, at(2 * STOPWATCH_LIMIT_MS + 1)), 2);
		assert.equal(stopwatchWraps(state, at(3 * STOPWATCH_LIMIT_MS + 1)), 3);
	});

	it('wraps correctly when a suspension skipped two whole capacities', () => {
		// The derived-not-stored design is what makes this right: a stored counter incremented per
		// tick would have missed both wraps entirely.
		const state = stopwatchSearch(defaultStopwatch(), at(0));
		// Three capacities and five seconds after it started.
		const jumped = at(3 * STOPWATCH_LIMIT_MS + 5_000);
		assert.equal(stopwatchWraps(state, jumped), 3);
		assert.equal(stopwatchElapsedMs(state, jumped), 5_000);
	});

	it('never reports more than its capacity', () => {
		const state = stopwatchSearch(defaultStopwatch(), at(0));
		for (let i = 0; i < 200; i += 1) {
			const elapsed = stopwatchElapsedMs(state, at(i * 1_000_000));
			assert.ok(elapsed >= 0 && elapsed <= STOPWATCH_LIMIT_MS, `${elapsed} out of range`);
		}
	});
});

describe('the reading, formatted for the LCD (SW-1)', () => {
	it('prints hours, minutes, seconds and hundredths', () => {
		assert.equal(formatStopwatch(0), "00'00'00.00");
		assert.equal(formatStopwatch(1), "00'00'00.00", 'a hundredth is the resolution');
		assert.equal(formatStopwatch(10), "00'00'00.01");
		assert.equal(formatStopwatch(1_000), "00'00'01.00");
		assert.equal(formatStopwatch(60_000), "00'01'00.00");
		assert.equal(formatStopwatch(3_600_000), "01'00'00.00");
		assert.equal(formatStopwatch(STOPWATCH_LIMIT_MS), "23'59'59.99");
	});

	it('splits into the fields the face draws separately', () => {
		const parts = stopwatchParts(3_723_456);
		assert.equal(parts.hours, 1);
		assert.equal(parts.minutes, 2);
		assert.equal(parts.seconds, 3);
		assert.equal(parts.hundredths, 45);
	});

	it('truncates rather than rounds, so the display never runs ahead of the truth', () => {
		// 9.999 ms is nine hundredths and a fraction. Rounding would show 00.01, a hundredth the
		// stopwatch has not measured yet.
		assert.equal(stopwatchParts(9_999).hundredths, 99, '9999 ms is 9 s and 99 hundredths');
		// 999 ms is 0.99 s — ninety-nine hundredths, computed rather than guessed. The first version
		// of this assertion said 9, which is a tenth of a second and not this value at all.
		assert.equal(stopwatchParts(999).hundredths, 99);
		assert.equal(stopwatchParts(9).hundredths, 0, 'under a hundredth reads zero, not one');
		assert.equal(formatStopwatch(9_999), "00'00'09.99");
	});

	it('is never persisted (SW-10, PRS-2)', () => {
		// There is deliberately no `repairStopwatch`: the stopwatch has no persisted form at all, and
		// the controller simply builds a fresh one. This asserts the default is genuinely empty.
		const fresh = defaultStopwatch();
		assert.equal(fresh.banked, 0);
		assert.equal(fresh.startedAt, null);
		assert.equal(fresh.splitMs, null);
		assert.equal(stopwatchRawMs(fresh, at(9_999_999)), 0);
	});
});
