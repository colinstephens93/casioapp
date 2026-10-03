/**
 * Face composition and layout tests.
 *
 * These cannot judge whether the watch *looks* right — that needs eyes, which is what the preview
 * page is for. What they can do is catch the failure modes that make a rendered face obviously
 * broken and are easy to miss in a large generated string.
 *
 * Three classes of failure, and they are genuinely different checks:
 *
 * - **Malformed markup**: NaN coordinates, unbalanced tags, an empty face.
 * - **Collision**: two glyphs on top of each other. Caught by the pairwise box test.
 * - **Overflow**: a glyph outside the LCD. The pairwise test cannot see this at all — a face whose
 *   digits all ran off the right edge has no overlapping pair — and both classes have already
 *   happened once in this project.
 *
 * The layout constants live in `theme.ts`; when a test here fails, the constants are wrong.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderFace, type DisplayState } from '../src/renderer/face.ts';
import { stateFor, scenarios } from '../src/renderer/preview.ts';
import { CELL_HEIGHT, CELL_WIDTH, textWidth } from '../src/shared/svg.ts';
import { FACE, TEXT_SIZE, TRACKING } from '../src/shared/theme.ts';
import { CITIES } from '../src/shared/catalog.ts';
import { formatDay, formatMonthDay } from '../src/shared/time.ts';

const AT = new Date(Date.UTC(2026, 6, 15, 22, 48, 37));

/** The vertical extent of a run at a given cell size, in grid units. */
const heightOf = (size: number): number => (CELL_HEIGHT / CELL_WIDTH) * size;

/** Every glyph instance in a rendered face, with its box. */
function instances(svg: string): { character: string; x: number; y: number; w: number; h: number }[] {
	const pattern =
		/<use href="#ch-([^"]+)" x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)" \/>/g;
	return [...svg.matchAll(pattern)].map((match) => ({
		character: match[1] ?? '',
		x: Number(match[2]),
		y: Number(match[3]),
		w: Number(match[4]),
		h: Number(match[5]),
	}));
}

/** Every glyph of a given cell height, which is how a run is identified from the markup. */
function runOfHeight(svg: string, size: number): ReturnType<typeof instances> {
	const wanted = heightOf(size);
	return instances(svg).filter((glyph) => Math.abs(glyph.h - wanted) < 0.01);
}

function baseState(overrides: Partial<DisplayState> = {}): DisplayState {
	const state = stateFor({
		title: 'test',
		note: 'test',
		zone: 'Asia/Tokyo',
		homeZone: 'Asia/Tokyo',
		at: AT,
		clock: '24h',
		mode: 'timekeeping',
		dst: 'auto',
	});
	return {
		// `syncWatch` reads the Home City at `auto` in this fixture, so Japan has no DST and the label
		// is empty. The flash test needs a labelled DST field to have something to flash, and a forced
		// override is what produces one.
		...state,
		dstLabel: 'DST',
		...overrides,
	};
}

/** Every scenario, drawn in both clock formats, since the PM indicator is format-dependent. */
function everyFace(): { title: string; clock: '12h' | '24h'; svg: string }[] {
	const out: { title: string; clock: '12h' | '24h'; svg: string }[] = [];
	for (const scenario of scenarios(AT)) {
		for (const clock of ['12h', '24h'] as const) {
			out.push({ title: scenario.title, clock, svg: renderFace(stateFor({ ...scenario, clock })) });
		}
	}
	return out;
}

describe('rendering produces well-formed markup', () => {
	it('emits a single SVG with the case viewBox', () => {
		const svg = renderFace(baseState());
		// The viewBox is derived from `FACE` rather than written out here, so the assertion is about
		// the shape of the document and not about the case's current dimensions.
		assert.match(svg, new RegExp(`^<svg class="watch" viewBox="0 0 ${FACE.width} ${FACE.height}"`));
		assert.equal((svg.match(/<svg/g) ?? []).length, 1);
		assert.equal((svg.match(/<\/svg>/g) ?? []).length, 1);
	});

	it('balances every group and definition', () => {
		const svg = renderFace(baseState());
		for (const [open, close] of [
			['<g[ >]', '</g>'],
			['<defs>', '</defs>'],
			['<symbol', '</symbol>'],
		] as const) {
			const opened = (svg.match(new RegExp(open, 'g')) ?? []).length;
			const closed = (svg.match(new RegExp(close, 'g')) ?? []).length;
			assert.equal(opened, closed, `${open} opened ${opened} times but ${close} closed ${closed}`);
		}
	});

	it('never emits a NaN or undefined coordinate', () => {
		// The classic way a computed layout fails: a division by zero or a missing field turns into
		// "NaN" in an attribute, and the element silently vanishes.
		for (const { title, clock, svg } of everyFace()) {
			assert.equal(svg.includes('NaN'), false, `NaN in "${title}" (${clock})`);
			assert.equal(svg.includes('undefined'), false, `undefined in "${title}" (${clock})`);
			assert.equal(svg.includes('Infinity'), false, `Infinity in "${title}" (${clock})`);
		}
	});

	it('uses no fonts and no raster images on the face (DIS-1)', () => {
		const svg = renderFace(baseState());
		assert.equal(svg.includes('<image'), false, 'a raster image reached the face');
	});

	it('draws every character from the sprite rather than as geometry', () => {
		const svg = renderFace(baseState());
		const uses = (svg.match(/<use href="#ch-/g) ?? []).length;
		assert.ok(uses >= 18, `only ${uses} glyph instances, expected the whole face`);
	});

	it('renders every scenario without error', () => {
		for (const { title, clock, svg } of everyFace()) {
			assert.ok(svg.length > 2000, `"${title}" (${clock}) produced only ${svg.length} characters`);
		}
	});
});

describe('the fields fit inside the LCD', () => {
	it('keeps every glyph inside the LCD, on every screen and both clock formats', () => {
		// The check the overlap test structurally cannot make. The stopwatch's first layout ran its
		// last digits out past the LCD's right edge and onto the case — no two glyphs *overlapped*,
		// so the pairwise test was perfectly happy, and the picture showed digits printed on the
		// bezel. Overflow and collision are different failures and each needs its own assertion.
		const { lcd } = FACE;
		const right = lcd.x + lcd.width;
		const bottom = lcd.y + lcd.height;

		for (const { title, clock, svg } of everyFace()) {
			for (const glyph of instances(svg)) {
				if (glyph.character === 'space') {
					continue;
				}
				assert.ok(
					glyph.x >= lcd.x && glyph.y >= lcd.y && glyph.x + glyph.w <= right && glyph.y + glyph.h <= bottom,
					`"${title}" (${clock}): glyph ${glyph.character} at ${glyph.x},${glyph.y} (${glyph.w}x${glyph.h}) leaves the LCD, which is x ${lcd.x}..${right}, y ${lcd.y}..${bottom}`,
				);
			}
		}
	});

	it('reserves a gutter for the PM indicator, clear of the hour digits', () => {
		// PM has its own slot at the row's left; the digits move right to clear it, so that `PM6:48`
		// never reads as a single run. The shift is measured, because `10` and `23` differ in width.
		//
		// The gutter only applies when the indicator is actually drawn: in 24-hour format, in 12-hour
		// format before noon, and never on the Alarm screen, whose digits are an always-24-hour alarm
		// time and would contradict a `PM` beside them.
		const gutter = FACE.pmIndicator.x + textWidth('PM', TEXT_SIZE.indicator, TRACKING.indicator) + 10;

		for (const scenario of scenarios(AT)) {
			for (const clock of ['12h', '24h'] as const) {
				const state = stateFor({ ...scenario, clock });
				const showPm = clock === '12h' && state.wall.getUTCHours() >= 12 && state.mode !== 'alarm';
				const least = showPm ? gutter : FACE.row.left;
				for (const glyph of runOfHeight(renderFace(state), TEXT_SIZE.mainTime)) {
					assert.ok(
						glyph.x >= least - 0.01,
						`"${scenario.title}" (${clock}): a main digit starts at ${glyph.x}, the row's left is ${least.toFixed(1)}`,
					);
				}
			}
		}

		assert.ok(FACE.pmIndicator.x >= FACE.lcd.x, 'the PM indicator starts left of the LCD');
		assert.ok(
			FACE.pmIndicator.x + textWidth('PM', TEXT_SIZE.indicator, TRACKING.indicator) <=
				FACE.lcd.x + FACE.lcd.width,
			'the PM indicator overflows the LCD',
		);
	});

	it('does not contradict an alarm time with a PM indicator', () => {
		// The alarm screen's digits are always 24-hour, so `PM` beside `19:30` would be the same
		// instant stated twice and differently. The PM run is two glyphs at the indicator cell.
		const evening = new Date(Date.UTC(2026, 6, 15, 22, 48, 37));
		const alarm = stateFor({
			title: 'alarm',
			note: '',
			zone: 'Europe/London',
			homeZone: 'Europe/London',
			at: evening,
			clock: '12h',
			mode: 'alarm',
			dst: 'auto',
			alarmHour: 19,
			alarmMinute: 30,
			alarmMode: 'daily',
		});
		const clockScreen = { ...alarm, mode: 'timekeeping' as const };

		const pmCount = (svg: string): number =>
			runOfHeight(svg, TEXT_SIZE.indicator).filter((glyph) => glyph.character === 'P').length;

		assert.equal(pmCount(renderFace(clockScreen)), 1, 'the clock shows PM after noon');
		assert.equal(pmCount(renderFace(alarm)), 0, 'the alarm screen must not');
	});

	it('places the seconds and the sub-fields in separate columns of the sub-row', () => {
		// They share one line because there is no vertical room for two, so they are separated by
		// column. The stopwatch's sub-field is the wider of the two and therefore sets the bound: if
		// it clears the seconds, the countdown's does too.
		//
		// The seconds' column position is a compromise, and it is worth stating: the two runs are on
		// *different screens*, so a column each is what makes one row serve both. Moving the seconds
		// right to sit closer to the main digits' end puts them straight through the sub-field's
		// column, which is what this assertion caught when it was tried.
		const secondsRight = FACE.row.secondsX + textWidth('59', TEXT_SIZE.seconds, TRACKING.seconds);
		const subWidth = textWidth(':59.99', TEXT_SIZE.subSecond, TRACKING.subSecond);
		const subLeft = FACE.row.right - subWidth;

		assert.ok(
			subLeft >= secondsRight + 8,
			`the sub-fields start at ${subLeft.toFixed(1)}, the seconds end at ${secondsRight.toFixed(1)}, needing an 8 gap`,
		);
		assert.ok(FACE.row.right <= FACE.lcd.x + FACE.lcd.width, 'the sub-field run crosses the LCD margin');
		assert.ok(
			FACE.row.subY + heightOf(TEXT_SIZE.subSecond) <= FACE.lcd.y + FACE.lcd.height,
			'the sub-field row pokes below the LCD',
		);
	});
	it('places the seconds and the sub-fields on the same line', () => {
		// They are one row, not two: this is the property that makes the columns work, and asserting
		// it stops a later edit from drifting one of them onto the other's row.
		for (const { title, svg } of everyFace()) {
			for (const glyph of runOfHeight(svg, TEXT_SIZE.subSecond)) {
				assert.equal(
					glyph.y,
					FACE.row.subY,
					`"${title}": a sub-field is at y=${glyph.y}, the sub-row is ${FACE.row.subY}`,
				);
			}
		}
	});

	it('keeps the seconds on the sub-row', () => {
		for (const { title, svg } of everyFace()) {
			const seconds = runOfHeight(svg, TEXT_SIZE.seconds);
			// The alarm screen's `1TIME` marker shares this cell size, so a screen may legitimately
			// have none of them; what matters is that every one that exists is in a row the layout
			// provides.
			for (const glyph of seconds) {
				const known = glyph.y === FACE.row.subY || glyph.y === FACE.onceMarker.y;
				assert.ok(known, `"${title}": a ${TEXT_SIZE.seconds}-cell glyph is at y=${glyph.y}, which is no row`);
			}
		}
	});

	it('keeps the day marker clear of the main digits', () => {
		// Both are on the main row. `23:59` at the main cell reaches x 307, so a marker at 268 sat on
		// top of the World Time face's digits — which is exactly what the overlap test reported.
		const gap = 8;
		const widest = FACE.row.left + textWidth('23:59', TEXT_SIZE.mainTime, TRACKING.mainTime);
		assert.ok(
			FACE.dayMarker.x >= widest + gap || FACE.dayMarker.y !== FACE.row.y,
			`the day marker at ${FACE.dayMarker.x} is too close to main digits reaching ${widest.toFixed(1)}`,
		);
		assert.ok(
			FACE.dayMarker.x + textWidth('-1', TEXT_SIZE.field, TRACKING.field) <= FACE.lcd.x + FACE.lcd.width,
			'the day marker overflows the LCD',
		);
	});

	it('keeps the day and date field inside the LCD, for the longest real value', () => {
		// The longest realistic value is a three-letter day, a space, and a two-digit month-day.
		const longest = 'WED 12-30';
		assert.ok(
			FACE.dateField.x + textWidth(longest, TEXT_SIZE.field, TRACKING.field) <=
				FACE.lcd.x + FACE.lcd.width,
			'day/date field overflows the LCD',
		);
		assert.ok(FACE.dateField.x >= FACE.lcd.x, 'day/date field starts left of the LCD');
	});

	it('keeps the DST indicator on its own row, clear of the city code', () => {
		// DST cannot share the city-code row: the code is three glyphs wide, so a fixed offset either
		// overlaps it or drifts. The overlap test caught exactly that, with DST drawn on top of `TYO`.
		const codeBox = { x: FACE.codeField.x, y: FACE.codeField.y, w: 60, h: 28 };
		const dstBox = {
			x: FACE.dstIndicator.x,
			y: FACE.dstIndicator.y,
			w: textWidth('DST*', TEXT_SIZE.indicator, TRACKING.indicator),
			h: heightOf(TEXT_SIZE.indicator),
		};

		const overlapX = Math.min(codeBox.x + codeBox.w, dstBox.x + dstBox.w) - Math.max(codeBox.x, dstBox.x);
		const overlapY = Math.min(codeBox.y + codeBox.h, dstBox.y + dstBox.h) - Math.max(codeBox.y, dstBox.y);
		assert.ok(overlapX <= 0 || overlapY <= 0, 'the DST indicator overlaps the city code field');
		assert.ok(dstBox.x + dstBox.w <= FACE.lcd.x + FACE.lcd.width, 'the DST indicator overflows the LCD');
	});

	it('keeps every vertical band in order and inside the LCD', () => {
		// The lower half of the panel carries four rows in a fixed order, each needing clearance from
		// the next. This asserts the ordering structurally rather than as four separate bounds.
		const { lcd } = FACE;
		const bands: [string, number, number][] = [
			['subdial', FACE.subdial.cy - FACE.subdial.r, FACE.subdial.cy + FACE.subdial.r],
			['date/code row', FACE.dateField.y, FACE.dateField.y + heightOf(TEXT_SIZE.field)],
			['indicator row', FACE.indicators.y, FACE.indicators.y + heightOf(TEXT_SIZE.indicator)],
			['main row', FACE.row.y, FACE.row.y + heightOf(TEXT_SIZE.mainTime)],
			['sub-row', FACE.row.subY, FACE.row.subY + heightOf(TEXT_SIZE.subSecond)],
		];

		for (const [name, top, bottom] of bands) {
			assert.ok(top >= lcd.y, `${name} pokes above the LCD`);
			assert.ok(bottom <= lcd.y + lcd.height, `${name} pokes below the LCD (ends at ${bottom.toFixed(1)})`);
		}
		for (let index = 1; index < bands.length; index += 1) {
			const previous = bands[index - 1];
			const current = bands[index];
			if (!previous || !current) {
				continue;
			}
			assert.ok(
				current[1] >= previous[2],
				`${current[0]} at ${current[1]} overlaps ${previous[0]}, which ends at ${previous[2]}`,
			);
		}
	});

	it('keeps the subdial and the world map from overlapping', () => {
		const dialRight = FACE.subdial.cx + FACE.subdial.r;
		const mapBottom = FACE.map.y + FACE.map.width / 2.4;

		assert.ok(dialRight < FACE.map.x, `subdial reaches ${dialRight}, map starts at ${FACE.map.x}`);
		assert.ok(mapBottom < FACE.dateField.y, 'map overlaps the day/date field');
	});

	it('keeps the subdial clear of the day/date field', () => {
		// The first rasterised face showed the dial drawn over the leading `T` of `THU`, because the
		// date row began 14 units above the dial's foot. Invisible in the markup, obvious in a picture.
		const dialBottom = FACE.subdial.cy + FACE.subdial.r;
		assert.ok(
			FACE.dateField.y >= dialBottom,
			`the date field at y=${FACE.dateField.y} overlaps the dial, which ends at y=${dialBottom}`,
		);
	});

	it('keeps the day/date and city-code columns from colliding', () => {
		// The longest date the watch shows is `WED 12-30`. The first rasterised face had the full
		// `WED 30 12-30` form running into the city code with no gap at all, which is why the day
		// number is not repeated here.
		const longestDate = 'WED 12-30';
		const dateWidth = textWidth(longestDate, TEXT_SIZE.field, TRACKING.field);
		assert.ok(
			FACE.dateField.x + dateWidth + 6 <= FACE.codeField.x,
			`the date field reaches ${(FACE.dateField.x + dateWidth).toFixed(1)}, the code field starts at ${FACE.codeField.x}`,
		);
	});

	it('keeps the date field clear of the subdial above it', () => {
		assert.ok(
			FACE.dateField.x >= FACE.subdial.cx - FACE.subdial.r,
			'the date field starts left of the subdial',
		);
	});

	it('keeps the ALM/SIG indicator row clear of the rows above and below', () => {
		// A real gap on both sides, not mere non-overlap: `ALM` was strictly outside the `TYO` cells
		// yet still read as part of it.
		const gap = FACE.indicators.gap;
		const codeRowBottom = FACE.codeField.y + heightOf(TEXT_SIZE.field);
		const indicatorHeight = heightOf(TEXT_SIZE.indicator);

		assert.ok(
			FACE.indicators.y >= codeRowBottom + gap,
			`the row starts at y=${FACE.indicators.y}, the city-code row ends at ${codeRowBottom.toFixed(1)}, needing a ${gap} gap`,
		);
		assert.ok(
			FACE.indicators.y + indicatorHeight + gap <= FACE.row.y,
			`the row ends at y=${(FACE.indicators.y + indicatorHeight).toFixed(1)}, the main digits start at ${FACE.row.y}, needing a ${gap} gap`,
		);
		assert.ok(
			FACE.indicators.sigX + textWidth('SIG', TEXT_SIZE.indicator, TRACKING.indicator) <=
				FACE.lcd.x + FACE.lcd.width,
			'the SIG label overflows the LCD',
		);
	});

	it('keeps every band inside the LCD', () => {
		const { lcd } = FACE;
		const rightEdge = lcd.x + lcd.width;

		assert.ok(FACE.subdial.cy - FACE.subdial.r >= lcd.y, 'subdial pokes above the LCD');
		assert.ok(FACE.subdial.cx - FACE.subdial.r >= lcd.x, 'subdial pokes left of the LCD');
		assert.ok(FACE.map.x + FACE.map.width <= rightEdge, 'map pokes right of the LCD');
		assert.ok(FACE.map.y >= lcd.y, 'map pokes above the LCD');
		assert.ok(FACE.muteIndicator.x <= rightEdge, 'the MUTE marker overflows the LCD');
		assert.ok(
			FACE.row.y + heightOf(TEXT_SIZE.mainTime) <= lcd.y + lcd.height,
			'main time digits poke below the LCD',
		);
	});
});

describe('conditional elements appear only when they should', () => {
	it('draws the backlight wash only when illuminated', () => {
		assert.equal(renderFace(baseState({ illuminated: false })).includes('class="illumination"'), false);
		assert.equal(renderFace(baseState({ illuminated: true })).includes('class="illumination"'), true);
	});

	it('shows the day marker only when the civil dates differ', () => {
		assert.notEqual(renderFace(baseState({ dayDiff: 0 })), renderFace(baseState({ dayDiff: 1 })));
	});

	it('shows the alarm number in Alarm mode instead of a city code', () => {
		const alarm = renderFace(baseState({ mode: 'alarm', alarmNumber: 3 }));
		const worldTime = renderFace(baseState({ mode: 'worldtime', alarmNumber: 3 }));
		assert.notEqual(alarm, worldTime);
	});

	it('changes the map band when the mode reverts to the Home City (MAP-4)', () => {
		const follows = renderFace(baseState({ mode: 'worldtime', displayedOffset: 540, homeOffset: -300 }));
		const reverts = renderFace(baseState({ mode: 'alarm', displayedOffset: 540, homeOffset: -300 }));
		assert.notEqual(follows, reverts);
	});

	it('simplifies the DST label when a zone has no DST', () => {
		assert.notEqual(renderFace(baseState({ dstLabel: 'DST' })), renderFace(baseState({ dstLabel: '' })));
	});

	it('flashes exactly the field the setting screen names', () => {
		// The flash is a class on a group, so the geometry does not move while a field blinks. A state
		// with no field flashing must therefore contain no flashing group at all.
		assert.equal(renderFace(baseState({ flash: null })).includes('class="flashing"'), false);

		for (const flash of ['seconds', 'city', 'dst', 'hour', 'minutes', 'year', 'month', 'day', 'illumination'] as const) {
			assert.equal(
				renderFace(baseState({ mode: 'timekeeping', flash })).includes('class="flashing"'),
				true,
				`the ${flash} field should flash`,
			);
		}
	});

	it('marks the pressed pushers and the chord (INT-8)', () => {
		const released = renderFace(baseState());
		assert.equal(released.includes('pushed'), false);

		const pressed = renderFace(baseState({ pressed: ['adjust'] }));
		assert.equal(pressed.includes('pusher-adjust pushed'), true);
		assert.equal(pressed.includes('pusher-light pushed'), false);

		const chord = renderFace(baseState({ pressed: ['adjust', 'light'], chord: true }));
		assert.equal(chord.includes('pusher-adjust pushed'), true);
		assert.equal(chord.includes('pusher-light pushed'), true);
	});

	it('blinks the alarm indicator only while an alarm sounds (ALM-8)', () => {
		const quiet = renderFace(baseState({ alarmArmed: true }));
		const sounding = renderFace(baseState({ alarmArmed: true, alerting: true }));
		assert.ok(quiet.includes('alm-indicator'));
		assert.equal(quiet.includes('alerting'), false);
		assert.ok(sounding.includes('alm-indicator alerting'));
	});

	it('shows each screen’s own state marker', () => {
		// The markers are distinguishing, not merely present: two states that differ only in their
		// marker must render differently, or the marker is not reaching the panel at all.
		assert.notEqual(
			renderFace(baseState({ mode: 'timer', timerRunning: true })),
			renderFace(baseState({ mode: 'timer', timerRunning: false })),
		);
		assert.notEqual(
			renderFace(baseState({ mode: 'stopwatch', stopwatchSplit: true, stopwatchRunning: true })),
			renderFace(baseState({ mode: 'stopwatch', stopwatchSplit: false, stopwatchRunning: true })),
		);
		assert.notEqual(
			renderFace(baseState({ mode: 'alarm', alarmNumber: 1, alarmMode: 'daily' })),
			renderFace(baseState({ mode: 'alarm', alarmNumber: 1, alarmMode: 'once' })),
		);
		assert.notEqual(
			renderFace(baseState({ mode: 'alarm', alarmNumber: 1, alarmMode: 'off' })),
			renderFace(baseState({ mode: 'alarm', alarmNumber: 1, alarmMode: 'daily' })),
		);
	});

	it('shows the hourly signal’s own screen without an alarm time (ALM-9)', () => {
		// The sixth alarm screen is not an alarm. Its centre-right field reads `SIG` rather than
		// `AL1`, its date row reads `SIGNAL` rather than a schedule, and it shows the running clock
		// rather than a stored alarm time.
		const signal = renderFace(
			baseState({ mode: 'alarm', signalScreen: true, signalOn: true, alarmHour: null, alarmMinute: null }),
		);
		const alarm = renderFace(
			baseState({ mode: 'alarm', signalScreen: false, alarmNumber: 1, alarmMode: 'daily', alarmHour: 7, alarmMinute: 30 }),
		);
		assert.notEqual(signal, alarm);

		// Counted from the rendered markup rather than searched for as a substring: `SIGNAL` contains
		// `AL`, so a substring search would "find" an alarm number on the signal screen and prove
		// nothing. Both runs sit on the date/code row, so the count covers them together.
		const rowGlyphs = (svg: string): string =>
			runOfHeight(svg, TEXT_SIZE.field)
				.filter((glyph) => glyph.y === FACE.dateField.y)
				.map((glyph) => glyph.character)
				.join('');
		assert.equal(rowGlyphs(signal), 'SIGNALSIG', 'the signal screen says SIGNAL and SIG');
		assert.equal(rowGlyphs(alarm), 'DAILYAL1', 'the alarm screen says DAILY and AL1');
	});

	it('labels the stopwatch’s wrapped reading (SW-8)', () => {
		// The marker is a `24H` run on the main row; its presence is what distinguishes a rolled-over
		// reading from a fresh one, so the two faces must differ and the marker must add glyphs.
		const wrapped = renderFace(baseState({ mode: 'stopwatch', stopwatchWrapped: true }));
		const plain = renderFace(baseState({ mode: 'stopwatch', stopwatchWrapped: false }));
		assert.notEqual(wrapped, plain);
		assert.equal(
			instances(wrapped).length - instances(plain).length,
			3,
			'the 24H marker is three glyphs',
		);
	});
});

describe('the subdial always follows the Home City (ANA-2)', () => {
	const hands = (svg: string): string => (svg.match(/class="dial-hand-[a-z]+"[^>]*/g) ?? []).join('|');

	it('does not move when the displayed zone changes', () => {
		const tokyo = renderFace(baseState({ displayedOffset: 540, homeOffset: 0, cityCode: 'TYO' }));
		const newYork = renderFace(baseState({ displayedOffset: -240, homeOffset: 0, cityCode: 'NYC' }));
		assert.equal(hands(tokyo), hands(newYork), 'the subdial moved with the displayed city');
	});

	it('does move when the Home City time changes', () => {
		const state = baseState();
		const earlier = renderFace({ ...state, homeWall: new Date(Date.UTC(2026, 6, 15, 3, 0, 0)) });
		const later = renderFace({ ...state, homeWall: new Date(Date.UTC(2026, 6, 15, 9, 30, 0)) });
		assert.notEqual(hands(earlier), hands(later));
	});
});

describe('rendered glyphs never collide', () => {
	it('places no two text glyphs on top of each other', () => {
		// This is the check that caught the date field running into the city code: the two fields'
		// last and first glyphs overlapped by 0.18 units, which is invisible in the markup and
		// produces a garbled reading on screen. A blank glyph lights nothing, so its box is ignored.
		for (const { title, clock, svg } of everyFace()) {
			const boxes = instances(svg).filter((glyph) => glyph.character !== 'space');

			for (let i = 0; i < boxes.length; i += 1) {
				for (let j = i + 1; j < boxes.length; j += 1) {
					const a = boxes[i];
					const b = boxes[j];
					if (!a || !b) {
						continue;
					}
					const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
					const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
					assert.ok(
						overlapX <= 0 || overlapY <= 0,
						`"${title}" (${clock}): glyphs ${a.character}@${a.x},${a.y} and ${b.character}@${b.x},${b.y} overlap by ${overlapX.toFixed(2)}x${overlapY.toFixed(2)}`,
					);
				}
			}
		}
	});

	it('reports a sane number of glyphs for a timekeeping face', () => {
		// A guard against the overlap check silently passing because nothing rendered. A 24-hour
		// timekeeping face carries the weekday and month-day (7), the city code (3), the four time
		// digits plus a colon (5), the seconds (2), and the battery percentage (3).
		const boxes = instances(renderFace(baseState()));
		assert.ok(boxes.length >= 18, `only ${boxes.length} glyphs rendered`);
	});
});

describe('formatting reaches the face intact', () => {
	it('shows the day and month-day it was given', () => {
		const state = baseState();
		const day = formatDay(state.wall);
		const monthDay = formatMonthDay(state.wall);
		assert.match(day, /^[A-Z]{3} \d{1,2}$/);
		assert.match(monthDay, /^\d{1,2}-\d{1,2}$/);
	});

/**
 * A glyph's character from the sprite symbol id.
 *
 * The markup carries the *symbol name*, not the character: `<use href="#ch-space">` for a blank and
 * `#ch-dash`, `#ch-colon`, `#ch-dot` for the punctuation that has no safe id of its own (see
 * `glyphId` in `svg.ts`). Comparing rendered text against a literal string without mapping these back
 * produced an assertion failure reading `NEWspaceYORK` — the code was right and the reader was naive.
 */
const CHARACTER_OF_ID: Readonly<Record<string, string>> = {
	space: ' ',
	dash: '-',
	colon: ':',
	dot: '.',
};

function characterOf(id: string): string {
	return CHARACTER_OF_ID[id] ?? id;
}

describe('the city name on the World Time screen (WLD-1)', () => {
	/**
	 * A World Time face for a zone, built through the real scenario path — so the name comes from the
	 * catalogue and the code from the same city, which is what the screen actually renders.
	 *
	 * The first version of these tests passed a `worldCity` and a `cityCode` by hand while leaving
	 * `mode` at its default of timekeeping, so the World Time branch never ran and every assertion
	 * was reading the *weekday* row instead. The numbers looked plausible, which is why it took a
	 * failing gap check to notice.
	 */
	const worldFace = (zone: string): string =>
		renderFace(
			stateFor({
				title: 'world',
				note: '',
				zone,
				homeZone: 'Europe/London',
				at: AT,
				clock: '24h',
				mode: 'worldtime',
				dst: 'auto',
			}),
		);

	/** The same face, with the register indicator occupying the row (MOD-3). */
	const worldFaceWithIndicator = (zone: string): string =>
		renderFace(
			stateFor({
				title: 'world',
				note: '',
				zone,
				homeZone: 'Europe/London',
				at: AT,
				clock: '24h',
				mode: 'worldtime',
				dst: 'auto',
				showRegister: true,
				multiTime: 2,
			}),
		);

	/**
	 * The name run's glyphs.
	 *
	 * Identified by **column, not by row**: the name and the code sit at the same y, because they are
	 * two fields on one line. Filtering by y alone merges them into `TOKYOTYO`, which is how the
	 * first version of these tests passed while measuring nothing.
	 */
	const nameRun = (svg: string) =>
		runOfHeight(svg, TEXT_SIZE.field).filter(
			(glyph) => glyph.y === FACE.dateField.y && glyph.x < FACE.codeField.x,
		);

	/** The code field's glyphs, which start at the code column. */
	const codeRun = (svg: string) =>
		runOfHeight(svg, TEXT_SIZE.field).filter(
			(glyph) => glyph.y === FACE.codeField.y && glyph.x >= FACE.codeField.x,
		);

	const textOf = (glyphs: { character: string }[]): string =>
		glyphs.map((glyph) => characterOf(glyph.character)).join('');

	it('shows a short name whole, and the code in its own field', () => {
		const svg = worldFace('Asia/Tokyo');
		assert.equal(textOf(nameRun(svg)), 'TOKYO', 'the name fits and is shown');
		assert.equal(textOf(codeRun(svg)), 'TYO', 'and the code has its own field');
	});

	it('shows a name whole or shows the code, never a truncated name', () => {
		// The rule, and the reason for it: truncating to fit produced `NEW YOR`, `RIO DE J` and
		// `FERNANDO D`, none of which is a place — the last is ten glyphs and still nonsense, so a
		// floor on the length does not rescue it. A name is shown whole or replaced by the code, and
		// the code is unambiguous by construction.
		assert.equal(textOf(nameRun(worldFace('Asia/Tokyo'))), 'TOKYO', 'fits whole');
		assert.equal(textOf(nameRun(worldFace('America/New_York'))), 'NEW YORK', 'seven glyphs, fits');
		assert.equal(textOf(nameRun(worldFace('Pacific/Auckland'))), 'WELLINGTON', 'and ten fits');

		// Eleven of the catalogue's names fit and thirty-eight do not. These three do not, at 211,
		// 269 and 366 units against a 210-unit row.
		assert.equal(textOf(nameRun(worldFace('America/Los_Angeles'))), 'LAX');
		assert.equal(textOf(nameRun(worldFace('America/Sao_Paulo'))), 'RIO');
		assert.equal(textOf(nameRun(worldFace('America/Noronha'))), 'FEN');
	});

	it('shows the register indicator in place of the code, not beside it (MOD-3)', () => {
		// They are alternatives, and the reason is arithmetic: the name row needs 153 units for
		// `NEW YORK`, the indicator 56 and the clearances 26, against 210 available. The code gives
		// way, because the name above it already says where the time is from.
		const gap = 12;
		for (const multiTime of [1, 2, 3, 4]) {
			const svg = renderFace(
				baseState({ mode: 'worldtime', showRegister: true, multiTime, cityCode: 'AAA' }),
			);
			const row = runOfHeight(svg, TEXT_SIZE.field).filter(
				(glyph) => glyph.y === FACE.codeField.y,
			);

			// Three runs share this y: the name at the date column, the indicator in the clearance,
			// and the code at its own column — which is absent while the indicator shows.
			const indicatorRun = row.filter(
				(glyph) => glyph.x >= FACE.dateField.x + 120 && glyph.x < FACE.codeField.x,
			);
			assert.equal(indicatorRun.length, 3, `T-${multiTime} should be three glyphs`);
			assert.equal(characterOf(indicatorRun[0]?.character ?? ''), 'T', 'and should start with T');

			assert.equal(
				row.filter((glyph) => glyph.x >= FACE.codeField.x).length,
				0,
				'the code is replaced, not duplicated',
			);

			// The name yields to the indicator rather than colliding with it: it is the elastic field
			// and the indicator is not. `NEW YORK` cannot fit beside `T-2`, so the row steps down to
			// the code — which is visible here as the name run holding exactly three glyphs.
			const nameRun = row.filter(
				(glyph) => glyph.x < FACE.dateField.x + 120 && glyph.x >= FACE.dateField.x,
			);
			assert.ok(nameRun.length > 0, 'something should identify the city');
			const lastName = nameRun[nameRun.length - 1];
			const firstIndicator = indicatorRun[0];
			assert.ok(lastName && firstIndicator);
			assert.ok(
				lastName.x + lastName.w + gap <= firstIndicator.x,
				`the name ends at ${(lastName.x + lastName.w).toFixed(1)}, the indicator starts at ${firstIndicator.x}, needing a ${gap} gap`,
			);
		}
	});

	it('reduces the city name to the code when the indicator will not leave room', () => {
		// The concrete case: `NEW YORK` is 153 units and the reduced room — the code column less the
		// indicator and both clearances — is 140. So the row shows the code rather than running `T-2`
		// through `YORK`. Asserted on the glyph set rather than on the text, because the name run and
		// the indicator share this row and the document order interleaves them.
		const occupying = nameRun(worldFaceWithIndicator('America/New_York')).map((glyph) =>
			characterOf(glyph.character),
		);
		// The indicator is emitted before the fields, so it leads. What matters is what follows it:
		// the name stepped down to `NYC` rather than `NEW YOR` or a collision.
		assert.deepEqual(occupying, ['T', '-', '2', 'N', 'Y', 'C'], 'the name stepped down to the code');

		const free = textOf(nameRun(worldFace('America/New_York')));
		assert.equal(free, 'NEW YORK', 'and with the row free, the name returns');
	});

	it('keeps the name clear of the code field beside it', () => {
		// Both are field-glyph runs on the same line, so a gap is demanded rather than mere
		// non-overlap — the same lesson the `ALM`/`TYO` collision taught in M2.
		const gap = 12;
		for (const zone of [
			'Asia/Tokyo',
			'America/New_York',
			'America/Los_Angeles',
			'Pacific/Auckland',
			'Asia/Singapore',
		]) {
			const glyphs = nameRun(worldFace(zone)).filter((glyph) => glyph.character !== 'space');
			const last = glyphs[glyphs.length - 1];
			assert.ok(last, `${zone} rendered no name`);
			assert.ok(
				last.x + last.w + gap <= FACE.codeField.x,
				`${zone}: the name reaches ${(last.x + last.w).toFixed(1)}, the code field starts at ${FACE.codeField.x}, needing a ${gap} gap`,
			);
		}
	});

	it('renders every catalogue name without leaving the LCD', () => {
		// The row is the only place a string of unpredictable length reaches the face, so every name
		// the catalogue can put there is drawn and checked.
		for (const city of CITIES) {
			const svg = worldFace(city.zone);
			for (const glyph of runOfHeight(svg, TEXT_SIZE.field)) {
				assert.ok(
					glyph.x >= FACE.lcd.x && glyph.x + glyph.w <= FACE.lcd.x + FACE.lcd.width,
					`${city.name}: a glyph reaches ${(glyph.x + glyph.w).toFixed(1)}`,
				);
			}
		}
	});
});
});
