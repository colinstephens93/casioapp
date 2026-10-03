/**
 * The city catalogue.
 *
 * Two things are separate here on purpose:
 *
 * - `code` is the three-letter label the watch prints on its LCD, and only the watch's own 47
 *   entries have one.
 * - `zone` is a full IANA identifier, which is what actually keeps the time correct.
 *
 * The manual claims "48 cities (31 time zones) and Coordinated Universal Time", but the city
 * code table it prints contains **46 cities plus UTC** across **30 distinct offsets**. All three
 * independent reproductions of the manual agree, so the discrepancy is Casio's, not a
 * transcription error. Requirement ZON-2 therefore forbids hard-coding 48/31: the table is data
 * and its size is computed. See docs/RESEARCH.md §5.
 *
 * A few entries carry `extended: true`. Those are zones this widget supports beyond the watch
 * (requirement ZON-5, ZON-6) — notably Chatham at +12:45 and Kathmandu at +05:45, the latter
 * being a zone the watch *does* list. They exist because a desktop clock that cannot show the
 * user's real offset is broken, which was the whole reason for keeping IANA behind the face.
 */
import { modernZone, offsetMinutes } from './time.ts';

export interface City {
	/** The watch's three-letter LCD label, where the watch has one. */
	readonly code?: string;
	/** Display name. */
	readonly name: string;
	/** IANA zone id — the source of truth for the time. */
	readonly zone: string;
	/** Standard-time offset in minutes, for reference and for ordering. */
	readonly refOffset: number;
	/** True when the watch itself does not list this city. */
	readonly extended?: true;
}

/**
 * The watch's city code table, in the order the manual prints it, west to east.
 *
 * `refOffset` is the *standard time* offset, matching the manual's table. The live offset is
 * always computed from the zone, never read from here.
 */
export const WATCH_CITIES: readonly City[] = [
	{ code: 'PPG', name: 'Pago Pago', zone: 'Pacific/Pago_Pago', refOffset: -660 },
	{ code: 'HNL', name: 'Honolulu', zone: 'Pacific/Honolulu', refOffset: -600 },
	{ code: 'ANC', name: 'Anchorage', zone: 'America/Anchorage', refOffset: -540 },
	{ code: 'YVR', name: 'Vancouver', zone: 'America/Vancouver', refOffset: -480 },
	{ code: 'LAX', name: 'Los Angeles', zone: 'America/Los_Angeles', refOffset: -480 },
	{ code: 'YEA', name: 'Edmonton', zone: 'America/Edmonton', refOffset: -420 },
	{ code: 'DEN', name: 'Denver', zone: 'America/Denver', refOffset: -420 },
	{ code: 'MEX', name: 'Mexico City', zone: 'America/Mexico_City', refOffset: -360 },
	{ code: 'CHI', name: 'Chicago', zone: 'America/Chicago', refOffset: -360 },
	{ code: 'NYC', name: 'New York', zone: 'America/New_York', refOffset: -300 },
	{ code: 'SCL', name: 'Santiago', zone: 'America/Santiago', refOffset: -240 },
	{ code: 'YHZ', name: 'Halifax', zone: 'America/Halifax', refOffset: -240 },
	{ code: 'YYT', name: "St. Johns", zone: 'America/St_Johns', refOffset: -210 },
	{ code: 'RIO', name: 'Rio De Janeiro', zone: 'America/Sao_Paulo', refOffset: -180 },
	{ code: 'FEN', name: 'Fernando de Noronha', zone: 'America/Noronha', refOffset: -120 },
	{ code: 'RAI', name: 'Praia', zone: 'Atlantic/Cape_Verde', refOffset: -60 },
	{ code: 'UTC', name: 'Coordinated Universal Time', zone: 'Etc/UTC', refOffset: 0 },
	{ code: 'LIS', name: 'Lisbon', zone: 'Europe/Lisbon', refOffset: 0 },
	{ code: 'LON', name: 'London', zone: 'Europe/London', refOffset: 0 },
	{ code: 'MAD', name: 'Madrid', zone: 'Europe/Madrid', refOffset: 60 },
	{ code: 'PAR', name: 'Paris', zone: 'Europe/Paris', refOffset: 60 },
	{ code: 'ROM', name: 'Rome', zone: 'Europe/Rome', refOffset: 60 },
	{ code: 'BER', name: 'Berlin', zone: 'Europe/Berlin', refOffset: 60 },
	{ code: 'STO', name: 'Stockholm', zone: 'Europe/Stockholm', refOffset: 60 },
	{ code: 'ATH', name: 'Athens', zone: 'Europe/Athens', refOffset: 120 },
	{ code: 'CAI', name: 'Cairo', zone: 'Africa/Cairo', refOffset: 120 },
	{ code: 'JRS', name: 'Jerusalem', zone: 'Asia/Jerusalem', refOffset: 120 },
	{ code: 'MOW', name: 'Moscow', zone: 'Europe/Moscow', refOffset: 180 },
	{ code: 'JED', name: 'Jeddah', zone: 'Asia/Riyadh', refOffset: 180 },
	{ code: 'THR', name: 'Tehran', zone: 'Asia/Tehran', refOffset: 210 },
	{ code: 'DXB', name: 'Dubai', zone: 'Asia/Dubai', refOffset: 240 },
	{ code: 'KBL', name: 'Kabul', zone: 'Asia/Kabul', refOffset: 270 },
	{ code: 'KHI', name: 'Karachi', zone: 'Asia/Karachi', refOffset: 300 },
	{ code: 'DEL', name: 'Delhi', zone: 'Asia/Kolkata', refOffset: 330 },
	{ code: 'KTM', name: 'Kathmandu', zone: 'Asia/Kathmandu', refOffset: 345 },
	{ code: 'DAC', name: 'Dhaka', zone: 'Asia/Dhaka', refOffset: 360 },
	{ code: 'RGN', name: 'Yangon', zone: 'Asia/Yangon', refOffset: 390 },
	{ code: 'BKK', name: 'Bangkok', zone: 'Asia/Bangkok', refOffset: 420 },
	{ code: 'SIN', name: 'Singapore', zone: 'Asia/Singapore', refOffset: 480 },
	{ code: 'HKG', name: 'Hong Kong', zone: 'Asia/Hong_Kong', refOffset: 480 },
	{ code: 'BJS', name: 'Beijing', zone: 'Asia/Shanghai', refOffset: 480 },
	{ code: 'TPE', name: 'Taipei', zone: 'Asia/Taipei', refOffset: 480 },
	{ code: 'SEL', name: 'Seoul', zone: 'Asia/Seoul', refOffset: 540 },
	{ code: 'TYO', name: 'Tokyo', zone: 'Asia/Tokyo', refOffset: 540 },
	{ code: 'ADL', name: 'Adelaide', zone: 'Australia/Adelaide', refOffset: 570 },
	{ code: 'GUM', name: 'Guam', zone: 'Pacific/Guam', refOffset: 600 },
	{ code: 'SYD', name: 'Sydney', zone: 'Australia/Sydney', refOffset: 600 },
	{ code: 'NOU', name: 'Noumea', zone: 'Pacific/Noumea', refOffset: 660 },
	{ code: 'WLG', name: 'Wellington', zone: 'Pacific/Auckland', refOffset: 720 },
];

/**
 * Zones this widget supports that the watch cannot show.
 *
 * Chatham is +12:45 and Kiritimati +14:00, both outside the watch's −11…+12 range; Marquesas at
 * −09:30 adds a fractional western offset the watch's table has no city for.
 */
export const EXTENDED_CITIES: readonly City[] = [
	{ name: 'Marquesas', zone: 'Pacific/Marquesas', refOffset: -570, extended: true },
	{ name: 'Chatham', zone: 'Pacific/Chatham', refOffset: 765, extended: true },
	{ name: 'Tonga', zone: 'Pacific/Tongatapu', refOffset: 780, extended: true },
	{ name: 'Kiritimati', zone: 'Pacific/Kiritimati', refOffset: 840, extended: true },
];

/** Every selectable city. */
export const CITIES: readonly City[] = [...WATCH_CITIES, ...EXTENDED_CITIES];

/** The watch's own count, derived rather than asserted: 46 cities plus UTC. */
export const WATCH_CITY_COUNT = WATCH_CITIES.filter((city) => city.code !== 'UTC').length;

const byZone = new Map<string, City>();
for (const city of CITIES) {
	byZone.set(modernZone(city.zone), city);
}

/** Looks up a city by zone id, normalising ICU's legacy spellings first. */
export function cityForZone(zone: string): City | undefined {
	return byZone.get(modernZone(zone));
}

/** Looks up a city by its three-letter code, case-insensitively. */
export function cityForCode(code: string): City | undefined {
	const wanted = code.toUpperCase();
	return CITIES.find((city) => city.code === wanted);
}

/**
 * The label to print on the LCD for a zone.
 *
 * A zone with a watch code uses it. An extended zone has no code the watch would recognise, so
 * a compact abbreviation of its name is used instead — the LCD has room for three glyphs.
 */
export function lcdCodeForZone(zone: string): string {
	const city = cityForZone(zone);
	if (city?.code) {
		return city.code;
	}
	const name = city?.name ?? zone.split('/').pop() ?? zone;
	return name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'UTC';
}

/**
 * The zones World Time scrolls and the setting screens pick from, **west to east**.
 *
 * Deliberately not sorted by *current* offset. That was the obvious first idea and it is wrong: a
 * Northern-Hemisphere city moves by an hour twice a year, so an offset-sorted list would reorder
 * itself under the operator — a city two steps east in July would be three steps east in January,
 * and the World Time index they left the widget on would point somewhere else after a restart. The
 * manual's table is fixed, and requirement WLD-1's "eastward" is a direction on that table.
 *
 * The order is derived by sorting on `refOffset` rather than taken from the source array's order,
 * because the source array's order is *not* strictly ascending: `ATH` is listed after `STO` though
 * both are +1, so a search from Stockholm eastward reached Athens and a search from London westward
 * wrapped past the whole table instead of reaching Lisbon. Sorting makes the direction a property
 * of the data instead of an accident of how the table was transcribed.
 *
 * The sort is stable with respect to the source order, so cities sharing an offset keep the
 * manual's relative order (LIS before LON, MAD before PAR before ROM before BER before STO).
 *
 * `UTC` is included, because requirement ZON-3 makes it selectable and WLD-3 makes it the one city
 * whose DST cannot be touched. The requirement's "UTC exclusion" is about DST only; removing it
 * from the list would break ZON-3.
 */
export function catalogueZones(): readonly string[] {
	return [...WATCH_CITIES]
		.sort((a, b) => a.refOffset - b.refOffset)
		.map((city) => city.zone);
}

/**
 * The zone's position in the manual's table, or −1 when it is not one of the watch's cities.
 *
 * Used to place a restored World Time index: a stored zone that the watch does not list (Chatham,
 * say, which requirement ZON-5 keeps available) has no position, and the caller falls back rather
 * than silently landing on Pago Pago.
 */
export function cataloguePosition(zone: string): number {
	const wanted = modernZone(zone);
	return catalogueZones().findIndex((candidate) => modernZone(candidate) === wanted);
}

/**
 * The catalogue sorted by *current* offset, west to east, with the excluded zones removed.
 *
 * `exclude` holds the zones already assigned to T-1…T-4, so the picker only offers what is
 * still available. Comparison is on the modern zone name, so a stored `Asia/Calcutta` correctly
 * excludes `Asia/Kolkata` rather than appearing alongside it.
 */
export function catalogFor(at: Date, exclude: readonly string[] = []): City[] {
	const skip = new Set(exclude.map((zone) => modernZone(zone)));

	return CITIES.filter((city) => !skip.has(modernZone(city.zone)))
		.map((city) => ({ city, offset: offsetMinutes(city.zone, at) }))
		.sort((a, b) => a.offset - b.offset || a.city.name.localeCompare(b.city.name))
		.map(({ city }) => city);
}
