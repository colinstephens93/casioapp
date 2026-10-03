/**
 * The countdown timer.
 *
 * Pure state plus a **monotonic-instant** clock injected by the caller. There is no timer in here
 * and no `Date.now()`: every method takes the instant it should reason about. That is what makes a
 * 24-hour countdown testable in a millisecond, and it is also requirement NFR-5.
 *
 * ## Why the end is an absolute instant
 *
 * A countdown is the one piece of watch state that must survive the process dying. The plan's
 * decision 5 settles it: the timer stores the **absolute epoch time at which it will reach zero**,
 * not a remaining duration that a tick decrements. If the widget is quit for an hour mid-countdown
 * and restarted, the countdown is simply an hour further along, which is what a real timer does —
 * whereas a decremented duration would resume as if no time had passed. Requirement TMR-8.
 *
 * That also means a paused timer has no end at all: pausing converts the end instant back into a
 * remaining duration, because "paused" has to be immune to the passage of time as well.
 *
 * ## Why subtraction, not accumulation
 *
 * `remaining = endsAt - now`, recomputed from scratch on every read. Nothing is ever added to a
 * running total, so a late, early, doubled or missed tick cannot make the countdown wrong — it can
 * only make it stale, and only until the next read. This is the same reasoning that makes `Watch`
 * re-derive its state rather than accumulate elapsed time (PRS-5).
 *
 * Requirements TMR-1..TMR-8.
 */

/** One second, the timer's smallest settable value (TMR-1). */
export const TIMER_MIN_MS = 1_000;
/** 24 hours, the timer's largest settable value. */
export const TIMER_MAX_MS = 24 * 3_600_000;

/**
 * The three settable fields, in the order `MODE` moves through them (TMR-3).
 *
 * Not an enum: `erasableSyntaxOnly` is on, and enums emit code.
 */
export type TimerField = 'hours' | 'minutes' | 'seconds';

export const TIMER_FIELDS: readonly TimerField[] = ['hours', 'minutes', 'seconds'];

export interface TimerState {
	/**
	 * The duration the timer returns to when reset (TMR-5) or when it reaches zero (TMR-6).
	 *
	 * Held in milliseconds even though the watch sets it in whole hours, minutes and seconds: the
	 * display and the arithmetic then have one representation, and the 1/10 s display unit (TMR-2)
	 * falls out of it rather than needing a fourth field.
	 */
	readonly startMs: number;
	/** True while counting down. */
	readonly running: boolean;
	/**
	 * Absolute epoch milliseconds at which the countdown reaches zero. Only meaningful while
	 * `running`; `null` when paused or idle, because a paused timer must not be affected by time.
	 */
	readonly endsAt: number | null;
	/** Remaining milliseconds while paused. Ignores the clock completely. */
	readonly pausedMs: number;
	/**
	 * True once the countdown has reached zero and until the operator acknowledges it (TMR-6).
	 *
	 * The timer has already auto-reset to `startMs` at this point, and `fired` is what suppresses an
	 * immediate restart: reaching zero must not begin counting again (TMR-7).
	 */
	readonly fired: boolean;
}

/** The watch's power-on timer: 24 hours, stopped, at its start value. */
export function defaultTimer(): TimerState {
	return { startMs: TIMER_MAX_MS, running: false, endsAt: null, pausedMs: TIMER_MAX_MS, fired: false };
}

/** Clamps a duration into the settable range, in whole seconds (TMR-1). */
export function clampTimerMs(ms: number): number {
	const whole = Math.round(ms / 1000) * 1000;
	return Math.min(TIMER_MAX_MS, Math.max(TIMER_MIN_MS, whole));
}

/** The remaining milliseconds at `now`, without mutating anything. */
export function timerRemaining(state: TimerState, now: number): number {
	if (!state.running || state.endsAt === null) {
		return state.pausedMs;
	}
	return Math.max(0, state.endsAt - now);
}

/** True when a running countdown has reached zero. */
export function timerExpired(state: TimerState, now: number): boolean {
	return state.running && state.endsAt !== null && now >= state.endsAt;
}

/**
 * The countdown's display value, in milliseconds.
 *
 * The watch shows whole tenths and never shows a fractional count (`TMR-2`), so the value is
 * **rounded up** to the next tenth: at 1.05 s remaining it reads `1.1`, and it only reads `0.0` at
 * the instant it actually reaches zero. Truncating instead would show `0.0` for a tenth of a second
 * while the timer was still running, which reads as a stopped timer.
 */
export function timerDisplayMs(state: TimerState, now: number): number {
	const remaining = timerRemaining(state, now);
	return Math.ceil(remaining / 100) * 100;
}

/** Splits milliseconds into the four display fields: hours, minutes, seconds, tenths. */
export interface TimerParts {
	readonly hours: number;
	readonly minutes: number;
	readonly seconds: number;
	readonly tenths: number;
}

export function timerParts(ms: number): TimerParts {
	const total = Math.max(0, Math.round(ms / 100));
	const hours = Math.floor(total / 36_000);
	const minutes = Math.floor(total / 600) % 60;
	const seconds = Math.floor(total / 10) % 60;
	const tenths = total % 10;
	return { hours, minutes, seconds, tenths };
}

/**
 * The timer as the LCD shows it, e.g. `24H00'00.0`.
 *
 * At 24 hours the watch prints `24H` rather than `24:00` (TMR-1), so the literal `H` is part of the
 * face, not a formatting flourish — the glyph for it exists for this and for nothing else.
 */
export function formatTimer(ms: number): string {
	const { hours, minutes, seconds, tenths } = timerParts(ms);
	return `${String(hours).padStart(2, '0')}H${String(minutes).padStart(2, '0')}'${String(seconds).padStart(2, '0')}.${tenths}`;
}

/**
 * A countdown reduced to its hours, minutes and seconds, for the setting screen.
 *
 * The tenths are dropped deliberately: the watch sets whole seconds, and the setting screen shows
 * the value being edited rather than the countdown.
 */
export function timerSetParts(ms: number): TimerParts {
	return { ...timerParts(ms), tenths: 0 };
}

/** Starts, resumes, or pauses — what a press of `SEARCH` does (TMR-4). */
export function timerToggle(state: TimerState, now: number): TimerState {
	if (state.running) {
		return { ...state, running: false, endsAt: null, pausedMs: timerRemaining(state, now) };
	}
	// A zero or negative remainder would end the countdown on the same tick it started, so a
	// finished timer starts over from its full value rather than restarting instantly.
	const from = state.fired || state.pausedMs <= 0 ? state.startMs : state.pausedMs;
	return { ...state, running: true, endsAt: now + from, pausedMs: from, fired: false };
}

/**
 * Stops completely and returns to the start value — pause, then `ADJUST` (TMR-5).
 *
 * Idempotent, and deliberately *not* a toggle: the watch requires a pause first, so an accidental
 * press while running must do nothing rather than silently discard a countdown in progress.
 */
export function timerReset(state: TimerState): TimerState {
	if (state.running) {
		return state;
	}
	return { ...state, running: false, endsAt: null, pausedMs: state.startMs, fired: false };
}

/** Changes the set duration, which is also the value a reset returns to (TMR-1, TMR-3). */
export function timerSetStart(state: TimerState, ms: number): TimerState {
	const startMs = clampTimerMs(ms);
	// While stopped, the displayed value is the start value, so both move together. While running,
	// only the reset target changes: the countdown in flight is what the operator is watching.
	return state.running
		? { ...state, startMs }
		: { ...state, startMs, pausedMs: startMs, fired: false };
}

/**
 * Applies the elapsed-time effects of reaching zero.
 *
 * Returns the state with the countdown **auto-reset to its start value and stopped** (TMR-6) and
 * flagged as fired so nothing restarts it (TMR-7). The caller is responsible for raising the
 * alert, because the alarm lifecycle is shared with the alarms and lives in `machine.ts`.
 */
export function timerFire(state: TimerState): TimerState {
	return { ...state, running: false, endsAt: null, pausedMs: state.startMs, fired: true };
}

/**
 * Clears the `fired` flag once the operator has acknowledged the alarm.
 *
 * Kept separate from `timerFire` because the two happen at different times: the timer resets the
 * instant it hits zero, while the flag clears only when the 10-second alert ends or a button
 * silences it. Merging them would let a still-sounding alarm be restarted by a stray press.
 */
export function timerAcknowledge(state: TimerState): TimerState {
	return state.fired ? { ...state, fired: false } : state;
}

/** The value the setting screen edits, as whole hours/minutes/seconds, at a given instant. */
export function timerFieldValue(state: TimerState, field: TimerField, now: number): number {
	const parts = timerSetParts(timerRemaining(state, now));
	return field === 'hours' ? parts.hours : field === 'minutes' ? parts.minutes : parts.seconds;
}

/**
 * Increments or decrements one settable field.
 *
 * The fields are **not** a single duration split into parts, because they are not: `+1 hour` on a
 * timer of 1 minute must give 1 h 00 m 00 s, and one hour added to the millisecond total would give
 * 1 h 01 m 00 s instead. The watch adds to the field, so this does too (TMR-1, TMR-3).
 */
export function timerStepField(
	state: TimerState,
	field: TimerField,
	step: number,
	now: number,
): TimerState {
	const current = timerSetParts(timerRemaining(state, now));

	// Each field wraps within its own bounds rather than carrying into its neighbour: decrementing
	// the minutes of `01H00'00` gives `01H59'00`, which is how the watch behaves and is what someone
	// holding the button expects. Carrying would instead walk the whole duration down.
	const hours = field === 'hours' ? wrap(current.hours + step, 0, 24) : current.hours;
	const minutes = field === 'minutes' ? wrap(current.minutes + step, 0, 59) : current.minutes;
	const seconds = field === 'seconds' ? wrap(current.seconds + step, 0, 59) : current.seconds;

	// One second is the minimum settable duration (TMR-1), so a zero total snaps up to it rather
	// than being refused: the operator is holding a button, not typing a number.
	const total = Math.max(TIMER_MIN_MS, (hours * 3600 + minutes * 60 + seconds) * 1000);
	return timerSetStart(state, Math.min(TIMER_MAX_MS, total));
}

/**
 * Wraps `value` into `[low, high]`, both inclusive.
 *
 * Inclusive on purpose: the callers step *fields*, and a field's natural range is `0..59` for
 * minutes — sixty values, so `+1` on `59` must give `0`, not `60`. The bounds are the extremes the
 * field can hold.
 */
function wrap(value: number, low: number, high: number): number {
	const span = high - low + 1;
	return low + ((((value - low) % span) + span) % span);
}

/** Validation and repair for a stored timer (requirement PRS-3, PRS-4). */
export function repairTimer(value: unknown): TimerState {
	const fallback = defaultTimer();
	if (typeof value !== 'object' || value === null) {
		return fallback;
	}

	const source = value as Partial<TimerState>;
	const startMs =
		typeof source.startMs === 'number' && Number.isFinite(source.startMs)
			? clampTimerMs(source.startMs)
			: fallback.startMs;

	// The one case that matters: a stored *running* timer with an absolute end keeps counting down
	// across a restart (TMR-8). A stored running timer with no end is not worth trusting, so it
	// comes back paused at the start value instead.
	if (source.running === true && typeof source.endsAt === 'number' && Number.isFinite(source.endsAt)) {
		return { startMs, running: true, endsAt: source.endsAt, pausedMs: startMs, fired: false };
	}

	const pausedMs =
		typeof source.pausedMs === 'number' && Number.isFinite(source.pausedMs)
			? clampTimerMs(source.pausedMs)
			: startMs;

	return { startMs, running: false, endsAt: null, pausedMs, fired: false };
}
