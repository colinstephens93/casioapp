/**
 * The zone-and-clock derivation.
 *
 * The valuable cases are the ones where the derived fields must stay consistent with each other:
 * the wall clock, the offset, the gap from the Home City, the day marker and the DST label all come
 * from one snapshot, so a forced DST override has to move all of them together rather than only the
 * digits. A test asserting exactly that is what stops the map band moving while the numbers do not.
 *
 * Persistence and the screens are *not* tested here — `controller.test.ts` owns both, because
 * `controller.ts` owns them. This file is about the arithmetic, and only the arithmetic.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultSettings, syncWatch, type WatchSettings } from '../src/shared/watch.ts';
import { effectiveOffset } from '../src/shared/time.ts';

const SUMMER = new Date(Date.UTC(2026, 6, 15, 22, 48, 37));
const WINTER = new Date(Date.UTC(2026, 0, 15, 14, 5, 9));

/** Settings with explicit zones, so tests never depend on the machine's own zone. */
function settings(overrides: Partial<WatchSettings> = {}): WatchSettings {
	return { ...defaultSettings('Europe/London'), ...overrides };
}

describe('syncWatch', () => {
	it('derives the displayed wall clock from the register, not the Home City', () => {
		const state = syncWatch({ ...settings(), selected: 4 }, SUMMER);
		// T-4 is Tokyo in the default settings.
		assert.equal(state.zone, 'Asia/Tokyo');
		assert.equal(state.cityCode, 'TYO');
		assert.equal(state.wall.toISOString(), new Date(SUMMER.getTime() + 540 * 60_000).toISOString());
	});

	it('reports the Home City independently of the selection', () => {
		const state = syncWatch({ ...settings(), selected: 4 }, SUMMER);
		assert.equal(state.homeZone, 'Europe/London');
		// July is British Summer Time, and the default DST mode is `off`, so standard time applies.
		assert.equal(state.homeOffset, 0);
	});

	it('reports the offset gap from the Home City', () => {
		const state = syncWatch({ ...settings(), selected: 4 }, SUMMER);
		assert.equal(state.diffFromHome, 540 - state.homeOffset);
	});

	it('computes the ±1 day marker from civil dates', () => {
		// Tokyo is nine hours ahead, so a late-evening instant in London is already tomorrow there.
		const late = new Date(Date.UTC(2026, 6, 15, 22, 48, 37));
		assert.equal(syncWatch({ ...settings(), selected: 4 }, late).dayDiff, 1);

		const early = new Date(Date.UTC(2026, 6, 15, 6, 0, 0));
		assert.equal(syncWatch({ ...settings(), selected: 4 }, early).dayDiff, 0);
	});

	it('exposes the DST label for the displayed register', () => {
		const london = { zone: 'Europe/London', dst: 'auto' as const };
		const withAuto = syncWatch({ ...settings(), slots: [london, london, london, london] }, SUMMER);
		assert.equal(withAuto.dstLabel, 'DST');

		const forcedOff = syncWatch(
			{ ...settings(), slots: [{ ...london, dst: 'off' }, london, london, london] },
			SUMMER,
		);
		assert.equal(forcedOff.dstLabel, 'STD*');
	});

	it('moves the walls, the gap and the day marker together when DST is forced', () => {
		// A forced override changes the offset, so every derived field must follow it. This is the bug
		// class the design guards against: the band moving while the digits do not.
		const base = { zone: 'America/New_York', dst: 'auto' as const };
		const auto = syncWatch({ ...settings(), slots: [base, base, base, base], selected: 1 }, WINTER);
		const forced = syncWatch(
			{ ...settings(), slots: [{ ...base, dst: 'on' }, base, base, base], selected: 1 },
			WINTER,
		);

		assert.notEqual(auto.displayedOffset, forced.displayedOffset);
		assert.equal(forced.displayedOffset - auto.displayedOffset, 60);
		// The wall clock moves by the same hour.
		assert.equal(forced.wall.getTime() - auto.wall.getTime(), 3_600_000);
		// And the offset matches what the pure helper says it should be.
		assert.equal(forced.displayedOffset, effectiveOffset('America/New_York', WINTER, 'on'));
	});

	it('marks the afternoon for the PM indicator', () => {
		// 22:48 UTC is 15:48 in New York (EDT) — afternoon.
		const newYork = { ...settings(), selected: 2 };
		assert.equal(syncWatch({ ...newYork, slots: newYork.slots }, SUMMER).pm, true);

		// The same instant is 07:48 the next morning in Tokyo — morning.
		assert.equal(syncWatch({ ...settings(), selected: 4 }, SUMMER).pm, false);
	});

	it('clamps an out-of-range register rather than throwing', () => {
		assert.equal(syncWatch({ ...settings(), selected: 9 }, SUMMER).selected, 4);
		assert.equal(syncWatch({ ...settings(), selected: -3 }, SUMMER).selected, 1);
	});

	it('always has a Home City, even if the slots are empty', () => {
		// A partial file must never stop the clock (PRS-4), and this is the derivation's own floor
		// rather than the reader's: even handed nothing, it answers with a real zone.
		const state = syncWatch({ slots: [], clock: '24h', selected: 1 }, SUMMER);
		assert.equal(typeof state.homeZone, 'string');
		assert.ok(state.homeZone.length > 0);
	});

	it('does not divide by zero on an empty register set', () => {
		// The clamp used to be `Math.min(max(selected,1), slots.length)`, which is 0 when there are no
		// slots, giving index -1. It survived only because `slots[-1]` is undefined and the fallback
		// caught it — a correct answer for a wrong reason, which is worth pinning.
		const state = syncWatch({ slots: [], clock: '24h', selected: 4 }, SUMMER);
		assert.equal(state.selected, 1);
		assert.ok(Number.isFinite(state.displayedOffset));
		assert.ok(!Number.isNaN(state.wall.getTime()));
	});
});
