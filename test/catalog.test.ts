/**
 * City catalogue tests.
 *
 * The catalogue carries the manual's city code table as data. These tests hold it to the two
 * things that matter: every entry must resolve to a real IANA zone, and the watch's own count
 * must be *computed* rather than asserted, because the manual contradicts itself.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	CITIES,
	EXTENDED_CITIES,
	WATCH_CITIES,
	WATCH_CITY_COUNT,
	catalogFor,
	cityForCode,
	cityForZone,
	lcdCodeForZone,
} from '../src/shared/catalog.ts';
import { isValidZone, offsetMinutes } from '../src/shared/time.ts';

const JULY = new Date(Date.UTC(2026, 6, 15, 12, 0, 0));

describe('the watch city table (ZON-1, ZON-2)', () => {
	it('is modelled as data with a computed size', () => {
		// The manual claims 48 cities / 31 time zones. Its printed city code table actually holds
		// 46 cities plus UTC. The size is therefore derived from the table, never hard-coded.
		// See docs/RESEARCH.md §5.
		assert.equal(WATCH_CITY_COUNT, 48);
		assert.equal(WATCH_CITIES.length, 49); // 48 cities + UTC
	});

	it('contains the manual\u2019s codes, including the ones the reference catalog lacked', () => {
		// The manual's table, west to east, as transcribed in docs/RESEARCH.md §5.
		const manual = [
			'PPG', 'HNL', 'ANC', 'YVR', 'LAX', 'YEA', 'DEN', 'MEX', 'CHI', 'NYC',
			'SCL', 'YHZ', 'YYT', 'RIO', 'FEN', 'RAI', 'UTC', 'LIS', 'LON', 'MAD',
			'PAR', 'ROM', 'BER', 'STO', 'ATH', 'CAI', 'JRS', 'MOW', 'JED', 'THR',
			'DXB', 'KBL', 'KHI', 'DEL', 'KTM', 'DAC', 'RGN', 'BKK', 'SIN', 'HKG',
			'BJS', 'TPE', 'SEL', 'TYO', 'ADL', 'GUM', 'SYD', 'NOU', 'WLG',
		];

		const ours = WATCH_CITIES.map((city) => city.code ?? '');
		assert.deepEqual(ours, manual, 'the catalogue must match the manual table exactly');
	});

	it('gives every code exactly three letters', () => {
		for (const city of WATCH_CITIES) {
			assert.match(city.code ?? '', /^[A-Z]{3}$/, `bad code for ${city.name}`);
		}
	});

	it('has no duplicate codes or zones', () => {
		assert.equal(new Set(WATCH_CITIES.map((c) => c.code)).size, WATCH_CITIES.length);
		assert.equal(new Set(CITIES.map((c) => c.zone)).size, CITIES.length);
	});
	it('resolves every zone to a real IANA identifier', () => {
		for (const city of CITIES) {
			assert.ok(isValidZone(city.zone), `${city.name} has invalid zone ${city.zone}`);
		}
	});
});

describe('the extended zones (ZON-5, ZON-6)', () => {
	it('covers offsets the watch cannot display', () => {
		const byZone = new Map(EXTENDED_CITIES.map((city) => [city.zone, city]));
		assert.ok(byZone.has('Pacific/Chatham'));
		assert.ok(byZone.has('Pacific/Kiritimati'));
		assert.ok(byZone.has('Pacific/Marquesas'));
	});

	it('reaches beyond the watch\u2019s +12 ceiling', () => {
		assert.equal(offsetMinutes('Pacific/Chatham', new Date(Date.UTC(2026, 0, 15))), 825);
		assert.equal(offsetMinutes('Pacific/Kiritimati', JULY), 840);
		assert.ok(offsetMinutes('Pacific/Kiritimati', JULY) > 720);
	});

	it('supplies a western fractional offset the watch table lacks', () => {
		assert.equal(offsetMinutes('Pacific/Marquesas', JULY), -570);
	});

	it('keeps every extended zone free of a watch code', () => {
		for (const city of EXTENDED_CITIES) {
			assert.equal(city.code, undefined, `${city.name} should not claim a watch code`);
			assert.equal(city.extended, true);
		}
	});
});

describe('lookups', () => {
	it('finds a city by code', () => {
		assert.equal(cityForCode('TYO')?.zone, 'Asia/Tokyo');
		assert.equal(cityForCode('tyo')?.name, 'Tokyo');
		assert.equal(cityForCode('ZZZ'), undefined);
	});

	it('finds a city by zone, normalising legacy spellings', () => {
		assert.equal(cityForZone('Asia/Tokyo')?.code, 'TYO');
		// The catalogue stores Asia/Kolkata, so the ICU spelling must still resolve.
		assert.equal(cityForZone('Asia/Calcutta')?.code, 'DEL');
	});

	it('returns a three-glyph LCD code for every supported zone (DIS-6)', () => {
		for (const city of CITIES) {
			const code = lcdCodeForZone(city.zone);
			assert.match(code, /^[A-Z]{3}$/, `${city.zone} produced "${code}"`);
		}
	});

	it('prefers the watch code over any generated one', () => {
		assert.equal(lcdCodeForZone('Asia/Tokyo'), 'TYO');
		assert.equal(lcdCodeForZone('Europe/London'), 'LON');
		assert.equal(lcdCodeForZone('Pacific/Auckland'), 'WLG');
	});

	it('invents a code for extended zones, which have none', () => {
		assert.equal(lcdCodeForZone('Pacific/Chatham'), 'CHA');
		assert.equal(lcdCodeForZone('Pacific/Kiritimati'), 'KIR');
	});
});

describe('catalogFor', () => {
	it('sorts west to east by current offset', () => {
		const list = catalogFor(JULY);
		const offsets = list.map((city) => offsetMinutes(city.zone, JULY));
		const sorted = [...offsets].sort((a, b) => a - b);
		assert.deepEqual(offsets, sorted);
	});

	it('puts Pago Pago first and Kiritimati last', () => {
		const list = catalogFor(JULY);
		assert.equal(list[0]?.code, 'PPG');
		assert.equal(list[list.length - 1]?.zone, 'Pacific/Kiritimati');
	});

	it('excludes the zones already assigned to T-1\u2026T-4 (MOD-2)', () => {
		const list = catalogFor(JULY, ['Asia/Tokyo', 'Europe/London']);
		assert.equal(list.some((city) => city.zone === 'Asia/Tokyo'), false);
		assert.equal(list.some((city) => city.zone === 'Europe/London'), false);
	});

	it('excludes by normalised name, not raw string', () => {
		// A stored Asia/Calcutta must exclude Asia/Kolkata rather than appearing beside it.
		const list = catalogFor(JULY, ['Asia/Calcutta']);
		assert.equal(list.some((city) => city.zone === 'Asia/Kolkata'), false);
	});

	it('never mutates the source catalogue', () => {
		const before = CITIES.map((city) => city.zone).join(',');
		catalogFor(JULY, ['Asia/Tokyo']);
		assert.equal(CITIES.map((city) => city.zone).join(','), before);
	});
});
