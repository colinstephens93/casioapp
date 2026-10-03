/**
 * The face: case, LCD and every field on it.
 *
 * This module is the single place that knows the watch's visual layout. It emits SVG as a string
 * and takes a plain data object, which keeps it free of the DOM and of Electron — so the same code
 * draws the preview in a browser and the widget in the tray, and the geometry can be snapshot
 * tested without a window.
 *
 * ## How the indicators are drawn
 *
 * The real LCD has no icons. `ALM`, `SIG`, `MUTE`, `DST`, `PM`, `SPL` and `T1`…`T4` are all rendered
 * from the *same seven segments* as the time, simply at a smaller size. So they reuse `textRun`
 * rather than introducing a second drawing system — which is both faithful and less code.
 *
 * ## Five screens, one geometry
 *
 * The watch's five screens are not five different faces; they are one face whose *fields* change
 * (requirements DIS-3, DIS-8). The layout constants in `theme.ts` are the same for all of them, and
 * each screen chooses what goes in the slots the layout provides. That is why this file has one
 * `renderFields` with a `switch` in it rather than five renderers: the shared bands are what make
 * the watch recognisable, and duplicating them per screen is how they would drift apart.
 *
 * The **map band** is the exception, and it is structural rather than conditional here: it reverts
 * to the Home City in Alarm, Timer and Stopwatch (requirement MAP-4), and that rule lives in
 * `bandForMode` so the renderer cannot get it wrong.
 */
import {
	formatClock,
	formatDay,
	formatMonthDay,
	type Clock,
	type DstMode,
} from '../shared/time.ts';
import { renderMap, type ScreenMode } from '../shared/map.ts';
import { buildSprite, textRun, textWidth } from '../shared/svg.ts';
import { FACE, TEXT_SIZE, TRACKING, themeCss } from '../shared/theme.ts';
import { stopwatchParts, STOPWATCH_LIMIT_MS } from '../shared/stopwatch.ts';
import { timerParts } from '../shared/timer.ts';
import type { FlashField } from '../shared/machine.ts';

export interface DisplayState {
	/** The instant being displayed. */
	readonly at: Date;
	/** Wall-clock time in the displayed zone, as a `Date` whose UTC fields are local fields. */
	readonly wall: Date;
	/** Offset of the displayed zone, in minutes. */
	readonly displayedOffset: number;
	/** Offset of the Home City, in minutes. Drives the map in Alarm, Timer and Stopwatch. */
	readonly homeOffset: number;
	/** Offset gap between the displayed zone and the Home City, in minutes. */
	readonly diffFromHome: number;
	/** Calendar-day difference from the Home City: -1, 0 or +1. */
	readonly dayDiff: number;
	/** The three-letter LCD code of the displayed zone. */
	readonly cityCode: string;
	/** 12- or 24-hour presentation. */
	readonly clock: Clock;
	/** Which screen is being shown, which decides whether the map follows the display. */
	readonly mode: ScreenMode;
	/** DST override in force for the displayed zone. */
	readonly dst: DstMode;
	/** DST indicator text, already resolved by `dstLabel`. */
	readonly dstLabel: string;
	/** Multi Time register currently selected, 1..4. */
	readonly multiTime: number;
	/**
	 * True while the `T-n` register indicator is showing.
	 *
	 * The watch displays this for about a second after the register changes, **in place of the city
	 * code**, then reverts. It is a flag rather than a timer so the face stays a pure function.
	 */
	readonly showRegister: boolean;
	/** True while the button-operation tone is muted. */
	readonly muted: boolean;
	/** True when any alarm is armed. */
	readonly alarmArmed: boolean;
	/** True when the hourly time signal is on. */
	readonly signalOn: boolean;
	/** Simulated battery level, 0..1, for the 10 YEAR BATTERY readout. */
	readonly battery: number;
	/** Wall clock in the Home City, which the subdial always follows (ANA-2). */
	readonly homeWall: Date;
	/** Whether the amber backlight is currently lit. */
	readonly illuminated: boolean;
	/** The field currently flashing on a setting screen, or null (TIM-4, ALM-4, TMR-3). */
	readonly flash: FlashField | null;
	/** True while an alarm or the countdown is sounding, which drives the alarm animation (ALM-11). */
	readonly alerting: boolean;

	/* -- Alarm screen ------------------------------------------------------------------------ */
	/** Alarm number being shown in Alarm mode, 1..5. `null` on the hourly-signal screen. */
	readonly alarmNumber: number | null;
	/** The alarm's hour and minute, in Home City time. */
	readonly alarmHour: number | null;
	readonly alarmMinute: number | null;
	/** The alarm's armed state, which the setting screen also stores here. */
	readonly alarmMode: 'daily' | 'once' | 'off' | null;
	/** True when the Alarm screen is showing the hourly-signal screen instead of an alarm. */
	readonly signalScreen: boolean;

	/* -- Countdown Timer screen -------------------------------------------------------------- */
	/** Remaining milliseconds, or null off the Timer screen. */
	readonly timerMs: number | null;
	/** True while counting down. */
	readonly timerRunning: boolean;
	/** The values the setting screen edits, when it is open. */
	readonly timerSet: { hours: number; minutes: number; seconds: number } | null;

	/* -- Stopwatch screen -------------------------------------------------------------------- */
	/** The reading in milliseconds, or null off the Stopwatch screen. */
	readonly stopwatchMs: number | null;
	readonly stopwatchRunning: boolean;
	/** True while a split is frozen, which is what lights `SPL` (SW-2). */
	readonly stopwatchSplit: boolean;
	/** True once the reading has rolled over its 24-hour capacity (SW-8). */
	readonly stopwatchWrapped: boolean;

	/* -- World Time screen ------------------------------------------------------------------- */
	/** The displayed city's name, for the World Time screen's date row. */
	readonly worldCity: string;
	/** True when the displayed city is `UTC`, which the DST field cannot touch (WLD-3). */
	readonly worldIsUtc: boolean;

	/* -- Interaction ------------------------------------------------------------------------- */
	/** Pushers currently held down (INT-8). */
	readonly pressed: readonly string[];
	/** True while the ADJUST+LIGHT chord is down (INT-8). */
	readonly chord: boolean;
	/** The selected illumination duration in milliseconds, shown while its field is being set (LIT-3). */
	readonly illuminationMs: number;
}

/** Draws the whole watch. */
export function renderFace(state: DisplayState): string {
	return [
		`<svg class="watch" viewBox="0 0 ${FACE.width} ${FACE.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${ariaLabel(state)}">`,
		`<style>${themeCss()}</style>`,
		buildSprite(),
		renderCase(state),
		renderLcd(state),
		state.illuminated ? renderIllumination() : '',
		'</svg>',
	].join('');
}

/** A one-line description of what the face is showing, for screen readers (NFR-9). */
function ariaLabel(state: DisplayState): string {
	const time = formatClock(state.wall, state.clock, true);
	const screen = state.mode === 'worldtime' ? `World Time ${state.cityCode}` : state.mode;
	return `Casio AE-1200WH style world clock — ${screen}, ${state.cityCode}, ${time}`;
}

/** The clipped-corner case, its bezel lettering, the LCD window and the four pushers. */
function renderCase(state: DisplayState): string {
	const { width, height, cornerClip, lcd } = FACE;
	const parts: string[] = [];

	// The body, with the clipped corners that define the "Royale" silhouette.
	parts.push(`<path class="case-body" d="${clippedRect(0, 0, width, height, cornerClip)}" />`);
	// The two-piece seam, a vertical line down the middle of the case sides.
	parts.push(`<path class="case-seam" d="M 0 6 L 0 ${height - 6}" />`);
	parts.push(`<path class="case-seam" d="M ${width} 6 L ${width} ${height - 6}" />`);

	// The recessed LCD window.
	parts.push(
		`<rect class="lcd-bezel" x="${lcd.x - 7}" y="${lcd.y - 7}" width="${lcd.width + 14}" height="${lcd.height + 14}" rx="6" />`,
	);
	parts.push(
		`<rect class="lcd-glass" x="${lcd.x}" y="${lcd.y}" width="${lcd.width}" height="${lcd.height}" rx="4" />`,
	);

	// Bezel lettering. Positions are proportional to the case so the text stays put at any size.
	// The anchor value is `middle`, not `center`: `center` is not a valid SVG `text-anchor` and is
	// silently ignored, which left-aligned the bezel text instead of centring it.
	parts.push(bezelText('WORLD TIME', width / 2, 52, 'middle'));
	// The printed lines below the LCD are pushed to the case's own foot. They used to sit at
	// `height - 46` and `height - 22`, which put them *inside* the LCD window — the rasterised face
	// showed the `10 YEAR BATTERY` print sitting on top of the main digits, and the `ILLUMINATOR`
	// line on top of the seconds.
	parts.push(bezelText('ILLUMINATOR', width / 2, height - 12, 'middle'));
	parts.push(`<text class="case-print accent" x="${width - 52}" y="34" text-anchor="end">CASIO</text>`);
	parts.push(`<text class="case-print accent" x="30" y="70">5 ALARMS</text>`);
	parts.push(`<text class="case-print" x="30" y="418">WR100M</text>`);
	// The watch prints MUTE on the lower bezel, which is where the LCD has no room for it.
	parts.push(`<text class="case-print" x="${width - 30}" y="418" text-anchor="end">MUTE</text>`);

	parts.push(renderPushers(state));
	return parts.join('');
}

/**
 * The four pushers and their printed labels: MODE, ADJUST, LIGHT, SEARCH.
 *
 * Each pusher carries its own class, so the pressed state (requirement INT-8) is a class change on
 * the one element rather than a second drawing. The real pushers also depress visibly, and the
 * button-operation tone is what the MUTE indicator refers to (MUT-1).
 */
function renderPushers(state: DisplayState): string {
	const { pushers, width } = FACE;
	const slots = [
		{ key: 'adjust', label: 'ADJUST', x: pushers.left.x, y: pushers.left.y, anchor: 'start' as const },
		{ key: 'light', label: 'LIGHT', x: pushers.right.x, y: pushers.right.y, anchor: 'end' as const },
		{ key: 'mode', label: 'MODE', x: pushers.left.x, y: pushers.left.y + 62, anchor: 'start' as const },
		{ key: 'search', label: 'SEARCH', x: pushers.right.x, y: pushers.right.y + 62, anchor: 'end' as const },
	];

	const held = new Set(state.pressed);

	return slots
		.map((slot) => {
			const onLeft = slot.anchor === 'start';
			const down = held.has(slot.key);
			// A depressed pusher is drawn two units further in: the visible click the watch gives.
			const inset = down ? (onLeft ? 2 : -2) : 0;
			const barX = (onLeft ? -4 : width + 4 - 10) + inset;
			const classes = ['pusher', `pusher-${slot.key}`, down ? 'pushed' : ''].filter(Boolean).join(' ');
			const bar = `<rect class="${classes}" x="${barX}" y="${slot.y}" width="14" height="${pushers.left.height}" rx="5" />`;
			const labelX = onLeft ? 26 : width - 26;
			const label =
				slot.key === 'mode' || slot.key === 'search'
					? `<text class="case-print pusher-label" x="${labelX}" y="${slot.y + 103}" text-anchor="${slot.anchor}">${slot.label}</text>`
					: '';
			return bar + label;
		})
		.join('');
}

/** The LCD contents: subdial, map, indicators and the fields for the current screen. */
function renderLcd(state: DisplayState): string {
	const { lcd } = FACE;
	return [
		`<g class="lcd-content" clip-path="url(#lcd-clip)">`,
		`<defs><clipPath id="lcd-clip"><rect x="${lcd.x}" y="${lcd.y}" width="${lcd.width}" height="${lcd.height}" rx="4" /></clipPath></defs>`,
		renderSubdial(state.homeWall),
		renderMap(state.mode, state.displayedOffset, state.homeOffset),
		renderIndicators(state),
		renderFields(state),
		'</g>',
	].join('');
}

/**
 * The analog subdial.
 *
 * It **always tracks T-1, the Home City**, in every mode, and never the selected world-time city
 * (requirement ANA-2). Its ring is numbered 5, 10, … 60 rather than 1..12 (ANA-4), which is why it
 * is drawn by hand instead of with a clock-drawing helper.
 */
function renderSubdial(homeWall: Date): string {
	const { cx, cy, r } = FACE.subdial;
	const parts: string[] = [];

	parts.push(`<circle class="dial-face" cx="${cx}" cy="${cy}" r="${r}" />`);
	parts.push(`<circle class="dial-ring" cx="${cx}" cy="${cy}" r="${r - 3}" />`);

	// The ring numerals, every five units, with 60 at the top.
	for (let n = 5; n <= 60; n += 5) {
		const angle = (n / 60) * Math.PI * 2;
		const tickX = cx + Math.sin(angle) * (r - 10);
		const tickY = cy - Math.cos(angle) * (r - 10);
		if (n % 10 === 0) {
			parts.push(`<circle class="dial-tick" cx="${round(tickX)}" cy="${round(tickY)}" r="2" />`);
		}
		if (n % 20 === 0) {
			const labelX = cx + Math.sin(angle) * (r - 22);
			const labelY = cy - Math.cos(angle) * (r - 22);
			parts.push(
				`<text class="dial-numeral" x="${round(labelX)}" y="${round(labelY + 3)}" text-anchor="middle">${n}</text>`,
			);
		}
	}

	const hand = (value: number, total: number, length: number, className: string): string => {
		const angle = (value / total) * Math.PI * 2;
		return `<line class="${className}" x1="${cx}" y1="${cy}" x2="${round(cx + Math.sin(angle) * length)}" y2="${round(cy - Math.cos(angle) * length)}" />`;
	};

	const hours = homeWall.getUTCHours() % 12;
	const minutes = homeWall.getUTCMinutes();
	const seconds = homeWall.getUTCSeconds();

	parts.push(hand(hours * 5 + minutes / 12, 60, r - 24, 'dial-hand-hour'));
	parts.push(hand(minutes, 60, r - 14, 'dial-hand-minute'));
	parts.push(hand(seconds, 60, r - 12, 'dial-hand-second'));
	parts.push(`<circle class="dial-hub" cx="${cx}" cy="${cy}" r="4" />`);

	return `<g class="subdial">${parts.join('')}</g>`;
}

/** The status indicators around the LCD margins. */
function renderIndicators(state: DisplayState): string {
	const { pmIndicator, muteIndicator, codeField } = FACE;
	const cell = TEXT_SIZE.indicator;
	const tracking = TRACKING.indicator;
	const parts: string[] = [];

	// MUTE. The word itself is printed on the case bezel rather than the LCD, because the LCD's
	// indicator column has no room for four characters; the triangular icon alone marks the state,
	// which is what the real panel does.
	if (state.muted) {
		parts.push(
			`<path class="mute-icon" d="M ${muteIndicator.x - 8} ${muteIndicator.y + 4} L ${muteIndicator.x} ${muteIndicator.y - 3} L ${muteIndicator.x} ${muteIndicator.y + 11} Z" />`,
		);
	}

	// ALM and SIG share one row between the date row and the main digits, right-aligned. While an
	// alarm is sounding the whole row flashes (requirement ALM-8), which is done by a class so the
	// geometry does not move.
	const alerting = state.alerting ? ' alerting' : '';
	if (state.alarmArmed || state.alerting) {
		parts.push(`<g class="alm-indicator${alerting}">${textRun('ALM', FACE.indicators.almX, FACE.indicators.y, cell, tracking)}</g>`);
	}
	if (state.signalOn) {
		parts.push(textRun('SIG', FACE.indicators.sigX, FACE.indicators.y, cell, tracking));
	}

	// DST has its own row, because sharing the city-code row means a fixed offset that either
	// overlaps a three-glyph code or drifts away from a shorter one.
	//
	// It flashes while the DST field is the one being set (TIM-5), which is why the label is wrapped
	// rather than emitted bare: the operator changes this field by watching this label, because the
	// field is not a value the main digits show.
	if (state.dstLabel) {
		parts.push(
			flashGroup(
				state,
				['dst'],
				textRun(state.dstLabel, FACE.dstIndicator.x, FACE.dstIndicator.y, cell, tracking),
			),
		);
	}

	// The PM indicator occupies its own reserved gutter left of the hour digits, in 12-hour
	// format only. It cannot sit inline: doing so pushes a value like `10:48 PM` off the LCD.
	//
	// It is suppressed on the Alarm screen, because that screen's digits are an alarm *time* and are
	// always 24-hour whatever the clock format is (see `fieldsAlarm`). Showing `PM` beside `07:30`
	// contradicts the digits: the same instant said twice, and said differently.
	const { wall, clock } = state;
	if (clock === '12h' && wall.getUTCHours() >= 12 && state.mode !== 'alarm') {
		parts.push(textRun('PM', pmIndicator.x, pmIndicator.y, cell, tracking));
	}

	// The Multi Time register indicator is transient: the watch shows `T-1`…`T-4` in place of the
	// city code for about a second after the register changes, then reverts to the code. Rendering
	// it as a separate corner label would overlap the subdial, so it replaces the code instead.
	//
	// It is anchored to the left of the code column rather than on it, so that it stays clear of the
	// SIG/ALM indicator column on the right.
	if (state.showRegister) {
		parts.push(
			textRun(`T-${state.multiTime}`, codeField.x - 46, codeField.y, TEXT_SIZE.field, TRACKING.field),
		);
	}

	return `<g class="indicators">${parts.join('')}</g>`;
}

/**
 * The screen's own fields.
 *
 * Every screen fills the same bands the layout provides:
 *
 *   band 2   the day/date field, then the city-code / alarm-number / timer-state field
 *   band 3   the main row: the large digits, and the seconds or sub-field beside them
 *   band 4   the sub-field row, on the two screens that need a fourth field
 *
 * The bands are the watch's, so a screen that put its numbers somewhere else would stop looking
 * like the watch. What changes per screen is which *values* go in them.
 */
function renderFields(state: DisplayState): string {
	const parts: string[] = [];

	switch (state.mode) {
		case 'worldtime':
			parts.push(...fieldsWorldTime(state));
			break;
		case 'alarm':
			parts.push(...fieldsAlarm(state));
			break;
		case 'timer':
			parts.push(...fieldsTimer(state));
			break;
		case 'stopwatch':
			parts.push(...fieldsStopwatch(state));
			break;
		default:
			parts.push(...fieldsTimekeeping(state));
			break;
	}

	parts.push(renderBattery(state.battery));

	return `<g class="fields">${parts.join('')}</g>`;
}

/**
 * The main digits' x, shifted right for the PM gutter in 12-hour format only.
 *
 * It is a shift rather than a fixed coordinate because `10` and `23` are not the same width, and the
 * PM indicator must not touch either. The digit string itself is placed at the row's fixed left
 * column, so nothing can push it onto another field.
 */
function mainX(state: DisplayState): number {
	if (state.clock !== '12h' || state.wall.getUTCHours() < 12) {
		return FACE.row.left;
	}
	return FACE.pmIndicator.x + textWidth('PM', TEXT_SIZE.indicator, TRACKING.indicator) + 10;
}

/** The seconds run, in its own column on the sub-row. */
function secondsRun(state: DisplayState): string {
	return textRun(
		pad(state.wall.getUTCSeconds()),
		FACE.row.secondsX,
		FACE.row.subY,
		TEXT_SIZE.seconds,
		TRACKING.seconds,
	);
}

/** Timekeeping and Multi Time: the day, the month-day, the city code and the seconds (TIM-1). */
function fieldsTimekeeping(state: DisplayState): string[] {
	const { dateField, codeField, dayMarker } = FACE;
	const parts: string[] = [];

	// `THU 16` and `7-16` overlap: the day number is already in the month-day pair, so printing
	// both costs six characters of a row that has no room to spare. The first rasterised face
	// showed the full form running into the city code with no gap at all. Only the weekday name
	// and the month-day go here.
	const weekday = formatDay(state.wall).split(' ')[0] ?? '';

	// While the setting screen is on a date field, the date row shows the value being edited instead
	// of the weekday. The watch's setting screen replaces the field it is editing — the operator
	// cannot set a year they cannot see — and this is also what gives the field something to flash,
	// since `year`, `month` and `day` have no other representation on the face.
	const editing = editingDate(state);
	const lighting = state.flash === 'illumination' ? illuminationLabel(state.illuminationMs) : null;
	if (editing ?? lighting) {
		const value = editing ?? lighting ?? '';
		parts.push(
			flashGroup(
				state,
				['year', 'month', 'day', 'illumination'],
				textRun(value, dateField.x, dateField.y, TEXT_SIZE.field, TRACKING.field),
			),
		);
	} else {
		parts.push(
			flashGroup(
				state,
				['day'],
				textRun(`${weekday} ${formatMonthDay(state.wall)}`, dateField.x, dateField.y, TEXT_SIZE.field, TRACKING.field),
			),
		);
	}

	// The centre-right field carries the city code, and the register indicator takes its place for
	// a second after the register changes (MOD-3).
	if (!state.showRegister) {
		parts.push(flashGroup(state, ['city'], textRun(state.cityCode, codeField.x, codeField.y, TEXT_SIZE.field, TRACKING.field)));
	}

	parts.push(
		flashGroup(
			state,
			['hour', 'minutes'],
			textRun(clockDigits(state), mainX(state), FACE.row.y, TEXT_SIZE.mainTime, TRACKING.mainTime),
		),
	);
	parts.push(flashGroup(state, ['seconds'], secondsRun(state)));

	// The ±1 day marker, when the civil date differs from the Home City's.
	if (state.dayDiff !== 0) {
		parts.push(textRun(state.dayDiff > 0 ? '+1' : '-1', dayMarker.x, dayMarker.y, TEXT_SIZE.field, TRACKING.field));
	}

	return parts;
}

/**
 * World Time: the city's name, and the same clock (WLD-1..WLD-5).
 *
 * The date row carries the city **name** rather than the weekday, because on this screen knowing
 * *where* matters more than knowing which day of the week it is, and because the name is the only
 * long string the face ever shows. It is truncated to the width the row actually has, computed from
 * the glyph metrics rather than guessed, and the full name is always recoverable from the
 * catalogue.
 */
function fieldsWorldTime(state: DisplayState): string[] {
	const { dateField, codeField, dayMarker } = FACE;
	const parts: string[] = [];

	const name = fitText(state.worldCity.toUpperCase(), dateField.x, codeField.x - 8, TEXT_SIZE.field, TRACKING.field);
	parts.push(textRun(name, dateField.x, dateField.y, TEXT_SIZE.field, TRACKING.field));

	// The code, unless the register indicator is showing in its place.
	if (!state.showRegister) {
		parts.push(textRun(state.cityCode, codeField.x, codeField.y, TEXT_SIZE.field, TRACKING.field));
	}

	parts.push(textRun(clockDigits(state), mainX(state), FACE.row.y, TEXT_SIZE.mainTime, TRACKING.mainTime));
	parts.push(secondsRun(state));

	if (state.dayDiff !== 0) {
		parts.push(textRun(state.dayDiff > 0 ? '+1' : '-1', dayMarker.x, dayMarker.y, TEXT_SIZE.field, TRACKING.field));
	}

	return parts;
}

/**
 * Alarm: the armed alarm's time, its number, and its schedule (ALM-1..ALM-9).
 *
 * The alarm's hour and minute go in the main digits because that is what the operator came to read.
 * The centre-right field shows `ALn`, which is requirement DIS-8, and the hourly-signal screen shows
 * the *current* time instead of an alarm's.
 */
function fieldsAlarm(state: DisplayState): string[] {
	const { dateField, codeField } = FACE;
	const parts: string[] = [];

	if (state.signalScreen) {
		parts.push(textRun('SIGNAL', dateField.x, dateField.y, TEXT_SIZE.field, TRACKING.field));
	} else {
		const schedule = state.alarmMode === 'daily' ? 'DAILY' : state.alarmMode === 'once' ? 'ONCE' : 'OFF';
		parts.push(
			flashGroup(state, ['schedule'], textRun(schedule, dateField.x, dateField.y, TEXT_SIZE.field, TRACKING.field)),
		);
	}

	if (!state.showRegister) {
		const field = state.signalScreen ? 'SIG' : `AL${state.alarmNumber ?? 1}`;
		parts.push(textRun(field, codeField.x, codeField.y, TEXT_SIZE.field, TRACKING.field));
	}

	// An alarm's time is always 24-hour on the watch's alarm screen, whatever the clock format:
	// `AL1` at `7:30` would be ambiguous morning and evening, and an alarm has no AM/PM field.
	const alarmText = state.signalScreen
		? clockDigits(state)
		: `${pad(state.alarmHour ?? state.wall.getUTCHours())}:${pad(state.alarmMinute ?? state.wall.getUTCMinutes())}`;

	parts.push(
		flashGroup(
			state,
			['hour', 'minutes'],
			textRun(alarmText, mainX(state), FACE.row.y, TEXT_SIZE.mainTime, TRACKING.mainTime),
		),
	);

	// The hourly-signal screen has a running clock, so it shows the real seconds. An alarm screen has
	// no seconds at all: its second row carries the schedule marker instead.
	if (state.signalScreen) {
		parts.push(secondsRun(state));
	}

	// `1TIME` is the watch's own marker for a one-time alarm: it fires once and disarms itself, and
	// the panel says so. Drawn at the indicator cell because it is a marker rather than a value.
	if (!state.signalScreen && state.alarmMode === 'once') {
		parts.push(
			textRun(
				'1TIME',
				FACE.onceMarker.x,
				FACE.onceMarker.y,
				TEXT_SIZE.seconds,
				TRACKING.seconds,
			),
		);
	}

	return parts;
}

/**
 * Countdown Timer: hours, minutes, seconds and tenths (TMR-2).
 *
 * The reading is four fields wide — `23H59'59.9` is eleven glyphs — which will not fit one row, so
 * it takes two: `24H00` on the main digits at full size, and `:00.0` on a line below. That is what
 * the real module does, and it is the only arrangement in which the main digits keep their size —
 * requirement DIS-4 makes them the largest element on the panel, and shrinking them to fit one row
 * would break that.
 */
function fieldsTimer(state: DisplayState): string[] {
	const { dateField, codeField } = FACE;
	const parts: string[] = [];

	// The setting screen replaces the reading with the value being edited, so the operator can see
	// what they are setting. Otherwise the row shows the state: RUN, STP, or SET while editing.
	const editing = state.timerSet;
	const label = editing ? 'SET' : state.timerRunning ? 'RUN' : 'STP';
	parts.push(textRun(label, dateField.x, dateField.y, TEXT_SIZE.field, TRACKING.field));

	parts.push(textRun('TIMER', codeField.x - 12, codeField.y, TEXT_SIZE.field, TRACKING.field));

	const ms = state.timerMs ?? 0;
	const parts4 = timerParts(ms);

	// `24H` rather than `24:00`, because that is what the watch prints at its maximum (TMR-1).
	const hourText = parts4.hours >= 24 ? '24H' : pad(parts4.hours);
	const mainText = `${hourText}${SEPARATOR}${pad(parts4.minutes)}`;
	const subText = `${SEPARATOR}${pad(parts4.seconds)}.${parts4.tenths}`;

	parts.push(
		flashGroup(
			state,
			['timer-hours', 'timer-minutes'],
			textRun(mainText, FACE.wideLeft, FACE.row.y, TEXT_SIZE.mainTime, TRACKING.mainTime),
		),
	);

	parts.push(
		flashGroup(
			state,
			['timer-seconds'],
			textRun(subText, subFieldX(subText), FACE.row.subY, TEXT_SIZE.subSecond, TRACKING.subSecond),
		),
	);

	return parts;
}

/**
 * Stopwatch: hours, minutes, seconds and hundredths (SW-1).
 *
 * The capacity is `23:59:59.99`, which cannot be one row. The real module splits it the same way the
 * countdown does — hours and minutes on the large digits, seconds and hundredths on the line below —
 * and that is what this does, because the alternative is shrinking the main digits until the panel
 * stops being the largest element on the face (DIS-4).
 *
 * The first attempt put `HH'MM'SS` on the main row and `.CC` below, which *looked* like the split
 * that saved space and in fact ran the digits off the LCD. The rasterised face showed it: the markup
 * was balanced, every test passed, and the picture had `00:12 34` trailing into the case.
 */
function fieldsStopwatch(state: DisplayState): string[] {
	const { dateField, codeField, dayMarker } = FACE;
	const parts: string[] = [];

	// The label goes on the date row rather than in the trailing block, so the digits below are never
	// crowded: `SPL` while a split is frozen (DIS-7, SW-2), and the state otherwise.
	const label = state.stopwatchSplit ? 'SPL' : state.stopwatchRunning ? 'RUN' : 'STP';
	parts.push(textRun(label, dateField.x, dateField.y, TEXT_SIZE.field, TRACKING.field));

	parts.push(textRun('STW', codeField.x, codeField.y, TEXT_SIZE.field, TRACKING.field));

	const parts4 = stopwatchParts(state.stopwatchMs ?? 0);

	const mainText = `${pad(parts4.hours)}${SEPARATOR}${pad(parts4.minutes)}`;
	const subText = `${SEPARATOR}${pad(parts4.seconds)}.${pad(parts4.hundredths)}`;

	parts.push(textRun(mainText, FACE.wideLeft, FACE.row.y, TEXT_SIZE.mainTime, TRACKING.mainTime));
	parts.push(textRun(subText, subFieldX(subText), FACE.row.subY, TEXT_SIZE.subSecond, TRACKING.subSecond));

	// The rollover marker. The stopwatch resets to zero and keeps running at its 24-hour limit
	// (SW-8), and without a marker the reading would simply look wrong. `SPL` takes precedence,
	// because which of the two the operator needs to know is the split.
	//
	// It sits in the free column between the main digits and the day marker. The day marker's own
	// slot at x 340 cannot hold a three-glyph run without crossing the LCD's right margin, and `24H`
	// is three glyphs — which the LCD-bounds test reported the first time it was tried there.
	if (state.stopwatchWrapped && !state.stopwatchSplit) {
		parts.push(textRun('24H', 166, FACE.row.subY, TEXT_SIZE.field, TRACKING.field));
	}

	return parts;
}

/** Where a sub-field run sits: right-aligned to the row's margin. */
function subFieldX(text: string): number {
	return FACE.row.right - textWidth(text, TEXT_SIZE.subSecond, TRACKING.subSecond);
}

/**
 * The separator between digit groups on the timer and stopwatch screens.
 *
 * A colon, because **the face has no apostrophe**. The seven-segment sprite carries `-`, `.`, `:`
 * and a space, and nothing else; an apostrophe is not a seven-segment character at all, so the first
 * draft's `00'12` rendered as `00 12` — the picture showed the gap and the markup gave no hint of it.
 * The colon is a real glyph this panel has, and `00:12 34.56` reads as the same quantity.
 */
const SEPARATOR = ':';

/**
 * The date being edited, when the setting screen is on one of the three date fields (TIM-5).
 *
 * Returns the string the date row shows — `2026`, `07`, `15` — or null when no date field is open.
 * The three fields share one display slot on the watch, because only one of them flashes at a time;
 * showing all three at once would leave the operator unable to tell which digit they are changing.
 */
function editingDate(state: DisplayState): string | null {
	if (state.mode !== 'timekeeping') {
		return null;
	}
	if (state.flash === 'year') {
		return pad4(state.wall.getUTCFullYear());
	}
	if (state.flash === 'month') {
		return pad(state.wall.getUTCMonth() + 1);
	}
	if (state.flash === 'day') {
		return pad(state.wall.getUTCDate());
	}
	return null;
}

/** Four digits, for the year field. */
function pad4(value: number): string {
	return String(value).padStart(4, '0');
}

/**
 * The illumination duration as the setting screen prints it: `1.5S` or `3.0S`.
 *
 * The field is a two-value cycle, so the label is the value — and it has to be shown in the slot the
 * date row occupies, because there is no other place on the face where a duration of seconds could
 * go. Requirement LIT-3 makes it a field of the Timekeeping setting screen, so it needs one.
 */
function illuminationLabel(ms: number): string {
	return `${(ms / 1000).toFixed(1)}S`;
}

/** Wraps a run in a group the stylesheet can flash, when it is the field currently being set. */
function flashGroup(state: DisplayState, fields: readonly FlashField[], markup: string): string {
	const flashing = state.flash !== null && fields.includes(state.flash);
	return flashing ? `<g class="flashing">${markup}</g>` : markup;
}

/**
 * `HH:MM` from the displayed wall clock.
 *
 * Deliberately built here rather than through `formatClock`, because the 12-hour `AM`/`PM` suffix
 * is a *separate indicator* on this watch rather than part of the string — rendering `10:48 PM` as
 * one run is what originally pushed the digits off the LCD.
 */
function clockDigits(state: DisplayState): string {
	const hours = state.wall.getUTCHours();
	const hour = state.clock === '12h' ? hours % 12 || 12 : hours;
	return `${pad(hour)}:${pad(state.wall.getUTCMinutes())}`;
}

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

/**
 * Truncates a string so it fits a width, measured with the glyph metrics.
 *
 * The World Time screen shows city *names*, which are the only strings of unpredictable length on
 * the face, so the fit is computed from `textWidth` rather than guessed. A name that does not fit is
 * cut rather than allowed to run into the field beside it, because an overlapping field is
 * unreadable whereas a truncated one is merely abbreviated — and a test asserts the result never
 * crosses the boundary.
 */
export function fitText(
	text: string,
	x: number,
	limit: number,
	cellWidth: number,
	tracking: number,
): string {
	let candidate = text;
	while (candidate.length > 0 && x + textWidth(candidate, cellWidth, tracking) > limit) {
		candidate = candidate.slice(0, -1);
	}
	return candidate;
}

/**
 * The battery line: printed text, with the percentage revealed as the cell drains.
 *
 * It sits in the case's lower bezel rather than inside the LCD window. The watch prints it inside
 * the window's lower-left, but this face has no spare room there — the seconds block and the
 * trailing sub-field row both reach into that corner — and print over a live field is worse than
 * print on the bezel beside it.
 */
function renderBattery(level: number): string {
	const percent = Math.max(0, Math.min(100, Math.round(level * 100)));
	return [
		`<text class="case-print accent battery-label" x="${FACE.width / 2}" y="406" text-anchor="middle">10 YEAR BATTERY</text>`,
		`<text class="battery-value" x="${FACE.width / 2}" y="418" text-anchor="middle">${percent}%</text>`,
	].join('');
}

/** The amber backlight wash, drawn over everything while the LIGHT pusher is held. */
function renderIllumination(): string {
	return `<rect class="illumination" x="0" y="0" width="${FACE.width}" height="${FACE.height}" />`;
}

function bezelText(text: string, x: number, y: number, anchor: 'start' | 'middle' | 'end'): string {
	return `<text class="case-print accent bezel-text" x="${x}" y="${y}" text-anchor="${anchor}">${text}</text>`;
}

/** A rectangle with its corners clipped, as a path. */
function clippedRect(x: number, y: number, width: number, height: number, clip: number): string {
	const right = x + width;
	const bottom = y + height;
	return [
		`M ${x + clip} ${y}`,
		`L ${right - clip} ${y}`,
		`L ${right} ${y + clip}`,
		`L ${right} ${bottom - clip}`,
		`L ${right - clip} ${bottom}`,
		`L ${x + clip} ${bottom}`,
		`L ${x} ${bottom - clip}`,
		`L ${x} ${y + clip}`,
		'Z',
	].join(' ');
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

/** The stopwatch's capacity, re-exported so the preview can label its scenario honestly. */
export { STOPWATCH_LIMIT_MS };
