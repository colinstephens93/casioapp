/**
 * Extracts one rendered face from the preview page into a standalone `.svg` file.
 *
 * Why this exists: in the development sandbox the widget cannot be launched and the preview page
 * cannot be opened in a browser (see docs/ENVIRONMENT.md). But an SVG can be rasterised, and an
 * image *can* be inspected — which makes visual fidelity reviewable here after all, rather than
 * only on the user's machine.
 *
 * Usage: node scripts/extract-svg.mjs <scenario-index> <output.svg>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const index = Number(process.argv[2] ?? 0);
const outFile = process.argv[3] ?? join(root, 'dist', 'preview', `face-${index}.svg`);

const html = readFileSync(join(root, 'dist', 'preview', 'index.html'), 'utf-8');

// Take the Nth <svg class="watch">…</svg>. The page's own SVGs are the only ones present.
const matches = [...html.matchAll(/<svg class="watch"[\s\S]*?<\/svg>/g)];
const svg = matches[index]?.[0];

if (!svg) {
	console.error(`no face at index ${index}; the page has ${matches.length}`);
	process.exit(1);
}

// Standalone: add the XHTML namespace so the file opens on its own, and give it a background rect
// so the transparent case is visible when rasterised.
const standalone = svg
	.replace(
		'<svg class="watch"',
		'<svg xmlns:xlink="http://www.w3.org/1999/xlink" class="watch"',
	)
	.replace(
		/(<style>)/,
		'$1\n.watch { background: #0c0e0b; }\n',
	);

writeFileSync(outFile, standalone, 'utf-8');
console.log(`wrote ${outFile} (${(standalone.length / 1024).toFixed(1)} KB) from face ${index} of ${matches.length}`);
