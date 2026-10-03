/**
 * The stopwatch.
 *
 * Pure state plus an injected **monotonic** instant, exactly like the countdown timer — but with
 * one deliberate difference that the plan's decision 5 spells out: the stopwatch measures elapsed
 * time from a monotonic source (`performance.now()`), not from the wall clock. A wall-clock
 * adjustment, a DST shift or an NTP correction mid-run must not change how long something took.
 * `Date.now()` would. The caller therefore passes milliseconds from a monotonic origin, and this
 * module never converts to or from a calendar time.
 *
 * ## The three behaviours
 *
 * The manual describes one control layout that produces three different readings depending on the
 * order the buttons are pressed in (docs/RESEARCH.md §4, requirements SW-2..SW-5):
 *
 * - **Elapsed** — SEARCH start, SEARCH stop.
 * - **Split** — SEARCH start, ADJUST freezes the display, ADJUST releases it, SEARCH stop.
 * - **Two finishes** — as split, except SEARCH stops the watch while the display is still frozen,
 *   so the first finisher's time stays on screen and the second finisher's is taken at the stop.
 *
 * All three fall out of **three pieces of state**: how much time had accumulated before the current
 * run, when the current run began, and whether a split is frozen with the value it froze at. There
 * is no mode variable, because a mode variable could disagree with the facts.
 *
 * ## No lap memory
 *
 * There is deliberately nowhere to store a lap. Requirement SW-9 and out-of-scope item 2: the watch
 * has no lap memory, no counter and no recall, so a split is released, never banked. Adding a list
 * here would be building something the device does not have.
 *
 * Requirements SW-1..SW-10.
 */

/** 23 h 59 min 59.99 s — the stopwatch's capacity (SW-1). */
export const STOPWATCH_LIMIT_MS = 23 * 3_600_000 + 59 * 60_000 + 59_000 + 990;

export interface StopwatchState {
	/**
	 * Milliseconds banked by completed runs.
	 *
	 * On its own this is not the reading while the watch is running: the reading is this plus the
	 * run in progress. Keeping them separate is what makes pausing exact — pausing folds the
	 * current run into `banked` once, at the instant of the press.
	 */
	readonly banked: number;
	/** Monotonic instant the current run began, or `null` when stopped. */
	readonly startedAt: number | null;
	/**
	 * The value a frozen split displays, or `null` when the display is live.
	 *
	 * The *only* purpose of a split is to hold the display still, so it is one nullable number and
	 * not a mode. Releasing it sets this back to `null`, which is precisely requirement SW-7's
	 * "returns to elapsed time".
	 */
	readonly splitMs: number | null;
}

/** A stopwatch that has never been started: `00'00'00.00`. It is never persisted (SW-10). */
export function defaultStopwatch(): StopwatchState {
	return { banked: 0, startedAt: null, splitMs: null };
}

/** True while time is being counted. */
export function stopwatchRunning(state: StopwatchState): boolean {
	return state.startedAt !== null;
}

/**
 * Total elapsed time including the run in progress, before the 24-hour rollover.
 *
 * This is the honest elapsed time and can exceed the capacity; `stopwatchElapsedMs` applies the
 * rollover. Keeping both means the rollover can be reasoned about (and tested) as a pure function
 * of the raw value rather than as an accumulation of state changes.
 */
export function stopwatchRawMs(state: StopwatchState, now: number): number {
	const run = state.startedAt === null ? 0 : Math.max(0, now - state.startedAt);
	return state.banked + run;
}

/**
 * The elapsed time as displayed, after the 24-hour rollover.
 *
 * Requirement SW-8: at its limit the stopwatch **resets to zero and continues running** until it is
 * stopped. So the reading is the raw elapsed time modulo the capacity, and the count continues from
 * zero rather than stopping or latching at the maximum.
 *
 * This was wrong in the first draft, and wrong in the way that matters: it clamped instead of
 * wrapping (`Math.min(limit, raw)`), which reads correctly at the limit and is therefore easy to
 * believe — the reading reached `23'59'59.99` exactly as it should, and then stayed there forever
 * instead of rolling over. The test caught it because it asserted the value *past* the limit and not
 * only at it.
 */
export function stopwatchElapsedMs(state: StopwatchState, now: number): number {
	const raw = stopwatchRawMs(state, now);
	// A negative reading can only mean a clock that went backwards; reporting zero is better than
	// reporting a nonsensical figure.
	return Math.max(0, raw) % STOPWATCH_LIMIT_MS;
}

/**
 * How many times the reading has rolled over by `now`.
 *
 * Derived rather than stored: the rollover count is a function of the raw elapsed time, and a
 * stored counter is one more field that a restart or a missed tick could get wrong. It is what
 * makes the rollover survive a suspension — a process that slept through two whole capacities
 * reports the right number of wraps as soon as it reads the clock again.
 *
 * The first wrap happens as soon as the raw reading passes the capacity. The second happens a full
 * capacity after that, not a full capacity after the limit, which is why the numerator subtracts
 * the limit first.
 */
export function stopwatchWraps(state: StopwatchState, now: number): number {
	const raw = stopwatchRawMs(state, now);
	if (raw <= STOPWATCH_LIMIT_MS) {
		return 0;
	}
	return Math.floor((raw - STOPWATCH_LIMIT_MS) / STOPWATCH_LIMIT_MS) + 1;
}

/** The value on the LCD: a frozen split if there is one, otherwise the live elapsed time (SW-2). */
export function stopwatchDisplayMs(state: StopwatchState, now: number): number {
	return state.splitMs ?? stopwatchElapsedMs(state, now);
}

/**
 * `SEARCH`: start, stop, or re-start (SW-3..SW-5).
 *
 * Stopping **with a split frozen** is what produces the two-finish reading — the display keeps
 * showing the value it froze at, which is the first finisher's time, while `banked` holds the
 * second finisher's. Nothing extra needs to be recorded for that case.
 */
export function stopwatchSearch(state: StopwatchState, now: number): StopwatchState {
	if (state.startedAt !== null) {
		return { ...state, banked: stopwatchRawMs(state, now), startedAt: null };
	}
	return { ...state, startedAt: now };
}

/**
 * `ADJUST`: freeze a split, or release one (SW-4, SW-5).
 *
 * Freezing while stopped is a no-op, because a stopped stopwatch's display is already still — the
 * watch's ADJUST does nothing there either, and the way to clear is to press it a second time.
 */
export function stopwatchAdjust(state: StopwatchState, now: number): StopwatchState {
	if (state.splitMs !== null) {
		return { ...state, splitMs: null };
	}
	if (state.startedAt === null) {
		return state;
	}
	return { ...state, splitMs: stopwatchElapsedMs(state, now) };
}

/**
 * Clears the stopwatch back to zero (SW-3).
 *
 * Only meaningful while stopped: while running, ADJUST means "split", which is why this is a
 * separate entry point rather than being folded into `stopwatchAdjust`. The caller decides which
 * one a press means from the state it is in.
 */
export function stopwatchClear(state: StopwatchState): StopwatchState {
	return defaultStopwatch();
}

/**
 * The stopwatch reading as the LCD shows it, to `SW-1`'s resolution: `HH'MM'SS.CC`.
 *
 * The separator pattern follows the countdown timer's own `HH'MM'SS` habit rather than inventing a
 * third convention — the watch's cells hold an apostrophe and a period, and both are real glyphs on
 * the panel. The face draws the fields separately at different sizes, so this single-string form
 * exists for tests and for the accessible label, not as the drawing path.
 */
export function formatStopwatch(ms: number): string {
	const { hours, minutes, seconds, hundredths } = stopwatchParts(ms);
	const pad = (value: number, width: number): string => String(value).padStart(width, '0');
	return `${pad(hours, 2)}'${pad(minutes, 2)}'${pad(seconds, 2)}.${pad(hundredths, 2)}`;
}

/** The reading split into the fields the face draws separately, so the layout can size them apart. */
export interface StopwatchParts {
	readonly hours: number;
	readonly minutes: number;
	readonly seconds: number;
	readonly hundredths: number;
}

export function stopwatchParts(ms: number): StopwatchParts {
	const totalHundredths = Math.floor(Math.max(0, Math.min(STOPWATCH_LIMIT_MS, ms)) / 10);
	const hundredths = totalHundredths % 100;
	const totalSeconds = Math.floor(totalHundredths / 100);
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60, seconds, hundredths };
}
