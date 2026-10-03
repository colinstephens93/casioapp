/**
 * Gesture recognition tests (requirement INT-*).
 *
 * The gestures are where a naive implementation is most likely to be wrong in a way that no amount
 * of clicking would reveal: a hold that also acts as a press, a chord that also acts as its two
 * components, a repeat that fires once after the screen has changed. Each of those has a test here.
 *
 * Everything is driven by injected instants, so "hold SEARCH for three seconds" runs in microseconds.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	CHORDS,
	GestureReader,
	HOLD_MS,
	PUSHERS,
	REPEAT_DELAY_MS,
	REPEAT_MS,
	type Gesture,
	type Pusher,
} from '../src/shared/gestures.ts';

const T0 = 1_000;

/** Collects the gesture kinds a reader produced, for compact assertions. */
function kinds(gestures: readonly Gesture[]): string[] {
	return gestures.map((gesture) => gesture.kind);
}

describe('presses', () => {
	it('reports a press on the way down and never on the way up', () => {
		// The release must not be a second press: holding a pusher would otherwise act twice, and the
		// state machine acts on presses.
		const reader = new GestureReader();
		assert.deepEqual(kinds(reader.down('search', T0)), ['press']);
		assert.deepEqual(kinds(reader.up('search', T0 + 50)), ['release']);
	});

	it('ignores a second press of a pusher that is already down', () => {
		const reader = new GestureReader();
		reader.down('mode', T0);
		assert.deepEqual(reader.down('mode', T0 + 10), []);
	});

	it('ignores a release of a pusher that was never down', () => {
		const reader = new GestureReader();
		assert.deepEqual(reader.up('light', T0), []);
	});

	it('names every pusher the case has', () => {
		assert.deepEqual([...PUSHERS], ['adjust', 'light', 'mode', 'search']);
	});
});

describe('holds, at the watch durations (INT-5)', () => {
	it('does not fire one millisecond before the threshold', () => {
		const reader = new GestureReader();
		reader.configure({ adjust: HOLD_MS.settings });
		reader.down('adjust', T0);
		assert.deepEqual(reader.tick(T0 + HOLD_MS.settings - 1), []);
	});

	it('fires exactly at the threshold', () => {
		const reader = new GestureReader();
		reader.configure({ adjust: HOLD_MS.settings });
		reader.down('adjust', T0);
		const fired = reader.tick(T0 + HOLD_MS.settings);
		assert.deepEqual(kinds(fired), ['hold']);
		assert.equal(fired[0]?.kind === 'hold' ? fired[0].ms : 0, HOLD_MS.settings);
	});

	it('fires the hold only once, however long it is held', () => {
		const reader = new GestureReader();
		reader.configure({ adjust: HOLD_MS.settings });
		reader.down('adjust', T0);
		assert.equal(reader.tick(T0 + 1_000).length, 1);
		// A second and a half later the hold has already happened and must not happen again.
		assert.deepEqual(reader.tick(T0 + 2_500), []);
		assert.deepEqual(reader.tick(T0 + 30_000), []);
	});

	it('uses the watch three durations and no others', () => {
		// Requirement INT-5 names ~1 s, ~2 s and ~3 s. These are the values, and they are asserted so
		// that a later "tidy-up" cannot quietly round them to something more convenient.
		assert.equal(HOLD_MS.settings, 1000, 'ADJUST hold: setting screen');
		assert.equal(HOLD_MS.mute, 1000, 'MODE hold: mute');
		assert.equal(HOLD_MS.cityPicker, 2000, 'ADJUST hold on T-2..T-4: city picker');
		assert.equal(HOLD_MS.autoDisplay, 3000, 'SEARCH hold: Auto Display');
	});

	it('re-reads the threshold when the screen changes', () => {
		// The same pusher, two meanings. If the reader kept the old threshold, a 3 s hold that should
		// fire Auto Display would fire the 1 s gesture instead.
		const reader = new GestureReader();
		reader.configure({ search: HOLD_MS.settings });
		reader.down('search', T0);
		reader.configure({ search: HOLD_MS.autoDisplay });
		assert.deepEqual(reader.tick(T0 + HOLD_MS.settings), [], 'the shortened threshold must not apply');
		assert.equal(reader.tick(T0 + HOLD_MS.autoDisplay).length, 1);
	});

	it('never fires a hold for a pusher whose threshold is infinite', () => {
		// LIGHT and the stopwatch's SEARCH have no hold of their own. An infinite threshold is how
		// "no hold" is expressed, rather than by absence from the table, so a stale entry cannot leak.
		const reader = new GestureReader();
		reader.configure({ light: Number.POSITIVE_INFINITY });
		reader.down('light', T0);
		assert.deepEqual(reader.tick(T0 + 600_000), []);
	});
});

describe('chords (INT-6, INT-8)', () => {
	it('emits one chord when both pushers are down, and no holds', () => {
		const reader = new GestureReader();
		reader.configure({ adjust: HOLD_MS.settings, light: Number.POSITIVE_INFINITY });

		reader.down('adjust', T0);
		reader.down('light', T0 + 30);

		// Held well past ADJUST's own threshold: the chord swallows it.
		assert.deepEqual(reader.tick(T0 + 5_000), []);

		// Releasing either pusher produces the chord, exactly once.
		const released = reader.up('light', T0 + 5_100);
		assert.deepEqual(kinds(released), ['release', 'chord']);

		// The other pusher's release must not produce a second chord.
		const second = reader.up('adjust', T0 + 5_200);
		assert.deepEqual(kinds(second), ['release']);
	});

	it('reports the chord as active while both are down (INT-8)', () => {
		const reader = new GestureReader();
		reader.down('adjust', T0);
		assert.equal(reader.activeChord(), null);
		reader.down('light', T0 + 10);
		assert.equal(reader.activeChord(), 'adjust+light');
		reader.up('light', T0 + 20);
		assert.equal(reader.activeChord(), null);
	});

	it('knows only the chords the watch has', () => {
		assert.deepEqual([...CHORDS], ['adjust+light']);
	});

	it('does not treat two pushers pressed far apart as a chord', () => {
		// ADJUST pressed, released, and LIGHT pressed a moment later is two presses. Only genuinely
		// overlapping presses are a chord.
		const reader = new GestureReader();
		reader.configure({ adjust: HOLD_MS.settings });
		reader.down('adjust', T0);
		reader.up('adjust', T0 + 100);
		reader.down('light', T0 + 200);
		assert.equal(reader.activeChord(), null);
		assert.deepEqual(kinds(reader.tick(T0 + 400)), []);
	});

	it('forgets a pending chord when the gesture state is cleared', () => {
		const reader = new GestureReader();
		reader.down('adjust', T0);
		reader.down('light', T0 + 10);
		reader.clear();
		assert.equal(reader.activeChord(), null);
		assert.deepEqual(reader.pressed(), []);
		// The release after a clear has nothing to report, so no chord can arrive late.
		assert.deepEqual(reader.up('light', T0 + 5_000), []);
	});
});

describe('fast scroll on hold (WLD-1, ALM-2)', () => {
	it('repeats only for a pusher the current screen declared', () => {
		const reader = new GestureReader();
		// A repeating pusher has no hold of its own: on the watch, holding SEARCH in World Time *is*
		// the fast scroll rather than a different action, so the threshold is infinite.
		reader.configure({ search: Number.POSITIVE_INFINITY }, ['search']);
		reader.down('search', T0);
		const repeats = reader.tick(T0 + 2_000);
		assert.ok(repeats.length >= 1, 'a repeating pusher should have repeated by two seconds');
		assert.ok(repeats.every((gesture) => gesture.kind === 'repeat'));
	});

	it('refuses to both hold and repeat, since those are different meanings', () => {
		// The distinction the watch makes: SEARCH scrolls in World Time, and fires the test alarm in
		// Alarm mode. It cannot do both, so a finite threshold disqualifies it as a repeater.
		const reader = new GestureReader();
		reader.configure({ search: HOLD_MS.autoDisplay }, ['search']);
		reader.down('search', T0);
		const fired = reader.tick(T0 + 3_000);
		assert.deepEqual(kinds(fired), ['hold']);
		assert.deepEqual(reader.tick(T0 + 10_000), [], 'a terminal hold must not also scroll');
	});

	it('does not repeat a pusher with no repeat declared', () => {
		const reader = new GestureReader();
		reader.configure({ search: HOLD_MS.autoDisplay }, []);
		reader.down('search', T0);
		const fired = reader.tick(T0 + 3_000);
		assert.deepEqual(kinds(fired), ['hold']);
		assert.deepEqual(reader.tick(T0 + 10_000), []);
	});

	it('starts repeating after the deliberate-press delay', () => {
		// A press on its way to a scroll must not fire on the way down.
		const reader = new GestureReader();
		reader.configure({ search: Number.POSITIVE_INFINITY }, ['search']);
		reader.down('search', T0);
		assert.deepEqual(reader.tick(T0 + REPEAT_DELAY_MS - 1), []);
		assert.deepEqual(kinds(reader.tick(T0 + REPEAT_DELAY_MS)), ['repeat']);
		// And the delay is shorter than the shortest hold, so it cannot be mistaken for one.
		assert.ok(REPEAT_DELAY_MS < HOLD_MS.settings);
	});

	it('stops repeating the instant the pusher comes up', () => {
		const reader = new GestureReader();
		reader.configure({ search: Number.POSITIVE_INFINITY }, ['search']);
		reader.down('search', T0);
		reader.tick(T0 + 1_000);
		reader.up('search', T0 + 1_100);
		assert.deepEqual(reader.tick(T0 + 5_000), []);
	});

	it('drops a pending repeat when the screen stops repeating it', () => {
		// The screen changed between two ticks. Without this the old screen's repeat would fire once
		// more, scrolling a list the operator is no longer looking at.
		const reader = new GestureReader();
		reader.configure({ search: Number.POSITIVE_INFINITY }, ['search']);
		reader.down('search', T0);
		reader.tick(T0 + 500);
		reader.configure({ search: Number.POSITIVE_INFINITY }, []);
		assert.deepEqual(reader.tick(T0 + 6_000), []);
	});

	it('spaces its repeats at the documented cadence', () => {
		const reader = new GestureReader();
		reader.configure({ search: Number.POSITIVE_INFINITY }, ['search']);
		reader.down('search', T0);

		// Count the repeats over two seconds of steady ticking and check the rate is the intended
		// one, rather than asserting an exact sequence that a cadence change would break for no
		// reason.
		let count = 0;
		for (let t = T0 + 500; t <= T0 + 2_500; t += 50) {
			count += reader.tick(t).length;
		}
		// Two seconds of repeats, at one per REPEAT_MS.
		const expected = Math.round(2_000 / REPEAT_MS);
		assert.ok(
			Math.abs(count - expected) <= 2,
			`${count} repeats in two seconds, expected about ${expected}`,
		);
	});
});

describe('the pressed state the face draws (INT-8)', () => {
	it('lists the pushers that are down, in a stable order', () => {
		const reader = new GestureReader();
		assert.deepEqual(reader.pressed(), []);
		reader.down('search', T0);
		reader.down('adjust', T0 + 5);
		assert.deepEqual(reader.pressed(), ['adjust', 'search']);
		reader.up('adjust', T0 + 10);
		assert.deepEqual(reader.pressed(), ['search']);
	});

	it('reports the chord state separately from the pressed state', () => {
		const reader = new GestureReader();
		reader.down('adjust', T0);
		reader.down('light', T0 + 5);
		assert.deepEqual(reader.pressed(), ['adjust', 'light']);
		assert.equal(reader.activeChord(), 'adjust+light');
	});

	it('forgets every stuck press when cleared, as a window losing focus must', () => {
		const reader = new GestureReader();
		for (const pusher of PUSHERS) {
			reader.down(pusher as Pusher, T0);
		}
		assert.equal(reader.pressed().length, 4);
		reader.clear();
		assert.deepEqual(reader.pressed(), []);
	});
});
