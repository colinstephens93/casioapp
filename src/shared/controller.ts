/**
 * The controller: everything that has to happen *over time*.
 *
 * The split this file implements is the project's central architectural rule. `machine.ts` decides
 * what a button *means*; `face.ts` decides what a state *looks like*; neither may own a clock. The
 * controller is the only object in the project that does, and it owns every piece of liveness:
 *
 * - the tick loop, and its **per-screen cadence** (NFR-4: idle CPU below half a percent, so a clock
 *   screen must not tick at a stopwatch's rate),
 * - the gesture timer, which turns a press into a hold after the watch's own durations,
 * - the alert, which sounds for ten seconds and is silenced by a button,
 * - the backlight, which washes the face for 1.5 s or 3 s and feeds the battery,
 * - persistence, including the countdown's absolute end instant across a restart.
 *
 * It is still headless: no DOM, no Electron, no `setTimeout` of its own. The timer functions are
 * injected, so the whole object can be driven by a test that never waits for anything.
 *
 * Requirements PRS-1..PRS-5, NFR-4, NFR-5, MOD-5, ALM-7, ALM-10, LIT-1, MUT-3, TMR-8, SW-10.
 */
import { type Alarms, defaultAlarms, repairAlarms } from './alarms.ts';
import { catalogueZones, lcdCodeForZone } from './catalog.ts';
import { GestureReader, HOLD_MS, type Gesture, type Pusher } from './gestures.ts';
import {
	type Alert,
	type FlashField,
	type MachineEvent,
	type MachineState,
	MODE_CYCLE,
	TICK_MS,
	alarmSlot,
	cycleDst,
	defaultScreenIndex,
	flashingField,
	illuminationDuration,
	initialMachineState,
	reduce,
	showRegisterIndicator,
	slotDst,
	slotZone,
	worldZone,
} from './machine.ts';
import type { ScreenMode } from './machine.ts';
import {
	type TimerState,
	repairTimer,
	timerRemaining,
	timerSetParts,
} from './timer.ts';
import { STOPWATCH_LIMIT_MS, stopwatchDisplayMs } from './stopwatch.ts';
import {
	type Clock,
	type DstMode,
	civilDayDiff,
	dstLabel,
	effectiveOffset,
	localZone,
} from './time.ts';

/** The face's inputs. The renderer's `DisplayState` is this plus nothing. */
export interface FaceState {
	readonly at: Date;
	readonly wall: Date;
	readonly homeWall: Date;
	readonly displayedOffset: number;
	readonly homeOffset: number;
	readonly diffFromHome: number;
	readonly dayDiff: number;
	readonly cityCode: string;
	readonly clock: Clock;
	readonly mode: ScreenMode;
	readonly dst: DstMode;
	readonly dstLabel: string;
	readonly multiTime: number;
	readonly showRegister: boolean;
	readonly muted: boolean;
	readonly alarmArmed: boolean;
	readonly signalOn: boolean;
	readonly battery: number;
	readonly illuminated: boolean;
	readonly flash: FlashField | null;
	readonly alert: Alert | null;
	readonly pressed: readonly Pusher[];
	readonly chord: boolean;
	/** The selected illumination duration, shown while its setting field is open (LIT-3). */
	readonly illuminationMs: number;
	readonly worldCity: string;
	readonly alarmHour: number | null;
	readonly alarmMinute: number | null;
	readonly alarmMode: 'daily' | 'once' | 'off' | null;
	readonly timerMs: number | null;
	readonly timerRunning: boolean;
	readonly timerSet: { hours: number; minutes: number; seconds: number } | null;
	readonly stopwatchMs: number | null;
	readonly stopwatchRunning: boolean;
	readonly stopwatchSplit: boolean;
	readonly stopwatchWrapped: boolean;
}

/** Persistence, injected so the widget's config file and the tests' memory object are the same shape. */
export interface ControllerStore {
	load(): string | null;
	save(value: string): void;
}

/** The narrow slice of the outside world the controller needs. */
export interface ControllerDeps {
	/** Wall-clock instant. */
	now(): number;
	/** Monotonic milliseconds, for the stopwatch. Never goes backwards; unaffected by clock changes. */
	mono(): number;
	/** Schedules `fn` after `ms`. Returns a cancel function. */
	setTimer(fn: () => void, ms: number): () => void;
	store?: ControllerStore;
	/** Raised once per firing alarm, for the Windows notification (requirement ALM-10). */
	notify?(alert: Alert): void;
	/** The initial battery level, 0..1. */
	battery?: number;
}

const CONFIG_VERSION = 2;

/**
 * The controller.
 *
 * One instance per widget. Construct with a `Watch`-style store and call `start()`; subscribe to be
 * told when anything changed.
 */
export class WatchController {
	private readonly deps: ControllerDeps;
	private state: MachineState;
	private battery: number;
	/** Illumination end instant, monotonic. `null` when dark. */
	private litUntilMono: number | null = null;
	private litStartedMono: number | null = null;
	private readonly gestures = new GestureReader();
	private cancelTimer: (() => void) | null = null;
	private readonly listeners = new Set<(state: MachineState) => void>();

	constructor(deps: ControllerDeps) {
		this.deps = deps;

		const restored = this.restore();
		this.battery = deps.battery ?? restored.battery;

		this.state = initialMachineState(
			{
				slots: restored.slots,
				clock: restored.clock,
				register: restored.register,
				worldIndex: restored.worldIndex,
				alarms: restored.alarms,
				timer: restored.timer,
				muted: restored.muted,
				illuminationMs: restored.illuminationMs,
				mode: restored.mode,
				screenIndex: restored.screenIndex,
			},
			deps.now(),
		);
	}

	/* ---------------------------------------------------------------------------------------- */
	/* Reading                                                                                   */
	/* ---------------------------------------------------------------------------------------- */

	getState(): MachineState {
		return this.state;
	}

	getBattery(): number {
		return this.battery;
	}

	subscribe(listener: (state: MachineState) => void): () => void {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	/** The face's inputs, derived once so nothing in a single frame can disagree (HANDOFF rule 3). */
	faceState(): FaceState {
		const state = this.state;
		const now = this.deps.now();
		const mono = this.deps.mono();

		// The face may be drawn at a different instant from the one the machine last saw, so the
		// wall clock is recomputed here rather than read from a cached snapshot. Everything else —
		// the offsets, the day marker, the DST label — is derived from that same instant.
		//
		// The seconds reset is a **display offset added to the instant**, which is what makes TIM-7's
		// "reset the seconds" possible without moving the system clock: the widget is a guest on the
		// machine and has no business setting its time.
		const at = new Date(now + this.secondOffsetMs(mono));

		const mode = state.mode;
		const displayedZone = this.displayedZone();
		const displaySlot = this.displayedSlot();
		const homeSlot = state.slots[0] ?? { zone: localZone(), dst: 'off' as DstMode };

		const displayedOffset = effectiveOffset(displayedZone, at, displaySlot.dst);
		const homeOffset = effectiveOffset(homeSlot.zone, at, homeSlot.dst);
		const wall = new Date(at.getTime() + displayedOffset * 60_000);
		const homeWall = new Date(at.getTime() + homeOffset * 60_000);

		const alarm = this.alarmDisplay();

		return {
			at,
			wall,
			homeWall,
			displayedOffset,
			homeOffset,
			diffFromHome: displayedOffset - homeOffset,
			dayDiff: civilDayDiff(displayedOffset, homeOffset, at),
			cityCode: lcdCodeForZone(displayedZone),
			clock: state.clock,
			mode,
			dst: displaySlot.dst,
			dstLabel: dstLabel(displayedZone, at, displaySlot.dst),
			multiTime: state.register,
			showRegister: showRegisterIndicator(state, now),
			muted: state.muted,
			alarmArmed: state.alarms.defs.some((def) => def.mode !== 'off'),
			signalOn: state.alarms.signal,
			battery: this.battery,
			illuminated: this.isLit(mono),
			flash: flashingField(state, now),
			alert: state.alert,
			pressed: this.gestures.pressed(),
			chord: this.gestures.activeChord() !== null,
			illuminationMs: state.illuminationMs,
			worldCity: worldZone(state),
			alarmHour: alarm?.hour ?? null,
			alarmMinute: alarm?.minute ?? null,
			alarmMode: alarm?.mode ?? null,
			timerMs: mode === 'timer' ? timerRemaining(state.timer, now) : null,
			timerRunning: state.timer.running,
			timerSet: mode === 'timer' && state.edit?.kind === 'timer' ? timerSetParts(timerRemaining(state.timer, now)) : null,
			stopwatchMs: mode === 'stopwatch' ? stopwatchDisplayMs(state.stopwatch, mono) : null,
			stopwatchRunning: state.stopwatch.startedAt !== null,
			stopwatchSplit: state.stopwatch.splitMs !== null,
			stopwatchWrapped: state.stopwatch.banked >= STOPWATCH_LIMIT_MS,
		};
	}

	/** The zone whose time the current screen displays. */
	private displayedZone(): string {
		const state = this.state;
		switch (state.mode) {
			case 'worldtime':
				return worldZone(state);
			case 'timekeeping':
				return slotZone(state, state.register);
			default:
				// Requirements ALM-1..TMR-8: Alarm, Timer and Stopwatch show the Home City's time.
				// The map band reverts to the Home City in these three modes as well (MAP-4), which
				// is why the controller and the renderer agree on the same rule rather than each
				// having its own version of it.
				return slotZone(state, 1);
		}
	}

	private displayedSlot(): { zone: string; dst: DstMode } {
		const state = this.state;
		if (state.mode === 'worldtime') {
			const zone = worldZone(state);
			// A World Time city's DST override is the one belonging to its own register if it has
			// one, and standard time otherwise — which is what "per city, others unaffected" means.
			const slot = state.slots.find((candidate) => candidate.zone === zone);
			return { zone, dst: slot?.dst ?? 'off' };
		}
		const register = state.mode === 'timekeeping' ? state.register : 1;
		return { zone: slotZone(state, register), dst: slotDst(state, register) };
	}

	private alarmDisplay(): { hour: number; minute: number; mode: 'daily' | 'once' | 'off' } | null {
		const state = this.state;
		if (state.mode !== 'alarm') {
			return null;
		}
		const slot = alarmSlot(state);
		if (slot === 0) {
			// The hourly-signal screen shows the current time, not an alarm time.
			return null;
		}
		const def = state.alarms.defs.find((candidate) => candidate.id === slot);
		return def ? { hour: def.hour, minute: def.minute, mode: def.mode } : null;
	}

	/* ---------------------------------------------------------------------------------------- */
	/* The clock                                                                                 */
	/* ---------------------------------------------------------------------------------------- */

	/**
	 * The tick period for the current screen, in milliseconds.
	 *
	 * This is requirement NFR-4, and it is the reason the cadence is computed rather than fixed.
	 * A hundredth-of-a-second stopwatch needs 50 ms; a clock showing whole seconds needs 1000; an
	 * idle widget needs an occasional wake to retire an alert and nothing else. Ticking everything
	 * at the fastest rate would work and would burn twenty times the CPU to draw the same picture
	 * fifty times over.
	 */
	tickPeriodMs(): number {
		const state = this.state;
		if (this.isLit(this.deps.mono())) {
			// The backlight's own end has to be honoured promptly, or it stays on past its duration.
			return 50;
		}
		if (state.alert) {
			return 100;
		}
		if (state.edit) {
			// The flashing field's half-period is 800 ms; 50 ms resolves its edges crisply.
			return 50;
		}
		// A lit stopwatch or a running countdown needs the finer cadence; everything else is a clock
		// showing whole seconds.
		if (state.mode === 'stopwatch' && state.stopwatch.startedAt !== null) {
			return 50;
		}
		if (state.mode === 'timer' && state.timer.running) {
			// The countdown's display unit is a tenth (TMR-2), so 50 ms resolves it without waste.
			return 50;
		}
		if (state.mode === 'timer') {
			return 200;
		}
		return state.mode === 'timekeeping' ? 1000 : 500;
	}

	start(): void {
		if (this.cancelTimer) {
			return;
		}
		this.schedule();
	}

	stop(): void {
		this.cancelTimer?.();
		this.cancelTimer = null;
	}

	private schedule(): void {
		const period = this.tickPeriodMs();
		this.cancelTimer = this.deps.setTimer(() => {
			this.cancelTimer = null;
			this.tick();
			if (this.cancelTimer === null) {
				this.schedule();
			}
		}, period);
	}

	/** One tick: advance the machine, retire alerts, feed the battery, then reschedule. */
	tick(): void {
		const now = this.deps.now();
		const mono = this.deps.mono();

		this.retireIllumination(mono);

		// The pushers first: a hold or a repeat that fell due is a button event, and it must be acted
		// on before the machine's own clock effects so that a hold which opens a setting screen is
		// seen by the same tick's cadence calculation. The reader is configured for the *current*
		// screen, which is why this runs before the state advances.
		this.configureGestures();
		this.dispatch(this.gestures.tick(now), now);

		// The alarm comparison needs the *previous* reading as well as this one, and only the
		// controller knows when it last ran — the cadence varies by screen, and a suspended process
		// may not have run for minutes. Passing both is what lets an alarm be found in the gap.
		const homeWall = this.homeWallAt(now);
		const previousHomeWall =
			this.lastTickAt === null ? new Date(homeWall.getTime() - TICK_MS) : this.homeWallAt(this.lastTickAt);

		this.state = reduce(this.state, { kind: 'tick', at: now, homeWall }, { homeWall, previousHomeWall });
		this.lastTickAt = now;

		this.afterReduce(now, mono);
		this.emit();
	}

	/** The instant of the previous tick, so a late one can still find the alarm it slept through. */
	private lastTickAt: number | null = null;

	/**
	 * The Home City wall clock at an instant, which the machine needs for its alarm comparison.
	 *
	 * Computed here rather than in the machine because it needs `Intl`, and the machine is
	 * deliberately free of it so it can be tested against a fixed `Date` with no zone database.
	 */
	private homeWallAt(at: number): Date {
		const home = this.state.slots[0] ?? { zone: localZone(), dst: 'off' as DstMode };
		const offset = effectiveOffset(home.zone, new Date(at), home.dst);
		return new Date(at + offset * 60_000);
	}

	/** Shared work after any state change: notifications, and the seconds-reset request. */
	private afterReduce(now: number, mono: number): void {
		const alert = this.state.alert;
		if (alert && alert.kind !== 'test' && alert.endsAt > now && this.deps.notify) {
			// Announced once per firing. The alert's own `endsAt` is the deduplication key: a second
			// tick within the same alert sees the same instant and does not re-notify.
			if (this.announcedAlert !== alert.endsAt) {
				this.announcedAlert = alert.endsAt;
				this.deps.notify(alert);
			}
		}

		if (this.state.secondReset) {
			this.applySecondReset(now, mono);
		}
	}

	private announcedAlert: number | null = null;

	/* ---------------------------------------------------------------------------------------- */
	/* The seconds reset (TIM-7, TIM-8)                                                          */
	/* ---------------------------------------------------------------------------------------- */

	/**
	 * A display offset, its length, and when it is released — the seconds field's reset.
	 *
	 * The watch's "reset the seconds" does not move the clock, it **re-zeroes the display**: the
	 * seconds read `00` and then resume from the next real second. Both halves of requirement TIM-8
	 * fall out of one offset, added to the instant to give the displayed wall clock:
	 *
	 * - `-remainder` makes the displayed second `00`;
	 * - `60000 - remainder`, applied only when the reading was 30–59, re-zeroes *and* advances the
	 *   minute — exactly as zeroing a mechanical seconds hand has to.
	 *
	 * `until` is when the offset is released, and it is the remainder's own length. Releasing it then
	 * makes the display skip the seconds it spent showing `00`, so it lands back in step with the
	 * real clock instead of running a minute behind forever. That is what the watch does, and it is
	 * why this is one offset rather than a running correction.
	 */
	private secondOffset: { origin: number; until: number; ms: number } | null = null;

	private secondOffsetMs(mono: number): number {
		const offset = this.secondOffset;
		if (!offset) {
			return 0;
		}
		if (mono >= offset.until) {
			// The reset has been absorbed; the clock is in step again.
			this.secondOffset = null;
			return 0;
		}
		return offset.ms;
	}

	private applySecondReset(now: number, mono: number): void {
		this.state = reduce(this.state, { kind: 'second-reset-applied' }, { homeWall: this.homeWallAt(now) });

		// Computed from the *displayed* reading and not from the raw instant, because that is what the
		// operator is looking at — and because it makes a second reset inside the same minute compose
		// with the first instead of undoing it.
		const current = this.secondOffsetMs(mono);
		const displayed = now + current;
		const remainder = (displayed % 60_000 + 60_000) % 60_000;

		// Resetting when the display already reads `00.000` would do nothing, and a zero-length
		// remainder cannot define how long the reset lasts. Skipped rather than applied.
		if (remainder === 0) {
			return;
		}

		// TIM-8: a reading of 30–59 also advances the minute.
		const target = remainder >= 30_000 ? 60_000 - remainder : -remainder;
		this.secondOffset = { origin: mono, until: mono + remainder, ms: current + target };
	}

	/* ---------------------------------------------------------------------------------------- */
	/* Pushers                                                                                   */
	/* ---------------------------------------------------------------------------------------- */

	/** A pusher went down. */
	down(pusher: Pusher): void {
		const now = this.deps.now();
		this.configureGestures();
		this.dispatch(this.gestures.down(pusher, now), now);
		this.emit();
	}

	/** A pusher came up. */
	up(pusher: Pusher): void {
		const now = this.deps.now();
		this.dispatch(this.gestures.up(pusher, now), now);
		this.emit();
	}

	/** Forgets any stuck press, for a window that lost focus mid-gesture. */
	cancelGestures(): void {
		this.gestures.clear();
		this.emit();
	}

	/* ---------------------------------------------------------------------------------------- */
	/* Direct settings, for the host's own controls                                              */
	/* ---------------------------------------------------------------------------------------- */

	/**
	 * These are not watch gestures — the watch reaches every one of them through its pushers, and
	 * the state machine owns that path. They exist because the widget's own host has controls the
	 * device does not: the browser preview's convenience buttons, and later the tray menu's "reset
	 * battery" and a settings file. Routing them through `reduce` where a gesture already exists
	 * would be the honest way to do it, so each of these does exactly that.
	 */

	/** Moves to a Multi Time register, 1..4 — the same change a `SEARCH` press makes (MOD-2). */
	selectRegister(register: number): void {
		if (register < 1 || register > this.state.slots.length || register === this.state.register) {
			return;
		}
		// A `SEARCH` press advances the register by one rather than to a target, so this presses
		// until it arrives rather than duplicating the machine's stepping here. The loop is bounded
		// by the register count, and the target is one of its members, so it always terminates.
		const homeWall = this.homeWallAt(this.deps.now());
		let state = this.state;
		for (let guard = 0; guard <= this.state.slots.length; guard += 1) {
			if (state.register === register) {
				break;
			}
			state = reduce(state, { kind: 'press', pusher: 'search', at: this.deps.now() }, { homeWall });
		}
		this.state = state;
		this.emit();
	}

	/** Toggles 12- and 24-hour presentation (TIM-12). */
	toggleClock(): void {
		// Not a gesture on the watch: the clock format is a field of the setting screen (TIM-5), so
		// this is the host's shortcut into it and changes nothing else.
		this.state = { ...this.state, clock: this.state.clock === '24h' ? '12h' : '24h' };
		this.emit();
	}

	/** Assigns a zone to a register, as the city picker's SEARCH/LIGHT scrolling does (TIM-9). */
	setZone(register: number, zone: string): void {
		if (register < 1 || register > this.state.slots.length) {
			return;
		}
		this.state = {
			...this.state,
			slots: this.state.slots.map((slot, position) => (position === register - 1 ? { ...slot, zone } : slot)),
		};
		this.emit();
	}

	/** Cycles a register's DST override through `auto -> on -> off` (DST-3). */
	cycleRegisterDst(register: number): void {
		const slot = this.state.slots[register - 1];
		if (!slot) {
			return;
		}
		const next = cycleDst(slot.dst);
		this.state = {
			...this.state,
			slots: this.state.slots.map((current, position) =>
				position === register - 1 ? { ...current, dst: next } : current,
			),
		};
		this.emit();
	}

	/**
	 * Narrows the gesture table for the current screen.
	 *
	 * This is the piece that makes INT-5's three durations real rather than nominal. The same
	 * `ADJUST` means "setting screen" at 1 s in Timekeeping on T-1, "nothing" at 2 s in World Time
	 * (where 1 s is already the DST toggle), and "city picker" at 2 s on T-2..T-4. The gesture
	 * reader is told the threshold; it does not guess.
	 */
	private configureGestures(): void {
		const state = this.state;

		if (state.edit) {
			// Inside a setting screen the only gesture left is a repeat: MODE moves the field, SEARCH
			// and LIGHT step it, and holding either of those is the fast version of stepping.
			this.gestures.configure(
				{ adjust: Number.POSITIVE_INFINITY, mode: Number.POSITIVE_INFINITY, light: Number.POSITIVE_INFINITY, search: Number.POSITIVE_INFINITY },
				['search', 'light'],
			);
			return;
		}

		switch (state.mode) {
			case 'timekeeping':
				// Neither pusher repeats here. A held SEARCH is Auto Display (TIM-11) and a press is
				// one register step (MOD-2) — fast scroll is a World Time and Alarm feature, and
				// letting SEARCH repeat here made a three-second hold cycle the registers before Auto
				// Display could be recognised, which is exactly the bug the tests caught.
				this.gestures.configure(
					{
						adjust: state.register === 1 ? HOLD_MS.settings : HOLD_MS.cityPicker,
						mode: HOLD_MS.mute,
						search: HOLD_MS.autoDisplay,
						light: Number.POSITIVE_INFINITY,
					},
					[],
				);
				return;

			case 'worldtime':
				// SEARCH scrolls east and a hold is the *fast* version of the same thing (WLD-1), so it
				// repeats and has no terminal hold. ADJUST's hold is the DST toggle (WLD-2).
				this.gestures.configure(
					{ adjust: HOLD_MS.settings, mode: HOLD_MS.mute, search: Number.POSITIVE_INFINITY, light: Number.POSITIVE_INFINITY },
					['search'],
				);
				return;

			case 'alarm':
				// SEARCH's hold is the test alarm (ALM-6), which is terminal, so it cannot also scroll;
				// ALM-2's fast scroll is a repeat on LIGHT instead.
				this.gestures.configure(
					{ adjust: HOLD_MS.settings, mode: HOLD_MS.mute, search: HOLD_MS.autoDisplay, light: Number.POSITIVE_INFINITY },
					['light'],
				);
				return;

			case 'timer':
				this.gestures.configure(
					{ adjust: HOLD_MS.settings, mode: HOLD_MS.mute, search: Number.POSITIVE_INFINITY, light: Number.POSITIVE_INFINITY },
					[],
				);
				return;

			case 'stopwatch':
				this.gestures.configure(
					{ adjust: Number.POSITIVE_INFINITY, mode: HOLD_MS.mute, search: Number.POSITIVE_INFINITY, light: Number.POSITIVE_INFINITY },
					[],
				);
				return;

			default:
				return;
		}
	}

	/** Feeds a gesture to the machine, then handles what the machine cannot. */
	private dispatch(gestures: readonly Gesture[], now: number): void {
		for (const gesture of gestures) {
			// The backlight is a timed effect, so it belongs here rather than in the machine — and it
			// happens on the way *down*, because the watch lights the LCD as the button is pressed.
			// The machine's own `light` handling is the other half: the decrement.
			if (gesture.kind === 'press' && gesture.pusher === 'light') {
				this.startIllumination();
			}

			const event = toMachineEvent(gesture);
			if (!event) {
				continue;
			}
			this.state = reduce(this.state, event, { homeWall: this.homeWallAt(now) });
		}
		this.afterReduce(now, this.deps.mono());
	}

	/* ---------------------------------------------------------------------------------------- */
	/* Illumination and battery                                                                  */
	/* ---------------------------------------------------------------------------------------- */

	private startIllumination(): void {
		const mono = this.deps.mono();
		// Re-lighting while already lit restarts the duration and does not double-count the charge,
		// which is what the watch's own LED does.
		if (this.litStartedMono === null) {
			this.litStartedMono = mono;
		}
		this.litUntilMono = mono + illuminationDuration(this.state);
	}

	private isLit(mono: number): boolean {
		return this.litUntilMono !== null && mono < this.litUntilMono;
	}

	/** Turns the backlight off when its duration expires, and charges the battery for the time it ran. */
	private retireIllumination(mono: number): void {
		if (this.litUntilMono === null || mono < this.litUntilMono) {
			return;
		}
		const started = this.litStartedMono;
		if (started !== null) {
			this.drainBatterySeconds((this.litUntilMono - started) / 1000);
		}
		this.litUntilMono = null;
		this.litStartedMono = null;
	}

	/**
	 * The battery model's drain, in seconds of "operation".
	 *
	 * The calibration is Casio's own stated assumption (requirement BAT-3): ten seconds of alarm
	 * operation and 1.5 seconds of illumination per day gives about ten years. Ten years is 3652.5
	 * days, so one simulated day of that pattern is 11.5 seconds of operation, and the whole cell is
	 * 3652.5 × 11.5 ≈ 42 000 seconds. Requirement BAT-2 wants the drain driven by *actual* use, which
	 * is why the only thing this method is ever called with is real elapsed time.
	 */
	private drainBatterySeconds(seconds: number): void {
		if (!Number.isFinite(seconds) || seconds <= 0) {
			return;
		}
		this.battery = Math.max(0, this.battery - seconds / BATTERY_CAPACITY_SECONDS);
	}

	/**
	 * An alarm or the countdown sounding, charged to the battery for as long as it sounds.
	 *
	 * Requirement BAT-2 wants the drain driven by *actual* alarm seconds, and this is where they are
	 * counted — but nothing calls it yet, because the alert lifecycle is wired to notifications in
	 * M8 and charging for a sound that is not yet made would be inventing a number. The seam exists
	 * and is one line, which is the honest state of it.
	 */
	drainAlertSeconds(seconds: number): void {
		this.drainBatterySeconds(seconds);
	}

	/** Resets the simulated battery, from the context menu (requirement BAT-6). */
	resetBattery(): void {
		this.battery = 1;
		this.emit();
	}

	/** The battery level, as a percentage, for the readout (BAT-5). */
	batteryPercent(): number {
		return Math.round(this.battery * 100);
	}

	/* ---------------------------------------------------------------------------------------- */
	/* Persistence                                                                               */
	/* ---------------------------------------------------------------------------------------- */

	/**
	 * The stored configuration.
	 *
	 * Schema version 2: version 1 stored only the four registers, the clock and the selected
	 * register. Everything M5–M7 adds is additive, and an older file is read as far as it goes and
	 * repaired for the rest (requirement PRS-4 — a partial file must never stop the clock).
	 *
	 * The stopwatch is deliberately absent (SW-10, PRS-2). The countdown is present as its absolute
	 * end instant (TMR-8, PRS-3), which is what makes a countdown survive a quit mid-flight.
	 */
	serialise(): string {
		const state = this.state;
		return JSON.stringify({
			version: CONFIG_VERSION,
			clock: state.clock,
			register: state.register,
			mode: state.mode,
			screenIndex: state.screenIndex,
			worldIndex: state.worldIndex,
			slots: state.slots.map((slot) => ({ zone: slot.zone, dst: slot.dst })),
			alarms: state.alarms,
			timer: state.timer,
			muted: state.muted,
			illuminationMs: state.illuminationMs,
			battery: this.battery,
		});
	}

	/**
	 * Saves the current configuration.
	 *
	 * Called by the widget after any gesture that changed something, and not on a tick — a clock
	 * that writes a file every second would defeat WIN-10's "quiet when idle" for no benefit, since
	 * a tick cannot change anything worth persisting.
	 */
	save(): void {
		this.deps.store?.save(this.serialise());
	}

	private restore(): {
		slots: { zone: string; dst: DstMode }[];
		clock: Clock;
		register: number;
		worldIndex: number;
		alarms: Alarms;
		timer: TimerState;
		muted: boolean;
		illuminationMs: number;
		mode: ScreenMode;
		screenIndex: Record<ScreenMode, number>;
		battery: number;
	} {
		const fallback = {
			slots: [
				{ zone: localZone(), dst: 'off' as DstMode },
				{ zone: 'America/New_York', dst: 'off' as DstMode },
				{ zone: 'Europe/London', dst: 'off' as DstMode },
				{ zone: 'Asia/Tokyo', dst: 'off' as DstMode },
			],
			clock: '24h' as Clock,
			register: 1,
			worldIndex: 0,
			alarms: defaultAlarms(),
			timer: repairTimer(null),
			muted: false,
			illuminationMs: 1500,
			mode: 'timekeeping' as ScreenMode,
			screenIndex: defaultScreenIndex(),
			battery: 1,
		};

		const raw = this.deps.store?.load() ?? null;
		if (!raw) {
			return fallback;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return fallback;
		}
		if (typeof parsed !== 'object' || parsed === null) {
			return fallback;
		}

		const config = parsed as Record<string, unknown>;

		// Each field is repaired independently. One bad zone must not cost the operator their
		// alarms, and one bad alarm must not cost them their registers.
		const slots = Array.isArray(config['slots']) ? config['slots'] : [];
		const repairedSlots = fallback.slots.map((slot, index) => {
			const candidate = slots[index];
			if (typeof candidate !== 'object' || candidate === null) {
				return slot;
			}
			const entry = candidate as { zone?: unknown; dst?: unknown };
			return {
				zone: typeof entry.zone === 'string' && entry.zone.length > 0 ? entry.zone : slot.zone,
				dst: isDst(entry.dst) ? entry.dst : slot.dst,
			};
		});

		const mode = MODE_CYCLE.includes(config['mode'] as ScreenMode)
			? (config['mode'] as ScreenMode)
			: fallback.mode;

		return {
			slots: repairedSlots,
			clock: config['clock'] === '12h' || config['clock'] === '24h' ? config['clock'] : fallback.clock,
			register: clampInt(config['register'], 1, 4, fallback.register),
			worldIndex: clampInt(config['worldIndex'], 0, Math.max(0, catalogueZones().length - 1), fallback.worldIndex),
			alarms: repairAlarms(config['alarms']),
			timer: repairTimer(config['timer']),
			muted: config['muted'] === true,
			illuminationMs: config['illuminationMs'] === 3000 ? 3000 : 1500,
			mode,
			screenIndex: repairScreenIndex(config['screenIndex']),
			battery: clampNumber(config['battery'], 0, 1, 1),
		};
	}

	/* ---------------------------------------------------------------------------------------- */
	/* Notifications                                                                             */
	/* ---------------------------------------------------------------------------------------- */

	private emit(): void {
		for (const listener of this.listeners) {
			listener(this.state);
		}
	}
}

/**
 * The battery's capacity in seconds of "operation", from Casio's own rating assumption.
 *
 * Requirement BAT-3: 10 s of alarm plus 1.5 s of illumination per day, for ten years. Ten years is
 * 3652.5 days (two leap days per decade on average, which is the honest figure rather than 3650),
 * and 3652.5 × 11.5 s = 42 003.75 s.
 */
export const BATTERY_CAPACITY_SECONDS = 3652.5 * (10 + 1.5);

/** Translates a gesture into the machine's own vocabulary. */
function toMachineEvent(gesture: Gesture): MachineEvent | null {
	switch (gesture.kind) {
		case 'press':
			return { kind: 'press', pusher: gesture.pusher, at: gesture.at };
		case 'hold':
			return { kind: 'hold', pusher: gesture.pusher, at: gesture.at, ms: gesture.ms };
		case 'repeat':
			return { kind: 'repeat', pusher: gesture.pusher, at: gesture.at };
		case 'chord':
			return { kind: 'chord', chord: gesture.chord, at: gesture.at };
		case 'release':
			return { kind: 'release', pusher: gesture.pusher, at: gesture.at };
		default:
			return null;
	}
}

function isDst(value: unknown): value is DstMode {
	return value === 'auto' || value === 'on' || value === 'off';
}

function clampInt(value: unknown, low: number, high: number, fallback: number): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) {
		return fallback;
	}
	return value;
}

function clampNumber(value: unknown, low: number, high: number, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(high, Math.max(low, value));
}

function repairScreenIndex(value: unknown): Record<ScreenMode, number> {
	const fallback = defaultScreenIndex();
	if (typeof value !== 'object' || value === null) {
		return fallback;
	}
	const source = value as Record<string, unknown>;
	const out = { ...fallback };
	for (const mode of MODE_CYCLE) {
		// Each mode has its own screen count: five alarms plus the signal, four registers, and one
		// screen each for the two that have nothing to scroll.
		const limit = mode === 'alarm' ? 6 : mode === 'timekeeping' ? 4 : 1;
		out[mode] = clampInt(source[mode], 0, limit - 1, 0);
	}
	return out;
}
