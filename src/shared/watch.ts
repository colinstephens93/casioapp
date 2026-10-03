/**
 * The zone-and-clock derivation: which zone a screen is showing, and what its clock reads.
 *
 * This is the layer between the pure maths in `time.ts` / `catalog.ts` and the pure drawing in
 * `face.ts`. It is a **pure function from settings to a snapshot** — no class, no timers, no
 * persistence, no store. Everything that changes over time lives in `controller.ts`, which owns the
 * screens, the alarms, the countdown, the stopwatch and the gestures.
 *
 * ## Why the offsets are cached on every sync
 *
 * `offsetMinutes` consults `Intl` for the instant in question, which is not free, and the face needs
 * the same offsets for the digits, the map band, the day marker and the DST label. They are computed
 * once per sync and stored, rather than recomputed by each consumer. That also means the face's
 * inputs are a snapshot that cannot disagree with itself halfway through a render.
 *
 * ## Why this is not `controller.faceState()`
 *
 * They overlap, and it is worth being precise about how. `syncWatch` answers "what does this zone
 * read at this instant". `faceState` answers "what is on the panel right now", which adds the screen,
 * the alarms, the countdown, the stopwatch and the interaction state. The controller builds the
 * second without the first, because it needs the displayed zone to be a *screen-dependent* choice —
 * the Home City in Alarm, Timer and Stopwatch, requirement MAP-4 — and `syncWatch` takes the
 * register as given.
 *
 * So this function's callers are the renderer's static preview and the tests that check the
 * derivation on its own. It is retained rather than folded into the controller because it is the
 * simplest statement of the offset rules, and it is what the map band's placement is verified
 * against. The class and the config reader that used to live here are gone: the controller owns
 * persistence, and having two owners of "the live watch" is how the zone-validation bug below got in.
 *
 * **What that removal cost, recorded so it is not repeated.** The class here validated every stored
 * zone before using it. The controller did not, and an unrecognised zone reaches `offsetMinutes`,
 * which throws — so a hand-edited config file killed `faceState()` and `tick()` on every frame. The
 * check is now in `controller.ts` as `resolveZone`, with a test. Deleting the old reader safely
 * required reading what it had accepted, not just what it had exported.
 */
import { cityForZone, lcdCodeForZone } from './catalog.ts';
import {
	type Clock,
	type DstMode,
	civilDayDiff,
	dstLabel,
	effectiveOffset,
	localZone,
} from './time.ts';

/** A zone register: the Home City is `T-1`, and `T-2`…`T-4` are the Local Times. */
export interface Slot {
	readonly zone: string;
	/** Per-zone DST override. Defaults to `off`, matching the watch's manual toggle. */
	readonly dst: DstMode;
}

export interface WatchSettings {
	/** Always four entries: T-1 (Home) plus T-2…T-4. */
	readonly slots: readonly Slot[];
	readonly clock: Clock;
	/** Which Multi Time register is displayed, 1..4. */
	readonly selected: number;
}

/** Everything `syncWatch` derives from the settings and an instant. */
export interface WatchState {
	readonly settings: WatchSettings;
	/** The instant the last sync used. */
	readonly at: Date;
	/** The register currently displayed. */
	readonly selected: number;
	/** Zone of the displayed register. */
	readonly zone: string;
	/** Zone of the Home City (T-1). */
	readonly homeZone: string;
	/** Offset of the displayed register, honouring its DST override. */
	readonly displayedOffset: number;
	/** Offset of the Home City, honouring its DST override. */
	readonly homeOffset: number;
	/** Wall-clock time in the displayed zone. */
	readonly wall: Date;
	/** Wall-clock time in the Home City. */
	readonly homeWall: Date;
	/** LCD code for the displayed zone. */
	readonly cityCode: string;
	/** DST indicator text for the displayed zone. */
	readonly dstLabel: string;
	/** Offset gap from the Home City, in minutes. */
	readonly diffFromHome: number;
	/** Civil-day difference from the Home City: -1, 0 or +1. */
	readonly dayDiff: number;
	/** True in the afternoon, for the PM indicator. */
	readonly pm: boolean;
}

/** Settings that match the watch out of the box: Home City plus three locals, all DST off. */
export function defaultSettings(zone = localZone()): WatchSettings {
	const home = zone;
	return {
		slots: [
			{ zone: home, dst: 'off' },
			{ zone: 'America/New_York', dst: 'off' },
			{ zone: 'Europe/London', dst: 'off' },
			{ zone: 'Asia/Tokyo', dst: 'off' },
		],
		clock: '24h',
		selected: 1,
	};
}

/** A `Date` whose UTC fields are the wall-clock fields of the given zone at the given instant. */
function wallFor(slot: Slot, at: Date): { offset: number; wall: Date } {
	const offset = effectiveOffset(slot.zone, at, slot.dst);
	return { offset, wall: new Date(at.getTime() + offset * 60_000) };
}

/** Derives the face's inputs from the settings at a given instant. */
export function syncWatch(settings: WatchSettings, at: Date): WatchState {
	const home = settings.slots[0] ?? { zone: localZone(), dst: 'off' as DstMode };
	const index = Math.min(Math.max(settings.selected, 1), Math.max(1, settings.slots.length)) - 1;
	const slot = settings.slots[index] ?? home;

	const displayed = wallFor(slot, at);
	const homeWall = wallFor(home, at);

	// The day marker and offset gap are both relative to the Home City, and must use the *effective*
	// offsets — a forced DST change has to move the calendar marker as well as the digits.
	const displayedOffset = displayed.offset;
	const homeOffset = homeWall.offset;
	const displayedWall = displayed.wall;

	const pm = displayedWall.getUTCHours() >= 12;

	return {
		settings,
		at,
		selected: index + 1,
		zone: slot.zone,
		homeZone: home.zone,
		displayedOffset,
		homeOffset,
		wall: displayedWall,
		homeWall: homeWall.wall,
		cityCode: lcdCodeForZone(slot.zone),
		dstLabel: dstLabel(slot.zone, at, slot.dst),
		diffFromHome: displayedOffset - homeOffset,
		// `civilDayDiff` takes offsets rather than zones, which is what is wanted here: a forced DST
		// override moves the offset without moving the zone, and the calendar marker must follow the
		// offset that is actually being displayed.
		dayDiff: civilDayDiff(displayedOffset, homeOffset, at),
		pm,
	};
}

/** The catalogue's entry for a zone, re-exported for callers that need the city behind a code. */
export { cityForZone };
