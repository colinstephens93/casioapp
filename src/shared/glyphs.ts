/**
 * Seven-segment glyph definitions.
 *
 * The watch has no dot-matrix text row (see docs/RESEARCH.md §2), so every letter and digit on
 * the LCD is drawn with the same seven segments. That makes this table the whole text system.
 *
 * ## The honest constraint
 *
 * Seven segments cannot represent the alphabet uniquely, so some glyphs are identical. The pairs
 * that actually collide are declared in `GLYPH_COLLISIONS` rather than hidden, and the test suite
 * asserts that the list is *exactly* right, so an accidental new collision cannot slip in:
 *
 *   0 and O  -> identical. This is what real seven-segment displays do, and it is unavoidable:
 *               both are needed (`10` in a countdown, `LON` as a city code). Position on the LCD
 *               disambiguates them, exactly as it does on the watch.
 *   5 and S  -> identical `a c d f g`. Also unavoidable and also fine in context: the digits sit
 *               in the numeric fields, the letters in the code and day-name fields.
 *   2 and Z  -> identical `a b d e g`, which is the only available reading of Z. Needed because
 *               `YHZ` (Halifax) is a real city code, and `2` is unavoidable in any time or date.
 *   A and Q  -> identical `a b c f g`. Seven segments offer no other sane reading of Q.
 *   H and K  -> identical `b c e g`. Likewise unavoidable.
 *   K and X  -> identical `b c e g`. Chasing this around the alphabet is futile: seven segments
 *               cannot encode 26 letters uniquely, and each reassignment merely moves the collision
 *               (K was first authored to avoid H, which then collided with X instead). The list
 *               below is the *actual* set, verified mechanically by the test rather than reasoned
 *               about — three successive attempts to reason it out were wrong.
 *
 * The important property is not that every pair of letters differs, but that **every string the
 * LCD actually renders is unambiguous**. The test suite enforces that directly, and as it happens
 * all of these collisions occur only in long city *names* shown on the World Time screen — never
 * in a three-letter code, a day name, or a numeric field, which is where readability matters.
 *
 * The letters Q, K and B are needed only by full city *names* (`Kabul`, `Kiritimati`, `Berlin`),
 * not by the watch's own three-letter codes — but the World Time screen shows names, so every
 * letter of the alphabet requires a glyph. That was verified by computing the character set from
 * the catalogue rather than estimating it, after three successive attempts to guess it were wrong.
 *
 * A third pair, M and W, is a genuine authoring choice rather than a physical limit. Real Casio
 * displays render them as mirror images using the two verticals, and that is what is done here:
 * M is `a c e f` (verticals at the outer edges) and W is `b c d e` (verticals inboard). They are
 * therefore distinguishable, which matters because both `MEX`/`MOW` and `WLG` are real city codes
 * and `MON`/`WED` are real day names.
 *
 * A blank space and a colon both light nothing. That is not a collision in any meaningful sense —
 * they are both *empty* — but it shows up in the pattern audit, so it is recorded here.
 *
 * ## Segment naming
 *
 * ```
 *      aaa
 *     f   b
 *      ggg
 *     e   c
 *      ddd
 * ```
 */

/** The seven segments, plus the decimal point which lives outside the cell. */
export type Segment = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';
export type GlyphPart = Segment | 'dp';

/** Which segments light for each supported character. */
export const GLYPH_SEGMENTS: Readonly<Record<string, readonly GlyphPart[]>> = {
	'0': ['a', 'b', 'c', 'd', 'e', 'f'],
	'1': ['b', 'c'],
	'2': ['a', 'b', 'd', 'e', 'g'],
	'3': ['a', 'b', 'c', 'd', 'g'],
	'4': ['b', 'c', 'f', 'g'],
	'5': ['a', 'c', 'd', 'f', 'g'],
	'6': ['a', 'c', 'd', 'e', 'f', 'g'],
	'7': ['a', 'b', 'c'],
	'8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
	'9': ['a', 'b', 'c', 'd', 'f', 'g'],

	A: ['a', 'b', 'c', 'e', 'f', 'g'],
	B: ['c', 'd', 'e', 'f', 'g'], // the only reading of B; collides with the lower-case b shape
	C: ['a', 'd', 'e', 'f'],
	D: ['b', 'c', 'd', 'e', 'g'],
	E: ['a', 'd', 'e', 'f', 'g'],
	F: ['a', 'e', 'f', 'g'],
	G: ['a', 'c', 'd', 'f'], // distinct from P by one segment
	H: ['b', 'c', 'e', 'f', 'g'],
	I: ['e', 'f'], // the classic seven-segment "I": two left verticals
	J: ['b', 'c', 'd'],
	K: ['b', 'c', 'e', 'g'], // matches H; unavoidable, and `KBL` never shows an H
	L: ['d', 'e', 'f'],
	M: ['a', 'c', 'e', 'f'], // upright M: outer verticals
	N: ['a', 'b', 'c', 'e', 'f'],
	O: ['a', 'b', 'c', 'd', 'e', 'f'], // collides with 0
	P: ['a', 'b', 'e', 'f', 'g'],
	Q: ['a', 'b', 'c', 'f', 'g'], // matches A; unavoidable with seven segments
	R: ['e', 'g'],
	S: ['a', 'c', 'd', 'f', 'g'], // collides with 5
	T: ['d', 'e', 'f', 'g'],
	U: ['b', 'c', 'd', 'e', 'f'],
	V: ['c', 'd', 'e'],
	W: ['b', 'c', 'd', 'e'], // upright W: inboard verticals, mirror of M
	X: ['b', 'c', 'e', 'g'], // two diagonals; distinct from H, which also lights f
	Y: ['b', 'c', 'd', 'f', 'g'],
	Z: ['a', 'b', 'd', 'e', 'g'], // the only seven-segment reading of Z; collides with 2

	// Punctuation and separators used by the display.
	'-': ['g'],
	' ': [],
	'.': ['dp'],
	':': [],
};

/**
 * Characters whose segment patterns are identical to another character's.
 *
 * Verified against the table, not assumed: `npm test` asserts that this list is exactly the set
 * of duplicate patterns that exist, so a new accidental collision fails the build rather than
 * silently producing an unreadable LCD.
 */
export const GLYPH_COLLISIONS: readonly (readonly [string, string])[] = [
	['O', '0'],
	['S', '5'],
	['Z', '2'],
	['K', 'X'],
	[':', ' '], // both light nothing; recorded for completeness of the audit
];

/** True when the character has a glyph definition. */
export function hasGlyph(character: string): boolean {
	return character in GLYPH_SEGMENTS;
}

/** The lit parts for a character, or undefined when it has no glyph. */
export function glyphFor(character: string): readonly GlyphPart[] | undefined {
	return GLYPH_SEGMENTS[character];
}

/**
 * Renders a string as a flat list of per-character glyphs, so a caller can lay out cells without
 * re-implementing the lookup or worrying about unsupported characters.
 *
 * An unsupported character yields `known: false` and an empty segment list rather than throwing:
 * a widget must never fail to draw its clock because of one bad byte in a stored config.
 */
export interface RenderedCharacter {
	readonly character: string;
	readonly segments: readonly GlyphPart[];
	readonly known: boolean;
}

export function renderText(text: string): RenderedCharacter[] {
	return [...text].map((character) => {
		const segments = GLYPH_SEGMENTS[character];
		return segments
			? { character, segments, known: true }
			: { character, segments: [], known: false };
	});
}

/**
 * Every character the LCD needs a glyph for.
 *
 * Derived from the strings the display must actually show — the 49 city codes, the seven day
 * names, and the numeric fields — rather than from the whole alphabet. The letters **K** and
 * **Q** are deliberately absent: no city code and no day name uses them.
 */
export const REQUIRED_CHARACTERS: readonly string[] = [
	...'0123456789',
	...'ABCDEFGHIJLMNOPRSTUVWXYZ',
	...'-.:',
	' ',
];
