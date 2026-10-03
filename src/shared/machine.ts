/**
 * The mode and sub-mode state machine.
 *
 * This is the file that decides what every pusher does on every screen. It is a **pure reducer**:
 * `reduce(state, event, now)` returns a new state and touches nothing. There are no timers, no DOM
 * and no persistence here, which is the whole reason the project's §6 gestures can be tested
 * exhaustively rather than demonstrated by hand.
 *
 * ## Screens, and why "three modes" is a lie the code should not tell
 *
 * Requirement MOD-1 says MODE cycles Timekeeping → World Time → Alarm → Countdown Timer →
 * Stopwatch. The manual and the research (§3) say the watch has only **three** modes and that the
 * timer and stopwatch are screens inside the cycle. Both are true and they are not in conflict: the
 * cycle a user experiences has five stops.
 *
 * What follows from the manual's version is the part that matters: **SEARCH moves within a mode**,
 * not around the cycle. Inside Timekeeping it walks T-1…T-4; inside Alarm it walks alarms 1…5 and
 * the hourly signal; inside World Time it walks cities. So a screen index is kept per mode, and
 * `screenIndex` for the current mode is the only one that changes when SEARCH is pressed.
 *
 * The stopwatch and the countdown are the exceptions, because neither has anything to walk: SEARCH
 * means *start* and *stop* there, and the screen index is pinned at zero.
 *
 * Requirements MOD-1..MOD-6, WLD-1..WLD-5, ALM-1..ALM-9, TMR-1..TMR-8, SW-1..SW-10, TIM-3..TIM-11.
 */
import {
	type AlarmDef,
	type Alarms,
	alarmById,
	alarmScreenAt,
	alarmsEnteringMinute,
	nextAlarmMode,
	stepAlarmPosition,
	withAlarm,
	ALARM_SIGNAL_SLOT,
} from './alarms.ts';
import { catalogueZones } from './catalog.ts';
import {
	type TimerField,
	type TimerState,
	TIMER_FIELDS,
	defaultTimer,
	clampTimerMs,
	timerAcknowledge,
	timerFire,
	timerRemaining,
	timerReset,
	timerSetParts,
	timerStepField,
	timerToggle,
} from './timer.ts';
import {
	type StopwatchState,
	defaultStopwatch,
	stopwatchAdjust,
	stopwatchClear,
	stopwatchRunning,
	stopwatchSearch,
} from './stopwatch.ts';
import type { Pusher } from './gestures.ts';
import { type Clock, type DstMode, DST_MODES } from './time.ts';

export type ScreenMode = 'timekeeping' | 'worldtime' | 'alarm' | 'timer' | 'stopwatch';

/**
 * The MODE cycle, in order (requirement MOD-1).
 *
 * The order is asserted against this array rather than against a chain of `if`s, so the cycle can
 * be checked for completeness — every mode appears exactly once — by a test over the array itself.
 */
export const MODE_CYCLE: readonly ScreenMode[] = [
	'timekeeping',
	'worldtime',
	'alarm',
	'timer',
	'stopwatch',
];

/** A T-n register: the zone assigned to it, and its own DST override. */
export interface Slot {
	readonly zone: string;
	readonly dst: DstMode;
}

/**
 * An alert that is currently sounding.
 *
 * The alarm lifecycle is shared: an alarm, the countdown reaching zero and a test alarm all sound
 * for ten seconds and all stop on any button (ALM-7, TMR-6). Modelling them as one `Alert` rather
 * than as a flag per source means the "sounds for ten seconds" rule and the "any button stops it"
 * rule exist once.
 */
export interface Alert {
	readonly kind: 'alarm' | 'timer' | 'test';
	/** For `alarm`, which alarm; for the others, undefined. */
	readonly alarmId?: number;
	/** Absolute epoch milliseconds at which the alert silences itself. */
	readonly endsAt: number;
}

/**
 * Which field the setting screen is flashing, and the screen it belongs to.
 *
 * Deliberately a union rather than a string plus a magic prefix, so the setter for each field is
 * found by the compiler rather than by reading a naming convention.
 */
export type Edit =
	| { readonly kind: 'timekeeping'; readonly field: TimekeepingField }
	| { readonly kind: 'alarm'; readonly alarmId: number; readonly field: AlarmField }
	| { readonly kind: 'timer'; readonly field: TimerField }
	| { readonly kind: 'worldtime'; readonly field: 'city' | 'dst' };

/** The Timekeeping setting order, exactly as TIM-5 lists it. */
export const TIMEKEEPING_FIELDS = [
	'seconds',
	'city',
	'dst',
	'hour',
	'minutes',
	'clock',
	'year',
	'month',
	'day',
	'illumination',
] as const;

export type TimekeepingField = (typeof TIMEKEEPING_FIELDS)[number];

/** The alarm setting order: Hour, Minutes, then the one-time/daily selector (ALM-4). */
export const ALARM_FIELDS = ['hour', 'minutes', 'schedule'] as const;
export type AlarmField = (typeof ALARM_FIELDS)[number];

/**
 * The three positions of an alarm's schedule field.
 *
 * Only two are shown on the LCD — `1TIME` and `DAILY` — but Off is a position the field passes
 * through, because the watch's schedule selector is the same three-state value the alarm screen
 * cycles. Skipping it here would make the setting screen disagree with the alarm screen.
 */
export const ALARM_SCHEDULES = ['once', 'daily', 'off'] as const;
export type AlarmSchedule = (typeof ALARM_SCHEDULES)[number];

/** Editable date fields, for the setting screen's year/month/day. */
export interface EditDate {
	readonly year: number;
	readonly month: number;
	readonly day: number;
}

export interface MachineState {
	readonly mode: ScreenMode;
	/**
	 * The sub-screen each mode is showing.
	 *
	 * All five are kept, not just the current one, because requirements MOD-4 and MOD-6 both
	 * demand that a mode you leave comes back the way you left it — the last alarm you looked at,
	 * the last city, the register.
	 */
	readonly screenIndex: Readonly<Record<ScreenMode, number>>;
	readonly clock: Clock;
	/** Which Multi Time register Timekeeping is showing, 1..4. */
	readonly register: number;
	/** The T-1..T-4 registers. Index 0 is the Home City. */
	readonly slots: readonly Slot[];
	/** The World Time city, as an index into `catalogueZones()`. */
	readonly worldIndex: number;
	readonly alarms: Alarms;
	readonly timer: TimerState;
	readonly stopwatch: StopwatchState;
	readonly muted: boolean;
	/** Selected illumination duration: 1.5 s or 3 s (requirement LIT-2). */
	readonly illuminationMs: number;
	/** The setting screen, when one is open (TIM-4, ALM-4, TMR-3). */
	readonly edit: Edit | null;
	/** The date being edited, held separately from the clock so cancelling cannot corrupt it. */
	readonly editDate: EditDate | null;
	/** Transient: the `T-n` indicator replaces the city code for ~1 s after the register changes. */
	readonly registerChangedAt: number | null;
	/** Auto Display: the display cycles through the registers by itself (TIM-11). */
	readonly autoDisplay: boolean;
	/** The alert currently sounding, if any. */
	readonly alert: Alert | null;
	/** The last instant a button was pressed, for MOD-5's auto-return. */
	readonly lastInteractionAt: number;
	/** True while the amber backlight is lit. */
	readonly illuminated: boolean;
	/**
	 * Set while the `SEARCH` field that resets the seconds has just been pressed (TIM-7, TIM-8).
	 *
	 * The *reset itself* cannot happen here: the clock is the system clock, and this machine is a
	 * pure reducer over `Date`s it does not own. So the request is recorded and the controller —
	 * which is the only thing that may move the clock — acts on it and clears the flag. Modelling it
	 * as a request rather than as a silent no-op keeps the gesture observable and testable.
	 */
	readonly secondReset: boolean;
	/**
	 * The alarm minute that has already fired, so it cannot fire again within the same minute.
	 *
	 * Both fields are in **Home City wall-clock** time, not epoch time, because that is the only time
	 * base the alarm logic has: an alarm is a wall-clock hour and minute, and the comparison that
	 * finds it is a wall-clock comparison. Mixing the epoch `at` in here would have compared two
	 * unrelated clocks — which is exactly the bug the first draft of this field had.
	 *
	 * `at` is the minute's own wall-clock key and `until` is the wall-clock instant at which the
	 * minute ends, so a wall clock that jumps backwards or forwards still releases the block.
	 *
	 * Deliberately **not** persisted: an alarm that fired is an event in the past, and after a
	 * restart the clock is where it is. A stale block would suppress a legitimate firing.
	 */
	readonly lastFiredMinute: { readonly at: number; readonly until: number } | null;
	/**
	 * When Auto Display last moved the register, so it steps on a cadence rather than on every tick.
	 *
	 * Held as an instant rather than a countdown for the same reason as everything else here: a
	 * suspended process must resume the cycle in the right place, not restart it.
	 */
	readonly lastAutoStepAt: number;
}

/** How long the `T-n` register indicator replaces the city code (requirement MOD-3). */
export const REGISTER_INDICATOR_MS = 1000;

/** How long an alarm or the countdown sounds before silencing itself (ALM-7, TMR-6). */
export const ALERT_MS = 10_000;

/**
 * Auto-return to Timekeeping after this much idle time (requirement MOD-5).
 *
 * The requirement says "2–3 minutes" because that is the range the manual gives. The lower bound is
 * used: a widget that is still showing the alarm screen three minutes after the last touch is worse
 * than one that returns a few seconds early, and the operator can always press MODE again.
 */
export const IDLE_RETURN_MS = 120_000;

/** The two selectable illumination durations (requirement LIT-2). */
export const ILLUMINATION_MS = [1500, 3000] as const;

/** Current and next illumination duration, for the setting screen's toggle. */
export function nextIlluminationMs(current: number): number {
	return current === ILLUMINATION_MS[0] ? ILLUMINATION_MS[1] : ILLUMINATION_MS[0];
}

/** Everything the machine needs that is not part of its own state. */
export interface MachineInit {
	readonly slots: readonly Slot[];
	readonly clock: Clock;
	readonly register: number;
	readonly worldIndex: number;
	readonly alarms: Alarms;
	readonly timer: TimerState;
	readonly muted: boolean;
	readonly illuminationMs: number;
	readonly mode: ScreenMode;
	readonly screenIndex: Record<ScreenMode, number>;
}

export function defaultScreenIndex(): Record<ScreenMode, number> {
	return { timekeeping: 0, worldtime: 0, alarm: 0, timer: 0, stopwatch: 0 };
}

export function initialMachineState(init: MachineInit, now: number): MachineState {
	return {
		mode: init.mode,
		screenIndex: init.screenIndex,
		clock: init.clock,
		register: init.register,
		slots: init.slots,
		worldIndex: init.worldIndex,
		alarms: init.alarms,
		timer: init.timer,
		stopwatch: defaultStopwatch(),
		muted: init.muted,
		illuminationMs: init.illuminationMs,
		edit: null,
		editDate: null,
		registerChangedAt: null,
		autoDisplay: false,
		alert: null,
		lastInteractionAt: now,
		illuminated: false,
		secondReset: false,
		lastFiredMinute: null,
		lastAutoStepAt: now,
	};
}

/** A default machine, used by tests and by the preview before any stored config exists. */
export function defaultMachineState(now: number, zone: string): MachineState {
	return initialMachineState(
		{
			slots: [
				{ zone, dst: 'off' },
				{ zone, dst: 'off' },
				{ zone, dst: 'off' },
				{ zone, dst: 'off' },
			],
			clock: '24h',
			register: 1,
			worldIndex: 0,
			alarms: { defs: [], signal: false },
			timer: defaultTimer(),
			muted: false,
			illuminationMs: ILLUMINATION_MS[0],
			mode: 'timekeeping',
			screenIndex: defaultScreenIndex(),
		},
		now,
	);
}

/* -------------------------------------------------------------------------------------------- */
/* Events                                                                                        */
/* -------------------------------------------------------------------------------------------- */

/**
 * The machine's input.
 *
 * `hold` carries which hold it is, because the same pusher means different things at 1 s, 2 s and
 * 3 s and the *duration* is the discriminator. Passing the duration rather than three separate
 * event kinds keeps the reducer's switch to one arm per pusher.
 */
export type MachineEvent =
	| { readonly kind: 'press'; readonly pusher: Pusher; readonly at: number }
	| { readonly kind: 'hold'; readonly pusher: Pusher; readonly at: number; readonly ms: number }
	| { readonly kind: 'repeat'; readonly pusher: Pusher; readonly at: number }
	| { readonly kind: 'chord'; readonly chord: 'adjust+light'; readonly at: number }
	| { readonly kind: 'release'; readonly pusher: Pusher; readonly at: number }
	/** A regular cadence tick, which also advances the clock's own consequences. */
	| { readonly kind: 'tick'; readonly at: number; readonly homeWall: Date }
	/**
	 * The seconds field's reset request has been carried out, so the flag comes back down.
	 *
	 * Emitted by the controller immediately after it applies the reset — the two are separate events
	 * because only the controller may touch the clock, and a flag that cleared itself would be a
	 * side effect inside a function that is supposed to have none.
	 */
	| { readonly kind: 'second-reset-applied' };

/* -------------------------------------------------------------------------------------------- */
/* The reducer                                                                                   */
/* -------------------------------------------------------------------------------------------- */

export interface ReduceContext {
	/**
	 * Home City wall clock at `at`, as a `Date` whose UTC fields are local fields.
	 *
	 * Passed in rather than computed here for two reasons: it keeps this module free of `Intl` so it
	 * stays trivially testable, and it makes the alarms' Home-City-time comparison explicit instead
	 * of a hidden dependency.
	 */
	readonly homeWall: Date;
	/**
	 * Home City wall clock at the **previous** tick, for the alarm crossing test.
	 *
	 * Supplied by the caller rather than reconstructed here by subtracting a nominal cadence,
	 * because the two are not the same thing: the controller may tick late, early, or after the
	 * process was suspended, and only it knows the instant it last ran. An alarm due in the gap is
	 * found either way, which is what requirement PRS-5's "no accumulated ticks" is for.
	 *
	 * Absent on a gesture, where there is no previous reading to compare against.
	 */
	readonly previousHomeWall?: Date;
}

/**
 * The whole state machine, as one function.
 *
 * Every branch returns a *new* state; nothing is mutated. That is what lets a test hold two
 * versions of the machine and compare them — which is how "a forced DST change moves the digits,
 * the band and the marker together" is asserted rather than assumed.
 */
export function reduce(
	state: MachineState,
	event: MachineEvent,
	context: ReduceContext,
): MachineState {
	// Any button cancels Auto Display and counts as interaction for the idle timer (TIM-11, MOD-5).
	const touched = touchedBy(event);
	let base: MachineState = touched
		? { ...state, autoDisplay: false, lastInteractionAt: event.at }
		: state;

	// A sounding alert is silenced by any button (ALM-7, TMR-6) — but silencing is a *side effect*,
	// not the button's whole meaning.
	//
	// An earlier revision returned here, which meant the press that silenced an alarm did nothing
	// else. On the watch every button both stops the sound and does its own job, and the difference
	// is observable: holding SEARCH fires the test alarm, and holding it a second time would silence
	// that alarm while leaving Auto Display off. The event falls through to its handler below.
	if (base.alert && touched) {
		base = silence({ ...base, alert: null });
	}

	switch (event.kind) {
		case 'tick':
			return tick(base, event.at, context);
		case 'press':
			return press(base, event.pusher, event.at, context);
		case 'hold':
			return hold(base, event.pusher, event.at, event.ms, context);
		case 'repeat':
			return repeat(base, event.pusher, event.at, context);
		case 'chord':
			return promote(base);
		case 'release':
			// A release carries no action of its own: the press and the hold already did. It exists
			// so the face can drop its pressed state, and for callers that time the gesture.
			return base;
		case 'second-reset-applied':
			return base.secondReset ? { ...base, secondReset: false } : base;
		default:
			return base;
	}
}

/**
 * The events a pusher produced, as opposed to the clock's own ticks.
 *
 * A `release` is deliberately **not** one of them. The watch stops a sounding alarm on a press, and
 * treating the inevitable release that follows as a second press would silence an alarm the
 * operator had only just triggered — the test alarm on `SEARCH` hold is exactly that case.
 */
type PusherEvent = Extract<MachineEvent, { at: number; kind: 'press' | 'hold' | 'repeat' | 'chord' }>;

function touchedBy(event: MachineEvent): event is PusherEvent {
	return (
		event.kind === 'press' ||
		event.kind === 'hold' ||
		event.kind === 'repeat' ||
		event.kind === 'chord'
	);
}

/**
 * The `fired` flag on the timer is cleared when its alert ends, not when the countdown reaches zero.
 *
 * Split out because it is the *only* thing an alert ending does beyond clearing the alert itself,
 * and forgetting it would leave a finished countdown unable to start again.
 */
function silence(state: MachineState): MachineState {
	return { ...state, timer: timerAcknowledge(state.timer) };
}

/* -------------------------------------------------------------------------------------------- */
/* The clock                                                                                     */
/* -------------------------------------------------------------------------------------------- */

/**
 * A tick does three things: retires an expired alert, fires any alarm whose minute the Home City
 * clock has just entered, and — only if the countdown is running — notices that it has reached zero.
 *
 * The alarm test is a **crossing** test between two readings of a real clock, not a "is it that
 * minute now?" test. The second question, asked once a second, fires each alarm sixty times; the
 * first asks whether the clock *entered* the alarm's minute between the previous reading and this
 * one, which is both correct and correct when the reading is late.
 *
 * The previous reading arrives in the context rather than being reconstructed here by subtracting a
 * nominal cadence, because only the caller knows when it last ran: the cadence varies by screen and
 * a suspended process may not have run for minutes.
 */
function tick(state: MachineState, at: number, context: ReduceContext): MachineState {
	let next = state;

	// 1. An expired alert stops on its own.
	if (next.alert && at >= next.alert.endsAt) {
		next = silence({ ...next, alert: null });
	}

	// 2. The countdown reaching zero: fire, alert, and auto-reset in one step (TMR-6).
	if (
		next.timer.running &&
		next.timer.endsAt !== null &&
		at >= next.timer.endsAt &&
		next.alert === null
	) {
		next = {
			...next,
			timer: timerFire(next.timer),
			alert: { kind: 'timer', endsAt: at + ALERT_MS },
		};
	}

	// 3. Alarms whose minute the Home City clock has just entered.
	//
	// Two separate guards, and both are needed.
	//
	// The **range** (from the previous reading to this one) is what makes a late or suspended tick
	// still find the alarm it slept through, and what stops a tick that merely *sits inside* the
	// alarm's minute from firing it sixty times a minute.
	//
	// The **minute key** is what stops it firing again on the *next* tick, one second later: the
	// previous reading is then already inside the minute, so the range test alone would report it
	// again on every tick until the minute elapsed. Only alarms in the range whose minute is not the
	// one that last fired are considered.
	const previousWall = context.previousHomeWall ?? new Date(context.homeWall.getTime() - TICK_MS);
	const minuteKey = Date.UTC(
		context.homeWall.getUTCFullYear(),
		context.homeWall.getUTCMonth(),
		context.homeWall.getUTCDate(),
		context.homeWall.getUTCHours(),
		context.homeWall.getUTCMinutes(),
	);
	const blocked =
		next.lastFiredMinute !== null && context.homeWall.getTime() < next.lastFiredMinute.until;

	const due = blocked
		? []
		: alarmsEnteringMinute(next.alarms, previousWall, context.homeWall);
	const first = due[0];
	if (first) {
		// The alert lasts ten seconds, but the *minute* is blocked until it passes entirely — or an
		// alarm firing at 07:30:05 would fire again at 07:30:15, once its first alert had expired.
		const until = minuteKey + 60_000;
		const firedNext: MachineState = {
			...next,
			alarms: disarmOneTime(next.alarms, first),
			lastFiredMinute: { at: minuteKey, until },
		};
		// An alert already sounding is not replaced — but the one-time alarm is still disarmed and
		// the minute still blocked, so a firing is never repeated or lost.
		next =
			next.alert === null
				? { ...firedNext, alert: { kind: 'alarm', alarmId: first.id, endsAt: at + ALERT_MS } }
				: firedNext;
	}

	// 4. Auto-return to Timekeeping after two minutes of nothing (MOD-5).
	if (next.mode !== 'timekeeping' && at - next.lastInteractionAt >= IDLE_RETURN_MS) {
		next = { ...next, mode: 'timekeeping', edit: null, autoDisplay: false };
	}

	// 5. Auto Display: the display cycles the registers by itself (TIM-11).
	//
	// It only runs on the Timekeeping screen and only while enabled, and it is driven from here
	// rather than from its own interval so that it stops the moment *anything* else happens — the
	// requirement is that any button turns it off, and a separate timer would have to be cancelled
	// from a dozen places to achieve that.
	if (next.autoDisplay && next.mode === 'timekeeping' && !next.edit) {
		const elapsed = at - next.lastAutoStepAt;
		if (elapsed >= AUTO_DISPLAY_STEP_MS) {
			// The register advances by however many whole steps have passed, so a suspended process
			// resumes the cycle rather than lagging behind it — the same reasoning as the stopwatch's
			// derived rollover.
			const steps = Math.floor(elapsed / AUTO_DISPLAY_STEP_MS);
			const count = Math.max(1, next.slots.length);
			const register = ((next.register - 1 + steps) % count + count) % count + 1;
			next = {
				...next,
				register,
				registerChangedAt: next.lastAutoStepAt + steps * AUTO_DISPLAY_STEP_MS,
				lastAutoStepAt: next.lastAutoStepAt + steps * AUTO_DISPLAY_STEP_MS,
			};
		}
	}

	return next;
}

/**
 * How long Auto Display holds each register before moving to the next (TIM-11).
 *
 * Two seconds, which is the watch's own cadence as closely as the research could establish it. It
 * has to be longer than the `T-n` indicator's one second (MOD-3) or the indicator would never clear.
 */
export const AUTO_DISPLAY_STEP_MS = 2000;

/**
 * How often the machine is ticked by its controller.
 *
 * 50 ms is chosen by the *finest* consumer, not the coarsest: the stopwatch displays hundredths, so
 * anything slower than 10 ms would visibly quantise it. 50 ms still updates a hundredths field more
 * than fast enough to read, and it is twenty ticks a second rather than a hundred — which matters,
 * because NFR-4 caps idle CPU at half a percent of one core.
 */
export const TICK_MS = 50;

/**
 * Turns a one-time alarm off once it has fired (ALM-1, ALM-3).
 *
 * A daily alarm is left armed; a one-time alarm is not, which is the entire difference between the
 * two. This is where "one-time" is implemented — there is no date field on the watch and no
 * comparison to a stored date, only this.
 */
function disarmOneTime(alarms: Alarms, def: AlarmDef): Alarms {
	return def.mode === 'once' ? withAlarm(alarms, { ...def, mode: 'off' }) : alarms;
}

/* -------------------------------------------------------------------------------------------- */
/* Buttons                                                                                       */
/* -------------------------------------------------------------------------------------------- */

function press(
	state: MachineState,
	pusher: Pusher,
	at: number,
	context: ReduceContext,
): MachineState {
	// A setting screen owns every button while it is open (TIM-6, ALM-4, TMR-3).
	if (state.edit) {
		return editPress(state, pusher, at, context);
	}

	switch (pusher) {
		case 'mode':
			return leaveMode({ ...state, mode: nextMode(state.mode) }, state.mode);
		case 'light':
			// LIGHT does two things at once, and the manual is explicit about both: it lights the LCD
			// (LIT-1) *and* it is the decrement key. Which screens decrement is the same set that
			// decrements on a repeat, so the routing lives in one place — `lightPress`.
			return lightPress(state, at);
		case 'search':
			return searchPress(state, at);
		case 'adjust':
			return adjustPress(state, at);
		default:
			return state;
	}
}

/**
 * A `LIGHT` press.
 *
 * The illumination itself is the controller's, because it is a timed effect and the machine owns no
 * clock; all the machine records is that the LCD is lit, so the face can draw the wash. What happens
 * here is the *other* half — the decrement, on the three screens that scroll.
 *
 * This was a real bug in the first draft: the press only set `illuminated`, so `SEARCH` scrolled
 * eastward while `LIGHT` did nothing, and the only way west was a repeat. The machine's own test
 * caught it, because it asserted the wrap in both directions rather than only the one the manual
 * names first.
 */
function lightPress(state: MachineState, at: number): MachineState {
	switch (state.mode) {
		case 'worldtime':
			return stepWorld({ ...state, illuminated: true }, -1);
		case 'alarm':
			return { ...stepAlarmScreen(state, -1), illuminated: true };
		case 'timekeeping':
			return { ...stepRegister(state, -1, at), illuminated: true };
		default:
			return { ...state, illuminated: true };
	}
}

/**
 * Leaving a mode: the one transition that a button press cannot express.
 *
 * Requirement SW-7 — "leaving the stopwatch while a split is frozen clears the split and returns to
 * elapsed time" — is a rule about *departure*, not about any particular button, so it lives here
 * rather than inside the SEARCH or ADJUST handler. Putting it in a press handler would make it
 * happen only when the operator left in one particular way.
 */
function leaveMode(state: MachineState, from: ScreenMode): MachineState {
	if (from !== 'stopwatch' || state.stopwatch.splitMs === null) {
		return state;
	}
	// The elapsed time underneath is untouched: only the frozen display is released.
	return { ...state, stopwatch: { ...state.stopwatch, splitMs: null } };
}

/**
 * A hold, dispatched on the pusher and the duration.
 *
 * The durations here are the half of INT-5 that the gesture reader cannot decide on its own: it
 * reports *how long*, and the machine knows *what for*. `ADJUST` at 1 s is the setting screen,
 * `ADJUST` at 2 s on T-2..T-4 is the city picker, `SEARCH` at 3 s is Auto Display — and none of
 * those are interchangeable, which is why the thresholds are per-pusher and per-screen.
 */
function hold(
	state: MachineState,
	pusher: Pusher,
	at: number,
	ms: number,
	context: ReduceContext,
): MachineState {
	switch (pusher) {
		case 'mode':
			// Requirement MUT-1. The manual is explicit that the mode also changes, because that is
			// what any MODE press does — but only on a *short* press. A hold toggles the tone and
			// nothing else, which is what the second half of the manual's sentence implies and what
			// makes the gesture usable at all.
			return { ...state, muted: !state.muted };
		case 'search':
			if (state.mode === 'alarm' && !state.edit) {
				return { ...state, alert: { kind: 'test', endsAt: at + ALERT_MS } };
			}
			if (state.mode === 'timekeeping' && !state.edit) {
				// Requirement TIM-11. Deliberately not gated on the register being T-1: the *press*
				// half of this same gesture already advanced the register by the time the hold is
				// recognised, so a T-1 gate would make the feature unreachable from T-1 — which is
				// precisely what the controller's test caught. Auto Display cycles the registers by
				// definition, so starting it from whichever one is showing is the coherent reading.
				//
				// The cycle's clock starts here, so the register the operator is looking at holds for
				// its full interval rather than stepping the instant the hold lands.
				return { ...state, autoDisplay: true, lastAutoStepAt: at };
			}
			return state;
		case 'adjust':
			return adjustHold(state, at, ms, context);
		case 'light':
			return state;
		default:
			return state;
	}
}

/**
 * A repeat, which is what a held scrolling pusher emits (WLD-1, ALM-2).
 *
 * Only the three scrolling screens have anything to repeat. On the others a repeat is ignored
 * rather than being routed to the press handler, because a press would be wrong: repeatedly
 * toggling the timer's start/stop at eleven times a second is not a gesture the watch has.
 */
function repeat(
	state: MachineState,
	pusher: Pusher,
	at: number,
	context: ReduceContext,
): MachineState {
	if (state.edit) {
		return editRepeat(state, pusher, at, context);
	}

	if (pusher === 'search') {
		switch (state.mode) {
			case 'worldtime':
				return stepWorld(state, 1);
			case 'alarm':
				return stepAlarmScreen(state, 1);
			case 'timekeeping':
				return stepRegister(state, 1, at);
			default:
				return state;
		}
	}

	if (pusher === 'light' && state.mode === 'worldtime') {
		return stepWorld(state, -1);
	}
	if (pusher === 'light' && state.mode === 'alarm') {
		return stepAlarmScreen(state, -1);
	}
	if (pusher === 'light' && state.mode === 'timekeeping') {
		return stepRegister(state, -1, at);
	}

	return state;
}

/**
 * Moves the Alarm screen to the next or previous slot (ALM-2).
 *
 * The state stores a **position**, not a slot number: the screens are `1 2 3 4 5 SIG` and the signal
 * is not an alarm, so a slot-number field would need a special case for it everywhere it was read.
 */
function stepAlarmScreen(state: MachineState, step: number): MachineState {
	const position = stepAlarmPosition(state.screenIndex.alarm, step);
	return { ...state, screenIndex: { ...state.screenIndex, alarm: position } };
}

/**
 * A `SEARCH` press.
 *
 * Its meaning is entirely a function of the screen, which is the manual's model: "press D to
 * scroll, or to start, or to increment, depending on where you are".
 */
function searchPress(state: MachineState, at: number): MachineState {
	switch (state.mode) {
		case 'timekeeping':
			return stepRegister(state, 1, at);
		case 'worldtime':
			return stepWorld(state, 1);
		case 'alarm':
			return stepAlarmScreen(state, 1);
		case 'timer':
			return { ...state, timer: timerToggle(state.timer, at) };
		case 'stopwatch':
			return { ...state, stopwatch: stopwatchSearch(state.stopwatch, at) };
		default:
			return state;
	}
}

/**
 * An `ADJUST` press: T-1's transient register flash (TIM-3), the alarm screen's schedule cycle
 * (ALM-3), the hourly signal's toggle (ALM-9), and the stopwatch's split or clear (SW-3..SW-5).
 */
function adjustPress(state: MachineState, at: number): MachineState {
	switch (state.mode) {
		case 'timekeeping':
			// TIM-3: on T-1, and only on T-1, a press briefly replaces the day/date field with the
			// Home City code and `T-1`. On the other registers the code is already showing.
			return state.register === 1 ? { ...state, registerChangedAt: at } : state;

		case 'alarm': {
			const slot = alarmSlot(state);
			if (slot === ALARM_SIGNAL_SLOT) {
				return { ...state, alarms: { ...state.alarms, signal: !state.alarms.signal } };
			}
			const def = alarmById(state.alarms, slot);
			if (!def) {
				return state;
			}
			return { ...state, alarms: withAlarm(state.alarms, { ...def, mode: nextAlarmMode(def.mode) }) };
		}

		case 'stopwatch':
			// Running means "split"; stopped means "clear". The two are the same button because the
			// watch has only four, and which one applies is read from the state (SW-3, SW-4).
			return {
				...state,
				stopwatch: stopwatchRunning(state.stopwatch)
					? stopwatchAdjust(state.stopwatch, at)
					: stopwatchClear(state.stopwatch),
			};

		case 'timer':
			// Pause, then ADJUST, returns the countdown to its start value (TMR-5).
			return { ...state, timer: timerReset(state.timer) };

		default:
			return state;
	}
}

/**
 * An `ADJUST` hold.
 *
 * The duration decides between the two entry points the watch has — the setting screen at 1 s and
 * the Local Time city picker at 2 s — and World Time has a third meaning entirely (WLD-2).
 */
function adjustHold(
	state: MachineState,
	at: number,
	ms: number,
	context: ReduceContext,
): MachineState {
	if (state.edit) {
		return editPress(state, 'adjust', at, context);
	}

	if (state.mode === 'worldtime') {
		// Requirement WLD-2, WLD-3: DST for the displayed city only, and never for `UTC`.
		return toggleWorldDst(state);
	}

	if (state.mode === 'timekeeping' && state.register !== 1) {
		// TIM-9: T-2..T-4 expose only the city code and DST, and are entered by a longer hold.
		return {
			...state,
			edit: { kind: 'worldtime', field: 'city' },
			editDate: dateOf(context),
		};
	}

	if (state.mode === 'timekeeping') {
		return { ...state, edit: { kind: 'timekeeping', field: 'seconds' }, editDate: dateOf(context) };
	}

	if (state.mode === 'alarm') {
		const slot = alarmSlot(state);
		if (slot === ALARM_SIGNAL_SLOT) {
			// The hourly-signal screen has no time to set, so a hold does nothing there and a press
			// toggles it (ALM-9).
			return { ...state, alarms: { ...state.alarms, signal: !state.alarms.signal } };
		}
		const def = alarmById(state.alarms, slot);
		if (!def) {
			return state;
		}
		// Requirement ALM-5: entering the setting screen arms the one-time mode. This is not a
		// convenience — it is the watch's behaviour, and the reason a user can set an alarm for
		// tonight without separately arming it.
		const armed = def.mode === 'off' ? { ...def, mode: 'once' as const } : def;
		return {
			...state,
			alarms: withAlarm(state.alarms, armed),
			edit: { kind: 'alarm', alarmId: def.id, field: 'hour' },
			editDate: dateOf(context),
		};
	}

	if (state.mode === 'timer') {
		return { ...state, edit: { kind: 'timer', field: 'hours' }, editDate: dateOf(context) };
	}

	return state;
}

/** The wall-clock date the setting screen starts from, so a cancelled edit cannot corrupt it. */
function dateOf(context: ReduceContext): EditDate {
	return {
		year: context.homeWall.getUTCFullYear(),
		month: context.homeWall.getUTCMonth() + 1,
		day: context.homeWall.getUTCDate(),
	};
}

/* -------------------------------------------------------------------------------------------- */
/* Modes and sub-screens                                                                         */
/* -------------------------------------------------------------------------------------------- */

/** The next mode in MODE's cycle (MOD-1), wrapping. */
export function nextMode(mode: ScreenMode): ScreenMode {
	const index = MODE_CYCLE.indexOf(mode);
	return MODE_CYCLE[(index + 1) % MODE_CYCLE.length] ?? 'timekeeping';
}

/** The alarm slot the Alarm screen is showing: 1..5, for the LCD, or 0 for the hourly signal. */
export function alarmSlot(state: MachineState): number {
	return alarmScreenAt(state.screenIndex.alarm);
}

/**
 * Moves the Multi Time register (MOD-2).
 *
 * The transient `T-n` indicator is armed here and nowhere else, which is what makes MOD-3's "for
 * ~1 s when the register changes" true: a register that is already selected produces no change and
 * therefore no indicator.
 */
function stepRegister(state: MachineState, step: number, at: number): MachineState {
	const count = Math.max(1, state.slots.length);
	const register = ((state.register - 1 + step) % count + count) % count + 1;
	return { ...state, register, registerChangedAt: at };
}

/* -------------------------------------------------------------------------------------------- */
/* World Time                                                                                    */
/* -------------------------------------------------------------------------------------------- */

/** The zones World Time scrolls, in the manual's west-to-east order. */
function worldZones(): readonly string[] {
	return catalogueZones();
}

/** The zone the World Time screen is showing. */
export function worldZone(state: MachineState): string {
	const zones = worldZones();
	return zones[((state.worldIndex % zones.length) + zones.length) % zones.length] ?? 'Etc/UTC';
}

/** Steps the World Time city, wrapping. `step` is +1 east, -1 west (WLD-1). */
function stepWorld(state: MachineState, step: number): MachineState {
	const count = worldZones().length;
	const worldIndex = ((state.worldIndex + step) % count + count) % count;
	return { ...state, worldIndex };
}

/**
 * `ADJUST` hold in World Time: DST for the **displayed city only** (WLD-2).
 *
 * The override is stored against the city's own zone, so every other city is untouched — which is
 * requirement DST-1 and the sentence the manual prints twice. `UTC` has no DST and no zone of its
 * own to override, so the press is inert there (WLD-3, DST-6).
 */
function toggleWorldDst(state: MachineState): MachineState {
	const zone = worldZone(state);
	if (zone === 'Etc/UTC' || zone === 'UTC') {
		return state;
	}

	// The city may or may not already occupy one of the four registers. If it does, its override
	// lives there; if it does not, the override is kept in the last register, which is the only
	// place four registers leave for a fifth city's state. That is a compromise, and it is stated
	// rather than hidden: the watch holds DST per *city code*, not per register, and this is what
	// four registers can represent.
	const index = state.slots.findIndex((slot) => slot.zone === zone);
	const target = index >= 0 ? index : state.slots.length - 1;
	return { ...state, slots: updateSlotIndex(state.slots, target, (slot) => ({ ...slot, dst: cycleDst(slot.dst) })) };
}

/** `auto -> on -> off -> auto`, the documented three-state extension over the watch's two (DST-3). */
export function cycleDst(mode: DstMode): DstMode {
	const index = DST_MODES.indexOf(mode);
	return DST_MODES[(index + 1) % DST_MODES.length] ?? 'off';
}

/**
 * The `ADJUST + LIGHT` chord: promote the displayed city to Home City (INT-6, TIM-10).
 *
 * Implemented as a **swap**, not a copy. The manual describes Home/World Time swapping, and a swap
 * is also the only version that does not destroy information: the old Home City moves into the
 * register the new one came from. Doing it as a copy would leave the operator with two registers
 * showing the same city and no way to get the old Home City back except by scrolling to it.
 *
 * The Home City is always `slots[0]`. When the promoted city already occupies a T-n register, the
 * two registers exchange zones; when it does not, the last register gives up its place, because the
 * watch has four and inventing a fifth would be a different watch.
 */
function promote(state: MachineState): MachineState {
	const zone = worldZone(state);
	const home = state.slots[0];
	if (!home || home.zone === zone) {
		return state;
	}

	const index = state.slots.findIndex((slot) => slot.zone === zone);
	if (index > 0) {
		const target = state.slots[index];
		if (!target) {
			return state;
		}
		const slots = state.slots.map((slot, position) => {
			if (position === 0) {
				return { zone: target.zone, dst: target.dst };
			}
			if (position === index) {
				return { zone: home.zone, dst: home.dst };
			}
			return slot;
		});
		return { ...state, slots, registerChangedAt: state.registerChangedAt };
	}

	// Not already a register: the promoted city takes over the last one, and T-1 becomes Home.
	const last = state.slots.length - 1;
	const slots = state.slots.map((slot, position) =>
		position === 0
			? { zone, dst: 'off' as DstMode }
			: position === last
				? { zone: home.zone, dst: home.dst }
				: slot,
	);
	return { ...state, slots, registerChangedAt: state.registerChangedAt };
}

/* -------------------------------------------------------------------------------------------- */
/* Setting screens                                                                               */
/* -------------------------------------------------------------------------------------------- */

/**
 * A button press while a setting screen is open.
 *
 * The shape is the same on all three screens, because the watch's is: `MODE` advances the flashing
 * field, `SEARCH` increments, `LIGHT` decrements, `ADJUST` exits — with a handful of fields where
 * `SEARCH` means something other than "increment", which is what TIM-7 lists.
 */
function editPress(
	state: MachineState,
	pusher: Pusher,
	at: number,
	context: ReduceContext,
): MachineState {
	const edit = state.edit;
	if (!edit) {
		return state;
	}

	switch (pusher) {
		case 'adjust':
			return exitEdit(state, context);
		case 'mode':
			return advanceField(state, context);
		case 'search':
			return stepField(state, 1, at, context);
		case 'light':
			return stepField(state, -1, at, context);
		default:
			return state;
	}
}

/** A repeat inside a setting screen: the fast-scroll fields only. */
function editRepeat(
	state: MachineState,
	pusher: Pusher,
	at: number,
	context: ReduceContext,
): MachineState {
	if (pusher === 'search') {
		return stepField(state, 1, at, context);
	}
	if (pusher === 'light') {
		return stepField(state, -1, at, context);
	}
	return state;
}

/** Leaves the setting screen, committing the edited date to nothing (the clock is the real one). */
function exitEdit(state: MachineState, _context: ReduceContext): MachineState {
	return { ...state, edit: null, editDate: null };
}

/** `MODE`: move to the next flashing field, or out of the screen when there is none left. */
function advanceField(state: MachineState, context: ReduceContext): MachineState {
	const edit = state.edit;
	if (!edit) {
		return state;
	}

	if (edit.kind === 'timekeeping') {
		const index = TIMEKEEPING_FIELDS.indexOf(edit.field);
		const next = TIMEKEEPING_FIELDS[index + 1];
		return next
			? { ...state, edit: { kind: 'timekeeping', field: next } }
			: exitEdit(state, context);
	}

	if (edit.kind === 'alarm') {
		const index = ALARM_FIELDS.indexOf(edit.field);
		const next = ALARM_FIELDS[index + 1];
		if (next) {
			return { ...state, edit: { kind: 'alarm', alarmId: edit.alarmId, field: next } };
		}
		return exitEdit(state, context);
	}

	// T-2..T-4's picker has two fields and leaves after the second, so it never reaches the timer's
	// sequence below.
	if (edit.kind === 'worldtime') {
		return edit.field === 'city'
			? { ...state, edit: { kind: 'worldtime', field: 'dst' } }
			: exitEdit(state, context);
	}

	// The timer sets Hours, Minutes, Seconds and nothing else (TMR-3).
	const index = TIMER_FIELDS.indexOf(edit.field);
	const next = TIMER_FIELDS[index + 1];
	if (next) {
		return { ...state, edit: { kind: 'timer', field: next } };
	}
	return exitEdit(state, context);
}

/**
 * `SEARCH` (increment) and `LIGHT` (decrement) inside a setting screen.
 *
 * A negative `step` never reaches the fields where `SEARCH` means something other than "+1", which
 * is what TIM-7 means by "context-specific single presses": resetting the seconds, toggling DST,
 * toggling 12/24 and toggling the illumination duration are all *increments* of a field whose
 * domain is a cycle rather than a range.
 */
function stepField(
	state: MachineState,
	step: number,
	at: number,
	context: ReduceContext,
): MachineState {
	const edit = state.edit;
	if (!edit) {
		return state;
	}

	if (edit.kind === 'timer') {
		return { ...state, timer: timerStepField(state.timer, edit.field, step, at) };
	}

	if (edit.kind === 'worldtime') {
		return stepFieldWorldTime(state, edit.field, step, context);
	}

	if (edit.kind === 'alarm') {
		return stepFieldAlarm(state, edit, step);
	}

	return stepFieldTimekeeping(state, edit.field, step);
}

/** T-2..T-4's city picker and DST toggle (TIM-9). */
function stepFieldWorldTime(
	state: MachineState,
	field: 'city' | 'dst',
	step: number,
	_context: ReduceContext,
): MachineState {
	if (field === 'dst') {
		return step === 1
			? { ...state, slots: updateSlot(state.slots, state.register, (slot) => ({ ...slot, dst: cycleDst(slot.dst) })) }
			: state;
	}

	// The picker walks the catalogue in the manual's order, which is also the order World Time
	// scrolls in, so the same button does the same thing on both screens.
	const zones = worldZones();
	const current = slotZone(state, state.register);
	const index = zones.indexOf(current);
	const base = index === -1 ? 0 : index;
	const next = zones[((base + step) % zones.length + zones.length) % zones.length];
	if (!next) {
		return state;
	}
	return { ...state, slots: updateSlot(state.slots, state.register, (slot) => ({ ...slot, zone: next })) };
}

/** The alarm setting screen: hour, minutes, and the schedule selector (ALM-4). */
function stepFieldAlarm(state: MachineState, edit: Edit & { kind: 'alarm' }, step: number): MachineState {
	const def = alarmById(state.alarms, edit.alarmId);
	if (!def) {
		return state;
	}

	if (edit.field === 'schedule') {
		// On the schedule field, SEARCH toggles rather than increments (ALM-4). A decrement is
		// ignored instead of walking backwards, because the watch's selector is a single toggle.
		if (step !== 1) {
			return state;
		}
		const index = ALARM_SCHEDULES.indexOf(def.mode === 'off' ? 'off' : def.mode);
		const next = ALARM_SCHEDULES[(index + 1) % ALARM_SCHEDULES.length] ?? 'once';
		return withEditAlarm(state, { ...def, mode: next });
	}

	const value = edit.field === 'hour' ? def.hour : def.minute;
	const range = edit.field === 'hour' ? 24 : 60;
	const next = ((value + step) % range + range) % range;
	return withEditAlarm(
		state,
		edit.field === 'hour' ? { ...def, hour: next } : { ...def, minute: next },
	);
}

function withEditAlarm(state: MachineState, def: AlarmDef): MachineState {
	return { ...state, alarms: withAlarm(state.alarms, def) };
}

/**
 * The Timekeeping setting screen's fields (TIM-5, TIM-7, TIM-8).
 *
 * The date fields are edited on `editDate` rather than by moving the clock, because a widget whose
 * clock is the system clock has no business writing to it, and because a half-finished edit must
 * not be visible anywhere else. The fields are validated but not applied; see the module note in
 * `controller.ts` for what the widget does with them.
 */
function stepFieldTimekeeping(
	state: MachineState,
	field: TimekeepingField,
	step: number,
): MachineState {
	switch (field) {
		case 'seconds':
			// TIM-7: SEARCH resets the seconds to `00`. TIM-8: from 30–59 that also advances the
			// minute. Implemented as a one-shot pulse rather than a running correction, so it is
			// observable in the state and testable without a clock.
			return step > 0 ? { ...state, secondReset: true } : state;

		case 'dst':
			return step > 0
				? { ...state, slots: updateSlot(state.slots, 1, (slot) => ({ ...slot, dst: cycleDst(slot.dst) })) }
				: state;

		case 'clock':
			// TIM-7: SEARCH toggles 12/24. A decrement is the same toggle, because a two-state field
			// has no other meaning for it.
			return { ...state, clock: state.clock === '24h' ? '12h' : '24h' };

		case 'illumination':
			return step > 0
				? { ...state, illuminationMs: nextIlluminationMs(state.illuminationMs) }
				: state;

		case 'city':
			// The Home City is chosen from the catalogue, in offset order, exactly as a Local Time is.
			return stepFieldHomeCity(state, step);

		case 'hour':
		case 'minutes':
		case 'year':
		case 'month':
		case 'day':
			return stepFieldDate(state, field, step);

		default:
			return state;
	}
}

function stepFieldHomeCity(state: MachineState, step: number): MachineState {
	const zones = worldZones();
	const current = slotZone(state, 1);
	const index = zones.indexOf(current);
	const base = index === -1 ? 0 : index;
	const next = zones[((base + step) % zones.length + zones.length) % zones.length];
	if (!next) {
		return state;
	}
	return { ...state, slots: updateSlot(state.slots, 1, (slot) => ({ ...slot, zone: next })) };
}

/**
 * The date fields, on `editDate`.
 *
 * The month lengths and leap years come from `Date` itself rather than from a table: constructing
 * day 0 of the following month yields the last day of this one, which is correct for February in a
 * leap year without a single hard-coded 28 (requirement TIM-2).
 */
function stepFieldDate(state: MachineState, field: TimekeepingField, step: number): MachineState {
	const date = state.editDate ?? { year: new Date().getUTCFullYear(), month: 1, day: 1 };

	if (field === 'year') {
		const year = Math.min(2099, Math.max(2000, date.year + step));
		return { ...state, editDate: { ...date, year, day: Math.min(date.day, daysInMonth(year, date.month)) } };
	}
	if (field === 'month') {
		const month = ((date.month - 1 + step) % 12 + 12) % 12 + 1;
		return { ...state, editDate: { ...date, month, day: Math.min(date.day, daysInMonth(date.year, month)) } };
	}

	const limit = daysInMonth(date.year, date.month);
	const day = ((date.day - 1 + step) % limit + limit) % limit + 1;
	return { ...state, editDate: { ...date, day } };
}

/** Days in a month, straight from the platform's calendar (TIM-2's 2000–2099 auto-calendar). */
export function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The zone assigned to register `register` (1..4). */
export function slotZone(state: MachineState, register: number): string {
	return state.slots[register - 1]?.zone ?? 'Etc/UTC';
}

/** The DST override for register `register` (1..4). */
export function slotDst(state: MachineState, register: number): DstMode {
	return state.slots[register - 1]?.dst ?? 'off';
}

function updateSlot(
	slots: readonly Slot[],
	register: number,
	update: (slot: Slot) => Slot,
): readonly Slot[] {
	return updateSlotIndex(slots, register - 1, update);
}

/** The same, by zero-based position, for callers that have already resolved one. */
function updateSlotIndex(
	slots: readonly Slot[],
	index: number,
	update: (slot: Slot) => Slot,
): readonly Slot[] {
	return slots.map((slot, position) => (position === index ? update(slot) : slot));
}

/* -------------------------------------------------------------------------------------------- */
/* Derived display facts                                                                         */
/* -------------------------------------------------------------------------------------------- */

/** True while the transient `T-n` register indicator should be showing (MOD-3). */
export function showRegisterIndicator(state: MachineState, now: number): boolean {
	if (state.registerChangedAt === null) {
		return false;
	}
	return now - state.registerChangedAt < REGISTER_INDICATOR_MS;
}

/**
 * The fields the active setting screen is flashing (TIM-4..TIM-11, ALM-4, TMR-3).
 *
 * Returned as a resolved list of *display* fields rather than as the `Edit` union, so the renderer
 * never has to know the sequence's names — the sequencing belongs to the machine, and the face
 * belongs to the renderer. Returning an empty list when nothing is flashing keeps the face's
 * condition one `length > 0` check.
 */
export type FlashField = 'seconds' | 'city' | 'dst' | 'hour' | 'minutes' | 'clock' | 'year' | 'month' | 'day' | 'illumination' | 'schedule' | 'timer-hours' | 'timer-minutes' | 'timer-seconds';

export function flashingField(state: MachineState, now: number): FlashField | null {
	if (!state.edit) {
		return null;
	}

	// The flash is a square wave: on for half the period, off for half. Eight hundred milliseconds
	// is the watch's own cadence as closely as the research could pin it, and it is slow enough to
	// read as a blink rather than a flicker.
	const on = Math.floor(now / FLASH_MS) % 2 === 0;
	if (!on) {
		return null;
	}

	const edit = state.edit;
	if (edit.kind === 'timekeeping') {
		return edit.field;
	}
	if (edit.kind === 'worldtime') {
		return edit.field === 'city' ? 'city' : 'dst';
	}
	if (edit.kind === 'alarm') {
		return edit.field;
	}
	return `timer-${edit.field}` as FlashField;
}

/** Half-period of the flashing-field blink, in milliseconds. */
export const FLASH_MS = 800;

/** The illumination duration, in milliseconds, for the current state (LIT-2). */
export function illuminationDuration(state: MachineState): number {
	return clampTimerMs(state.illuminationMs);
}

/** The countdown's current remaining time, in milliseconds, at an instant. */
export function timerNow(state: MachineState, now: number): number {
	return timerRemaining(state.timer, now);
}

/** The countdown's hours, minutes and seconds as the setting screen shows them. */
export function timerSetPartsOf(state: MachineState, now: number) {
	return timerSetParts(timerRemaining(state.timer, now));
}
