# Handoff

Everything a fresh session needs to work on this project productively without rediscovering what has
already been learned the hard way. [NEXT-SESSION.md](NEXT-SESSION.md) says where the work stands.
Read [ENVIRONMENT.md](ENVIRONMENT.md) before running anything.

**One-line summary:** a desktop world-time board, opened by `World time.vbs` in Edge, plus the
AE-1200WH face on the preview page. The time engine, city table, map, face, five screens, pushers,
and the board are tested. Electron is written and still does not open a window on this PC. See
[NEXT-SESSION.md](NEXT-SESSION.md) for the current launch path and [PROGRESS.md](PROGRESS.md) for
how it got here.

## 1. Get running in three commands

```sh
npm install              # toolchain + electron package wrapper (NOT the binary)
npm run fetch:electron   # downloads the electron binary — separate for a sandbox reason
npm run build            # compiles, bundles the preview, generates it, verifies it
```

Then:

```sh
npm test                 # 439 tests. Wiring tests need a prior build; npm run check does both
npm run typecheck        # four tsconfigs — run this, see §5
```

**To see the board:** `npm run build`, then double-click `World time.vbs`. It opens
`dist/renderer/widget.html` in Edge. That file is a classic script bundle. Opening
`dist/renderer/index.html` from the file explorer fails in Edge, because that page is an ES module.

**To see the watch face:**

```
dist/preview/index.html
```

Open it in a browser. Nineteen cards: the *Live* face first, then eighteen fixed screens, with the
controls at the **top** of the page. The *Live* card is driven by the real `WatchController`, its
pushers can be clicked and held, and right-clicking the case opens the context menu (INT-7). The
card's own note says the desktop shortcut opens the board.

## 2. What this project is

Two surfaces:

1. **The desktop window** is a world-time board in the arrangement and palette of timan: analog clock,
   map, city, seven-segment digits, zone list. `src/renderer/board.ts` draws it. `World time.vbs`
   opens it in Edge. State lives in `src/shared/desk.ts`.
2. **The preview page** is the Casio AE-1200WH ("Royale", module 3198): steel case, pale LCD, dark
   blue digits, dot-matrix map, analog subdial, four pushers, and all five screens. `src/renderer/face.ts`
   draws it. `THEME` in `src/shared/theme.ts` is that face's palette.

Fan project. Not affiliated with or endorsed by Casio. See [NOTICE.md](../NOTICE.md).

| Document | Read it when |
|---|---|
| [NEXT-SESSION.md](NEXT-SESSION.md) | You need **where the work stands** and how to open the window. |
| [REQUIREMENTS.md](REQUIREMENTS.md) | You need the original AE-1200 specification. Every requirement has a stable ID (`WIN-*`, `DST-*`, …). The status banner at the top says what the shortcut now opens. |
| [PLAN.md](PLAN.md) | You need the milestone sequence for that specification. |
| [RESEARCH.md](RESEARCH.md) | You need a **fact about the watch**, with citations. |
| [ENVIRONMENT.md](ENVIRONMENT.md) | **Before running any command.** Sandbox traps, and the Electron crash that sent the shortcut to Edge. |
| [PROGRESS.md](PROGRESS.md) | You want the history. |

**Watch out:** the reference project's own README and GitHub description are stale. GitHub calls it
"Command line interface to get Timezone"; it is actually a terminal world clock. Trust the README, not
the repo blurb.



## 3. Architecture, and the rules that hold it together

```
src/shared/     logic: no DOM, no Electron. The lowest layer. Includes desk.ts, the board's state.
src/renderer/   board.ts (the window) and face.ts (the preview SVG). ESM.
src/main/       Electron main process (CommonJS, .cts)
src/preload/    the narrow context-bridge surface (CommonJS, .cts)
test/           unit tests, run directly by Node with no build step
scripts/        build, bundle, preview, rasterise, verify — all Node or Python
review/         watermarked iteration rasters of the face, outside the build's reach
World time.vbs  opens dist/renderer/widget.html in Edge
```

### Rule 1 — one-way dependency

`src/shared` must not import from `src/main`, `src/renderer` or `src/preload`, and must not touch the
DOM. The renderer *bundles* it; nothing in it reaches upward. This is what lets the same logic run
under Node for tests and in a browser for the preview, and it is why the time engine can be verified
without a window.

### Rule 2 — pure rendering

`renderFace(state)` is a **pure function from a plain data object to an SVG string.** No DOM, no
timers, no side effects. Everything conditional is a field on the state. This is what makes the face
snapshot-testable and what let the whole thing be rasterised for inspection.

Corollary: **timers for the watch face live in the `Watch` controller**, never inside `renderFace`.
The `T-n` register indicator is a `showRegister` boolean, not a 1-second timer inside the drawing
code. `renderBoard` is pure in the same way. The board's one-second repaint lives in
`src/renderer/index.ts`.

### Rule 3 — derive once per sync

`syncWatch` computes the offsets once and stores them. The digits, map band, day marker and DST label
all read the same snapshot, so they cannot disagree mid-render. A forced DST change moves all of them
together; there is a test asserting exactly that.

### Rule 4 — the layout is computed, not eyeballed

Every field position lives in `FACE` in `theme.ts` and every size in `TEXT_SIZE`/`TRACKING`. Tests
assert the fields fit inside the LCD, do not overlap, and that no two rendered glyphs intersect. **If a
layout test fails, the layout is wrong — change the constants, not the test.**

## 4. Map of the important modules

| File | What it owns | Notes |
|---|---|---|
| `src/shared/time.ts` | Offsets, wall clock, ±1 day marker, DST, formatting | Ported from the reference project (MIT), re-typed |
| `src/shared/catalog.ts` | The watch's 49 codes + extended zones | Modelled as **data**; the size is computed, never asserted as 48/31 |
| `src/shared/glyphs.ts` | Seven-segment encoding: which segments spell what | Typography of the watch face. The board has its own block digits in `board.ts` |
| `src/shared/svg.ts` | Segment geometry, the sprite builder, text layout | Geometry authored once, instanced via `<use>` |
| `src/shared/theme.ts` | Colour tokens and the face grid | One unit = 0.1 mm. The lower rows' y values are **solved**, not chosen — see §5 |
| `src/shared/map.ts` | Land bitset, band placement, `bandForMode` | Encodes the Home City fallback rule |
| `src/shared/alarms.ts` | The five alarms, the schedule cycle, the hourly signal | The **crossing test** lives here, not in the machine |
| `src/shared/timer.ts` | The countdown, against an injected instant | Absolute end instants; never accumulates |
| `src/shared/stopwatch.ts` | The three behaviours, the 24-hour rollover | No lap memory, by requirement |
| `src/shared/machine.ts` | **Every screen and sub-screen.** A pure reducer | What every pusher does, everywhere |
| `src/shared/gestures.ts` | Press, hold and chord at the watch's durations | Injectable clock; no timers |
| `src/shared/controller.ts` | **The watch face's clock** | Timers, cadence, persistence and the simulated battery for the five screens. The board's tick lives in `renderer/index.ts` |
| `src/shared/watch.ts` | The pure zone-and-clock derivation for the face | `syncWatch` only: settings plus an instant to a snapshot. Not a second owner of the watch — see §5 |
| `src/shared/desk.ts` | **The board's state.** T0, up to nine favourites, focus, 12/24, DST | A payload without `desk: 1` is an old face blob and falls back to the defaults |
| `src/renderer/face.ts` | **The watch-face layout.** Case, LCD, all fields | Pure; no DOM. The preview page draws this |
| `src/renderer/board.ts` | **The window's layout.** Analog, map, clock, zone list | Pure HTML from a `DeskState`. The shortcut shows this |
| `src/renderer/index.ts` | The widget page: binds the desk to the bridge or to `localStorage` | Key `worldtime.desk` when `window.widget` is absent |
| `src/renderer/preview.ts` | The standalone preview page and its inline script | The inline script is a template string — see §5 |
| `src/main/config.ts` | The config schema, repair, clamping, atomic write | **ESM and Electron-free**, so it is unit-tested — see §5 |
| `src/main/notify.ts` | The notification payload and the toast XML | **ESM and Electron-free**, likewise |
| `src/main/main.cts` | The process: window, tray, IPC, lifecycle | CommonJS; imports Electron |
| `src/main/window.cts` | The Electron window, its letterbox contract, the fullscreen yield | CommonJS. Loads `renderer/index.html` and titles the window "World time". Size clamp 760×540 through 1100×780 |
| `src/main/tray.cts` | The tray icon and menu | CommonJS; the icon is drawn, not shipped |
| `src/main/notifications.cts` | The Electron-facing half of notifications | CommonJS |
| `src/preload/preload.cts` | The five-method context bridge | CommonJS; the renderer's entire outside world |
| `test/fake-electron.mjs` | The recording stand-in for Electron | Hooks module resolution; **`.mjs` because a `load` hook must return source synchronously** |

## 5. Traps in this codebase

### Run `npm run typecheck`, not just `npm test`

The tests run under **Node's type stripping, which ignores types entirely.** A test suite can be
entirely green while `tsc` fails. This has already hidden a real bug: `text-anchor="center"` is not a
valid SVG value (it is `middle`), so the bezel lettering was silently left-aligned — tests passed,
`tsc` failed.

`npm run typecheck` covers **all four** configs, including `tsconfig.main.json` for the Electron main
and preload processes. That one was missing from the script until it was noticed while writing this
document, which means the main process went untypechecked for several milestones. If you add a
tsconfig, add it to the script.

Also note `erasableSyntaxOnly` is on: no TypeScript parameter properties, no enums. They emit code,
which is incompatible with type stripping.

### The preview's inline script is invisible to tooling

It lives inside a template string in `preview.ts`, so neither `tsc` nor the tests parse it. A typo
there yields a page that silently does nothing. This is why `scripts/verify-preview.mjs` exists and
**runs as part of `npm run build`**. If you edit that script, run the build.

### Module ids must use forward slashes

`scripts/bundle-preview.mjs` normalises `path.relative` output with `.split(sep).join('/')`. Without
it, Windows backslashes register modules as `shared\watch` while the page requires `shared/watch`, and
every `require` fails at runtime — invisible on disk, and it already happened once.

### Seven segments cannot encode the alphabet

Four collisions are **declared** in `GLYPH_COLLISIONS`: `0`/`O`, `5`/`S`, `2`/`Z`, `K`/`X`. The test
asserts the declared list is exactly the set that exists. If you add a glyph that collides, the build
fails — declare it rather than working around it. Do not chase collisions around the alphabet;
reassigning a pattern only moves it.

### The map band is not where you might expect above +12

Kiritimati (+14:00) is 210° east, which on a −180…+180 map is 150° **west** — so it lands near the
*left* edge, in the Pacific. This is correct. Clamping it to the eastern rim puts it in the wrong
ocean, which is what the reference project's formula did.

### The map band follows the *displayed* zone — except in three modes

In Timekeeping and World Time the band tracks the displayed zone. In **Alarm, Timer and Stopwatch it
reverts to the Home City.** This is requirement MAP-4 and it is encoded structurally in
`bandForMode(mode, …)`. Do not "simplify" it away.

### The layout's y-coordinates are solved, not chosen

`theme.ts` holds the lower half of the panel's five rows — DST, date/code, indicators, main digits,
sub-row — and their y values are the answer to a constraint problem, not five independent choices.
Each row's cell height is fixed by its text size; the stack is closed from the LCD's foot upwards with
a uniform 8-unit gap. Picking the values one at a time produced **four successive collisions**, each
caught by a test but only after a round trip through the renderer.

If a text size changes, re-solve rather than adjust: the arithmetic is in the comment above
`indicators` in `theme.ts`, and `the fields fit inside the LCD` re-derives the ordering so a broken
stack fails loudly.

### There are three distinct classes of layout failure, and each has its own test

1. **Overlap** — two glyphs on top of each other. The pairwise box test.
2. **Overflow** — a glyph outside the LCD. The pairwise test *cannot see this*: digits that all ran off
   the right edge have no overlapping pair. Added after the stopwatch's first layout put three glyphs
   on the bezel with a green suite.
3. **Print over glyph** — case text on top of a live field. Neither of the above catches it, because
   case text is not a glyph instance. The rasterised face is the only thing that caught it.

### A pusher is either a hold or a repeater, never both

`GestureReader.configure` silently drops a pusher from `repeaters` if it has a finite hold threshold.
That is not defensive coding, it is the distinction the watch makes: `SEARCH` scrolls in World Time
(so it repeats, and has no terminal hold) and fires the test alarm in Alarm mode (so it has a hold, and
does not repeat). Getting this wrong made a three-second `SEARCH` hold cycle the registers before Auto
Display could be recognised.

### The alarm comparison is a crossing, not an equality

`alarmsEnteringMinute(alarms, from, to)` takes **two** readings. Asking "is it 07:30 now?" once a
second fires an alarm sixty times a minute; asking whether the clock entered the minute between two
readings fires it once and survives a late or suspended tick. The controller passes the previous
reading explicitly, because only it knows when it last ran. Do not "simplify" this to one instant.

### The catalogue's order is derived, and it is not the source array's order

`catalogueZones()` sorts the watch table on `refOffset`. The transcribed array is *not* strictly
ascending — `ATH` follows `STO` at the same offset — so scrolling westward from the first entry used to
wrap past the whole table. The sort is stable, so cities sharing an offset keep the manual's relative
order. Do not replace it with the array's own order.

### One owner per concept

`controller.ts` owns persistence, the clock and the battery; `watch.ts` owns the pure derivation;
`machine.ts` owns what a button means; `face.ts` owns the layout. **When two modules own one concept,
the loser's validation disappears silently.** That is not a theory: `watch.ts` used to read the config
file as well as deriving from it, and when the controller took persistence over, the zone validation
did not move with it. An invalid zone then reached `offsetMinutes`, which throws — killing both
`faceState()` and `tick()`, on the exact input PRS-4 says must fall back.

Before deleting a module, read what it *accepts*, not just what it exports.

### The ESM/CommonJS boundary, and why the file extension decides it

This is the trap most likely to cost an afternoon, so it is written out in full.

`src/main` and `src/preload` are **CommonJS** (`.cts`), because that is what Electron's main and preload
environments are. `src/shared` and `src/renderer` are **ESM** (`.ts`), because the renderer is a page and
the tests load them directly. Both are real requirements, and they meet in three places:

1. **`src/shared` cannot be required from main.** Its compiled form in `dist/shared/*.js` is ESM, and
   `require()` on ESM throws `ERR_REQUIRE_ESM`.
2. **A `.cts` file cannot be loaded by the test runner.** It is CommonJS by extension, so the ESM loader
   refuses it, and `createRequire` refuses the `import` statements inside it.

The resolution, which is a convention rather than a trick — **the extension says which module system a
file is**:

| File | Module system | May import | Tested by `npm test`? |
|---|---|---|---|
| `src/shared/*.ts`, `src/renderer/*.ts` | ESM | anything below it | yes |
| `src/main/*.ts` | ESM | Node built-ins only | **yes** |
| `src/main/*.cts`, `src/preload/*.cts` | CommonJS | Electron, Node, and its ESM neighbours *dynamically* | no |

So pure main-process logic goes in `src/main/*.ts` (`config.ts`, `notify.ts`), and the Electron-facing
code goes in `src/main/*.cts`. Three consequences, all of which bit during M8:

- **A `.cts` file reaches an ESM neighbour with `await import('./config.js')`**, not a static import.
  The specifier is `.js` because that is what is emitted.
- **Type-only imports across that boundary need a `resolution-mode` attribute**:
  `import type { Bounds } from './config.ts' with { 'resolution-mode': 'import' }`. Without it, Node16
  resolution applies CommonJS rules to an ESM target and refuses.
- **`tsconfig.main.json` must set `module: "Node16"`, not `"CommonJS"`.** This is the subtle one: plain
  `CommonJS` **downlevels a dynamic `import()` to `require()`**, which cannot load the ESM module — so
  the build succeeds and the app dies at startup with `ERR_REQUIRE_ESM`. `scripts/verify-widget.mjs`
  asserts the emitted form, because the mistake is invisible in the source and in the types.

`npm run build` compiles `src/main` **twice**, for this reason: `tsc` emits the `.cts` files as CommonJS,
and the in-process transpiler emits the `.ts` files as ESM. See `scripts/steps.mjs`.

### `serialiseConfig` stamps the current version, so it cannot express a file from the future

`isFromTheFuture` and `ConfigFile.load`'s read-only path are real and tested, but a test cannot build a
future file with `serialiseConfig` — that function deliberately writes `CONFIG_VERSION`. Write the JSON
by hand, as `test/shell.test.ts` does.

The related ordering matters too: `load` checks `isFromTheFuture` **before** the repair comparison,
because a file from the future differs from what this build would write by definition and would
otherwise be reported as damaged.

### The rasteriser is not eyes — and it must not carry its own copy of the truth

`scripts/svg_to_png.py` **does not implement SVG**. It re-implements the sprite lookup, so it renders
its own interpretation rather than following the rules a browser follows. It drew a *perfect* face
while a real browser drew a green rectangle with no digits — for the entire project. It is useful for
geometry, layout and colour *tokens*, and useless as evidence that a browser will render something.

It used to make this worse in a second way: it held a **hand-written copy of the whole palette**, so a
colour pass would have changed `theme.ts` while the tool kept drawing the old colours, and the image
handed over for review would have been of a face that no longer existed. It now parses the palette out
of the `<style>` block that `renderFace()` embeds, and fails loudly if the SVG has none. **Do not
reintroduce a table of colours into that file** — the same rule as `FACE_CSS`: one copy, beside the
thing it describes.

Three separate times in one session a tool agreed with itself instead of with reality: this rasteriser,
the fake Electron, and a verifier that crashed inside its own regex. **When the question is "does this
look right", the answer comes from a real browser and a human.** Use `--label` to watermark any image
handed to a reviewer, so the image identifies itself.

Also note: **headless Chrome/Edge cannot run here either.** Both are installed and both die at
Chromium's named-pipe IPC under `--headless`, so there is no way for an agent in this sandbox to take a
screenshot. See `docs/ENVIRONMENT.md` §4a; do not spend time re-deriving it.

### One class, one rule — and the face must carry its own stylesheet

The face was unstyled in the widget for the whole project because its stylesheet lived in the preview
page while `renderFace()` embedded only the CSS variables. `test/face.test.ts` now asserts that every
class the face emits has a rule in the stylesheet it carries. **Do not move `FACE_CSS` back out of
`src/shared/theme.ts`**, and do not add a class to the face without a rule for it.

### A failing assertion may be looking in the wrong place

Twice in one session a *correct* test failed because its scope was wrong: after the stylesheet moved into
the SVG, tests searching for `pushed` and `alerting` matched the CSS selectors instead of the markup. Use
`faceMarkup()` in `test/face.test.ts` for anything asking "is this drawn?". Before changing code to make a
test pass, check that the test is searching where the thing actually is.

### A truncated name is a wrong name

The World Time row is 210 units and shows a city name whole or the city's three-letter code, never a
cut-down string. `RIO DE J` and `FERNANDO D` are not places, and a floor on the length does not help
because `FERNANDO D` is ten glyphs and still nonsense. `fitText` still exists for cases where an
abbreviation reads as an abbreviation; this row is not one of them.

The name also yields to the `T-n` register indicator when it is showing, because the name is the
elastic field and the indicator is not — and because the three runs together (name, indicator, code)
need 336 units of the 319 available.

### Run the renderer, not just the tests

Four defects in this project were invisible to every test and obvious in the image:

1. `text-anchor="center"`, which is not a value — the bezel text was silently left-aligned.
2. The subdial drawn over the date field, so `THU` rendered as `EHU`.
3. The stopwatch's digits running onto the case — no two glyphs *overlapped*, so the pairwise test
   passed.
4. `10 YEAR BATTERY` and `ILLUMINATOR` printed across the live digits — print over a glyph is not a
   glyph over a glyph, and no geometry test can see it.

The rasteriser costs a minute and catches a class of bug the suite structurally cannot.

### The subdial follows the Home City

On the watch face, the analog subdial follows the Home City in every mode, whatever city is displayed
(requirement ANA-2). Its ring is numbered **5…60**, not 1…12 (ANA-4), which is why it is hand-drawn.
The board's analog clock is a separate drawing in `board.ts`, and it follows the focused row.

### The board and the face are different pages

`renderFace` is the preview. `renderBoard` is the window. A change to `THEME` moves the face and leaves
the board where it is. The board's palette is the literals in `board.ts` and `styles.css` (lit
`#c9f2b0`, ground `#070a08`, land `#4f6b52`, land in the band `#b7ec9a`, dim text `#6f8571`).

The map on the board is 64×16 cells sampled from the 96×40 bitset. The band is two columns, and only
land in those columns is marked. Ocean cells in the band are empty.

A favourite that is also the system zone is listed twice, as T0 and as its slot. `deskRows` skips a
zone in the catalogue once it is already showing, and it still appends every stored favourite.

The selected row's marker is ▸. A favourite that is not selected shows ★.

`lcdBlock` joins glyphs with a space. Seconds use width 3 and the main digits use width 9. Unlit
segments are `#101612`. A brighter ghost turns a 9 into an 8.

The shortcut page is `dist/renderer/widget.html`, a classic script. Electron's window loads
`dist/renderer/index.html`, the ES module page. `scripts/bundle-preview.mjs` must strip `.ts` as well
as `.js` from require specifiers, or `widget.js` throws `module not found: renderer/board.ts`.

## 6. How to see what you are doing

There is no window here, but the drawing is inspectable. This pipeline is the single most useful tool
in the repo:

```sh
npm run build
node scripts/extract-svg.mjs 1 dist/preview/face-1.svg     # Nth face from the preview page
python scripts/svg_to_png.py dist/preview/face-1.svg out.png 2 --label "what this is"
```

**Index 0 is the Live card**, because the interactive card now leads the gallery; the fixed scenarios
start at index 1. `--label` watermarks the image in a real font after rasterisation, so a review image
identifies itself and cannot be affected by a fault in the SVG.

Then look at `out.png`. `scripts/svg_to_png.py` is a small SVG rasteriser for the subset this renderer
emits; it parses the **real generated SVG** and reads the palette out of the stylesheet that SVG
carries, so the image is genuine output rather than a parallel interpretation. It is an inspection aid,
not a source of truth — the tests and the browser preview remain authoritative, and it ignores the
decimal point. It does not honour the CSS cascade, `mix-blend-mode`, stroke joins or real text metrics,
so **the illumination wash and the type will differ from a browser.**

`scripts/glyph_boxes.py` complements it: it lists every glyph instance with its box and flags any that
leave the LCD. Useful when a test failure names coordinates rather than a screen.

**Use this whenever you change layout.** Every layout bug found so far was invisible in the markup and
obvious in the image — including one class (case print over a live field) that no test can see.

## 7. What is next

**See [NEXT-SESSION.md](NEXT-SESSION.md).** The window is the board, launched by `World time.vbs`.
The notes below are what is still unfinished around that.

### The shell is written and its *wiring* is tested; Electron still has not opened a window here

M1 and M8's window half are implemented: window, tray, config file, notifications, the renderer entry
point, the letterbox layout, the drag rules and the packaging config. The window code loads
`dist/renderer/index.html` and titles itself "World time". On this PC `electron.exe` 40.10.6 exits
before that window appears, which is why the shortcut uses Edge. Inside the DSH sandbox a window
cannot be shown either. Both limits are in [ENVIRONMENT.md](ENVIRONMENT.md).

What *is* tested is the wiring. `test/wiring.test.ts` runs the built `.cjs` shell against a recording
fake Electron, so the window options, tray menu, notification construction, IPC surface and process
lifecycle are exercised. The point is a gap that static analysis cannot reach: **every Electron option
is optional**, so `nodeintegration` typechecks as happily as `nodeIntegration`, and a mistake surfaces
as "the window is in the taskbar" rather than as an error on a line. Twelve deliberate corruptions of
the built modules were used to confirm those assertions can fail. `docs/ENVIRONMENT.md` §12 says exactly
what the fake does and does not prove.

`docs/ENVIRONMENT.md` §9 is the remaining checklist: sixteen claims, ordered by how likely each is to be
wrong, each with the requirement it serves and how to check it. Items 6 (always-on-top yielding to
fullscreen), 10 (a toast that Focus Assist respects) and 16 (the AppUserModelID pairing) are the three
where a problem is most likely, and item 6 is explicitly an approximation rather than an implementation.

`docs/ENVIRONMENT.md` §10 explains the ESM/CommonJS split that decides which files can be tested at all,
and §11 why the notification's category is toast XML rather than an Electron option.

### Still needs a human

These are about the **preview face**. The board is a separate drawing.

1. **Whether the measured face looks like the photographs.** The LCD tokens are pale (`#aab4b4`) with
   dark blue segments (`#0c1a24`), on steel (`#d8d8d8`). The first measurement sampled shadows and
   inverted the contrast; RESEARCH.md §7 records both passes. A further pass is one edit per token in
   `THEME`. There is no way to screenshot a browser from the sandbox.
2. **Segment proportions and stroke weight.** Authored by eye. The rasteriser cannot show stroke weight
   faithfully.
3. **The case proportions**, still 450 × 445 rather than the device's 450 × 421. See RESEARCH.md §6.
4. **The World Time name rule on the face.** Thirty-eight of the forty-nine names do not fit the row and
   are shown as codes. The board prints city names in full, in its own row.
5. **The `ILLUMINATOR` band and the face's map resolution.** On the real watch `ILLUMINATOR` is printed
   on the steel below the black panel; on the face it sits inside the panel. The face's map is still
   full-resolution dot-matrix. The board's map is the 64×16 sample.
6. **The product name.** `royale` is a placeholder and appears in `electron-builder.yml`'s `appId` and
   in `APP_USER_MODEL_ID`.
7. **The flat glyph route**, still built. NEXT-SESSION.md says what each route-probe answer means.

Open `dist/preview/index.html` beside the photo in `notes/` for the first five. Open the shortcut for
the board.

## 8. Repository state

Eleven commits on `main`. HEAD before this documentation pass was `e5c99c7` ("Final MVP"). The commit
before that is `6b71df2` ("Grok fix"). `75e7c6f` is the stylesheet, launcher, and colour-gap commit,
and it is no longer the tip.

The colour pass, the preview restructure, the world-time board, and `World time.vbs` are in that
history. `npm test` on 2026-10-04 reported 439 passing tests, 94 suites, 15 files.

`Casio-AE1200-1.webp` is gitignored by `*.webp`. `notes/` is gitignored. Both are reference
photographs.

**`dist/` is a build product and is recleaned by every `npm run check` and `npm run build`.** Anything
written there by `svg_to_png.py` is deleted by the next build. The colour-pass rasters were lost that
way once, and now live in **`review/`**, which is not gitignored. Write review images there.

The watcher fix is worth knowing about before trusting a development loop: `src/main` was **not**
watched, so editing `config.ts` or `notify.ts` left `dist/main` stale while the build looked healthy.
`test/shell.test.ts` now pins the watch list against the directories under `src/`, so the same omission
cannot be reintroduced silently.

## 9. Working agreements established in this project

These came out of getting them wrong, so they are worth keeping:

1. **Compute, then assert.** Every value asserted from memory in this project was wrong — including,
   in M5–M7, the catalogue's scroll order, the glyph count of `SIGNAL`, and a stopwatch split that
   "looked like" the space-saving one. Derive values; do not enumerate them by hand.
2. **Fix the code, not the test** — unless the test is demonstrably wrong, in which case say so
   explicitly. Several test expectations here were the bug, and several code paths were correct when a
   test failed. Distinguish the two before editing either. In M5–M7 that distinction went both ways
   roughly equally: eleven real bugs and about as many wrong assertions.
3. **Render it and look at it** before claiming a layout works. Of the four layout failures in
   M5–M7, the image found all four and the tests found two of them.
4. **`npm run typecheck` is not optional**, because the tests cannot see types.
5. **Document corrections where they were found.** When implementation disproved the research (the
   49-code table, and now the case proportions), the research document was updated with a note
   explaining how it was found. Keep doing that.
6. **Solve constraint stacks; do not pick coordinates.** When several rows must fit between two fixed
   edges, compute them from the cell heights and a uniform gap. Four successive collisions came from
   choosing them one at a time.
7. **Say which it was.** "The test was wrong" and "the code was wrong" are both acceptable outcomes;
   guessing between them is not.
8. **A tool must not carry its own copy of the truth.** Twice now a verification tool has agreed with
   itself instead of with the artefact: the rasteriser re-implemented the sprite lookup, and then it
   kept a hand-written copy of the whole palette. Both times the tool drew a *perfect* picture of
   something the browser refused, or of a face that no longer existed. Read the artefact — the SVG, the
   stylesheet, the built module — and fail loudly rather than substituting a plausible default.
9. **A region census measures the lighting as much as the object.** Sampling large areas of a
   photograph of the watch measured its shadowed recesses and inverted the LCD's contrast, turning a
   pale panel into a dark one. Sample small, sample a material you know the identity of, and
   cross-check a second photograph before believing the number. The eye was right and the average was
   wrong.

