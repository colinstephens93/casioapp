/**
 * The world map.
 *
 * The watch's map is a dot-matrix equirectangular projection with the time zone of the displayed
 * time lit as a **solid north-south band**. Because the projection is equirectangular, longitude
 * maps linearly to a column and UTC offset maps linearly to longitude, which makes band placement
 * pure arithmetic — and therefore testable without drawing anything.
 *
 * The land data is a 96x40 bitset generated from Natural Earth 110m land, the same source the
 * reference project used (see NOTICE.md). Each bit is one cell; 96 cells across 360 degrees is
 * 3.75 degrees per cell, and at a one-hour band width of two cells an hour is 15 degrees, so the
 * arithmetic stays exact.
 */
import { FACE } from './theme.ts';

/** Bitmap dimensions. 96 x 40 cells, 480 bytes, LSB first within each byte. */
export const WORLD_WIDTH = 96;
export const WORLD_HEIGHT = 40;

/**
 * The land bitset, base64, generated from Natural Earth 110m land.
 *
 * Kept as data rather than redrawn by hand: it is 480 bytes and it is *accurate*, whereas a
 * hand-authored coastline would be neither.
 */
const WORLD_BASE64 =
	'AADA3/8PADAAAgAAAABB5/8HEAAAGAAAAIDrC/4DAEDg/wIA8Pe+MvwB4AH1////+///MTwMuPn/////8P9/GBgA3v////93QPB/eAAAiP///z8EAOD/+wGA9P///x8EAMD//wCA/////x8AAID/fwCA/////x8AAID/HwDAadj//28AAID/DwDgtN///yMAAAD/DwBAB/z//xQAAAD+AwDgb/7//wAAAAA8BADg/9///wAAAAA4AADw/338/wAAAAAwCQDw//t4DgAAAADgAADw/zswHgEAAAAAAgDw/wcQHAAAAAAA8ADw/x8wgAIAAAAA+APg/h8AgAAAAAAA+AcA+A8ATAAAAAAA/A8A/AcAaAgAAAAA/H8A+AMAAGAAAAAA+H8A+AcAAIAAAAAA8D8A+AcAAAgAAAAA4D8A+BMAAF4AAAAA4B8A8BEAgP8AAAAA4AcA8BEAwP8BAAAA4AcA8AEAwP8BAAAA4AMA4AAAgPsBAAAA4AEAAAAAAOBAAAAAcAAAAAAAAABAAAAAYAAAAAAAAAAgAAAAMAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** Decoded bitset. Node and browsers both provide `atob`-equivalent decoding via this helper. */
function decodeLand(): Uint8Array {
	if (typeof Buffer !== 'undefined') {
		return Uint8Array.from(Buffer.from(WORLD_BASE64, 'base64'));
	}
	const binary = atob(WORLD_BASE64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

const LAND = decodeLand();

/** True when the cell at `x`, `y` is land. */
export function isLand(x: number, y: number): boolean {
	if (x < 0 || x >= WORLD_WIDTH || y < 0 || y >= WORLD_HEIGHT) {
		return false;
	}
	const bit = y * WORLD_WIDTH + x;
	const byte = LAND[bit >> 3] ?? 0;
	return (byte & (1 << (bit & 7))) !== 0;
}

/** Total land cells, for tests and sanity checks. */
export function landCellCount(): number {
	let count = 0;
	for (let y = 0; y < WORLD_HEIGHT; y += 1) {
		for (let x = 0; x < WORLD_WIDTH; x += 1) {
			if (isLand(x, y)) {
				count += 1;
			}
		}
	}
	return count;
}

/** Cells per row at equirectangular proportions: 96 / 40 = 2.4. */
export const MAP_ASPECT = WORLD_WIDTH / WORLD_HEIGHT;

/**
 * The leftmost column of the band for a UTC offset, on a map `width` cells wide.
 *
 * The map is Greenwich-centred: longitude −180 is column 0, 0 is the midpoint, and +180 is the
 * right edge. Longitude maps linearly to a column, and a zone's longitude is its offset from UTC
 * expressed in degrees, so the column follows directly.
 *
 * Two details matter and both were wrong in an earlier revision:
 *
 * 1. **Rounding, not flooring.** Partitioning the map into `width` cells means each cell spans a
 *    range of longitude, so the band should sit at the *nearest* cell to the zone's centre. Flooring
 *    systematically biases every band one cell west, which at the map's 3.75-degree resolution is a
 *    visible error at fractional offsets like Kathmandu's +05:45.
 * 2. **Offsets beyond +12:00 wrap westward, as they should.** Kiritimati's +14:00 is 210 degrees
 *    east of Greenwich, which on a −180..+180 map is 150 degrees *west* — so it must land in the
 *    Pacific near the left edge, not be clamped to the eastern rim.
 */
export function bandColumn(offsetMinutes: number, width: number): number {
	const longitude = (offsetMinutes / 60) * 15;
	const column = Math.round(((longitude + 180) * width) / 360);
	return ((column % width) + width) % width;
}

/**
 * The band's two columns.
 *
 * The band can straddle the antimeridian, where `bandColumn` wraps to the far edge, so the pair is
 * returned in the order `[left, right]` with the second wrapped. Callers must therefore test
 * membership rather than assuming `right === left + 1`.
 */
export function bandColumns(offsetMinutes: number, width: number): [number, number] {
	const column = bandColumn(offsetMinutes, width);
	return [column, (column + 1) % width];
}

/**
 * The band columns for a screen.
 *
 * This encodes requirement **MAP-4**, which is easy to get wrong: the map shows the zone of the
 * *displayed* time in Timekeeping and World Time, but reverts to the **Home City** in Alarm, Timer
 * and Stopwatch. The mode is therefore an input, and the fallback is structural rather than a
 * detail a caller has to remember.
 */
export type ScreenMode = 'timekeeping' | 'worldtime' | 'alarm' | 'timer' | 'stopwatch';

export function bandForMode(
	mode: ScreenMode,
	displayedOffset: number,
	homeOffset: number,
	width: number,
): [number, number] {
	const followsDisplayed = mode === 'timekeeping' || mode === 'worldtime';
	return bandColumns(followsDisplayed ? displayedOffset : homeOffset, width);
}

/** Rendered map layout: the cell grid inside the block it was given. */
export interface MapLayout {
	readonly x: number;
	readonly y: number;
	readonly cellWidth: number;
	readonly cellHeight: number;
	readonly columns: number;
	readonly rows: number;
}

/**
 * Fits the map inside a box, preserving the equirectangular proportion rather than stretching.
 *
 * A stretched map would misplace every band, so the fit is computed and the remainder is left
 * empty (requirement MAP-7).
 */
export function fitMap(x: number, y: number, width: number, height: number): MapLayout {
	// Take the largest map of the right proportions that fits, so a box with the wrong shape is
	// letterboxed rather than stretched.
	const widthIfWidthBound = width;
	const heightIfWidthBound = width / MAP_ASPECT;
	const widthIfHeightBound = height * MAP_ASPECT;

	const mapWidth = heightIfWidthBound <= height ? widthIfWidthBound : widthIfHeightBound;
	const mapHeight = mapWidth / MAP_ASPECT;

	return {
		x,
		y,
		cellWidth: mapWidth / WORLD_WIDTH,
		cellHeight: mapHeight / WORLD_HEIGHT,
		columns: WORLD_WIDTH,
		rows: WORLD_HEIGHT,
	};
}

/** Default layout for the face's map block. */
export function faceMapLayout(): MapLayout {
	return fitMap(FACE.map.x, FACE.map.y, FACE.map.width, FACE.map.width / MAP_ASPECT);
}

/**
 * Renders the map as SVG.
 *
 * The land is emitted as a grid of rects rather than as a scaled bitmap, because a raster image
 * would blur when the widget is resized (requirements DIS-1, DIS-2). Consecutive land cells on a
 * row are merged into a single rect, which cuts the element count by roughly half.
 */
export function renderMap(mode: ScreenMode, displayedOffset: number, homeOffset: number): string {
	const layout = faceMapLayout();
	const band = bandForMode(mode, displayedOffset, homeOffset, layout.columns);
	const inBand = (column: number): boolean => band[0] === column || band[1] === column;

	const parts: string[] = [];

	// The band is drawn first, as a full-height block behind everything.
	for (const column of band) {
		parts.push(
			`<rect class="map-band" x="${round(layout.x + column * layout.cellWidth)}" y="${round(layout.y)}" width="${round(layout.cellWidth)}" height="${round(layout.rows * layout.cellHeight)}" />`,
		);
	}

	// Then the land, merged along each row.
	for (let row = 0; row < layout.rows; row += 1) {
		// A vertical gap between dot rows gives the LCD's dotted texture.
		const cellHeight = layout.cellHeight * 0.82;
		let runStart = -1;

		for (let column = 0; column <= layout.columns; column += 1) {
			const land = column < layout.columns && isLand(column, row);
			if (land && runStart === -1) {
				runStart = column;
			} else if (!land && runStart !== -1) {
				const cells = column - runStart;
				parts.push(
					`<rect class="${inBand(runStart) ? 'map-land in-band' : 'map-land'}" x="${round(layout.x + runStart * layout.cellWidth)}" y="${round(layout.y + row * layout.cellHeight)}" width="${round(cells * layout.cellWidth * 0.86)}" height="${round(cellHeight)}" />`,
				);
				runStart = -1;
			}
		}
	}

	return `<g class="world-map">${parts.join('')}</g>`;
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}
