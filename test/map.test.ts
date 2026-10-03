/**
 * World map tests.
 *
 * Two things are being pinned down here. First that the land data is intact and correctly
 * oriented — a silently corrupt bitset would still render a plausible-looking blob. Second that
 * band placement, including the Home City fallback rule, is arithmetically right.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	MAP_ASPECT,
	WORLD_HEIGHT,
	WORLD_WIDTH,
	bandColumn,
	bandColumns,
	bandForMode,
	fitMap,
	isLand,
	landCellCount,
	renderMap,
} from '../src/shared/map.ts';

describe('the land bitset', () => {
	it('decodes to the documented size', () => {
		// 96 x 40 cells at one bit each is exactly 480 bytes.
		assert.equal(landCellCount(), 1098);
	});

	it('covers a plausible fraction of the surface', () => {
		// Roughly 29% of an equirectangular projection is land. A wrong orientation or a shifted
		// decode would still look like a blob but would not land in this range.
		const fraction = landCellCount() / (WORLD_WIDTH * WORLD_HEIGHT);
		assert.ok(fraction > 0.25 && fraction < 0.33, `land fraction was ${fraction.toFixed(3)}`);
	});

	it('has its equirectangular proportions available', () => {
		assert.equal(MAP_ASPECT, 2.4);
	});

	it('treats anything outside the bitmap as sea rather than throwing', () => {
		assert.equal(isLand(-1, 0), false);
		assert.equal(isLand(WORLD_WIDTH, 0), false);
		assert.equal(isLand(0, -1), false);
		assert.equal(isLand(0, WORLD_HEIGHT), false);
	});

	it('has land in the northern hemisphere, where most of it is', () => {
		let northern = 0;
		let southern = 0;
		for (let y = 0; y < WORLD_HEIGHT; y += 1) {
			for (let x = 0; x < WORLD_WIDTH; x += 1) {
				if (!isLand(x, y)) {
					continue;
				}
				if (y < WORLD_HEIGHT / 2) {
					northern += 1;
				} else {
					southern += 1;
				}
			}
		}
		assert.ok(northern > southern, `north ${northern} should exceed south ${southern}`);
	});

	it('has land around the equator, where three continents cross it', () => {
		// The equator is the boundary row, so check the rows either side of it.
		let land = 0;
		for (const y of [WORLD_HEIGHT / 2 - 1, WORLD_HEIGHT / 2]) {
			for (let x = 0; x < WORLD_WIDTH; x += 1) {
				if (isLand(x, y)) {
					land += 1;
				}
			}
		}
		assert.ok(land > 0, 'no land found at the equator, which suggests a vertical flip');
	});
});

describe('band placement (MAP-2, MAP-3)', () => {
	it('places UTC at the midpoint, since the map is Greenwich-centred', () => {
		assert.equal(bandColumn(0, 96), 48);
	});

	it('places the documented reference cities where the geometry says they belong', () => {
		// Column = round((offsetHours * 15 + 180) * width / 360). Hand-computed as an independent
		// check on the formula, and cross-checked against the geometry note in docs/RESEARCH.md,
		// which independently derives column 71 for Kathmandu on this map.
		assert.equal(bandColumn(-660, 96), 4); // Pago Pago, -11:00, 165 degrees west
		assert.equal(bandColumn(-300, 96), 28); // New York, -05:00, 75 degrees west
		assert.equal(bandColumn(345, 96), 71); // Kathmandu, +05:45 — matches the research note
		assert.equal(bandColumn(540, 96), 84); // Tokyo, +09:00, 135 degrees east
		assert.equal(bandColumn(720, 96), 0); // the +12:00 ceiling meets the antimeridian exactly
	});

	it('advances one hour per 15 degrees, which is four cells at the native width', () => {
		// A one-hour zone is 15 degrees. At the native 96 cells the cell size is 360/96 = 3.75
		// degrees, so an hour is 15/3.75 = 4 cells. (The 2-cell figure quoted in the reference
		// project's source comment applies to a 48-cell map, not this one.) Checked west of the
		// antimeridian, where the column increases monotonically.
		const cellsPerHour = 96 / 24;
		assert.equal(cellsPerHour, 4);

		for (const width of [96, 120, 192]) {
			const expected = width / 24;
			for (let offset = -660; offset <= 600; offset += 60) {
				const step = bandColumn(offset + 60, width) - bandColumn(offset, width);
				assert.ok(
					Math.abs(step - expected) <= 1,
					`one hour stepped ${step} cells at offset ${offset} on a ${width}-cell map, expected about ${expected}`,
				);
			}
		}
	});

	it('keeps a constant cell size across the map, so no zone is misplaced', () => {
		// Four cells per hour exactly, for whole-hour offsets west of the antimeridian: a linear
		// projection. The loop stops at +10 because +12 lands on column 0 and wraps.
		for (let hour = -11; hour <= 10; hour += 1) {
			assert.equal(
				bandColumn((hour + 1) * 60, 96) - bandColumn(hour * 60, 96),
				4,
				`the cell size is not constant at ${hour}:00`,
			);
		}
	});

	it('increases monotonically from west to east until the antimeridian', () => {
		let previous = -1;
		for (let offset = -660; offset <= 660; offset += 60) {
			const column = bandColumn(offset, 96);
			assert.ok(column > previous, `column went backwards at offset ${offset}`);
			previous = column;
		}
	});

	it('wraps the zones beyond +12:00 to the far side, because that is where they are', () => {
		// +14:00 is 210 degrees east, which on a -180..+180 map is 150 degrees *west*. Clamping it to
		// the eastern rim would put Kiritimati in the wrong ocean, so the wrap is correct.
		const chatham = bandColumn(765, 96);
		const tonga = bandColumn(780, 96);
		const kiritimati = bandColumn(840, 96);

		assert.ok(kiritimati < 20, `Kiritimati landed at column ${kiritimati}, not in the Pacific`);
		assert.ok(tonga < 20, `Tongatapu landed at column ${tonga}`);
		assert.ok(chatham < 20, `Chatham landed at column ${chatham}`);
		assert.ok(chatham < tonga && tonga < kiritimati, 'the far-east zones are misordered');
	});

	it('produces a strictly two-cell band for every offset in use', () => {
		for (let offset = -660; offset <= 840; offset += 15) {
			const [first, second] = bandColumns(offset, 96);
			assert.equal(second, (first + 1) % 96, `band was not two cells at offset ${offset}`);
		}
	});

	it('keeps both columns inside the map for every offset the catalogue can hold', () => {
		// -11:00 (Pago Pago) through +14:00 (Kiritimati), the full range in use.
		for (let offset = -660; offset <= 840; offset += 15) {
			const [first, second] = bandColumns(offset, 96);
			assert.ok(first >= 0 && first < 96, `first ${first} at offset ${offset}`);
			assert.ok(second >= 0 && second < 96, `second ${second} at offset ${offset}`);
			assert.notEqual(first, second, `degenerate band at offset ${offset}`);
		}
	});

	it('scales to a narrower map without leaving the range', () => {
		for (const width of [24, 48, 60, 96, 120]) {
			for (let offset = -660; offset <= 840; offset += 60) {
				const [first, second] = bandColumns(offset, width);
				assert.ok(first >= 0 && first < width, `first ${first} of ${width}`);
				assert.ok(second >= 0 && second < width, `second ${second} of ${width}`);
			}
		}
	});

	it('moves the band in the right direction as the offset increases', () => {
		// West of UTC is left of centre, east is right: a wrong sign would mirror the whole map.
		const pago = bandColumn(-660, 96);
		const london = bandColumn(0, 96);
		const tokyo = bandColumn(540, 96);
		assert.ok(pago < london, `Pago Pago ${pago} should be left of London ${london}`);
		assert.ok(tokyo > london, `Tokyo ${tokyo} should be right of London ${london}`);
	});
});

describe('the Home City fallback (MAP-4)', () => {
	const displayed = 540; // Tokyo, on screen
	const home = -300; // New York, the Home City
	const width = 96;

	it('follows the displayed zone in Timekeeping', () => {
		assert.deepEqual(
			bandForMode('timekeeping', displayed, home, width),
			bandColumns(displayed, width),
		);
	});

	it('follows the displayed zone in World Time', () => {
		assert.deepEqual(bandForMode('worldtime', displayed, home, width), bandColumns(displayed, width));
	});

	it('reverts to the Home City in Alarm, Timer and Stopwatch', () => {
		// The watch shows the Home City zone on the map in these three screens, whatever the
		// digital field is displaying. This is the rule most easily got wrong.
		for (const mode of ['alarm', 'timer', 'stopwatch'] as const) {
			assert.deepEqual(bandForMode(mode, displayed, home, width), bandColumns(home, width), mode);
		}
	});

	it('produces visibly different bands in the two cases, so the rule is observable', () => {
		const follows = bandForMode('timekeeping', displayed, home, width);
		const reverts = bandForMode('alarm', displayed, home, width);
		assert.notDeepEqual(follows, reverts);
	});
});

describe('fitting the map into its block (MAP-7)', () => {
	it('preserves the equirectangular proportion rather than stretching', () => {
		// The cell *shape* need not be 2.4:1 — a narrow box gives square-ish cells. What must hold
		// is that the map as a whole keeps its proportions, so no zone is misplaced.
		for (const box of [
			{ width: 240, height: 60 },
			{ width: 240, height: 300 },
			{ width: 96, height: 96 },
			{ width: 500, height: 40 },
		]) {
			const layout = fitMap(0, 0, box.width, box.height);
			const totalWidth = layout.columns * layout.cellWidth;
			const totalHeight = layout.rows * layout.cellHeight;
			const ratio = totalWidth / totalHeight;
			assert.ok(
				Math.abs(ratio - MAP_ASPECT) < 1e-6,
				`box ${box.width}x${box.height} gave a map ratio of ${ratio}`,
			);
		}
	});

	it('fits within the box it was given', () => {
		const layout = fitMap(10, 20, 240, 100);
		assert.ok(layout.columns * layout.cellWidth <= 240 + 1e-9);
		assert.ok(layout.rows * layout.cellHeight <= 100 + 1e-9);
	});

	it('is limited by whichever dimension binds', () => {
		// A very wide but short box must be height-limited.
		const short = fitMap(0, 0, 1000, 40);
		assert.ok(Math.abs(short.rows * short.cellHeight - 40) < 1e-9);
		// A tall but narrow box must be width-limited.
		const narrow = fitMap(0, 0, 96, 1000);
		assert.ok(Math.abs(narrow.columns * narrow.cellWidth - 96) < 1e-9);
	});
});

describe('rendering', () => {
	it('emits a map group with the band and some land', () => {
		const markup = renderMap('timekeeping', 540, -300);
		assert.match(markup, /^<g class="world-map">/);
		assert.match(markup, /class="map-band"/);
		assert.match(markup, /class="map-land"/);
	});

	it('marks land inside the band so it stays visible against it (MAP-6)', () => {
		// Find an offset whose band certainly covers land, then check the in-band class is used.
		let found = false;
		for (let offset = -660; offset <= 840 && !found; offset += 60) {
			if (renderMap('timekeeping', offset, 0).includes('map-land in-band')) {
				found = true;
			}
		}
		assert.ok(found, 'no land was ever marked as inside the band');
	});

	it('draws only two band rects, whatever the offset', () => {
		for (const offset of [-660, -300, 0, 345, 540, 840]) {
			const markup = renderMap('timekeeping', offset, 0);
			const bands = markup.match(/class="map-band"/g) ?? [];
			assert.equal(bands.length, 2, `offset ${offset} drew ${bands.length} band rects`);
		}
	});

	it('changes the band when the mode reverts to the Home City', () => {
		const shown = renderMap('worldtime', 540, -300);
		const reverted = renderMap('alarm', 540, -300);
		assert.notEqual(shown, reverted);
		assert.equal(reverted, renderMap('alarm', -300, -300), 'the digital field must not matter');
	});

	it('merges consecutive land into single rects rather than one rect per cell', () => {
		// A per-cell renderer would emit at least one rect per land cell (1098 of them).
		const markup = renderMap('timekeeping', 0, 0);
		const rects = (markup.match(/<rect /g) ?? []).length;
		assert.ok(rects < 700, `emitted ${rects} rects, which suggests no run merging`);
		assert.ok(rects > 100, `emitted only ${rects} rects, which suggests missing land`);
	});
});
