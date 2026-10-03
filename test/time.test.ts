/**
 * Time zone maths tests.
 *
 * These target the behaviours the requirements single out as easy to get wrong:
 * fractional offsets, the civil-date day marker, DST in both hemispheres, and zones where a
 * manual DST override is inert. See docs/REQUIREMENTS.md §6.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	civilDayDiff,
	dayDiff,
	diffMinutes,
	dstLabel,
	dstOffsets,
	effectiveOffset,
	formatClock,
	formatDay,
	formatDiff,
	formatMonthDay,
	formatOffset,
	hasDst,
	isValidZone,
	localZone,
	modernZone,
	normalizeZone,
	offsetMinutes,
	wallClock,
	zoneAbbr,
	zoneName,
} from '../src/shared/time.ts';

/** 2026-07-15T12:00:00Z — northern summer, southern winter. */
const JULY = new Date(Date.UTC(2026, 6, 15, 12, 0, 0));
/** 2026-01-15T12:00:00Z — northern winter, southern summer. */
const JANUARY = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));

describe('offsetMinutes', () => {
	it('returns 0 for UTC', () => {
		assert.equal(offsetMinutes('Etc/UTC', JULY), 0);
	});

	it('handles whole-hour offsets', () => {
		assert.equal(offsetMinutes('America/New_York', JULY), -240); // EDT
		assert.equal(offsetMinutes('Europe/London', JULY), 60); // BST
		assert.equal(offsetMinutes('Asia/Tokyo', JULY), 540);
	});

	it('handles half-hour offsets', () => {
		assert.equal(offsetMinutes('Asia/Kolkata', JULY), 330);
		assert.equal(offsetMinutes('Australia/Adelaide', JULY), 570);
		assert.equal(offsetMinutes('America/St_Johns', JULY), -150); // NDT, -02:30
	});

	it('handles quarter-hour offsets', () => {
		// The watch lists Kathmandu at +5.75, and this widget must too (ZON-5).
		assert.equal(offsetMinutes('Asia/Kathmandu', JULY), 345);
		assert.equal(offsetMinutes('Australia/Eucla', JULY), 525);
	});

	it('handles 45-minute and 45+ offsets beyond the watch range', () => {
		// Chatham is +12:45, which the watch cannot display at all (ZON-5, ZON-6).
		assert.equal(offsetMinutes('Pacific/Chatham', JANUARY), 825);
		assert.equal(offsetMinutes('Pacific/Kiritimati', JULY), 840);
	});

	it('throws rather than silently returning a wrong offset', () => {
		assert.throws(() => offsetMinutes('Not/AZone', JULY));
	});
});

describe('wallClock and formatClock', () => {
	it('places the wall time in the UTC fields', () => {
		const wall = wallClock('Asia/Tokyo', new Date(Date.UTC(2026, 6, 15, 0, 30, 0)));
		assert.equal(wall.getUTCHours(), 9);
		assert.equal(wall.getUTCMinutes(), 30);
	});

	it('formats 24-hour time with a leading zero', () => {
		const wall = wallClock('Asia/Tokyo', new Date(Date.UTC(2026, 6, 15, 0, 5, 0)));
		assert.equal(formatClock(wall, '24h'), '09:05');
		assert.equal(formatClock(wall, '24h', true), '09:05:00');
	});

	it('formats 12-hour time with AM/PM and no leading zero', () => {
		const wall = wallClock('Asia/Tokyo', new Date(Date.UTC(2026, 6, 15, 0, 5, 0)));
		assert.equal(formatClock(wall, '12h'), '9:05 AM');
	});

	it('maps midnight and noon to 12, not 0', () => {
		const midnight = wallClock('Etc/UTC', new Date(Date.UTC(2026, 6, 15, 0, 0, 0)));
		const noon = wallClock('Etc/UTC', new Date(Date.UTC(2026, 6, 15, 12, 0, 0)));
		assert.equal(formatClock(midnight, '12h'), '12:00 AM');
		assert.equal(formatClock(noon, '12h'), '12:00 PM');
	});

	it('formats the day, date and month-day fields', () => {
		const wall = wallClock('Etc/UTC', new Date(Date.UTC(2026, 8, 25, 12, 0, 0)));
		assert.equal(formatDay(wall), 'FRI 25');
		assert.equal(formatMonthDay(wall), '9-25');
	});
});

describe('the ±1 day marker (WLD-5)', () => {
	it('compares calendar dates, not hours', () => {
		// 23:00 in London: still the same calendar day there, already the next day in Tokyo,
		// even though the offset gap is only 9 hours. Deriving this from hours gives 0.
		const late = new Date(Date.UTC(2026, 6, 15, 22, 0, 0));
		assert.equal(dayDiff('Asia/Tokyo', 'Europe/London', late), 1);
		assert.equal(dayDiff('Europe/London', 'Asia/Tokyo', late), -1);
	});

	it('reports 0 for equal calendar dates across different offsets', () => {
		const midday = new Date(Date.UTC(2026, 6, 15, 12, 0, 0));
		assert.equal(dayDiff('Europe/London', 'Europe/Paris', midday), 0);
	});

	it('handles the negative side of the date line', () => {
		const early = new Date(Date.UTC(2026, 6, 15, 2, 0, 0));
		// 02:00 UTC is still the previous day in Honolulu.
		assert.equal(dayDiff('Pacific/Honolulu', 'Etc/UTC', early), -1);
	});

	it('computes the civil difference from offsets directly', () => {
		assert.equal(civilDayDiff(0, 0, JULY), 0);
		// 12:00 UTC is 02:00 the *next day* at +14:00, so the civil difference is 1, not 0.
		assert.equal(civilDayDiff(840, 0, new Date(Date.UTC(2026, 6, 15, 12, 0, 0))), 1);
		// The same two offsets at 00:00 UTC are still on the same calendar date.
		assert.equal(civilDayDiff(840, 0, new Date(Date.UTC(2026, 6, 15, 0, 0, 0))), 0);
	});
});

describe('diffMinutes', () => {
	it('reports the offset gap', () => {
		assert.equal(diffMinutes('Asia/Tokyo', 'Etc/UTC', JULY), 540);
		assert.equal(diffMinutes('America/New_York', 'Europe/London', JULY), -300);
	});

	it('formats a gap readably', () => {
		assert.equal(formatDiff(0), '0h');
		assert.equal(formatDiff(240), '+4h');
		assert.equal(formatDiff(-60), '-1h');
		assert.equal(formatDiff(510), '+8h30');
	});

	it('formats offsets as the watch does (ZON-8)', () => {
		assert.equal(formatOffset(0), '+00:00');
		assert.equal(formatOffset(-180), '-03:00');
		assert.equal(formatOffset(345), '+05:45');
		assert.equal(formatOffset(825), '+13:45');
	});
});

describe('DST', () => {
	it('derives standard and summer offsets for the northern hemisphere', () => {
		assert.deepEqual(dstOffsets('Europe/London', 2026), { std: 0, dst: 60 });
		assert.deepEqual(dstOffsets('America/New_York', 2026), { std: -300, dst: -240 });
	});

	it('derives them for the southern hemisphere, where January is summer', () => {
		// Taking the minimum of the January and July offsets is what makes this correct.
		assert.deepEqual(dstOffsets('Australia/Sydney', 2026), { std: 600, dst: 660 });
		assert.deepEqual(dstOffsets('America/Santiago', 2026), { std: -240, dst: -180 });
	});

	it('reports no DST for zones that have none', () => {
		assert.equal(hasDst('Asia/Tokyo', 2026), false);
		assert.equal(hasDst('Etc/UTC', 2026), false);
		assert.equal(hasDst('Asia/Kolkata', 2026), false);
		assert.equal(hasDst('Europe/London', 2026), true);
	});

	it('follows IANA on auto', () => {
		assert.equal(effectiveOffset('America/New_York', JULY, 'auto'), -240);
		assert.equal(effectiveOffset('America/New_York', JANUARY, 'auto'), -300);
	});

	it('forces summer and standard offsets when overridden', () => {
		// Forcing 'on' in January must still give the summer offset.
		assert.equal(effectiveOffset('America/New_York', JANUARY, 'on'), -240);
		assert.equal(effectiveOffset('America/New_York', JULY, 'off'), -300);
	});

	it('is inert for a zone with no DST (DST-5)', () => {
		const auto = effectiveOffset('Asia/Tokyo', JULY, 'auto');
		assert.equal(effectiveOffset('Asia/Tokyo', JULY, 'on'), auto);
		assert.equal(effectiveOffset('Asia/Tokyo', JULY, 'off'), auto);
	});

	it('labels automatic and forced states distinctly', () => {
		assert.equal(dstLabel('America/New_York', JULY, 'auto'), 'DST');
		assert.equal(dstLabel('America/New_York', JANUARY, 'auto'), '');
		assert.equal(dstLabel('America/New_York', JULY, 'on'), 'DST*');
		assert.equal(dstLabel('America/New_York', JULY, 'off'), 'STD*');
	});

	it('never labels a zone that has no DST', () => {
		for (const mode of ['auto', 'on', 'off'] as const) {
			assert.equal(dstLabel('Etc/UTC', JULY, mode), '');
			assert.equal(dstLabel('Asia/Kolkata', JULY, mode), '');
		}
	});
});

describe('zone identity (ZON-7)', () => {
	it('normalises ICU legacy spellings', () => {
		assert.equal(modernZone('Asia/Calcutta'), 'Asia/Kolkata');
		assert.equal(modernZone('Asia/Katmandu'), 'Asia/Kathmandu');
		assert.equal(modernZone('Europe/Kiev'), 'Europe/Kyiv');
		assert.equal(modernZone('Asia/Tokyo'), 'Asia/Tokyo');
	});

	it('resolves a legacy spelling to the same offset as its modern name', () => {
		assert.equal(
			offsetMinutes(modernZone('Asia/Calcutta'), JULY),
			offsetMinutes('Asia/Kolkata', JULY),
		);
	});

	it('derives a display name from a zone id', () => {
		assert.equal(zoneName('America/New_York'), 'NEW YORK');
		assert.equal(zoneName('America/Argentina/Buenos_Aires'), 'BUENOS AIRES');
		assert.equal(zoneName('Europe/London'), 'LONDON');
	});
});

describe('zone validation (PRS-4)', () => {
	it('accepts valid IANA ids', () => {
		assert.ok(isValidZone('Asia/Tokyo'));
		assert.ok(isValidZone('America/Argentina/Buenos_Aires'));
	});

	it('rejects fixed offsets that Intl would otherwise accept', () => {
		assert.equal(normalizeZone('+03:00'), undefined);
		assert.equal(isValidZone('+03:00'), false);
	});

	it('rejects nonsense', () => {
		assert.equal(isValidZone('Not/AZone'), false);
		assert.equal(isValidZone(''), false);
	});

	it('corrects case on input', () => {
		assert.equal(normalizeZone('asia/tokyo'), 'Asia/Tokyo');
	});

	it('reports the system zone', () => {
		assert.equal(typeof localZone(), 'string');
		assert.ok(isValidZone(localZone()));
	});
});

describe('abbreviations', () => {
	it('returns an abbreviation where the platform knows one', () => {
		const abbr = zoneAbbr('America/New_York', JULY);
		// Platform ICU data varies, so accept either a real abbreviation or undefined.
		assert.ok(abbr === undefined || /^[A-Z]{2,5}$/.test(abbr));
	});
});
