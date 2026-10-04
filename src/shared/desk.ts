/**
 * The world-time board: home zone, up to nine favourites, and the city catalogue.
 *
 * This is the state the widget draws. It is stored in the config file's opaque `watch` string,
 * which used to hold the watch face. A payload without `desk: 1` is an old face blob or empty,
 * and it falls back to the defaults rather than being misread as cities.
 */
import { CITIES, cityForZone } from './catalog.ts';
import {
	DST_MODES,
	hasDst,
	modernZone,
	normalizeZone,
	zoneName,
	type Clock,
	type DstMode,
} from './time.ts';

export const DESK_VERSION = 1;
export const MAX_SLOTS = 9;

/** A favourite. T0 is the system zone and is not stored here. */
export interface Slot {
	readonly zone: string;
	readonly dst: DstMode;
}

/** Which row is on the digital clock. `zone` is empty when `where` is `local`. */
export interface DeskFocus {
	readonly where: 'local' | 'favorite' | 'catalog';
	readonly zone: string;
}

export interface DeskState {
	readonly clock: Clock;
	readonly slots: readonly Slot[];
	readonly focus: DeskFocus;
}

export interface DeskRow {
	readonly ref: string;
	readonly zone: string;
	readonly name: string;
	readonly dst: DstMode;
	readonly favorite: boolean;
	readonly catalog: boolean;
}

export interface DeskResult {
	readonly state: DeskState;
	readonly notice: string;
}

const DEFAULT_ZONES = ['America/New_York', 'Europe/London', 'Asia/Tokyo', 'Asia/Hong_Kong'] as const;

function quiet(state: DeskState): DeskResult {
	return { state, notice: '' };
}

export function defaultDesk(): DeskState {
	return {
		clock: '12h',
		slots: DEFAULT_ZONES.map((zone) => ({ zone, dst: 'auto' as const })),
		focus: { where: 'favorite', zone: 'America/New_York' },
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isDst(value: unknown): value is DstMode {
	return typeof value === 'string' && (DST_MODES as readonly string[]).includes(value);
}

function isFocus(value: unknown): value is DeskFocus {
	if (!isRecord(value)) {
		return false;
	}
	if (value['where'] !== 'local' && value['where'] !== 'favorite' && value['where'] !== 'catalog') {
		return false;
	}
	return typeof value['zone'] === 'string';
}

/** Reads a saved board. Anything that is not this schema becomes the default board. */
export function parseDesk(raw: string): DeskState {
	if (!raw) {
		return defaultDesk();
	}
	let value: unknown;
	try {
		value = JSON.parse(raw) as unknown;
	} catch {
		return defaultDesk();
	}
	if (!isRecord(value) || value['desk'] !== DESK_VERSION) {
		return defaultDesk();
	}

	const clock: Clock = value['clock'] === '24h' ? '24h' : '12h';
	const slots: Slot[] = [];
	const seen = new Set<string>();
	if (Array.isArray(value['slots'])) {
		for (const entry of value['slots']) {
			if (!isRecord(entry) || typeof entry['zone'] !== 'string' || !isDst(entry['dst'])) {
				continue;
			}
			const zone = normalizeZone(entry['zone']);
			if (!zone || seen.has(modernZone(zone))) {
				continue;
			}
			seen.add(modernZone(zone));
			slots.push({ zone, dst: entry['dst'] });
			if (slots.length === MAX_SLOTS) {
				break;
			}
		}
	}

	const fallback = defaultDesk();
	const focus = isFocus(value['focus']) ? value['focus'] : fallback.focus;
	return { clock, slots, focus: focus.where === 'local' ? { where: 'local', zone: '' } : focus };
}

export function serialiseDesk(state: DeskState): string {
	return JSON.stringify({ desk: DESK_VERSION, clock: state.clock, slots: state.slots, focus: state.focus });
}

function rowFor(zone: string, ref: string, dst: DstMode, favorite: boolean, catalog: boolean): DeskRow {
	const city = cityForZone(zone);
	return {
		ref,
		zone,
		name: (city?.name ?? zoneName(zone)).toUpperCase(),
		dst,
		favorite,
		catalog,
	};
}

/** T0, then favourites, then every catalogue city that is not already showing. */
export function deskRows(state: DeskState, local: string): DeskRow[] {
	const rows: DeskRow[] = [rowFor(local, 'T0', 'auto', true, false)];
	const taken = new Set<string>([modernZone(local)]);
	state.slots.forEach((slot, index) => {
		rows.push(rowFor(slot.zone, `T${index + 1}`, slot.dst, true, false));
		taken.add(modernZone(slot.zone));
	});
	for (const city of CITIES) {
		if (taken.has(modernZone(city.zone))) {
			continue;
		}
		rows.push(rowFor(city.zone, city.code ?? '', 'auto', false, true));
		taken.add(modernZone(city.zone));
	}
	return rows;
}

export function focusOf(row: DeskRow): DeskFocus {
	if (row.ref === 'T0') {
		return { where: 'local', zone: '' };
	}
	if (row.favorite) {
		return { where: 'favorite', zone: row.zone };
	}
	return { where: 'catalog', zone: row.zone };
}

/** Index of the focused row, or `0` when the saved focus no longer exists. */
export function focusIndex(rows: readonly DeskRow[], focus: DeskFocus): number {
	if (focus.where === 'local' || rows.length === 0) {
		return 0;
	}
	const zone = modernZone(focus.zone);
	const index = rows.findIndex((row) => {
		if (modernZone(row.zone) !== zone) {
			return false;
		}
		if (focus.where === 'favorite') {
			return row.favorite && row.ref !== 'T0';
		}
		return row.catalog;
	});
	return index === -1 ? 0 : index;
}

export function focusedRow(state: DeskState, local: string): DeskRow {
	const rows = deskRows(state, local);
	return rows[focusIndex(rows, state.focus)] ?? rows[0]!;
}

function withFocus(state: DeskState, row: DeskRow): DeskState {
	return { ...state, focus: focusOf(row) };
}

/** Up and down through the whole list, without wrapping. */
export function moveSelection(state: DeskState, local: string, delta: number): DeskState {
	const rows = deskRows(state, local);
	const next = Math.max(0, Math.min(rows.length - 1, focusIndex(rows, state.focus) + delta));
	const row = rows[next];
	return row ? withFocus(state, row) : state;
}

/** Left and right through T0 and the favourites, wrapping. From the catalogue, jump to the near end. */
export function moveFavorite(state: DeskState, local: string, delta: number): DeskState {
	const rows = deskRows(state, local);
	const favorites = rows.filter((row) => row.ref === 'T0' || (row.favorite && !row.catalog));
	if (favorites.length === 0) {
		return state;
	}
	const current = rows[focusIndex(rows, state.focus)];
	const position = favorites.findIndex((row) => row === current);
	const target =
		position === -1
			? delta > 0
				? favorites[0]
				: favorites[favorites.length - 1]
			: favorites[(position + delta + favorites.length) % favorites.length];
	return target ? withFocus(state, target) : state;
}

export function toggleFavorite(state: DeskState, local: string): DeskResult {
	const rows = deskRows(state, local);
	const row = rows[focusIndex(rows, state.focus)];
	if (!row) {
		return quiet(state);
	}
	if (row.ref === 'T0') {
		return { state, notice: 'T0 is the local zone; it stays' };
	}
	if (row.favorite) {
		const slots = state.slots.filter((slot) => modernZone(slot.zone) !== modernZone(row.zone));
		return quiet({ ...state, slots, focus: { where: 'catalog', zone: row.zone } });
	}
	if (state.slots.some((slot) => modernZone(slot.zone) === modernZone(row.zone))) {
		return { state, notice: 'already a favorite' };
	}
	if (state.slots.length >= MAX_SLOTS) {
		return { state, notice: `limit of ${MAX_SLOTS} favorites` };
	}
	return quiet({
		...state,
		slots: [...state.slots, { zone: row.zone, dst: 'auto' }],
		focus: { where: 'favorite', zone: row.zone },
	});
}

export function cycleDst(state: DeskState, local: string, at: Date): DeskResult {
	const rows = deskRows(state, local);
	const row = rows[focusIndex(rows, state.focus)];
	if (!row) {
		return quiet(state);
	}
	if (row.ref === 'T0') {
		return { state, notice: 'T0 follows the system clock' };
	}
	if (!row.favorite) {
		return { state, notice: 'DST is for favorites only' };
	}
	if (!hasDst(row.zone, at.getUTCFullYear())) {
		return { state, notice: `${row.name}: no daylight saving time` };
	}
	const order = DST_MODES;
	const slots = state.slots.map((slot) => {
		if (modernZone(slot.zone) !== modernZone(row.zone)) {
			return slot;
		}
		const next = order[(order.indexOf(slot.dst) + 1) % order.length] ?? 'auto';
		return { ...slot, dst: next };
	});
	return quiet({ ...state, slots });
}

export function toggleClock(state: DeskState): DeskState {
	return { ...state, clock: state.clock === '12h' ? '24h' : '12h' };
}

export function focusRow(state: DeskState, where: DeskFocus['where'], zone: string): DeskState {
	return { ...state, focus: where === 'local' ? { where: 'local', zone: '' } : { where, zone } };
}
