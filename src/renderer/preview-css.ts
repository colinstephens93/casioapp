/**
 * The face's appearance, as a string.
 *
 * Geometry lives in TypeScript; everything visual lives here, driven by the custom properties
 * emitted from `themeCss()`. That separation is what makes a colour pass a one-line change per
 * token, and it keeps the SVG markup free of presentation attributes.
 *
 * It is a string constant rather than a separate `.css` file because the preview inlines it into a
 * standalone page, and a plain text file cannot be imported by the renderer or typechecked.
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
