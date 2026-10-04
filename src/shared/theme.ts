/**
 * Colour tokens and face metrics.
 *
 * The research could not measure exact values from product photography (see docs/RESEARCH.md §7),
 * so every colour here is a **modelled approximation** and lives as a named token rather than
 * being written inline. That is deliberate: plan risk R-8 expects a colour pass once the preview
 * has been compared against reference photographs, and that pass should be one edit per token.
 *
 * The token names describe the role, not the value, so the values can be corrected without
 * touching any drawing code.
 */
export const THEME = {
	// The LCD is a pale yellow-green, noticeably lighter and more yellow than an F-91W's grey-green,
	// and not a negative/olive panel.
	lcdBackground: '#cfd8a0',
	/** The faint printed dots that give the LCD its texture. */
	lcdTexture: '#bcc886',
	/** Unlit segments, visible as a ghost on a real LCD. */
	segmentOff: '#b6c184',
	/** Lit segments: dark green-black, with the main digits the darkest element. */
	segmentOn: '#1b2410',

	/** The lit time-zone band on the world map. */
	mapBand: '#3d4a22',
	/** Landmass inside the band stays visible against it. */
	mapLand: '#1b2410',

	/** Matte black resin case. */
	caseBody: '#141414',
	/** The two-piece case seam. */
	caseSeam: '#000000',
	/** Clipped corners catch light differently from the flat faces. */
	caseEdge: '#2a2a2a',
	/** Gold/ochre accent print: WORLD TIME, ILLUMINATOR, 10 YEAR BATTERY. */
	caseAccent: '#c9a15a',
	/** Neutral print: the button labels and the smaller dial text. */
	caseText: '#d8d8d8',
	/** The recessed LCD window bezel. */
	lcdBezel: '#0b0b0b',

	/** The amber LED backlight wash. */
	illumination: '#ffb347',

	/** The subdial's printed ring and hub. */
	dialRing: '#1b2410',
	dialHub: '#1b2410',
} as const;

export type ThemeToken = keyof typeof THEME;

/**
 * The drawing grid.
 *
 * One unit is 0.1 mm, so the case is the real 45 x 42.1 mm and every other measurement can be
 * entered in millimetres. Getting the case *proportions* right matters more than it sounds: the
 * watch is slightly taller than it is wide, and a square case reads as wrong immediately.
 *
 * The LCD is 340 x 326 units and holds four horizontal bands:
 *
 *   upper    subdial (left) and world map (right), which do not overlap
 *   band 2   the day/date field, then the city-code or alarm-number field
 *   band 3   the large HH:MM digits, with the PM indicator in a reserved gutter to their left
 *   band 4   the seconds block, on its own line
 *
 * The seconds get their own line because they cannot share one with the main digits: with the PM
 * indicator also needing space, a 12-hour value like `10:48 PM` at a readably large cell overflows
 * the LCD. This was caught by a bounds test rather than by eye, and the original single-row layout
 * was wrong.
 */
export const FACE = {
	/** Case width in units (45 mm). */
	width: 450,
	/** Case height in units (42.1 mm). */
	height: 445,
	/** Corner clip on the case's clipped-corner silhouette. */
	cornerClip: 34,
	/** Thickness of the outer case ring. */
	caseRim: 16,
	/** The LCD window inside the case. */
	lcd: { x: 55, y: 96, width: 340, height: 290 },
	/** The analog subdial, upper-left. Occupies x 75..185, y 120..230. */
	subdial: { cx: 130, cy: 161, r: 54 },
	/** The world map block, upper-right. Occupies x 200..370, y 128..199. */
	map: { x: 200, y: 122, width: 170 },
	/**
	 * The ALM/SIG indicator row, between the date row and the main digits.
	 *
	 * Side by side rather than stacked: a three-glyph label in the right column is tall enough to
	 * reach either the city-code row above or the main digits beside it, and the rendered-glyph
	 * overlap test found it colliding with a city code, an alarm number, and the main digits in
	 * turn. One row with both labels ends the argument.
	 *
	 * The `gap` is the clearance demanded above and below the row. Box-level non-overlap is not
	 * enough: two glyph cells can be strictly non-overlapping and still read as one object, which
	 * is exactly how `ALM` appeared to be part of `TYO` in the first rendered face. The tests
	 * enforce this gap rather than mere box separation.
	 */
	/**
	 * The ALM/SIG indicator row, between the date row and the main digits.
	 *
	 * Side by side rather than stacked: a three-glyph label in the right column is tall enough to
	 * reach either the city-code row above or the main digits beside it, and the rendered-glyph
	 * overlap test found it colliding with a city code, an alarm number, and the main digits in
	 * turn. One row with both labels ends the argument.
	 *
	 * The `gap` is the clearance demanded above and below the row. Box-level non-overlap is not
	 * enough: two glyph cells can be strictly non-overlapping and still read as one object, which is
	 * exactly how `ALM` appeared to be part of `TYO` in the first rendered face.
	 *
	 * ## Where the y values below come from
	 *
	 * They are **solved, not chosen**. The lower half of the panel carries five rows between the
	 * subdial's foot at y 175 and the LCD's foot at 422, and each row's cell height is fixed by the
	 * text sizes. Working up from the LCD's foot with a uniform 8-unit gap yields the numbers below;
	 * guessing them one at a time produced four successive collisions, each caught by a test but only
	 * after a round trip through the renderer. `LOWER_BANDS` records the derivation, and the layout
	 * test re-derives it so a future text-size change cannot silently break the stack.
	 */
	indicators: { almX: 330, sigX: 360, y: 254, gap: 6 },
	/**
	 * The day-of-week and month-day field.
	 *
	 * Starts inboard of the subdial's left edge because the dial sits directly above it: a field
	 * beginning at the LCD's left margin would put its first glyph under the dial's shadow.
	 */
	dateField: { x: 76, y: 219 },
	/** The city-code or alarm-number field, clear of the longest date value. */
	codeField: { x: 300, y: 219 },
	/**
	 * The DST indicator, on its own row above the date field.
	 *
	 * It cannot share the city-code row: the code is three glyphs wide, so a label placed a fixed
	 * distance to its right either overlaps a wide code or floats far from a narrow one. A fixed
	 * position on its own row is unambiguous. This was caught by the rendered-glyph overlap test,
	 * after a hand-computed offset silently put DST on top of `TYO`.
	 */
	dstIndicator: { x: 240, y: 198 },
	/**
	 * The main row: the large digits, and the second row beneath them.
	 *
	 * ## Why these are fixed columns rather than one computed row
	 *
	 * The first attempt put the seconds on the same line as the main digits, placed from the row's
	 * right margin. That works only while the main run is short enough: on the World Time screen the
	 * main digits reach x 307 — because `23:59` is five glyphs — and the day marker has to sit clear
	 * of them, so the seconds were pushed onto the marker. The rendered-glyph overlap test caught it
	 * on the World Time face and the rasterised Stopwatch face had already shown the same failure
	 * mode at a larger size.
	 *
	 * A fixed column cannot be pushed onto anything. The price is that the main run is bounded on the
	 * left rather than centred, which is what the real panel does anyway — its digits start at a fixed
	 * offset from the bezel and the seconds have a cell of their own.
	 *
	 * The vertical order is the whole layout: the date row, the indicator row, the main digits, then
	 * **one** sub-row shared by the seconds and the countdown's or stopwatch's sub-fields. There is no
	 * room for a third digit row: the budget below the city-code row is 138 units and these two rows
	 * plus the indicator row and their clearances come to 116 of it.
	 */
	row: {
		/** The leftmost x the main digits may start at, inboard of the bezel. */
		left: 78,
		/** The main digits' own row. */
		y: 275,
		/**
		 * The sub-row: the seconds, and on two screens the sub-fields beside them.
		 *
		 * They share the line because they are never both the subject of the screen — the seconds are
		 * the clock's least significant field and the sub-fields are the countdown's or stopwatch's
		 * most significant — so a column each is sufficient and a row each is not affordable.
		 *
		 * `secondsX` and `right` are far enough apart for the **stopwatch's** five-glyph sub-field
		 * (`:59.99`, 101 units at the sub cell) to sit clear of the two seconds digits (37 units at
		 * their cell) with an 8-unit gap between them. The countdown's four-glyph `:59.9` then sits
		 * inside that bound rather than setting it.
		 */
		secondsX: 236,
		subX: 272,
		subY: 324,
		/** The right margin the sub-field run must not cross, so a wide value cannot meet the bezel. */
		right: 395,
	},
	/** The leftmost x the countdown's and stopwatch's main digits may start at. */
	wideLeft: 98,
	/**
	 * The ±1 day marker, on the main row at the right.
	 *
	 * Clear of the main digits at their widest: `23:59` at the main cell reaches x 307 and a marker
	 * at 268 sat on top of it, which is what the overlap test reported for the World Time face.
	 */
	dayMarker: { x: 340, y: 281 },
	/** The schedule marker on an alarm screen: `1TIME` for a one-time alarm. */
	onceMarker: { x: 300, y: 281 },
	/** The PM indicator gutter, at the left of the main row in 12-hour format only. */
	pmIndicator: { x: 66, y: 281 },
	/** The MUTE marker, in the free right column beside the main digits. */
	muteIndicator: { x: 392, y: 281 },
	/** Where each pusher sits on the case sides, for the preview and for hit testing in M7. */
	pushers: {
		left: { x: -6, y: 150, width: 30, height: 46 },
		right: { x: 426, y: 150, width: 30, height: 46 },
	},
} as const;

/**
 * Cell widths for each text size on the face, in grid units, and the tracking used with them.
 *
 * The main time is the constraint the whole layout is built around: it carries up to eight
 * characters (`10:48 PM`), and at 340 units of LCD width that caps the cell at roughly 32 units
 * once the PM gutter is reserved. Everything else is sized around that budget rather than chosen
 * freely, which is why these numbers look tight.
 */
export const TEXT_SIZE = {
	/**
	 * The large hour:minute pair.
	 *
	 * Sized so that `10:48` and the seconds run beside it both fit the main row. It was 30 while the
	 * seconds had a line of their own, and moving them onto this row cost four units — which is the
	 * trade the real panel makes too, and the reason its main digits are not as tall as they look.
	 */
	mainTime: 26,
	/** The seconds run, beside the main digits on the same line. */
	seconds: 13,
	/**
	 * The countdown's and the stopwatch's sub-fields, on a line of their own beneath the main digits.
	 *
	 * Larger than the seconds because it carries four or five glyphs and has a whole line to itself —
	 * and because the countdown's tenth and the stopwatch's hundredths are the fields the operator is
	 * actually watching on those two screens. It sets the width of the sub-row: the seconds column
	 * has to leave room for the stopwatch's five-glyph `:59.99` before the right margin.
	 */
	subSecond: 16,
	/** Day-of-week, month-day, city code and alarm number. */
	field: 17,
	/** Bezel lettering on the case. */
	bezel: 13,
	/** The button labels beside the pushers. */
	pusherLabel: 10,
	/** The small indicators: ALM, SIG, DST, PM, T-n. */
	indicator: 9,
} as const;

export const TRACKING = {
	mainTime: 0.06,
	seconds: 0.06,
	subSecond: 0.08,
	field: 0.14,
	bezel: 0.22,
	pusherLabel: 0.18,
	indicator: 0.1,
} as const;

/**
 * The theme as CSS custom properties.
 *
 * Emitted into the SVG so the drawing code can be styled purely by class. That keeps every colour
 * in one place — a colour pass is then one edit per token — and it means the same SVG can be
 * recoloured by a host page without touching geometry.
 */
/**
 * The face's appearance, as a stylesheet.
 *
 * Geometry lives in `face.ts`; everything visual lives here, driven by the custom properties above. That
 * separation is what makes a colour pass a one-line change per token, and it keeps the SVG markup free
 * of presentation attributes.
 *
 * ## Why this is here and not in the preview
 *
 * It used to live in `src/renderer/preview-css.ts`, which was inlined into the preview **page** — and
 * `renderFace()` embedded only the variable block above. So the class names travelled with the SVG and
 * the rules that give them appearance did not. The consequences were invisible for as long as nobody
 * looked outside the preview:
 *
 * - the **widget** would have drawn every class unstyled — black glyphs and black map land on the pale
 *   LCD, and a black case on a black background;
 * - an SVG exported on its own (which is how the face was being inspected) had no colours at all;
 * - and the development rasteriser appeared to work only because it hard-codes this same table a second
 *   time in `scripts/svg_to_png.py`, so it was validating its own copy rather than the artefact.
 *
 * Keeping the stylesheet beside the tokens it consumes is the fix: the SVG is now self-contained, so
 * whatever renders it — the widget, the preview, a file on disk — gets the whole appearance.
 */
export const FACE_CSS = `
.watch {
	display: block;
}

/* ---- segments ------------------------------------------------------------------------- */

/* Unlit segments sit as a faint ghost on a real LCD, which is what gives the digits their shape
   even when off. Lit segments are dark green-black, with the main digits the darkest element. */
.watch .off {
	fill: var(--segment-off);
	opacity: 0.35;
}
.watch .lit {
	fill: var(--segment-on);
}

/* ---- case ----------------------------------------------------------------------------- */

.watch .case-body {
	fill: var(--case-body);
	stroke: var(--case-edge);
	stroke-width: 2;
}
.watch .case-seam {
	stroke: var(--case-seam);
	stroke-width: 3;
	fill: none;
}
.watch .pusher {
	fill: var(--case-edge);
	stroke: var(--case-seam);
	stroke-width: 1.5;
}
.watch .case-print {
	fill: var(--case-text);
	font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
	font-size: 13px;
	letter-spacing: 0.06em;
}
.watch .case-print.accent {
	fill: var(--case-accent);
}
.watch .bezel-text {
	font-size: 15px;
	letter-spacing: 0.16em;
}
.watch .pusher-label {
	font-size: 11px;
	letter-spacing: 0.1em;
}
.watch .battery-label {
	font-size: 11px;
	letter-spacing: 0.12em;
}
/* The battery percentage is only meaningful once the cell has started to drain. */
.watch .battery-value {
	fill: var(--lcd-background);
	font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
	font-size: 10px;
	opacity: 0.85;
}
/* The MUTE marker is a small filled triangle: the LCD's indicator column has no room for the word,
   which is printed on the case bezel instead. */
.watch .mute-icon {
	fill: var(--segment-on);
}

/* ---- interaction and settings --------------------------------------------------------- */

/* The flashing setting field (TIM-4, ALM-4, TMR-3). The flash is a *class*, not a different
   drawing, so the geometry never moves while a field blinks — which is what the real panel does. */
.watch .flashing {
	opacity: 0.15;
}

/* Pressing a pusher depresses it two units inward, which is the visible click the watch gives
   (INT-8). The chord state is expressed the same way, on both pushers at once. */
.watch .pusher.pushed {
	fill: var(--case-seam);
}

/* An alarm or the countdown sounding makes the ALM indicator blink (ALM-8). */
.watch .alm-indicator.alerting {
	animation: alm-blink 0.6s steps(2, end) infinite;
}
@keyframes alm-blink {
	0% {
		opacity: 1;
	}
	100% {
		opacity: 0.25;
	}
}

/* ---- LCD ------------------------------------------------------------------------------ */

.watch .lcd-bezel {
	fill: var(--lcd-bezel);
}
.watch .lcd-glass {
	fill: var(--lcd-background);
}
.watch .lcd-content {
	fill: none;
}

/* ---- world map ------------------------------------------------------------------------ */

.watch .map-band {
	fill: var(--map-band);
}
.watch .map-land {
	fill: var(--map-land);
	opacity: 0.85;
}
/* Land inside the lit band must stay readable against it (requirement MAP-6). */
.watch .map-land.in-band {
	fill: var(--lcd-background);
	opacity: 0.9;
}

/* ---- subdial -------------------------------------------------------------------------- */

.watch .dial-face {
	fill: var(--lcd-background);
}
.watch .dial-ring {
	fill: none;
	stroke: var(--dial-ring);
	stroke-width: 1.2;
	opacity: 0.55;
}
.watch .dial-tick {
	fill: var(--dial-ring);
}
.watch .dial-numeral {
	fill: var(--dial-ring);
	font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
	font-size: 9px;
	opacity: 0.8;
}
.watch .dial-hub {
	fill: var(--dial-hub);
}
/* Hands are dark segments on the light disc, thickest for the hour. */
.watch .dial-hand-hour {
	stroke: var(--dial-ring);
	stroke-width: 5;
	stroke-linecap: round;
}
.watch .dial-hand-minute {
	stroke: var(--dial-ring);
	stroke-width: 3.2;
	stroke-linecap: round;
}
.watch .dial-hand-second {
	stroke: var(--dial-ring);
	stroke-width: 1.4;
	stroke-linecap: round;
}

/* ---- backlight ------------------------------------------------------------------------ */

/* The amber LED wash, drawn over the whole case while LIGHT is held. */
.watch .illumination {
	fill: var(--illumination);
	opacity: 0.22;
	pointer-events: none;
	mix-blend-mode: screen;
}
`;

/**
 * The stylesheet to embed in a face: the tokens, then every rule that consumes them.
 *
 * Emitted into the SVG so that **the SVG is self-contained**. Anything that can render an SVG at all
 * will now draw the watch correctly — the widget, the preview, a file saved to disk, an image tag — and
 * none of them depends on a host page happening to supply the rules.
 */
export function themeCss(): string {
	const variables = Object.entries(THEME)
		.map(([name, value]) => `--${kebab(name)}: ${value};`)
		.join('');
	return `:root, .watch { ${variables} }\n${FACE_CSS}`;
}

/** `lcdBackground` -> `lcd-background`. */
function kebab(name: string): string {
	return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
