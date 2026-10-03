# Environment notes — running this project inside DSH

This file records environment obstacles that cost real time to diagnose. Each one is a
property of the DSH sandbox this project is being developed in, not a defect in the project.
On an ordinary machine none of this applies.

## 1. npm cannot write its default cache — `cache` redirect — SOLVED

`npm install` fails with `EPERM` on `%LOCALAPPDATA%\npm-cache`, because the DSH file sandbox
confines writes to the session workspace. Fixed in `.npmrc`:

```
cache=.npm-cache
```

The registry itself is reachable (HTTP 200); only the cache path was the problem.

## 2. npm cannot run install scripts at all — SOLVED by doing it explicitly

Two independent blockers:

- **npm 12 blocks install scripts by default** unless the package is approved via
  `npm install-scripts approve`, which writes an `allowScripts` entry into `package.json`.
- **The DSH sandbox forbids spawning a child process with piped stdio**, which is exactly how
  npm executes install scripts. So `npm run <script>` cannot spawn anything: it dies with
  `spawn EPERM`.

The trap: **approving electron's install script makes things worse.** With `allowScripts`
present, npm *attempts* the postinstall spawn and the whole install fails. Without it, npm
simply skips the script and succeeds. So `allowScripts` must stay out of `package.json`.

`@electron/get` also caches to `%LOCALAPPDATA%\electron`, which is outside the sandbox.

The working sequence is therefore:

```
npm install              # toolchain + electron wrapper, no binary, exit 0
npm run fetch:electron   # downloads the binary itself, inherited stdio
```

`scripts/fetch-electron.mjs` sets `electron_config_cache` to a workspace-local directory and
runs electron's own `install.js` as a direct child.

## 3. `ELECTRON_RUN_AS_NODE=1` is set in this environment — SOLVED

This session has `ELECTRON_RUN_AS_NODE=1` in the environment. With it set, `electron.exe`
behaves as plain Node:

- no GUI initialises, and
- `require('electron')` resolves to **the npm wrapper package**, whose `index.js` ends in
  `module.exports = getElectronPath()` — a *path string*.

The symptom is:

```
TypeError: Cannot read properties of undefined (reading 'commandLine')
```

which looks like a code bug but is purely environmental. `scripts/run.mjs` deletes the
variable for the child process. **This would also break `npm start` for a human running in a
shell that inherits the variable**, which is why launching goes through a script rather than
calling `electron` directly.

## 4. Electron's GUI cannot run inside the DSH sandbox — UNRESOLVED

Three brute-force diagnostics, all run from this session:

| Test | Result |
|---|---|
| `notepad`, `mspaint` | Process starts, but `MainWindowHandle = 0` — **no visible window can be created in this session** |
| `electron --no-sandbox` | Main process starts (stdout confirms), then dies with `0xC0000005` (access violation) when the GPU/rendering process initialises |
| `electron` (default) | Dies at startup with `0x80000003` (breakpoint exception) |

Interpretation:

1. **DSH executes commands on a non-interactive desktop** (Session 3). GUI processes can start
   but cannot put a window on screen, so no window is ever visible to the user from here.
   This is a hard limit, not a configuration problem.
2. Chromium additionally **requires named pipes** for its multi-process IPC, and this sandbox
   explicitly forbids opening them — which matches the `0xC0000005` crash once the Chromium
   sandbox is disabled, and the earlier `0x80000003` when it is enabled.

**Consequence: this environment cannot launch the widget.** It can still build it, typecheck
it, unit-test every headless module, and generate the renderer as static HTML/SVG — but the
window must be opened by a human on an ordinary desktop.

## 5. `node --test` spawns children — SOLVED with `--test-isolation=none`

Node's test runner spawns a child process per test file **with piped stdio**, so a plain
`node --test` fails with `spawn EPERM` on every file before a single assertion runs. The symptom is
misleading: it reports the *test file* as failing.

`npm test` therefore runs:

```
node --test --test-isolation=none "test/**/*.test.ts"
```

This runs every test file in the main process instead. It costs per-file isolation, which this
project does not rely on, and it works both here and on an ordinary machine.

Note also that source uses explicit `.ts` import specifiers, which Node's native type stripping
resolves directly — so the tests need no build step and no transpiler.

## 6. Spawning with *inherited* stdio does work

The restriction is specifically on **piped** stdio. `execFileSync(..., { stdio: 'inherit' })` and
`spawnSync(..., { stdio: 'inherit' })` both work, which is what lets:

- `scripts/steps.mjs` run `tsc` for the main/preload build, and
- `scripts/fetch-electron.mjs` run Electron's own `install.js`.

The build deliberately avoids shelling out for the shared/renderer step and uses the TypeScript
compiler API in process instead, so that step cannot fail for environmental reasons at all.

## 7. Visual verification IS possible, despite §4 — SOLVED with a custom rasteriser

§4 concludes that the widget cannot be seen in this sandbox. That is true of the *widget*, but not of
its **drawing**. The face is generated as an SVG string by a pure function, so it can be rasterised
to a PNG and the image inspected:

```
node scripts/build.mjs
node scripts/bundle-preview.mjs
node scripts/make-preview.mjs
node scripts/extract-svg.mjs 0 dist/preview/face-0.svg
python scripts/svg_to_png.py dist/preview/face-0.svg dist/preview/face-0.png 2
```

Why a custom rasteriser: every ready-made option is blocked here. Edge and Chromium die at
Chromium's named-pipe IPC even with `--no-sandbox` and `--headless=new`, and no SVG library
(`cairosvg`, `svglib`, `reportlab`) is installed. Pillow is, so `scripts/svg_to_png.py` implements
the small subset of SVG the renderer emits — paths, rects, circles, lines, text, and `<use>`
references into the glyph sprite.

It parses the **real generated SVG**, so what it draws is genuine renderer output rather than a
re-implementation. It is an inspection aid, not a source of truth: the unit tests and the browser
preview remain authoritative, and it ignores the decimal point (drawn as an arc).

This mattered more than expected. The first rasterisation exposed four defects that every test had
passed and no amount of reading the markup would have revealed:

1. **`text-anchor="center"`** — not a valid SVG value. `tsc` caught the type error, but it meant the
   bezel lettering was silently left-aligned instead of centred.
2. **The subdial was drawn over the date field**, so `THU` rendered as a malformed `EHU`.
3. **The date field ran into the city code** with only 0.18 units of clearance, producing `7-16TYO`.
4. **The seconds block was clipped** by the LCD's foot, and `ALM` overlapped the world map.

None of these are visible in markup and all are obvious in a picture.

## 8. What remains verifiable here, and what does not

**Verifiable in the sandbox:**

- TypeScript build and typecheck.
- All `src/shared` logic: time zones, offsets, DST, the city table, map band maths, the
  battery model, the mode state machine. This is why the plan makes that logic headless.
- The renderer as static HTML/CSS/SVG, opened in a normal browser.
- Snapshot tests over generated SVG.

**Not verifiable in the sandbox:**

- Anything needing a visible window: dragging, tray, taskbar suppression, always-on-top,
  resizing behaviour, the amber backlight wash in situ.
- Windows notifications actually appearing.
- Real Electron integration at all.
