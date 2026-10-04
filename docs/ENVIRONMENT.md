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

### 4a. The same limit blocks headless screenshots, so keep a "render it and look" route — SETTLED

Confirmed again in the colour-pass session, this time by trying to use the *installed* browsers rather
than Electron, because a real screenshot would have been the ideal way to verify a visual change:

| Test | Result |
|---|---|
| `chrome --headless=new --no-sandbox --screenshot` | `FATAL: mojo\public\cpp\platform\platform_channel.cc:112 Check failed: . : Access is denied. (0x5)` — no image |
| `chrome --headless=old --no-sandbox --single-process --no-zygote` | Same fatal, same line. `--single-process` changes nothing |
| `msedge` / `chrome` binaries | Both found and both launch; both die at the same channel |

So this is **not** a missing-browser or a wrong-flags problem, and it is not worth retrying: the mojo
platform channel is the named-pipe requirement of point 2 above, and no combination of Chromium flags
removes its need for it. The `--single-process` attempt is worth recording because it *looks* like the
obvious workaround and fails identically.

**Consequence for how visual work is done here:** there is no way for an agent in this sandbox to see
what a browser sees. Every visual change therefore needs the human, and the best an agent can do is (a)
keep `scripts/svg_to_png.py` honest — see §7 — and (b) produce the watermarked iteration raster *and*
the preview page in one step, so the human's browser trip answers the question the raster cannot.

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
npm run build
node scripts/extract-svg.mjs 0 dist/preview/face-0.svg
python scripts/svg_to_png.py dist/preview/face-0.svg review/face-0.png 2 --label "what this is"
```

Write the **PNG** to `review/`, not to `dist/`: every build recleans `dist/`, so a raster left there is
deleted by the next one — which is how the rasters from one session were lost. `review/` is not
gitignored.

Note that `extract-svg.mjs 0` is the **Live** card, because the interactive card is now first on the
page. The fixed gallery starts at index 1.

Why a custom rasteriser: every ready-made option is blocked here. Edge and Chromium die at
Chromium's named-pipe IPC even with `--no-sandbox` and `--headless=new` — see §4a — and no SVG library
(`cairosvg`, `svglib`, `reportlab`) is installed. Pillow is, so `scripts/svg_to_png.py` implements
the small subset of SVG the renderer emits — paths, rects, circles, lines, text, and `<use>`
references into the glyph sprite.

It parses the **real generated SVG**, so what it draws is genuine renderer output rather than a
re-implementation. It is an inspection aid, not a source of truth: the unit tests and the browser
preview remain authoritative, and it ignores the decimal point (drawn as an arc).

### The palette is read from the SVG, not transcribed into the Python

This tool used to carry its own copy of the theme — a `TOKENS` dict and a `CLASS_STYLE` dict, both
hand-written. That made it a **third** copy of the colour model, and a copy is a thing that can
silently disagree with the original: a colour pass would have changed `theme.ts` while the rasteriser
kept drawing the old palette, and the image handed over for review would have been of a face that no
longer existed. That is the same failure as the sprite lookup it once re-implemented, and the project
has already paid for that lesson once.

So the table is gone. `parse_stylesheet()` reads the custom properties and the class rules out of the
`<style>` block that `renderFace()` embeds, resolves `var(--token)` against them, and **fails loudly**
if the SVG carries no stylesheet rather than falling back to substituted colours. `stroke`,
`stroke-width` and `font-size` are read the same way, which is what stopped the seams, the screw slots
and the subdial's ring rendering as shapeless fills.

What it still does not honour, and should not be trusted about: the CSS cascade beyond one class, the
`mix-blend-mode` on the illumination wash, text metrics beyond a single monospace face, and stroke
joins.

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

Note that this list has *shrunk* rather than grown: the config schema, its repair and its atomic write,
the window-clamping rules, and the notification payload are all now tested here, because they were
written as pure modules with no Electron import. See §10.

## 9. The Electron shell: what a human must check on a real desktop

The shell is written and reviewed, not run. Everything below is a claim the code makes that this
sandbox cannot confirm. It is ordered by how likely it is to be wrong, not by how important it is.

| # | Claim | Requirement | How to check |
|---|---|---|---|
| 1 | The widget launches at all | NFR-1 | `npm start` on a desktop where `ELECTRON_RUN_AS_NODE` is unset |
| 2 | It is frameless, transparent, and shows the case | WIN-1, WIN-7 | Look at it. A transparent window with no GPU compositing renders black, which is why `enable-transparent-visuals` is set |
| 3 | Dragging by the case works, and clicking a pusher does not drag | WIN-2, R-2 | Drag the case; then click each pusher. A pusher that drags means a `no-drag` rule is missing |
| 4 | A tray icon appears with a working menu | WIN-3 | Right-click the tray; toggle Show/Hide; the label must flip |
| 5 | No taskbar entry, and no Alt+Tab entry | WIN-4 | `skipTaskbar` covers the first; Alt+Tab is the one that surprises |
| 6 | Always-on-top yields to a fullscreen app | WIN-5, R-4 | Start a fullscreen film or game. **This is the least certain claim in the project**: Electron exposes no foreground-window handle, so `foregroundLooksFullscreen` uses the "display has no work area" proxy. An auto-hidden taskbar triggers it too |
| 7 | Resizing letterboxes rather than distorting | WIN-6, WIN-7, WIN-8 | Drag the window very wide, then very tall. The case must keep 450:445 and stay centred |
| 8 | Position and size survive a restart | WIN-9 | Move and resize, quit from the tray, relaunch |
| 9 | A window on a disconnected monitor is recoverable | WIN-9 | Move it to a second display, unplug that display, relaunch. The tray's *Reset window position* is the manual path; `clampToWorkAreas` is the automatic one |
| 10 | An alarm raises a toast that Focus Assist respects | ALM-10 | Set an alarm a minute out. Then turn Focus Assist on and repeat. The `alarm` scenario should still get through — see §11 |
| 11 | The on-face blink carries the alarm when the toast does not | ALM-11 | Deny notification permission in Windows settings and set an alarm |
| 12 | Clicking the toast raises the widget | ALM-10 | Hide to tray, set an alarm, click the toast |
| 13 | The context menu appears on a case right-click | INT-7 | Right-click the case. *Settings…* should reveal the config file in Explorer |
| 14 | The tray menu is keyboard-reachable | NFR-9 | Tab and arrow keys through the tray menu. This is the accessibility floor, since the rest of the widget is mouse-only by requirement |
| 15 | `npm run package` produces an installer that installs and runs | NFR-10 | `npm install electron-builder` first — it is deliberately not a dependency, see §2 |
| 16 | The installed shortcut carries the AppUserModelID | ALM-10 | Check `appId` in `electron-builder.yml` matches `APP_USER_MODEL_ID` in `src/main/notify.ts`. A mismatch silently attributes the toast to `electron.exe` |

Items 6, 10 and 16 are the three where I would expect a problem, and item 6 is where the code is
explicitly an approximation rather than an implementation.

## 10. Why so much of the shell *is* tested here

The main process is CommonJS and cannot be loaded in this sandbox. That does not mean none of it can be
tested — it means the split has to be deliberate. `src/main` therefore holds two kinds of file:

| Extension | Module system | Imports | Tested? |
|---|---|---|---|
| `.cts` | CommonJS, compiled by `tsc` | Electron, and Node built-ins | **Yes**, with a fake Electron — see §12 |
| `.ts` | ESM, compiled by the in-process transpiler | Node built-ins only | **Yes**, directly, with no build step |

The config schema, its per-field repair, the atomic write, the window-clamping rules and the
notification payload all live in `.ts` files, and `test/shell.test.ts` covers them — 32 tests.

**The boundary is load-bearing and easy to break.** A CommonJS file reaching an ESM one needs a dynamic
`import()` and a `resolution-mode` attribute on the type-only imports; see HANDOFF.md §5 for the details
and for why `tsconfig.main.json` sets `module: Node16` rather than `CommonJS`.

## 11. The notification scenario is a Windows toast XML attribute

Requirement ALM-10 asks for the notification to be "registered in the alarm category so Focus Assist is
respected". There is no `scenario` option on Electron's `Notification` — the property does not exist in
Electron's typings, and setting it is silently ignored. The category is an attribute of the **Windows
toast XML**, which Electron forwards verbatim through `toastXml`.

So the toast is built as XML in `src/main/notify.ts`, and `test/shell.test.ts` asserts the attribute is
present rather than trusting a caller to include it. The `<actions>` element is the other
non-decorative part: Windows expires a toast with nothing to act on, and an alarm should stay until it
is dismissed.

If the toast never appears on a real desktop, the things to check, in order: that
`app.setAppUserModelId` ran before the first toast; that `appId` in `electron-builder.yml` matches
`APP_USER_MODEL_ID`; and that Windows' notification settings allow the app at all — Focus Assist's
*priority* list is what the `alarm` scenario works around, not a blanket denial.

## 12. The fake Electron, and what it does and does not prove

`test/wiring.test.ts` runs the **built** `.cjs` shell against a recording stand-in for Electron
(`test/fake-electron.mjs`), so the window options, the tray menu, the notification construction, the IPC
surface and the process lifecycle are exercised rather than merely typechecked.

**How it works.** `module.registerHooks` (Node 22.15+) hooks `require` as well as `import`,
synchronously and in-process. The `resolve` hook rewrites the specifier `electron` to a private URL, and
the `load` hook returns the fake's source from that URL. Only `dist/main` and `dist/preload` are
intercepted, so anything else in the process that wanted the real module still gets it.

The ESM loader's `register()` cannot do this: `.cjs` files are CommonJS and the ESM loader refuses the
extension outright ("Unknown file extension .cjs"), so there is no way to import one in order to hook
it.

**What it proves.** That the shell passes the values it intends to the API it believes it is calling.
That is not a small thing in code that has never run: every Electron window option is optional, so
`nodeintegration` typechecks exactly as happily as `nodeIntegration`, and the symptom of getting it
wrong is a window in the taskbar rather than an error naming a line.

**What it does not prove.** That Electron honours any of it. `skipTaskbar: true` being passed is not the
taskbar entry being gone. `scenario="alarm"` being in the XML is not Focus Assist letting it through.
**The fake is an assertion about the shell's intent, not about Windows' behaviour**, and §9 remains the
only way to check the latter.

Two things to be careful of when reading these tests:

1. **The fake is written to match Electron's shapes, and a fake with the wrong shape is worse than no
   fake** — the assertion still runs, and still passes or fails, for the wrong reason. This bit during
   development: `isDestroyed` was a property where Electron has a method, so `main.cts`'s
   `getAllWindows().length === 0` guard silently never fired and a *correct* guard looked like a bug.
2. **The assertions were checked by mutation.** Twelve deliberate corruptions of the built modules —
   `skipTaskbar` off, `contextIsolation` off, the `screen-saver` level, `frame: true`, the toast
   scenario, the AppUserModelID, the sandbox flag, the tray labels, the icon data URL, `timeoutType`,
   `resizable`, and dropping `toastXml` — and all twelve were caught. One initially was not: the timer
   branch of `notificationFor` was reachable through `Notifier` but never asserted, which is now fixed.
   A test that cannot fail is not evidence, so the mutation pass is the evidence that this one can.

`npm test` needs `dist/` to exist for these tests; `npm run check` sequences typecheck, build and tests
so that a fresh checkout works in one command.
