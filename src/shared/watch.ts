/**
 * The live watch: which zones are loaded, what the clock reads, and what the face is showing.
 *
 * This is the layer between the pure maths in `time.ts` / `catalog.ts` and the pure drawing in
 * `face.ts`. It holds mutable state and a clock, so it is deliberately headless — no DOM and no
 * Electron — which keeps it unit-testable and lets the same object drive the browser preview and
 * the widget.
 *
 * ## Why the offsets are cached on every sync
 *
 * `offsetMinutes` consults `Intl` for the instant in question, which is not free, and the face needs
 * the same offsets for the digits, the map band, the day marker and the DST label. They are computed
 * once per sync and stored, rather than recomputed by each consumer. That also means the face's
 * inputs are a snapshot that cannot disagree with itself halfway through a render.
 */
import { cityForZone, lcdCodeForZone } from './catalog.ts';
import {
	DST_MODES,
	civilDayDiff,
	type Clock,
	type DstMode,
	dstLabel,
	effectiveOffset,
	localZone,
	offsetMinutes,
	wallClock,
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

/** Everything the face needs, plus what the widget needs to persist. */
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

/**
 * Minimal persistence seam.
 *
 * Deliberately not `localStorage` directly: the widget will use a config file in the Electron main
 * process, and tests need neither. A one-method interface is enough for both.
 */
export interface WatchStore {
	load(): string | null;
	save(value: string): void;
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
	const index = Math.min(Math.max(settings.selected, 1), settings.slots.length) - 1;
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

const CONFIG_VERSION = 1;

interface StoredConfig {
	version: number;
	clock: Clock;
	selected: number;
	slots: { zone: string; dst: DstMode }[];
}

/**
 * Validates and repairs a stored configuration.
 *
 * A corrupt or partial file must never stop the clock: every field falls back to its default, and
 * unknown zones are replaced rather than trusted. See requirement PRS-4.
 */
export function parseSettings(raw: string | null): WatchSettings {
	const fallback = defaultSettings();
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

	const config = parsed as Partial<StoredConfig>;
	const slots: Slot[] = [];

	if (Array.isArray(config.slots)) {
		for (const entry of config.slots.slice(0, 4)) {
			if (typeof entry !== 'object' || entry === null) {
				continue;
			}
			const candidate = entry as { zone?: unknown; dst?: unknown };
			const zone = typeof candidate.zone === 'string' ? normaliseZone(candidate.zone) : undefined;
			if (!zone) {
				continue;
			}
			slots.push({ zone, dst: isDstMode(candidate.dst) ? candidate.dst : 'off' });
		}
	}

	// A register set without a Home City is meaningless, so fall back wholesale.
	if (slots.length < 4) {
		return fallback;
	}

	const clock = config.clock === '12h' || config.clock === '24h' ? config.clock : fallback.clock;
	const selected =
		typeof config.selected === 'number' && config.selected >= 1 && config.selected <= 4
			? Math.floor(config.selected)
			: fallback.selected;

	return { slots: slots as [Slot, Slot, Slot, Slot], clock, selected };
}

function isDstMode(value: unknown): value is DstMode {
	return value === 'auto' || value === 'on' || value === 'off';
}

/** Resolves a stored zone, accepting ICU's legacy spellings. */
function normaliseZone(zone: string): string | undefined {
	const city = cityForZone(zone);
	if (city) {
		return city.zone;
	}
	// An arbitrary IANA zone that is not in the catalogue is still legitimate.
	return offsetMinutesSafe(zone) ? zone : undefined;
}

function offsetMinutesSafe(zone: string): boolean {
	try {
		offsetMinutes(zone, new Date());
		return true;
	} catch {
		return false;
	}
}

/** Serialises settings for persistence. */
export function serialiseSettings(settings: WatchSettings): string {
	const config: StoredConfig = {
		version: CONFIG_VERSION,
		clock: settings.clock,
		selected: settings.selected,
		slots: settings.slots.map((slot) => ({ zone: slot.zone, dst: slot.dst })),
	};
	return JSON.stringify(config);
}

/**
 * Ticks once a second and notifies subscribers.
 *
 * The interval only wakes to re-derive the state; it does not accumulate elapsed time, so a
 * suspended or throttled timer cannot make the clock drift (requirement PRS-5). The current instant
 * is read fresh on every tick.
 */
export class Watch {
	private settings: WatchSettings;
	private state: WatchState;
	private timer: ReturnType<typeof setInterval> | null = null;
	private readonly listeners = new Set<(state: WatchState) => void>();
	private readonly store: WatchStore | undefined;
	private readonly now: () => Date;

	/**
	 * Constructor properties are written out longhand rather than as TypeScript parameter
	 * properties: `erasableSyntaxOnly` forbids the shorthand because it emits code, which is
	 * incompatible with Node's type stripping that lets the tests run without a build step.
	 */
	constructor(settings: WatchSettings, store?: WatchStore, now?: () => Date) {
		this.settings = settings;
		this.store = store;
		this.now = now ?? (() => new Date());
		this.state = syncWatch(settings, this.now());
	}

	/** Restores settings from the store, if one was supplied. */
	static restore(store: WatchStore, now?: () => Date): Watch {
		return new Watch(parseSettings(store.load()), store, now);
	}

	getState(): WatchState {
		return this.state;
	}

	subscribe(listener: (state: WatchState) => void): () => void {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	/** True while the interval is running. */
	get running(): boolean {
		return this.timer !== null;
	}

	start(): void {
		if (this.timer !== null) {
			return;
		}
		this.tick();
		this.timer = setInterval(() => this.tick(), 1000);
	}

	stop(): void {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/** Re-derives the state from the current instant. */
	tick(): void {
		this.state = syncWatch(this.settings, this.now());
		for (const listener of this.listeners) {
			listener(this.state);
		}
	}

	/** Selects a Multi Time register, 1..4. */
	selectRegister(index: number): void {
		if (index < 1 || index > this.settings.slots.length || index === this.settings.selected) {
			return;
		}
		this.update({ ...this.settings, selected: index });
	}

	/** Moves to the next Multi Time register, wrapping, as the watch's SEARCH press does. */
	nextRegister(): void {
		const next = (this.settings.selected % this.settings.slots.length) + 1;
		this.update({ ...this.settings, selected: next });
	}

	/** Sets the zone of a register. Selecting T-1 changes the Home City. */
	setZone(index: number, zone: string): void {
		const resolved = normaliseZone(zone);
		const slot = this.settings.slots[index - 1];
		if (!resolved || !slot) {
			return;
		}
		const slots = this.settings.slots.map((current, position) =>
			position === index - 1 ? { zone: resolved, dst: current.dst } : current,
		);
		this.update({ ...this.settings, slots });
	}

	/** Cycles a register's DST override through auto -> on -> off, the documented extension. */
	cycleDst(index: number): void {
		const slot = this.settings.slots[index - 1];
		if (!slot) {
			return;
		}
		const next = DST_MODES[(DST_MODES.indexOf(slot.dst) + 1) % DST_MODES.length] ?? 'off';
		const slots = this.settings.slots.map((current, position) =>
			position === index - 1 ? { zone: current.zone, dst: next } : current,
		);
		this.update({ ...this.settings, slots });
	}

	/** Toggles 12- and 24-hour presentation. */
	toggleClock(): void {
		this.update({ ...this.settings, clock: this.settings.clock === '24h' ? '12h' : '24h' });
	}

	private update(settings: WatchSettings): void {
		this.settings = settings;
		this.tick();
		if (this.store) {
			this.store.save(serialiseSettings(settings));
		}
	}
}
