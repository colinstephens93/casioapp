/**
 * The terminal board, as HTML.
 *
 * The layout and the palette are Timan's: analog and map on the top row, the city beside a
 * seven-segment clock, then the zone list. It is drawn here rather than by embedding a terminal,
 * because a widget has to be a window, not a console.
 */
import { deskRows, focusIndex, type DeskRow, type DeskState } from '../shared/desk.ts';
import { bandColumn, isLand, WORLD_HEIGHT, WORLD_WIDTH } from '../shared/map.ts';
import {
	dayDiff,
	dstLabel,
	effectiveOffset,
	formatClock,
	formatDate,
	formatDay,
	formatDiff,
	formatOffset,
	offsetMinutes,
	wallClockAt,
	zoneAbbr,
} from '../shared/time.ts';

const MAP_COLUMNS = 64;
const MAP_ROWS = 16;

const ON: Record<string, string> = {
	'0': 'abcfed',
	'1': 'bc',
	'2': 'abged',
	'3': 'abgcd',
	'4': 'fgbc',
	'5': 'afgcd',
	'6': 'afgecd',
	'7': 'abc',
	'8': 'abcdefg',
	'9': 'abcfgd',
};

function esc(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

function lit(text: string, on: boolean): string {
	return `<span class="${on ? 'on' : 'off'}">${text}</span>`;
}

/** One digit, seven rows, unlit segments left visible the way an LCD leaves them. */
function digitRows(mask: string, wide: number): string[] {
	const has = (segment: string) => mask.includes(segment);
	const bar = (segment: string) => lit('▄'.repeat(wide), has(segment));
	const foot = (segment: string) => lit('▀'.repeat(wide), has(segment));
	const gap = ' '.repeat(Math.max(1, wide - 2));
	const stem = (left: string, right: string) => lit('█', has(left)) + gap + lit('█', has(right));
	return [bar('a'), stem('f', 'b'), stem('f', 'b'), foot('g'), stem('e', 'c'), stem('e', 'c'), foot('d')];
}

function colonRows(): string[] {
	const dot = lit('▄', true);
	const blank = lit(' ', false);
	return [blank, dot, blank, blank, dot, blank, blank];
}

function glyphRows(character: string, wide: number): string[] {
	if (character === ':') {
		return colonRows();
	}
	if (character === ' ') {
		return Array.from({ length: 7 }, () => lit(' '.repeat(wide), false));
	}
	return digitRows(ON[character] ?? '', wide);
}

function lcdBlock(text: string, wide: number): string[] {
	const glyphs = [...text].map((character) => glyphRows(character, wide));
	const rows: string[] = [];
	for (let line = 0; line < 7; line += 1) {
		// A gap between glyphs. Without it the two seconds digits are one smashed shape.
		rows.push(glyphs.map((glyph) => glyph[line] ?? '').join(' '));
	}
	return rows;
}

function clockFace(wall: Date): string {
	const hours = wall.getUTCHours() % 12;
	const minutes = wall.getUTCMinutes();
	const seconds = wall.getUTCSeconds();
	const hourAngle = (hours + minutes / 60) * 30;
	const minuteAngle = (minutes + seconds / 60) * 6;
	const secondAngle = seconds * 6;
	const hand = (angle: number, length: number, width: number, color: string) => {
		const rad = ((angle - 90) * Math.PI) / 180;
		const x = 50 + Math.cos(rad) * length;
		const y = 50 + Math.sin(rad) * length;
		return `<line x1="50" y1="50" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
	};
	const ticks = Array.from({ length: 12 }, (_, index) => {
		const rad = ((index * 30 - 90) * Math.PI) / 180;
		const inner = index % 3 === 0 ? 38 : 42;
		return `<line x1="${(50 + Math.cos(rad) * inner).toFixed(2)}" y1="${(50 + Math.sin(rad) * inner).toFixed(2)}" x2="${(50 + Math.cos(rad) * 46).toFixed(2)}" y2="${(50 + Math.sin(rad) * 46).toFixed(2)}" stroke="#6F8571" stroke-width="${index % 3 === 0 ? 2 : 1}"/>`;
	}).join('');
	return `<svg class="dial" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47" fill="#070a08" stroke="#3A4A3C" stroke-width="2"/>${ticks}${hand(hourAngle, 26, 3.2, '#C9F2B0')}${hand(minuteAngle, 36, 2, '#C9F2B0')}${hand(secondAngle, 40, 1, '#B7EC9A')}<circle cx="50" cy="50" r="2.2" fill="#C9F2B0"/></svg>`;
}

function landAt(column: number, row: number): boolean {
	const x0 = Math.floor((column * WORLD_WIDTH) / MAP_COLUMNS);
	const x1 = Math.max(x0 + 1, Math.floor(((column + 1) * WORLD_WIDTH) / MAP_COLUMNS));
	const y0 = Math.floor((row * WORLD_HEIGHT) / MAP_ROWS);
	const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * WORLD_HEIGHT) / MAP_ROWS));
	for (let y = y0; y < y1; y += 1) {
		for (let x = x0; x < x1; x += 1) {
			if (isLand(x, y)) {
				return true;
			}
		}
	}
	return false;
}

function mapHtml(offset: number): string {
	const band = bandColumn(offset, MAP_COLUMNS);
	const next = (band + 1) % MAP_COLUMNS;
	let cells = '';
	for (let row = 0; row < MAP_ROWS; row += 1) {
		for (let column = 0; column < MAP_COLUMNS; column += 1) {
			const inBand = column === band || column === next;
			const land = landAt(column, row);
			// Only land is marked. An ocean cell in the same columns was a full-height bar.
			const cls = land ? (inBand ? 'land band' : 'land') : '';
			cells += cls ? `<i class="${cls}"></i>` : '<i></i>';
		}
	}
	return `<div class="map-grid">${cells}</div>`;
}

function signedOffset(minutes: number): string {
	return formatOffset(minutes).replace('-', '−');
}

function panel(title: string, body: string, cls: string): string {
	return `<section class="panel ${cls}"><h2>${esc(title)}</h2>${body}</section>`;
}

function zoneDetail(row: DeskRow, at: Date, offset: number): string {
	const forced = dstLabel(row.zone, at, row.dst);
	if (row.dst !== 'auto') {
		return `UTC${signedOffset(offset)} · ${forced}`;
	}
	const abbr = zoneAbbr(row.zone, at);
	return [`UTC${signedOffset(offset)}`, abbr].filter((part) => part).join(' · ');
}

function listHtml(
	rows: readonly DeskRow[],
	selected: number,
	local: string,
	localOffset: number,
	at: Date,
	clock: DeskState['clock'],
): string {
	let seenCatalog = false;
	const lines = rows.map((row, index) => {
		let rule = '';
		if (row.catalog && !seenCatalog) {
			seenCatalog = true;
			rule = '<div class="rule"><span>all zones</span></div>';
		}
		const offset = effectiveOffset(row.zone, at, row.dst);
		const wall = wallClockAt(at, offset);
		const diff = row.ref === 'T0' ? 'local' : formatDiff(offset - localOffset);
		const day = dayDiff(row.zone, local, at);
		const marker = day === 0 ? '' : day > 0 ? `+${day}` : String(day);
		const where = row.ref === 'T0' ? 'local' : row.favorite ? 'favorite' : 'catalog';
		const mark = index === selected ? '▸' : row.favorite ? '★' : '';
		return `${rule}<button type="button" class="row${row.favorite ? ' favorite' : ''}${index === selected ? ' selected' : ''}" data-where="${where}" data-zone="${esc(row.zone)}"><span>${mark}</span><span>${esc(row.ref || '·')}</span><span class="name">${esc(row.name)}</span><span>${esc(signedOffset(offset))}</span><span>${esc(diff)}</span><span>${esc(formatClock(wall, clock, true))}</span><span>${esc(formatDay(wall))}</span><span>${esc(marker)}</span></button>`;
	});
	return `<div class="list">${lines.join('')}</div>`;
}

function footerHtml(notice: string): string {
	if (notice) {
		return `<p class="notice">${esc(notice)}</p>`;
	}
	return `<p class="hints"><span>↑↓ zone</span><span>←→ favorite</span><button type="button" data-action="favorite">f favorite</button><button type="button" data-action="dst">d DST</button><button type="button" data-action="clock">t 12/24</button></p>`;
}

/** The whole board for one instant. `local` is the system zone, which is always row T0. */
export function renderBoard(state: DeskState, at: Date, local: string, power: string, notice: string): string {
	const rows = deskRows(state, local);
	const selected = focusIndex(rows, state.focus);
	const row = rows[selected] ?? rows[0];
	if (!row) {
		return '';
	}

	const offset = effectiveOffset(row.zone, at, row.dst);
	const wall = wallClockAt(at, offset);
	const localOffset = offsetMinutes(local, at);
	const [hm = '--:--', ampm = ''] = formatClock(wall, state.clock).split(' ');
	const seconds = String(wall.getUTCSeconds()).padStart(2, '0');
	const digits = `<div class="readout"><div class="lcd">${lcdBlock(hm, 9)
		.map((line) => `<span class="lcd-line">${line}</span>`)
		.join('')}</div><div class="side"><span class="ampm">${esc(ampm)}</span><div class="lcd small">${lcdBlock(seconds, 3)
		.map((line) => `<span class="lcd-line">${line}</span>`)
		.join('')}</div></div></div>`;

	const infoTitle = row.ref || 'zone';
	const info = `<p class="dim">${esc(formatDate(wall))}</p><div class="hairline"></div><p class="city">${esc(row.name)}</p><div class="hairline"></div><p class="dim">${esc(zoneDetail(row, at, offset))}</p>`;
	const digital = `<p class="dim title">WORLD TIME</p><div class="lcd">${digits}</div><p class="dim power">${esc(power)}</p>`;

	return [
		panel('analog', clockFace(wall), 'analog'),
		panel('map', mapHtml(offset), 'map'),
		panel(infoTitle, info, 'info'),
		panel('digital', digital, 'digital'),
		panel('zones', listHtml(rows, selected, local, localOffset, at, state.clock), 'zones'),
		`<footer class="footer">${footerHtml(notice)}</footer>`,
		'<p class="mark">CASIO</p>',
	].join('');
}
