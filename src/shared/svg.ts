/**
 * Seven-segment geometry and SVG sprite generation.
 *
 * The face is drawn entirely as SVG with **no font and no raster image** (requirements DIS-1,
 * DIS-2, DAT-3). The geometry below is authored once and instanced many times, so a digit is a
 * class change on a reused `<use>` element rather than fresh geometry. That is what keeps the
 * digits crisp at 120 px and chunky at 700 px with no blur, and it is why no seven-segment font
 * would do: this watch's segment proportions are specific, and a font would guess at them.
 *
 * ## Coordinate system
 *
 * A single character cell is `CELL_WIDTH` x `CELL_HEIGHT` units, with a uniform margin. Segments
 * are laid out as a traditional seven-segment display:
 *
 * ```
 *       aaa
 *      f   b
 *       ggg
 *      e   c
 *       ddd
 * ```
 */
import { GLYPH_SEGMENTS, type GlyphPart } from './glyphs.ts';

/** Cell dimensions in user units. Callers scale the whole cell, never the geometry inside it. */
export const CELL_WIDTH = 60;
export const CELL_HEIGHT = 100;

/** How far in from the cell edge the segment runs. */
const MARGIN = 4;
/** Half the thickness of a segment. */
const T = 4.5;

const LEFT = MARGIN;
const RIGHT = CELL_WIDTH - MARGIN;
const TOP = MARGIN;
const MIDDLE = CELL_HEIGHT / 2;
const BOTTOM = CELL_HEIGHT - MARGIN;

const MID_X = CELL_WIDTH / 2;

/**
 * A horizontal bar whose outer edge spans `x1`..`x2` centred on `y`, with pointed ends.
 *
 * The callers below overlap the horizontal and vertical bars deliberately: segment `b` starts at
 * `MID_X - T` rather than at `MID_X`, so it meets segment `a` exactly. The paths also overlap each
 * other by design, which is why the sprite strokes them with round joins — a lit corner then has
 * no notch in it, and an unlit corner leaves a clean gap.
 */
function horizontalBar(x1: number, x2: number, y: number): string {
	return [
		`M ${x1} ${y}`,
		`L ${x1 + T} ${y - T}`,
		`L ${x2 - T} ${y - T}`,
		`L ${x2} ${y}`,
		`L ${x2 - T} ${y + T}`,
		`L ${x1 + T} ${y + T}`,
		'Z',
	].join(' ');
}

/** A vertical bar with pointed ends, spanning `y1`..`y2` centred on `x`. */
function verticalBar(x: number, y1: number, y2: number): string {
	return [
		`M ${x} ${y1}`,
		`L ${x + T} ${y1 + T}`,
		`L ${x + T} ${y2 - T}`,
		`L ${x} ${y2}`,
		`L ${x - T} ${y2 - T}`,
		`L ${x - T} ${y1 + T}`,
		'Z',
	].join(' ');
}

/** Path data for each segment, in cell coordinates. */
export const SEGMENT_PATHS: Readonly<Record<GlyphPart, string>> = {
	a: horizontalBar(LEFT, RIGHT, TOP),
	b: verticalBar(RIGHT, TOP, MIDDLE),
	c: verticalBar(RIGHT, MIDDLE, BOTTOM),
	d: horizontalBar(LEFT, RIGHT, BOTTOM),
	e: verticalBar(LEFT, MIDDLE, BOTTOM),
	f: verticalBar(LEFT, TOP, MIDDLE),
	g: horizontalBar(LEFT, RIGHT, MIDDLE),
	// The decimal point sits in the lower-right gutter, outside the segment block.
	dp: `M ${CELL_WIDTH - 4} ${CELL_HEIGHT - 10} a 5 5 0 1 1 0.01 0 Z`,
};

/** The order segments are emitted in, so generated markup is stable across builds. */
export const SEGMENT_ORDER: readonly GlyphPart[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];

/**
 * Builds the `<defs>` content: one path per segment, and one symbol per character.
 *
 * Each symbol instantiates all eight parts and marks the unlit ones, so a symbol is a fixed set of
 * references and the *instance* decides nothing. This trades a little markup size for the property
 * that a drawn character can never disagree with `GLYPH_SEGMENTS` — there is no second source of
 * truth for which segments spell what.
 */
export function buildSprite(): string {
	const paths = SEGMENT_ORDER.map(
		(part) => `<path id="seg-${part}" d="${SEGMENT_PATHS[part]}" />`,
	).join('');

	const symbols = Object.entries(GLYPH_SEGMENTS)
		.map(([character, lit]) => {
			const on = new Set<string>(lit);
			const uses = SEGMENT_ORDER.map((part) => {
				const className = on.has(part) ? 'lit' : 'off';
				return `<use href="#seg-${part}" class="${className}" />`;
			}).join('');

			return `<symbol id="ch-${glyphId(character)}" viewBox="0 0 ${CELL_WIDTH} ${CELL_HEIGHT}">${uses}</symbol>`;
		})
		.join('');

	return `<defs>${paths}${symbols}</defs>`;
}

/**
 * A symbol id safe to use in markup. Letters and digits pass through; punctuation is named, so no
 * escaping is needed at the reference site.
 */
export function glyphId(character: string): string {
	switch (character) {
		case '-':
			return 'dash';
		case ':':
			return 'colon';
		case '.':
			return 'dot';
		case ' ':
			return 'space';
		default:
			return character;
	}
}

/** A reference to one character, positioned and sized by the caller through `x`, `y` and `width`. */
export function glyphUse(character: string, x: number, y: number, width: number): string {
	const height = (width / CELL_WIDTH) * CELL_HEIGHT;
	return `<use href="#ch-${glyphId(character)}" x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" />`;
}

/**
 * Lays out a string as a row of characters.
 *
 * `tracking` is the gap between cells, as a fraction of the cell width. Unsupported characters
 * render as blanks rather than throwing, so a bad byte in a stored config can never stop the clock
 * from drawing (see `renderText` in glyphs.ts).
 */
export function textRun(
	text: string,
	x: number,
	y: number,
	cellWidth: number,
	tracking = 0.18,
): string {
	const advance = cellWidth * (1 + tracking);
	return [...text]
		.map((character, index) => glyphUse(character, x + index * advance, y, cellWidth))
		.join('');
}

/** Width a string will occupy, so callers can centre or right-align it. */
export function textWidth(text: string, cellWidth: number, tracking = 0.18): number {
	if (text.length === 0) {
		return 0;
	}
	const advance = cellWidth * (1 + tracking);
	return advance * text.length - cellWidth * tracking;
}

/** Trims float noise out of generated attributes, keeping the markup readable and diffable. */
function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}
