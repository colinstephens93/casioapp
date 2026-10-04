import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderBoard } from '../src/renderer/board.ts';
import {
	MAX_SLOTS,
	cycleDst,
	defaultDesk,
	moveFavorite,
	moveSelection,
	parseDesk,
	serialiseDesk,
	toggleClock,
	toggleFavorite,
	type DeskState,
} from '../src/shared/desk.ts';

const LOCAL = 'America/Chicago';
const JULY = new Date('2026-07-01T18:00:00Z');

function fillSlots(state: DeskState): DeskState {
	const zones = [
		'Pacific/Honolulu',
		'America/Los_Angeles',
		'America/Denver',
		'America/Chicago',
		'America/New_York',
		'Europe/London',
		'Europe/Paris',
		'Asia/Tokyo',
		'Australia/Sydney',
	];
	return {
		...state,
		slots: zones.map((zone) => ({ zone, dst: 'auto' as const })),
		focus: { where: 'catalog', zone: 'Asia/Dubai' },
	};
}

describe('the world-time board', () => {
	it('ignores an old watch blob and starts on New York', () => {
		const state = parseDesk('{"mode":"timekeeping","alarms":[]}');
		assert.equal(state.focus.where, 'favorite');
		assert.equal(state.focus.zone, 'America/New_York');
		assert.equal(state.slots.length, 4);
	});

	it('round-trips a saved board', () => {
		const saved = serialiseDesk(defaultDesk());
		assert.deepEqual(parseDesk(saved), defaultDesk());
	});

	it('will not drop the local zone', () => {
		const home = { ...defaultDesk(), focus: { where: 'local' as const, zone: '' } };
		const result = toggleFavorite(home, LOCAL);
		assert.equal(result.state.slots.length, home.slots.length);
		assert.match(result.notice, /T0/);
	});

	it('adds a catalogue city and removes it again', () => {
		const added = toggleFavorite(
			{ ...defaultDesk(), focus: { where: 'catalog', zone: 'Asia/Dubai' } },
			LOCAL,
		);
		assert.equal(added.notice, '');
		assert.equal(added.state.slots.at(-1)?.zone, 'Asia/Dubai');
		assert.equal(added.state.focus.where, 'favorite');

		const removed = toggleFavorite(added.state, LOCAL);
		assert.equal(removed.state.slots.some((slot) => slot.zone === 'Asia/Dubai'), false);
		assert.equal(removed.state.focus.where, 'catalog');
	});

	it('stops at nine favourites', () => {
		const result = toggleFavorite(fillSlots(defaultDesk()), LOCAL);
		assert.equal(result.state.slots.length, MAX_SLOTS);
		assert.match(result.notice, /limit/);
	});

	it('moves through favourites without entering the catalogue, and wraps', () => {
		const start = defaultDesk();
		const next = moveFavorite(start, LOCAL, 1);
		assert.equal(next.focus.zone, 'Europe/London');
		const wrapped = moveFavorite({ ...start, focus: { where: 'local', zone: '' } }, LOCAL, -1);
		assert.equal(wrapped.focus.zone, 'Asia/Hong_Kong');
	});

	it('moves up and down the whole list without wrapping', () => {
		const top = moveSelection({ ...defaultDesk(), focus: { where: 'local', zone: '' } }, LOCAL, -1);
		assert.equal(top.focus.where, 'local');
		const down = moveSelection(top, LOCAL, 1);
		assert.equal(down.focus.where, 'favorite');
	});

	it('cycles DST on a favourite and refuses it on a catalogue row', () => {
		const cycled = cycleDst(defaultDesk(), LOCAL, JULY);
		assert.equal(cycled.notice, '');
		assert.equal(cycled.state.slots[0]?.dst, 'on');
		const refused = cycleDst(
			{ ...defaultDesk(), focus: { where: 'catalog', zone: 'Europe/Paris' } },
			LOCAL,
			JULY,
		);
		assert.match(refused.notice, /favorites/);
	});

	it('toggles the clock', () => {
		assert.equal(toggleClock(defaultDesk()).clock, '24h');
	});

	it('draws the terminal panels for the focused city', () => {
		const html = renderBoard(defaultDesk(), JULY, LOCAL, '80% · BATTERY', '');
		assert.match(html, /WORLD TIME/);
		assert.match(html, /class="mark">CASIO/);
		assert.match(html, /NEW YORK/);
		assert.match(html, /data-where="favorite"/);
		assert.match(html, /class="row favorite selected"/);
		assert.match(html, /80% · BATTERY/);
		assert.match(html, /class="land/);
		assert.match(html, /class="land band"/);
		assert.equal((html.match(/<i class="band"/g) ?? []).length, 0);
		assert.equal((html.match(/<i[\s>]/g) ?? []).length, 64 * 16);
	});
});
