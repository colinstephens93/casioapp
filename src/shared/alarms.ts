/**
 * The five alarms and the hourly time signal.
 *
 * This module is pure data and pure arithmetic: no timers, no DOM, no Electron. The alarm *state*
 * machine lives in `machine.ts`; the *scheduling* lives in `controller.ts`. Keeping the three apart
 * is what lets "does alarm 3 fire at this instant?" be answered by a unit test with no clock at all.
 *
 * Two facts from the manual drive the whole design (docs/RESEARCH.md §4, "Alarms"):
 *
 * - There are exactly **five** alarms, each `Daily` or `One-time` or `Off`. The count is not a
 *   constant we chose; it is printed on the case (`5 ALARMS`) and asserted against that.
 * - An alarm is **a wall-clock hour and minute**, not an instant. "Daily 07:30" means 07:30 in the
 *   Home City, every day, forever — including across a DST change, which is why the comparison is
 *   done on Home City wall-clock fields rather than on UTC.
 *
 * Requirement ALM-1.
 */

/**
 * An alarm's armed state.
 *
 * `once` is not a separate flag from the time: the watch's One-time mode *is* the state, and
 * firing it turns the alarm off. Modelling it that way means there is no second field that could
 * disagree with the display.
 */
export type AlarmMode = 'daily' | 'once' | 'off';

/** The order `ADJUST` cycles through on an alarm screen (requirement ALM-3). */
export const ALARM_MODES: readonly AlarmMode[] = ['daily', 'once', 'off'];

/**
 * How many alarms the watch has. Derived from the printed case text, and asserted, rather than
 * being repeated as a literal in three places.
 */
export const ALARM_COUNT = 5;

export interface AlarmDef {
	/** 1..5, matching the number shown on the LCD. */
	readonly id: number;
	/** Hour in Home City wall-clock time, 0..23. */
	readonly hour: number;
	/** Minute, 0..59. */
	readonly minute: number;
	readonly mode: AlarmMode;
}

export interface Alarms {
	/** Always `ALARM_COUNT` entries. */
	readonly defs: readonly AlarmDef[];
	/** The hourly time signal (requirement ALM-9). */
	readonly signal: boolean;
}

/** Five alarms at 07:00, all off, and the hourly signal off — the watch's own power-on state. */
export function defaultAlarms(): Alarms {
	return {
		defs: Array.from({ length: ALARM_COUNT }, (_unused, index) => ({
			id: index + 1,
			hour: 7,
			minute: 0,
			mode: 'off' as AlarmMode,
		})),
		signal: false,
	};
}

/** The alarm carrying `id`, or undefined when the id is out of range. */
export function alarmById(alarms: Alarms, id: number): AlarmDef | undefined {
	return alarms.defs.find((def) => def.id === id);
}

/** Replaces one alarm, leaving the others untouched. */
export function withAlarm(alarms: Alarms, next: AlarmDef): Alarms {
	return { ...alarms, defs: alarms.defs.map((def) => (def.id === next.id ? next : def)) };
}

/** Moves an alarm through `daily -> once -> off -> daily`, as a press of ADJUST does (ALM-3). */
export function nextAlarmMode(mode: AlarmMode): AlarmMode {
	const index = ALARM_MODES.indexOf(mode);
	return ALARM_MODES[(index + 1) % ALARM_MODES.length] ?? 'off';
}

/** True when any alarm is armed, which is what lights the `ALM` indicator (requirement ALM-8). */
export function anyArmed(alarms: Alarms): boolean {
	return alarms.defs.some((def) => def.mode !== 'off');
}

/**
 * Home City wall-clock minutes-of-day for an alarm, for comparison against the clock.
 *
 * Kept as a named helper rather than inlined so the "minutes since midnight" convention has one
 * definition. `hour * 60 + minute` is exactly the kind of expression that gets written backwards.
 */
export function alarmMinuteOfDay(def: AlarmDef): number {
	return def.hour * 60 + def.minute;
}

/** True when the wall clock is inside the minute the alarm is set for. */
export function alarmDue(def: AlarmDef, homeWall: Date): boolean {
	if (def.mode === 'off') {
		return false;
	}
	return (
		homeWall.getUTCHours() === def.hour && homeWall.getUTCMinutes() === def.minute
	);
}

/**
 * The alarms that should fire as the clock crosses from `fromWall` into `toWall`.
 *
 * The comparison is done on **minute boundaries**, not on "is it that minute now". A caller that
 * asks "is alarm 3 due?" once a second would fire it sixty times; asking "did the wall clock
 * *enter* alarm 3's minute between these two readings?" fires it once, and is also correct when a
 * tick is late or the process was suspended (requirement PRS-5 — no accumulated ticks).
 *
 * Firing is deliberately *not* deduplicated against a stored "last fired" timestamp in here: the
 * crossing test already makes each minute fire at most once per call sequence, and a stored
 * timestamp would have to be persisted and repaired, which is one more thing to get wrong.
 */
export function alarmsEnteringMinute(alarms: Alarms, fromWall: Date, toWall: Date): AlarmDef[] {
	// Ordinary calendar arithmetic on the wall-clock fields. Deliberately *not* "minutes since the
	// epoch": a day is not always 1440 minutes, and on a spring-forward date an epoch-based
	// calculation silently shifts every alarm by an hour. The wall clock has already had the
	// offset applied, so its fields are the local date and time and need no further correction.
	const dayNumber = (wall: Date): number =>
		Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) / 86_400_000;
	const minuteOfDay = (wall: Date): number => wall.getUTCHours() * 60 + wall.getUTCMinutes();

	const fromDay = dayNumber(fromWall);
	const toDay = dayNumber(toWall);
	const fromMinute = minuteOfDay(fromWall);
	const toMinute = minuteOfDay(toWall);

	// A clock set backwards must yield nothing rather than firing every alarm in the table.
	if (toDay < fromDay || (toDay === fromDay && toMinute <= fromMinute)) {
		return [];
	}

	return alarms.defs.filter((def) => {
		if (def.mode === 'off') {
			return false;
		}
		const minute = alarmMinuteOfDay(def);
		// The range covers the tail of the first day and the head of the last one, and nothing
		// between: it is bounded by two readings of a real clock, not by an arbitrary window.
		const inFirstDay = minute > fromMinute;
		const inLastDay = toDay > fromDay && minute <= toMinute;
		return inFirstDay || inLastDay;
	});
}

/** Validation and repair for a stored alarm set (requirement PRS-4). */
export function repairAlarms(value: unknown): Alarms {
	const fallback = defaultAlarms();
	if (typeof value !== 'object' || value === null) {
		return fallback;
	}

	const source = value as { defs?: unknown; signal?: unknown };
	const signal = source.signal === true;
	const stored: readonly unknown[] = Array.isArray(source.defs) ? source.defs : [];

	// Slot by id rather than by position, so a reordered or gapped file still lands each alarm on
	// the screen number it names. A missing id keeps the default rather than shifting the rest.
	const defs = fallback.defs.map((def) => {
		const candidate = stored.find(
			(entry: unknown): entry is Partial<AlarmDef> =>
				typeof entry === 'object' &&
				entry !== null &&
				(entry as { id?: unknown }).id === def.id,
		);
		if (!candidate) {
			return def;
		}
		return {
			id: def.id,
			hour: isHour(candidate.hour) ? candidate.hour : def.hour,
			minute: isMinute(candidate.minute) ? candidate.minute : def.minute,
			mode: isAlarmMode(candidate.mode) ? candidate.mode : def.mode,
		};
	});

	return { defs, signal };
}

function isHour(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23;
}

function isMinute(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 59;
}

/** True for any of the three armed states. */
export function isAlarmMode(value: unknown): value is AlarmMode {
	return value === 'daily' || value === 'once' || value === 'off';
}

/**
 * Alarm screens, as `SEARCH` scrolls them: `1 2 3 4 5 SIG` (requirement ALM-2).
 *
 * The hourly signal is not an alarm and has no time, which is why the screens are modelled as a
 * list of slot numbers where `0` means the signal rather than as a sixth `AlarmDef` with a dummy
 * time that could be displayed by mistake.
 */
export const ALARM_SIGNAL_SLOT = 0;

/** The screens in order, ending with the hourly-signal slot. */
export function alarmScreens(): number[] {
	return [...Array.from({ length: ALARM_COUNT }, (_unused, index) => index + 1), ALARM_SIGNAL_SLOT];
}

/** The slot at a zero-based screen position, clamped rather than throwing on a bad index. */
export function alarmScreenAt(position: number): number {
	const screens = alarmScreens();
	return screens[((position % screens.length) + screens.length) % screens.length] ?? 1;
}

/**
 * The zero-based screen position carrying `slot`.
 *
 * The state stores a *position*, not a slot number, and the two are not interchangeable — an earlier
 * revision conflated them and the alarm screens advanced two at a time. Keeping the conversion in
 * one named function is what stops that recurring.
 */
export function alarmPosition(slot: number): number {
	const index = alarmScreens().indexOf(slot);
	return index === -1 ? 0 : index;
}

/** Moves a screen position by `step`, wrapping. `SEARCH` is +1, `LIGHT` is −1. */
export function stepAlarmPosition(position: number, step: number): number {
	const count = alarmScreens().length;
	return ((position + step) % count + count) % count;
}
