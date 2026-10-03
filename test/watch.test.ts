/**
 * Live watch state tests.
 *
 * The valuable cases here are the ones where the state must stay self-consistent: the digits, the
 * map band, the day marker and the DST label are all derived from one snapshot, so a forced DST
 * override has to move all of them together rather than only the display.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	Watch,
	defaultSettings,
	parseSettings,
	serialiseSettings,
	syncWatch,
	type WatchStore,
} from '../src/shared/watch.ts';
import { effectiveOffset, offsetMinutes } from '../src/shared/time.ts';

const SUMMER = new Date(Date.UTC(2026, 6, 15, 22, 48, 37));
const WINTER = new Date(Date.UTC(2026, 0, 15, 14, 5, 9));

/** Settings with explicit zones, so tests never depend on the machine's own zone. */
function settings(overrides: Partial<ReturnType<typeof defaultSettings>> = {}) {
	return {
		...defaultSettings('Europe/London'),
		...overrides,
	};
}

function memoryStore(initial: string | null = null): WatchStore & { value: string | null } {
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
		const state = syncWatch({ ...settings(), selected: 4 }, late);
		assert.equal(state.dayDiff, 1);

		const early = new Date(Date.UTC(2026, 6, 15, 6, 0, 0));
		assert.equal(syncWatch({ ...settings(), selected: 4 }, early).dayDiff, 0);
	});

	it('exposes the DST label for the displayed register', () => {
		const london = { zone: 'Europe/London', dst: 'auto' as const };
		const withAuto = syncWatch(
			{ ...settings(), slots: [london, london, london, london] },
			SUMMER,
		);
		assert.equal(withAuto.dstLabel, 'DST');

		const forcedOff = syncWatch(
			{ ...settings(), slots: [{ ...london, dst: 'off' }, london, london, london] },
			SUMMER,
		);
		assert.equal(forcedOff.dstLabel, 'STD*');
	});

	it('moves the walls, the gap and the day marker together when DST is forced', () => {
		// A forced override changes the offset, so every derived field must follow it. This is the
		// bug class the design guards against: the band moving while the digits do not.
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
		const state = syncWatch({ slots: [], clock: '24h', selected: 1 }, SUMMER);
		assert.equal(typeof state.homeZone, 'string');
		assert.ok(state.homeZone.length > 0);
	});
});

describe('settings round-trip', () => {
	it('survives serialisation', () => {
		const original = { ...settings(), clock: '12h' as const, selected: 3 };
		const restored = parseSettings(serialiseSettings(original));
		assert.equal(restored.clock, '12h');
		assert.equal(restored.selected, 3);
		assert.deepEqual(
			restored.slots.map((slot) => slot.zone),
			original.slots.map((slot) => slot.zone),
		);
	});

	it('preserves per-register DST overrides', () => {
		const slots = settings().slots.map((slot, index) => ({
			...slot,
			dst: index === 1 ? ('on' as const) : ('off' as const),
		}));
		const restored = parseSettings(serialiseSettings({ ...settings(), slots }));
		assert.deepEqual(
			restored.slots.map((slot) => slot.dst),
			['off', 'on', 'off', 'off'],
		);
	});
});

describe('settings repair (PRS-4)', () => {
	it('falls back on null, empty and malformed input rather than throwing', () => {
		for (const input of [null, '', 'not json', '[]', '42', '{"version":1}']) {
			const result = parseSettings(input);
			assert.equal(result.slots.length, 4, `input ${JSON.stringify(input)} produced bad slots`);
			assert.equal(result.clock, '24h');
		}
	});

	it('rejects a partial register set, since a Home City is mandatory', () => {
		const partial = JSON.stringify({
			version: 1,
			clock: '24h',
			selected: 1,
			slots: [{ zone: 'Asia/Tokyo', dst: 'off' }],
		});
		assert.equal(parseSettings(partial).slots[0]?.zone, defaultSettings().slots[0]?.zone);
	});

	it('replaces an unknown zone rather than trusting it', () => {
		const bad = JSON.stringify({
			version: 1,
			clock: '24h',
			selected: 1,
			slots: [
				{ zone: 'Not/AZone', dst: 'off' },
				{ zone: 'Asia/Tokyo', dst: 'off' },
				{ zone: 'Asia/Tokyo', dst: 'off' },
				{ zone: 'Asia/Tokyo', dst: 'off' },
			],
		});
		const result = parseSettings(bad);
		// The whole set is discarded, because index 0 must be a real Home City.
		assert.equal(result.slots[0]?.zone, defaultSettings().slots[0]?.zone);
	});

	it('accepts ICU legacy spellings for a stored zone', () => {
		const legacy = JSON.stringify({
			version: 1,
			clock: '24h',
			selected: 1,
			slots: [
				{ zone: 'Asia/Calcutta', dst: 'off' },
				{ zone: 'Asia/Tokyo', dst: 'off' },
				{ zone: 'Asia/Tokyo', dst: 'off' },
				{ zone: 'Asia/Tokyo', dst: 'off' },
			],
		});
		// The catalogue stores Asia/Kolkata, so the legacy spelling must resolve to it.
		assert.equal(parseSettings(legacy).slots[0]?.zone, 'Asia/Kolkata');
	});

	it('rejects an invalid clock or register value', () => {
		const bad = JSON.stringify({
			version: 1,
			clock: '36h',
			selected: 99,
			slots: settings().slots,
		});
		const result = parseSettings(bad);
		assert.equal(result.clock, '24h');
		assert.equal(result.selected, 1);
	});
});

describe('the Watch controller', () => {
	it('starts with a synced state using the injected clock', () => {
		const watch = new Watch(settings(), undefined, () => SUMMER);
		assert.equal(watch.getState().at.getTime(), SUMMER.getTime());
		assert.equal(watch.running, false);
	});

	it('does not accumulate elapsed time, so it cannot drift (PRS-5)', () => {
		let current = SUMMER;
		const watch = new Watch(settings(), undefined, () => current);

		// Simulate a long suspension: the wall clock jumps an hour while the timer slept.
		current = new Date(SUMMER.getTime() + 3_600_000);
		watch.tick();
		assert.equal(watch.getState().at.getTime(), current.getTime());

		// And a backwards jump must be honoured too, not clamped away.
		current = new Date(SUMMER.getTime() - 7_200_000);
		watch.tick();
		assert.equal(watch.getState().at.getTime(), current.getTime());
	});

	it('notifies subscribers immediately and on every tick', () => {
		let current = SUMMER;
		const watch = new Watch(settings(), undefined, () => current);
		const seen: number[] = [];
		watch.subscribe((state) => seen.push(state.at.getTime()));

		assert.equal(seen.length, 1, 'subscribe should deliver the current state at once');
		current = new Date(SUMMER.getTime() + 1000);
		watch.tick();
		assert.equal(seen.length, 2);
	});

	it('unsubscribes cleanly', () => {
		const watch = new Watch(settings(), undefined, () => SUMMER);
		let count = 0;
		const off = watch.subscribe(() => {
			count += 1;
		});
		off();
		watch.tick();
		assert.equal(count, 1, 'the listener should have been removed');
	});

	it('wraps through the registers, as the watch does', () => {
		const watch = new Watch(settings(), undefined, () => SUMMER);
		assert.equal(watch.getState().selected, 1);
		watch.nextRegister();
		assert.equal(watch.getState().selected, 2);
		watch.selectRegister(4);
		watch.nextRegister();
		assert.equal(watch.getState().selected, 1);
	});

	it('ignores an out-of-range register selection', () => {
		const watch = new Watch(settings(), undefined, () => SUMMER);
		watch.selectRegister(7);
		assert.equal(watch.getState().selected, 1);
	});

	it('changes a register zone and re-syncs', () => {
		const watch = new Watch(settings(), undefined, () => SUMMER);
		watch.setZone(2, 'Australia/Sydney');
		assert.equal(watch.getState().settings.slots[1]?.zone, 'Australia/Sydney');

		watch.selectRegister(2);
		assert.equal(watch.getState().cityCode, 'SYD');
	});

	it('rejects an unknown zone without disturbing the state', () => {
		const watch = new Watch(settings(), undefined, () => SUMMER);
		const before = watch.getState().settings.slots[1]?.zone;
		watch.setZone(2, 'Not/AZone');
		assert.equal(watch.getState().settings.slots[1]?.zone, before);
	});

	it('promotes a Local Time to Home City when T-1 is set', () => {
		// This is what ADJUST+LIGHT does on the watch (requirement TIM-10).
		const watch = new Watch(settings(), undefined, () => SUMMER);
		watch.setZone(1, 'Asia/Tokyo');
		assert.equal(watch.getState().homeZone, 'Asia/Tokyo');
	});

	it('cycles DST through auto, on, off and back, as the documented extension', () => {
		const watch = new Watch(settings(), undefined, () => SUMMER);
		assert.equal(watch.getState().settings.slots[0]?.dst, 'off');
		watch.cycleDst(1);
		assert.equal(watch.getState().settings.slots[0]?.dst, 'auto');
		watch.cycleDst(1);
		assert.equal(watch.getState().settings.slots[0]?.dst, 'on');
		watch.cycleDst(1);
		assert.equal(watch.getState().settings.slots[0]?.dst, 'off');
	});

	it('toggles between 12- and 24-hour presentation', () => {
		const watch = new Watch(settings(), undefined, () => SUMMER);
		assert.equal(watch.getState().settings.clock, '24h');
		watch.toggleClock();
		assert.equal(watch.getState().settings.clock, '12h');
	});

	it('persists on every change but not on a plain tick', () => {
		const store = memoryStore();
		const watch = new Watch(settings(), store, () => SUMMER);
		assert.equal(store.value, null, 'construction should not write');

		watch.tick();
		assert.equal(store.value, null, 'a tick should not write');

		watch.toggleClock();
		assert.notEqual(store.value, null, 'a change should write');
	});

	it('restores a stored configuration', () => {
		const store = memoryStore(
			serialiseSettings({ ...settings(), clock: '12h', selected: 2 }),
		);
		const watch = Watch.restore(store, () => SUMMER);
		assert.equal(watch.getState().settings.clock, '12h');
		assert.equal(watch.getState().selected, 2);
	});

	it('restores defaults from a corrupt store instead of failing to start', () => {
		const watch = Watch.restore(memoryStore('{ corrupt'), () => SUMMER);
		assert.equal(watch.getState().settings.slots.length, 4);
		assert.ok(watch.getState().cityCode.length === 3);
	});

	it('holds the register offset against an independent calculation', () => {
		// A cross-check that the controller is not doing its own, different, timezone maths.
		const watch = new Watch(settings(), undefined, () => WINTER);
		watch.selectRegister(4);
		const state = watch.getState();
		assert.equal(state.displayedOffset, offsetMinutes('Asia/Tokyo', WINTER));
	});
});
