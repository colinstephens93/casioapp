/**
 * Pusher gesture recognition: press, hold and chord.
 *
 * The watch needs all three (requirement INT-4) and the durations are part of its behaviour, not
 * tunable preferences (INT-5):
 *
 * | Gesture | Duration | What it does |
 * |---|---|---|
 * | `ADJUST` hold | ~1 s | enter the setting screen, or toggle DST in World Time |
 * | `ADJUST` hold | ~2 s | enter the Local Time city picker (T-2..T-4) |
 * | `SEARCH` hold | ~3 s | Auto Display, or the alarm test (ALM-6) |
 * | `MODE` hold | ~1 s | toggle MUTE (MUT-1) |
 *
 * ## Why this is a state machine and not three `setTimeout`s in a click handler
 *
 * The hard part of a hold is not detecting it, it is deciding what a *release* means afterwards. A
 * hold is produced by a press that has not ended yet, so when it does end the code must not also
 * fire the press action — otherwise holding `ADJUST` for a second would enter the setting screen
 * *and* briefly flash the register. This module answers that by construction: a gesture becomes a
 * hold exactly once, and the release that follows it is never read as a second action.
 *
 * Chords add the second trap. `ADJUST + LIGHT` promotes a city (INT-6), and it must not also be
 * read as an `ADJUST` hold or as an `LIGHT` press. So while two or more pushers are down, both of
 * their holds and repeats are cancelled and the pair is recorded as a **pending chord**. The chord
 * is emitted when either pusher comes back up — one gesture, once, for the whole interaction.
 *
 * ## The one honest compromise
 *
 * The first pusher's `press` is emitted speculatively as it goes down, before it is known whether a
 * chord is coming. A clock's pad has to feel instant, and delaying every press by a chord-detection
 * window would make that impossible to hide. The consequence is that the leading half of a chord
 * can have already acted, and the state machine is written to tolerate it: promoting a city with
 * `ADJUST + LIGHT` first moves the register indicator, which is a display transient and is
 * immediately overwritten by the promotion itself. The alternative — a 40 ms delay on every press
 * of a device with four of them — is worse, and the wait would be visible.
 *
 * ## Injectable clock
 *
 * Every method takes the instant it should reason about. There is no `setInterval` and no
 * `Date.now()` in this file, which is what lets "hold `SEARCH` for 3 seconds" be a unit test that
 * runs in microseconds.
 *
 * Requirements INT-1..INT-8, MUT-1.
 */

/**
 * The four pushers, named as the case prints them.
 *
 * Not an enum: `erasableSyntaxOnly` is on, and enums emit code that Node's type stripping cannot
 * execute.
 */
export type Pusher = 'adjust' | 'light' | 'mode' | 'search';

export const PUSHERS: readonly Pusher[] = ['adjust', 'light', 'mode', 'search'];

/** The two-key combinations the watch understands. Order-independent: it is a set, not a sequence. */
export type Chord = 'adjust+light';

export const CHORDS: readonly Chord[] = ['adjust+light'];

/**
 * The hold thresholds, in milliseconds.
 *
 * These are the watch's, from the manual (docs/RESEARCH.md §4). They are named rather than inlined
 * because M7's whole point is that they are exact, and a bare `2000` in a condition is not
 * reviewable.
 */
export const HOLD_MS = {
	/** `SEARCH`: Auto Display in Timekeeping (TIM-11), the test alarm in Alarm mode (ALM-6). */
	autoDisplay: 3000,
	/** `ADJUST`: enter the setting screen (TIM-4, ALM-4, TMR-3), toggle World Time DST (WLD-2). */
	settings: 1000,
	/** `MODE`: hold to toggle MUTE (MUT-1). */
	mute: 1000,
	/** `ADJUST` on T-2..T-4: the Local Time city picker (TIM-9). */
	cityPicker: 2000,
} as const;

/**
 * How often a held scrolling pusher repeats, in milliseconds.
 *
 * Fast scroll on the watch is a visibly stepped thing, not a smooth glide, and it is faster than
 * one city per second — requirement WLD-1's "high speed". 90 ms is about eleven steps a second,
 * which crosses the whole 49-code table in under five seconds.
 */
export const REPEAT_MS = 90;

/**
 * How long a held scrolling pusher waits before its repeats begin, in milliseconds.
 *
 * A repeat must not begin on the way to becoming a hold, so the delay is set below the shortest
 * hold threshold the watch has. A press therefore has to be deliberate to scroll.
 */
export const REPEAT_DELAY_MS = 400;

/**
 * A recognised gesture.
 *
 * Deliberately a flat shape with a `kind` discriminator rather than a class hierarchy: the state
 * machine that consumes these is a single `switch`, and a union makes an unhandled kind a compile
 * error at the `default` branch.
 */
export type Gesture =
	| { readonly kind: 'press'; readonly pusher: Pusher; readonly at: number }
	| { readonly kind: 'hold'; readonly pusher: Pusher; readonly at: number; readonly ms: number }
	| { readonly kind: 'repeat'; readonly pusher: Pusher; readonly at: number }
	| { readonly kind: 'release'; readonly pusher: Pusher; readonly at: number; readonly ms: number }
	| { readonly kind: 'chord'; readonly chord: Chord; readonly at: number };

interface Held {
	/** When the pusher went down. */
	readonly downAt: number;
	/** True once the hold threshold has been crossed, so it cannot be crossed twice. */
	holdFired: boolean;
	/** When the next repeat is due, or `null` when this pusher does not repeat. */
	nextRepeatAt: number | null;
	/** True when this press was swallowed because it became part of a chord. */
	chorded: boolean;
}

/**
 * Tracks which pushers are down and turns a stream of timestamps into gestures.
 *
 * One instance per widget. It holds no timers: the owner calls `tick(now)` on whatever cadence the
 * current screen needs (the stopwatch's hundredths need 10 ms; the clock needs 1000 ms) and
 * receives whatever gestures fell due. That keeps the cadence decision in one place — the
 * controller — instead of in a dozen `setTimeout`s.
 */
export class GestureReader {
	/**
	 * Per-pusher hold thresholds.
	 *
	 * A map rather than a fixed set of `if`s because `ADJUST` genuinely has three different meanings
	 * depending on how long it is held and which screen is showing (1 s settings, 2 s city picker,
	 * and in World Time 1 s is DST instead). The owner narrows the threshold as it learns which
	 * screen it is on, through `configure`, rather than this class having to know about screens.
	 */
	private thresholds: Record<Pusher, number> = {
		adjust: HOLD_MS.settings,
		light: Number.POSITIVE_INFINITY,
		mode: HOLD_MS.mute,
		search: HOLD_MS.autoDisplay,
	};

	/** Which pushers repeat while held, and therefore produce `repeat` gestures. */
	private repeaters: ReadonlySet<Pusher> = new Set<Pusher>();

	private readonly held = new Map<Pusher, Held>();

	/** A chord whose two pushers are both down but which has not been emitted yet. */
	private pendingChord: Chord | null = null;

	/**
	 * Replaces the gesture table.
	 *
	 * Called by the controller whenever the screen changes: the same pusher means different things
	 * on different screens, and the duration is part of the meaning. Passing the whole table each
	 * time avoids a stale threshold surviving a screen change, which is exactly the bug that would
	 * make "hold SEARCH for Auto Display" fire the alarm test instead.
	 *
	 * A pusher is either a **hold** or a **repeater**, and never both. That is not a simplification
	 * but the distinction the watch itself makes: `SEARCH` in World Time scrolls, so it repeats and
	 * has no hold; `SEARCH` in Alarm mode fires the test alarm, so it has a hold and does not repeat.
	 * A pusher with a finite threshold is therefore left out of `repeaters` even if it is listed
	 * there, because a terminal hold and a scroll cannot both be the meaning of one gesture.
	 */
	configure(thresholds: Partial<Record<Pusher, number>>, repeaters: readonly Pusher[] = []): void {
		this.thresholds = { ...this.thresholds, ...thresholds };
		this.repeaters = new Set(
			repeaters.filter((pusher) => !Number.isFinite(this.thresholds[pusher])),
		);

		// A pusher that has just stopped repeating loses its pending repeat, or it would fire once
		// more after the screen changed.
		for (const [pusher, held] of [...this.held]) {
			if (!this.repeaters.has(pusher) && held.nextRepeatAt !== null) {
				this.held.set(pusher, { ...held, nextRepeatAt: null });
			}
		}
	}

	/** The pushers currently down, for the face's pressed state (requirement INT-8). */
	pressed(): Pusher[] {
		return PUSHERS.filter((pusher) => this.held.has(pusher));
	}

	/** True while any chord is fully down, so the face can show the chord state (INT-8). */
	activeChord(): Chord | null {
		for (const chord of CHORDS) {
			const [first, second] = chord.split('+') as [Pusher, Pusher];
			if (this.held.has(first) && this.held.has(second)) {
				return chord;
			}
		}
		return null;
	}

	/**
	 * A pusher went down.
	 *
	 * Returns a `press` — see "the one honest compromise" above — and, if this completes a chord,
	 * cancels both holds and records the chord as pending.
	 */
	down(pusher: Pusher, at: number): Gesture[] {
		if (this.held.has(pusher)) {
			return [];
		}

		this.held.set(pusher, {
			downAt: at,
			holdFired: false,
			nextRepeatAt: null,
			chorded: false,
		});

		const gestures: Gesture[] = [{ kind: 'press', pusher, at }];

		const chord = this.activeChord();
		if (chord) {
			for (const member of chord.split('+') as Pusher[]) {
				const held = this.held.get(member);
				if (held) {
					this.held.set(member, { ...held, chorded: true, nextRepeatAt: null });
				}
			}
			this.pendingChord = chord;
			return gestures;
		}

		if (this.repeaters.has(pusher)) {
			const held = this.held.get(pusher);
			if (held) {
				this.held.set(pusher, { ...held, nextRepeatAt: at + REPEAT_DELAY_MS });
			}
		}

		return gestures;
	}

	/** An interval elapsed; emit whatever holds and repeats have come due. */
	tick(at: number): Gesture[] {
		const gestures: Gesture[] = [];

		for (const [pusher, held] of [...this.held]) {
			if (held.chorded) {
				continue;
			}

			const threshold = this.thresholds[pusher];
			if (!held.holdFired && Number.isFinite(threshold) && at - held.downAt >= threshold) {
				gestures.push({ kind: 'hold', pusher, at, ms: at - held.downAt });
				this.held.set(pusher, { ...held, holdFired: true });
				continue;
			}

			if (held.nextRepeatAt !== null && at >= held.nextRepeatAt) {
				gestures.push({ kind: 'repeat', pusher, at });
				this.held.set(pusher, { ...held, nextRepeatAt: at + REPEAT_MS });
			}
		}

		return gestures;
	}

	/**
	 * A pusher came up.
	 *
	 * Every release is reported, because a face needs to stop showing the pressed state, but only a
	 * chord release carries an action: a plain press has already been acted on, and a hold has
	 * already fired.
	 */
	up(pusher: Pusher, at: number): Gesture[] {
		const held = this.held.get(pusher);
		if (!held) {
			return [];
		}
		this.held.delete(pusher);

		const gestures: Gesture[] = [{ kind: 'release', pusher, at, ms: at - held.downAt }];

		if (this.pendingChord !== null) {
			const chord = this.pendingChord;
			this.pendingChord = null;
			// Both members are marked chorded, so the survivor's own release emits no action either.
			gestures.push({ kind: 'chord', chord, at });
		}

		return gestures;
	}

	/** True while the named pusher is down. */
	isDown(pusher: Pusher): boolean {
		return this.held.has(pusher);
	}

	/** Forgets every held pusher, for a window that lost focus mid-press. */
	clear(): void {
		this.held.clear();
		this.pendingChord = null;
	}
}
