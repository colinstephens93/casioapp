/**
 * Renders the route probe: one face drawn each way, for a human to say which one works.
 *
 * This is a **diagnostic**, not part of the widget. It exists because a construct can be valid SVG, can
 * satisfy every unit test, and can be drawn correctly by the development rasteriser, and still be blank
 * in a real browser — which is exactly what happened to the digits. The two routes are put side by side
 * with no other difference, so the only variable is the construct.
 *
 * The page carries no script and no external file: it is opened straight from disk, so nothing about it
 * can fail for a reason other than the SVG itself. Anything that could obscure the answer — a bundle, a
 * module import, a stylesheet — has been deliberately left out.
 */
import { renderFace } from './face.ts';
import { themeCss } from '../shared/theme.ts';
import { stateFor } from './preview.ts';

/** The page. */
export function renderRouteProbe(): string {
	// One scenario, rendered both ways. Built from the same fixed summer instant the preview gallery uses,
	// so the probe shows a real state rather than a hand-built stub that might differ from the widget.
	const state = stateFor({
		title: 'Timekeeping, 24-hour',
		note: 'Route probe.',
		zone: 'Asia/Tokyo',
		homeZone: 'Asia/Tokyo',
		at: new Date(Date.UTC(2026, 6, 15, 22, 48, 37)),
		clock: '24h',
		mode: 'timekeeping',
		dst: 'auto',
		alarmArmed: true,
	});

	const spriteFace = renderFace(state, 'sprite');
	const flatFace = renderFace(state, 'flat');

	const glyphCount = (svg: string): number => (svg.match(/<path/g) ?? []).length;

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Which route draws? — casioapp</title>
<style>
	${themeCss()}
	:root { color-scheme: dark; }
	body {
		margin: 0; padding: 24px; background: #0b0d0a; color: #e8e8e8;
		font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
	}
	h1 { font-size: 21px; margin: 0 0 6px; }
	p { margin: 0 0 8px; color: #a9b3a6; max-width: 62ch; }
	.warn { color: #ffcf7a; }
	.row { display: flex; gap: 36px; flex-wrap: wrap; margin-top: 22px; }
	.card { width: 470px; }
	.card h2 { font-size: 17px; margin: 0 0 2px; }
	.card .sub { color: #a9b3a6; font-size: 13px; margin: 0 0 10px; }
	.stage { background: #0c0e0b; border: 1px solid #2a2a2a; border-radius: 6px; padding: 8px; }
	.stage svg { display: block; width: 100%; height: auto; }
	code { color: #c9a15a; font-family: ui-monospace, monospace; font-size: 13px; }
	.badge {
		display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 12px;
		background: #1d2119; border: 1px solid #3a4033; color: #c9a15a;
	}
</style>
</head>
<body>
	<h1>Which of these two watches shows its digits?</h1>
	<p>
		The <b>only</b> difference between the two is how a character is drawn. Everything else — the case,
		the LCD, the subdial, the map, the colours — is identical, because both were produced by the same
		function with one argument changed.
	</p>
	<p class="warn">
		Please look carefully and tell me which card has dark digits across the middle. It is entirely
		possible that <b>neither</b> does, or that <b>both</b> do — all four answers are useful, and
		"neither" would point somewhere completely different.
	</p>

	<div class="row">
		<div class="card">
			<h2>1 — <span class="badge">reference route</span></h2>
			<p class="sub">
				Each character is a <code>&lt;symbol&gt;</code> instanced by <code>&lt;use href="#ch-…"&gt;</code>.
				This is what the watch used until now. ${glyphCount(spriteFace)} path elements.
			</p>
			<div class="stage">${spriteFace}</div>
		</div>

		<div class="card">
			<h2>2 — <span class="badge">flat route</span></h2>
			<p class="sub">
				Every lit segment written out as its own absolutely-positioned <code>&lt;path&gt;</code>.
				No <code>&lt;use&gt;</code>, no <code>&lt;symbol&gt;</code>, nothing referenced.
				${glyphCount(flatFace)} path elements.
			</p>
			<div class="stage">${flatFace}</div>
		</div>
	</div>

	<p style="margin-top: 22px">
		If card 2 draws and card 1 does not, the fix is already written: the widget switches to the flat
		route and the <code>&lt;symbol&gt;</code> sprite is deleted. If card 1 draws and card 2 does not,
		something is wrong with the flat geometry and I would want to know. If neither draws, the problem is
		not the glyph construct at all.
	</p>
</body>
</html>
`;
}
