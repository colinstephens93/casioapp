/**
 * Time zone maths via `Intl` only — no timezone library, no dependencies.
 *
 * Ported from the reference project's `src/time.ts` (MIT, see NOTICE.md) and re-typed.
 * Everything derives from the zone's offset in minutes at a given instant:
 *
 *   wall time = UTC instant + offset
 *
 * The wall clock is therefore a `Date` whose **UTC** fields hold the local fields. That is a
 * deliberate trick: it makes every calendar calculation (day of week, month length, leap
 * years, the ±1 day marker) fall out of the built-in date maths instead of hand-rolled tables.
 *
 * Strategy note: `Intl.DateTimeFormat` is asked for a *long offset* name (`GMT+05:45`) and the
 * minutes are parsed back out. That is the standard way to get a historical-correct offset for
 * an arbitrary instant, because it consults the bundled IANA database rather than a fixed table.
 */

/**
 * Legacy zone spellings that the bundled ICU still uses. `Intl.supportedValuesOf('timeZone')`
 * reports `Asia/Calcutta`, not `Asia/Kolkata`, so normalising here keeps the stored value
 * canonical no matter which spelling the platform hands us.
 */
const RENAMES: Readonly<Record<string, string>> = {
	'Africa/Asmera': 'Africa/Asmara',
	'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
	'America/Catamarca': 'America/Argentina/Catamarca',
	'America/Coral_Harbour': 'America/Atikokan',
	'America/Cordoba': 'America/Argentina/Cordoba',
	'America/Godthab': 'America/Nuuk',
	'America/Indianapolis': 'America/Indiana/Indianapolis',
	'America/Jujuy': 'America/Argentina/Jujuy',
	'America/Louisville': 'America/Kentucky/Louisville',
	'America/Mendoza': 'America/Argentina/Mendoza',
	'Asia/Calcutta': 'Asia/Kolkata',
	'Asia/Katmandu': 'Asia/Kathmandu',
	'Asia/Rangoon': 'Asia/Yangon',
	'Asia/Saigon': 'Asia/Ho_Chi_Minh',
	'Atlantic/Faeroe': 'Atlantic/Faroe',
	'Europe/Kiev': 'Europe/Kyiv',
	'Pacific/Enderbury': 'Pacific/Kanton',
	'Pacific/Ponape': 'Pacific/Pohnpei',
	'Pacific/Truk': 'Pacific/Chuuk',
};

/** Maps an ICU-legacy zone id to its current IANA name, or returns it unchanged. */
export function modernZone(id: string): string {
	return RENAMES[id] ?? id;
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(zone: string): Intl.DateTimeFormat {
	let formatter = offsetFormatters.get(zone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
		offsetFormatters.set(zone, formatter);
	}
	return formatter;
}

/** The zone's UTC offset at the given instant, in minutes. Nepal returns 345. */
export function offsetMinutes(zone: string, at: Date): number {
	const parts = offsetFormatter(zone).formatToParts(at);
	const name = parts.find((part) => part.type === 'timeZoneName')?.value;
	const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name ?? '');

	if (!match) {
		throw new Error(`unexpected offset for ${zone}: ${name ?? '(none)'}`);
	}
	if (!match[1]) {
		return 0;
	}

	const minutes = Number(match[2]) * 60 + Number(match[3]);
	return match[1] === '-' ? -minutes : minutes;
}

/** A `Date` whose UTC fields are the wall-time fields at the given offset. */
export function wallClockAt(at: Date, offset: number): Date {
	return new Date(at.getTime() + offset * 60_000);
}

/** A `Date` whose UTC fields are the wall-time fields in the given zone. */
export function wallClock(zone: string, at: Date): Date {
	return wallClockAt(at, offsetMinutes(zone, at));
}

/** Offset of `zone` relative to `referenceZone` at the given instant, in minutes. */
export function diffMinutes(zone: string, referenceZone: string, at: Date): number {
	return offsetMinutes(zone, at) - offsetMinutes(referenceZone, at);
}

/**
 * Civil date difference in whole days (−1, 0, +1).
 *
 * Deliberately computed from the two **calendar dates**, not from the hour difference. Tokyo is
 * +9 from London, so 23:00 in London is already tomorrow in Tokyo even though the hour gap is
 * less than 24 — deriving this from hours would report 0.
 */
export function civilDayDiff(offset: number, referenceOffset: number, at: Date): number {
	const civil = (date: Date): number =>
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

	return (
		(civil(wallClockAt(at, offset)) - civil(wallClockAt(at, referenceOffset))) / 86_400_000
	);
}

/** Civil date difference between a zone and the reference zone (−1, 0, +1). */
export function dayDiff(zone: string, referenceZone: string, at: Date): number {
	return civilDayDiff(offsetMinutes(zone, at), offsetMinutes(referenceZone, at), at);
}

/**
 * Per-zone DST override.
 *
 * The real watch has only two states (DST on / off). `auto` is this project's documented
 * extension: it follows the IANA rules instead of a manual toggle. See requirement DST-3.
 */
export type DstMode = 'auto' | 'on' | 'off';

export const DST_MODES: readonly DstMode[] = ['auto', 'on', 'off'];

/**
 * The zone's standard and summer offsets for a year.
 *
 * Derived by sampling 1 January and 1 July: the smaller offset is standard. Taking the minimum
 * rather than assuming January is winter is what makes the southern hemisphere correct, where
 * January *is* summer.
 */
export function dstOffsets(zone: string, year: number): { std: number; dst: number } {
	const january = offsetMinutes(zone, new Date(Date.UTC(year, 0, 1)));
	const july = offsetMinutes(zone, new Date(Date.UTC(year, 6, 1)));
	return { std: Math.min(january, july), dst: Math.max(january, july) };
}

/** True when the zone has no DST, in which case a manual override cannot do anything. */
export function hasDst(zone: string, year: number): boolean {
	const { std, dst } = dstOffsets(zone, year);
	return std !== dst;
}

/** The offset to display, honouring the DST override. */
export function effectiveOffset(zone: string, at: Date, mode: DstMode): number {
	if (mode === 'auto') {
		return offsetMinutes(zone, at);
	}
	const { std, dst } = dstOffsets(zone, at.getUTCFullYear());
	return mode === 'on' ? dst : std;
}

/**
 * The DST indicator text.
 *
 * `DST` = following IANA and currently in summer time. `DST*` / `STD*` = forced by the user, the
 * asterisk marking a manual override. Empty = standard time on auto, or a zone with no DST at
 * all, where the override is inert.
 */
export type DstLabel = '' | 'DST' | 'DST*' | 'STD*';

export function dstLabel(zone: string, at: Date, mode: DstMode): DstLabel {
	const { std, dst } = dstOffsets(zone, at.getUTCFullYear());
	if (std === dst) {
		return '';
	}
	if (mode === 'on') {
		return 'DST*';
	}
	if (mode === 'off') {
		return 'STD*';
	}
	return offsetMinutes(zone, at) === dst ? 'DST' : '';
}

/** `-03:00`, `+05:45`. Uses an ASCII hyphen; caller decides presentation. */
export function formatOffset(minutes: number): string {
	const abs = Math.abs(minutes);
	const hh = String(Math.floor(abs / 60)).padStart(2, '0');
	const mm = String(abs % 60).padStart(2, '0');
	return `${minutes < 0 ? '-' : '+'}${hh}:${mm}`;
}

/** `+4h`, `-1h`, `+8h30`, `0h`. */
export function formatDiff(minutes: number): string {
	if (minutes === 0) {
		return '0h';
	}
	const abs = Math.abs(minutes);
	const hours = Math.floor(abs / 60);
	const mins = abs % 60;
	return `${minutes < 0 ? '-' : '+'}${hours}h${mins ? String(mins).padStart(2, '0') : ''}`;
}

export type Clock = '12h' | '24h';

/** `9:08 PM` or `21:08`, from a wall clock. */
export function formatClock(wall: Date, clock: Clock, seconds = false): string {
	const hours = wall.getUTCHours();
	const mins = String(wall.getUTCMinutes()).padStart(2, '0');
	const secs = seconds ? `:${String(wall.getUTCSeconds()).padStart(2, '0')}` : '';

	if (clock === '24h') {
		return `${String(hours).padStart(2, '0')}:${mins}${secs}`;
	}
	return `${hours % 12 || 12}:${mins}${secs} ${hours < 12 ? 'AM' : 'PM'}`;
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

const MONTHS = [
	'JAN',
	'FEB',
	'MAR',
	'APR',
	'MAY',
	'JUN',
	'JUL',
	'AUG',
	'SEP',
	'OCT',
	'NOV',
	'DEC',
] as const;

/** `FRI 25`, from a wall clock. */
export function formatDay(wall: Date): string {
	return `${WEEKDAYS[wall.getUTCDay()] ?? ''} ${wall.getUTCDate()}`;
}

/** `FRI 25 SEP 2026`, from a wall clock. */
export function formatDate(wall: Date): string {
	return `${formatDay(wall)} ${MONTHS[wall.getUTCMonth()] ?? ''} ${wall.getUTCFullYear()}`;
}

/** Month and day in the watch's `6-30` form, from a wall clock. */
export function formatMonthDay(wall: Date): string {
	return `${wall.getUTCMonth() + 1}-${wall.getUTCDate()}`;
}

/**
 * The zone's common abbreviation (EDT, BST, IST) when the platform knows one.
 *
 * Each locale only knows its own region's abbreviations, so several are tried in turn. Returns
 * undefined when every locale only reports a `GMT±n` form.
 */
const ABBR_LOCALES = ['en-US', 'en-GB', 'en-AU', 'en-IN', 'en-NZ', 'en-ZA', 'en-HK', 'en-SG'];

export function zoneAbbr(zone: string, at: Date): string | undefined {
	for (const locale of ABBR_LOCALES) {
		const formatter = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' });
		const name = formatter.formatToParts(at).find((part) => part.type === 'timeZoneName')?.value;
		if (name && !/^(GMT|UTC)/.test(name)) {
			return name;
		}
	}
	return undefined;
}

/** `America/New_York` -> `NEW YORK`; `America/Argentina/Buenos_Aires` -> `BUENOS AIRES`. */
export function zoneName(zone: string): string {
	const last = modernZone(zone).split('/').pop() ?? zone;
	return last.replaceAll('_', ' ').toUpperCase();
}

/** The system's zone. */
export function localZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Validates an IANA id and returns the spelling to store, or undefined.
 *
 * Accepts what the user typed, including aliases such as `US/Eastern`, correcting only case.
 * Rejects fixed offsets like `+03:00`, which `Intl` would otherwise accept.
 */
export function normalizeZone(input: string): string | undefined {
	if (!/^[A-Za-z]/.test(input)) {
		return undefined;
	}

	let resolved: string;
	try {
		resolved = new Intl.DateTimeFormat('en-US', { timeZone: input }).resolvedOptions().timeZone;
	} catch {
		return undefined;
	}

	for (const candidate of [modernZone(resolved), resolved]) {
		if (candidate.toLowerCase() === input.toLowerCase()) {
			return candidate;
		}
	}
	return input;
}

export function isValidZone(zone: string): boolean {
	return normalizeZone(zone) !== undefined;
}
