/**
 * The configuration file on disk: its schema, its defaults, its repair, and its atomic write.
 *
 * This module is deliberately **self-contained**. It imports only Node built-ins — no Electron, and
 * no `src/shared` — for a structural reason rather than a stylistic one: `src/shared` is compiled to
 * **ESM** for the renderer, and the main process is **CommonJS**, so main cannot require it. Keeping
 * main's dependencies to Node and Electron is what makes that boundary unambiguous, and it is why this
 * module is a `.cts` file living beside the process that uses it.
 *
 * Being a `.cts` file also means Node's type stripping can load it directly, so everything here is
 * unit-tested in the sandbox with no Electron and no desktop.
 *
 * ## Why the schema is versioned from the first commit
 *
 * Plan decision 6. A settings file written by one version and read by another is the ordinary case for
 * a widget that lives on a desktop for years, and a format with no version field can only be migrated
 * by guessing.
 *
 * ## Why the write is atomic
 *
 * Requirement NFR-11. A settings file is rewritten often — every window move settles into one write —
 * and a crash mid-write on a non-atomic `writeFile` truncates it. The failure is not "the settings are
 * lost", it is "the widget starts with defaults and the user's alarms are gone". So:
 *
 *   1. write to a sibling temp file,
 *   2. `fsync` it, so the bytes are on the platter and not only in the page cache,
 *   3. `rename` over the target, which is atomic on NTFS and on POSIX.
 *
 * The `fsync` is not incidental. A rename is atomic with respect to *other readers*, not with respect
 * to power loss, and on Windows a rename that lands before the data has flushed can leave a
 * zero-length file — which is the exact outcome the sequence exists to prevent.
 *
 * ## Why every field is repaired rather than the file being validated wholesale
 *
 * Requirement PRS-4: an invalid or partial file falls back to defaults rather than failing to start.
 * The unit of repair is the **field**: a user who mistypes a zone should not lose their alarms, their
 * window position, or the mode they left it in. A file edited by hand is the case this exists for.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';

/** The configuration schema's version. Bumped when the shape changes incompatibly. */
export const CONFIG_VERSION = 2;

/** A window rectangle, in the screen coordinates Electron uses. */
export interface Bounds {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** A work area: the part of a display not covered by the taskbar. */
export interface WorkArea {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface WidgetConfig {
	readonly version: number;
	/** Window position and size (WIN-9). */
	readonly bounds: Bounds;
	/**
	 * True when the widget was hidden to the tray at quit, so it comes back hidden.
	 *
	 * WIN-3 gives the tray a Show/Hide toggle, which is only meaningful if the choice survives a
	 * restart.
	 */
	readonly hidden: boolean;
	/** The watch's own persisted state: registers, alarms, countdown, mode (PRS-1). */
	readonly watch: string;
	/** The simulated battery level, 0..1 (BAT-4). */
	readonly battery: number;
}

/** The default window: the case at a comfortable size, centred by the host on first run. */
export const DEFAULT_BOUNDS: Bounds = { x: 0, y: 0, width: 460, height: 560 };

/** Smallest usable window. Below this the case's letterboxing leaves no room for the device. */
export const MIN_SIZE = { width: 240, height: 280 } as const;

/** A fresh configuration, used on first run and as the fallback for every repair. */
export function defaultConfig(): WidgetConfig {
	return {
		version: CONFIG_VERSION,
		bounds: { ...DEFAULT_BOUNDS },
		hidden: false,
		watch: '',
		battery: 1,
	};
}

/** True when the value is a finite number, so a `NaN` from a hand-edited file cannot get through. */
function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Clamps a restored window into a work area, so a disconnected monitor cannot strand the widget.
 *
 * WIN-9 asks for position persistence, and its failure mode is the one worth guarding: the saved
 * position refers to a screen that is no longer attached, so on Windows the window appears somewhere
 * nobody can see or reach it. The tray's "reset position" is the recovery path; this is the
 * prevention.
 *
 * The rules, in order:
 *
 * 1. **Size is clamped** into the work area and never below `MIN_SIZE`. A window larger than the
 *    screen is unusable; one smaller than the case cannot be read.
 * 2. **Position is clamped** so a grab handle stays inside the work area. It is *not* forced fully
 *    inside: a widget deliberately hung off an edge is a legitimate arrangement and snapping it back
 *    would fight the user.
 * 3. A position that is *entirely* off every work area is replaced by a centred one, because there is
 *    no meaningful "nearest visible" for a window the user cannot see at all.
 */
export function clampToWorkArea(bounds: Bounds, work: WorkArea): Bounds {
	const width = Math.max(MIN_SIZE.width, Math.min(bounds.width, work.width));
	const height = Math.max(MIN_SIZE.height, Math.min(bounds.height, work.height));

	// How much of the window must remain visible in each axis. A widget is dragged by its case, so a
	// modest sliver is enough to grab.
	const visibleX = Math.min(48, width);
	const visibleY = Math.min(24, height);

	const offX = bounds.x + width <= work.x + visibleX || bounds.x >= work.x + work.width - visibleX;
	const offY = bounds.y + height <= work.y + visibleY || bounds.y >= work.y + work.height - visibleY;

	const x = offX
		? work.x + Math.round((work.width - width) / 2)
		: Math.min(Math.max(bounds.x, work.x - width + visibleX), work.x + work.width - visibleX);
	const y = offY
		? work.y + Math.round((work.height - height) / 2)
		: Math.min(Math.max(bounds.y, work.y - height + visibleY), work.y + work.height - visibleY);

	return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/**
 * Clamps a window into the nearest of several work areas.
 *
 * A multi-monitor desktop has one work area per display and the window must be tested against all of
 * them, not against a union — the union of two displays side by side also covers the gap between
 * them, where a window would be invisible.
 */
export function clampToWorkAreas(bounds: Bounds, workAreas: readonly WorkArea[]): Bounds {
	if (workAreas.length === 0) {
		return bounds;
	}
	// If any work area already holds the window well enough, clamp to that one and keep the position.
	for (const work of workAreas) {
		const clamped = clampToWorkArea(bounds, work);
		if (clamped.x === bounds.x && clamped.y === bounds.y) {
			return clamped;
		}
	}
	// Otherwise it is off every display: clamp to the first, which centres it on the primary.
	const first = workAreas[0];
	return first ? clampToWorkArea(bounds, first) : bounds;
}

/** True when a stored rectangle is usable, so a malformed one is replaced rather than clamped. */
function isBounds(value: unknown): value is Bounds {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Partial<Bounds>;
	return (
		isFiniteNumber(candidate.x) &&
		isFiniteNumber(candidate.y) &&
		isFiniteNumber(candidate.width) &&
		isFiniteNumber(candidate.height)
	);
}

/**
 * Parses a stored configuration, repairing every field that cannot be trusted.
 *
 * Never throws. This runs during startup, and a widget that refuses to start because its settings file
 * is corrupt is worse than one that starts in the wrong time zone.
 */
export function parseConfig(raw: string | null): WidgetConfig {
	const fallback = defaultConfig();
	if (!raw) {
		return fallback;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return fallback;
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return fallback;
	}

	const config = parsed as Partial<WidgetConfig>;
	return {
		// Reported as found, so the caller can tell an old file from a new one and a future file from a
		// corrupt one. `save` is what refuses to overwrite the future.
		version: isFiniteNumber(config.version) ? config.version : 0,
		bounds: isBounds(config.bounds) ? config.bounds : fallback.bounds,
		hidden: config.hidden === true,
		watch: typeof config.watch === 'string' ? config.watch : fallback.watch,
		battery: isFiniteNumber(config.battery) ? Math.min(1, Math.max(0, config.battery)) : fallback.battery,
	};
}

/**
 * Serialises a configuration, always stamping the current version.
 *
 * Written from the constant rather than carried through from the parsed file, so a configuration that
 * was repaired on read is stored as current.
 */
export function serialiseConfig(config: WidgetConfig): string {
	return JSON.stringify(
		{
			version: CONFIG_VERSION,
			bounds: config.bounds,
			hidden: config.hidden,
			watch: config.watch,
			battery: config.battery,
		},
		null,
		'\t',
	);
}

/**
 * True when a stored file was written by a *newer* build than this one.
 *
 * The caller must not overwrite such a file. Downgrading the widget — or running an older copy from a
 * different folder, which is how this happens in practice — would otherwise silently discard settings
 * the newer build understands, and the user would have no way to know.
 */
export function isFromTheFuture(config: WidgetConfig): boolean {
	return config.version > CONFIG_VERSION;
}

export interface ConfigStoreOptions {
	/** The directory the file lives in, normally Electron's `userData`. */
	readonly directory: string;
	/** The file's name. Overridable so a test can use a temporary directory. */
	readonly fileName?: string;
}

export interface LoadResult {
	readonly config: WidgetConfig;
	/** True when the file was unreadable, absent, or had fields that needed repair. */
	readonly repaired: boolean;
	/** True when the file exists but must not be overwritten. */
	readonly readOnly: boolean;
}

/**
 * The configuration file.
 *
 * Reads go to disk every time rather than being cached, because the file is documented as editable
 * outside the widget (PRS-4) and a cache would ignore an edit until the next restart. Writes are the
 * app's own and are rare.
 */
export class ConfigFile {
	private readonly path: string;
	private readonly directory: string;
	/** Set once a future-version file has been seen, so every later write is refused too. */
	private readOnly = false;

	constructor(options: ConfigStoreOptions) {
		this.directory = options.directory;
		this.path = join(options.directory, options.fileName ?? 'casioapp.json');
	}

	get filePath(): string {
		return this.path;
	}

	/** True when writes are being refused because the file belongs to a newer build. */
	get isReadOnly(): boolean {
		return this.readOnly;
	}

	/**
	 * Reads and repairs the configuration.
	 *
	 * Never throws: a missing directory, a missing file, a permissions error and a syntax error all
	 * produce defaults with `repaired: true`, because the widget has to be able to start.
	 */
	load(): LoadResult {
		let raw: string;
		try {
			raw = readFileSync(this.path, 'utf-8');
		} catch {
			// A missing file is the ordinary first run rather than a fault. Any other error is reported
			// the same way, because there is nothing useful the widget can do about it either.
			return { config: defaultConfig(), repaired: true, readOnly: false };
		}

		const config = parseConfig(raw);
		if (isFromTheFuture(config)) {
			// Remember it, so a later `save` cannot overwrite it either. Refusing only the first write
			// would leave the file intact until the user moved the window, which is seconds away.
			this.readOnly = true;
			return { config, repaired: false, readOnly: true };
		}

		return { config, repaired: differsFromStored(raw, config), readOnly: false };
	}

	/**
	 * Writes the configuration atomically.
	 *
	 * Returns false when the write was refused or failed. A failure is reported rather than thrown: a
	 * widget that cannot save its position should still be a working clock.
	 */
	save(config: WidgetConfig): boolean {
		if (this.readOnly) {
			return false;
		}

		const body = serialiseConfig(config);
		const temp = `${this.path}.tmp`;

		try {
			mkdirSync(this.directory, { recursive: true });
		} catch {
			return false;
		}

		let handle: number | null = null;
		try {
			handle = openSync(temp, 'w');
			writeSync(handle, body, null, 'utf-8');
			// The bytes must be on disk before the rename, or a power loss between the two leaves a
			// zero-length file where the settings used to be.
			fsyncSync(handle);
			closeSync(handle);
			handle = null;
			renameSync(temp, this.path);
			return true;
		} catch {
			if (handle !== null) {
				try {
					closeSync(handle);
				} catch {
					// Nothing useful to do; the temporary file is removed below.
				}
			}
			// Leave no temporary file behind, or the next run finds a stray `.tmp` beside the config.
			try {
				unlinkSync(temp);
			} catch {
				// It may never have been created.
			}
			return false;
		}
	}

	/** Removes the file, for the tray's "reset position". */
	reset(): boolean {
		this.readOnly = false;
		try {
			unlinkSync(this.path);
			return true;
		} catch {
			return false;
		}
	}
}

/**
 * True when the stored file is not already what we would write.
 *
 * Compared **structurally and order-independently**, not as text. A file that differs only in
 * whitespace or in the order a human's editor chose for its keys is not a repair, and reporting it as
 * one would fire the "your settings were reset" path on a file that was perfectly fine.
 *
 * `JSON.stringify` cannot do this comparison on its own: it preserves insertion order, so the same
 * object written by two editors compares unequal. That was the first version of this function, and it
 * reported a correctly-formatted file as damaged.
 */
function differsFromStored(raw: string, config: WidgetConfig): boolean {
	try {
		const stored: unknown = JSON.parse(raw);
		const canonical: unknown = JSON.parse(serialiseConfig(config));
		return stable(stored) !== stable(canonical);
	} catch {
		// `parseConfig` already returned defaults for unparseable input, so reaching here means the raw
		// text was not JSON and something was definitely repaired.
		return true;
	}
}

/**
 * A canonical string for a JSON value, with object keys in sorted order at every depth.
 *
 * Written rather than imported: it is ten lines, and a dependency for this would be the only one in the
 * project. Arrays keep their order, because an array's order is data — the register list and the alarm
 * list are arrays whose sequence means something.
 */
function stable(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stable).join(',')}]`;
	}
	if (typeof value === 'object' && value !== null) {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, entry]) => entry !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`;
	}
	return JSON.stringify(value) ?? 'null';
}
