/**
 * A two-route probe: the same face drawn with `<use>`+`<symbol>` and with inline flat paths.
 *
 * ## Why this file exists
 *
 * The watch's digits came out blank in a real browser while every `<rect>`, `<circle>`, `<line>`,
 * `<text>` and `<path>` on the same page drew correctly. The common factor in the failures was
 * reference-based drawing. `scripts/svg_to_png.py` drew them perfectly — because it re-implements the
 * sprite lookup itself rather than following the SVG rules, so it was validating a construct the
 * browser refused. A verification tool that reimplements the thing it verifies cannot catch a fault in
 * that thing, and that is how a completely broken face passed every check for several milestones.
 *
 * So this generates one page holding **one face drawn each way**, and the question for a human is
 * simply which side shows digits. It is a diagnostic, not a deliverable: once the answer is known the
 * losing route comes out of `face.ts` and this file goes with it.
 *
 * Run: `node scripts/make-flat-probe.mjs` — writes `dist/preview/route-probe.html`.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { root } from './steps.mjs';

const entry = pathToFileURL(join(root, 'src', 'renderer', 'flat-probe.ts')).href;
const { renderRouteProbe } = await import(entry);

const outDir = join(root, 'dist', 'preview');
const html = renderRouteProbe();

writeFileSync(join(outDir, 'route-probe.html'), html, 'utf-8');
console.log(`wrote dist/preview/route-probe.html (${(html.length / 1024).toFixed(1)} KB)`);
