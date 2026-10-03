// Writes the standalone preview page: one HTML file and one bundled script.
//
// The page must open by double-clicking, so the script is a classic bundle rather than an ES
// module (Chrome blocks module imports over `file://`). See scripts/bundle-preview.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The preview page is built by running its own render function under Node, which needs TypeScript
// type stripping. Node 22.6+ does this natively for .ts files. The path must be a file:// URL:
// the ESM loader rejects a bare Windows drive letter.
const entry = pathToFileURL(join(root, 'src', 'renderer', 'preview.ts')).href;
const { renderPreview } = await import(entry);

const outDir = join(root, 'dist', 'preview');

const html = renderPreview(new Date());
writeFileSync(join(outDir, 'index.html'), html, 'utf-8');

console.log(`wrote ${join('dist', 'preview', 'index.html')} (${(html.length / 1024).toFixed(1)} KB)`);
console.log(`bundle: ${(readFileSync(join(outDir, 'bundle.js'), 'utf-8').length / 1024).toFixed(1)} KB`);
