# Handoff

Everything a fresh session needs to work on this project productively without rediscovering what has
already been learned the hard way. Read this first, then
[ENVIRONMENT.md](ENVIRONMENT.md) before running anything.

**One-line summary:** a Casio AE-1200WH desktop clock widget for Windows, built in Electron. The
verifiable core — time engine, city table, world map, seven-segment face, live state, all five screens
and every pusher gesture — is complete and tested. The widget itself cannot be launched in the
development sandbox, but its drawing can be rendered and inspected. See [PROGRESS.md](PROGRESS.md) for
how it got here.

## 1. Get running in three commands

```sh
npm install              # toolchain + electron package wrapper (NOT the binary)
npm run fetch:electron   # downloads the electron binary — separate for a sandbox reason
npm run build            # compiles, bundles the preview, generates it, verifies it
```

Then:

```sh
npm test                 # 358 tests, no build step needed
npm run typecheck        # four tsconfigs — run this, see §5
```

**To see the result without any of that:**

```
dist/preview/index.html
```

Open it in a browser. Nineteen rendered faces plus live controls. No server needed. The *Live* card is
driven by the real `WatchController`, and its pushers can be clicked and held.

## 2. What this project is

A desktop clock widget modelled on the **Casio AE-1200WH** ("Royale", module 3198): the green LCD, the
seven-segment digits, the dot-matrix world map with a lit time-zone band, the analog subdial, the four
labelled pushers, and all five screens its three modes contain.

Fan project. Not affiliated with or endorsed by Casio. See [NOTICE.md](../NOTICE.md).

### The documents, and when to read each

| Document | Read it when |
|---|---|
| [REQUIREMENTS.md](REQUIREMENTS.md) | You need to know **what** to build. Every requirement has a stable ID (`WIN-*`, `DST-*`, …). |
| [PLAN.md](PLAN.md) | You need the milestone sequence, architectural decisions, risks, definition of done. |
| [RESEARCH.md](RESEARCH.md) | You need a **fact about the watch**, with citations, plus everything unverifiable. |
| [ENVIRONMENT.md](ENVIRONMENT.md) | **Before running any command.** Five sandbox traps, all solved, each of which presents as a code bug. |
| [PROGRESS.md](PROGRESS.md) | You want the history, the bug list, or what is verified and how. |

**Watch out:** the reference project's own README and GitHub description are stale. GitHub calls it
"Command line interface to get Timezone"; it is actually a terminal world clock. Trust the README, not
the repo blurb.

## 3. Architecture, and the rules that hold it together

```
src/shared/     logic: no DOM, no Electron. The lowest layer.
src/renderer/   the face: SVG generation and the preview page (ESM, DOM-free until it renders)
src/main/       Electron main process (CommonJS, .cts)
src/preload/    the narrow context-bridge surface (CommonJS, .cts)
test/           unit tests, run directly by Node with no build step
scripts/        build, bundle, preview, rasterise, verify — all Node or Python
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

Corollary: **timers live in the `Watch` controller**, never in the renderer. The `T-n` register
indicator is a `showRegister` boolean, not a 1-second timer inside the drawing code.

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
| `src/shared/glyphs.ts` | Seven-segment encoding: which segments spell what | The whole typography of the widget |
| `src/shared/svg.ts` | Segment geometry, the sprite builder, text layout | Geometry authored once, instanced via `<use>` |
| `src/shared/theme.ts` | Colour tokens and the face grid | One unit = 0.1 mm. The lower rows' y values are **solved**, not chosen — see §5 |
| `src/shared/map.ts` | Land bitset, band placement, `bandForMode` | Encodes the Home City fallback rule |
| `src/shared/alarms.ts` | The five alarms, the schedule cycle, the hourly signal | The **crossing test** lives here, not in the machine |
| `src/shared/timer.ts` | The countdown, against an injected instant | Absolute end instants; never accumulates |
| `src/shared/stopwatch.ts` | The three behaviours, the 24-hour rollover | No lap memory, by requirement |
| `src/shared/machine.ts` | **Every screen and sub-screen.** A pure reducer | What every pusher does, everywhere |
| `src/shared/gestures.ts` | Press, hold and chord at the watch's durations | Injectable clock; no timers |
| `src/shared/controller.ts` | **Everything with a clock in it** | The only object with timers, cadence and persistence |
| `src/shared/watch.ts` | The M3/M4 live state and its persistence | Still used by the map band tests; `controller.ts` supersedes it for the widget |
| `src/renderer/face.ts` | **The single layout authority.** Case, LCD, all fields | Pure; no DOM |
| `src/renderer/preview.ts` | The standalone preview page and its inline script | The inline script is a template string — see §5 |

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



In every mode, whatever city is displayed (requirement ANA-2). Its ring is numbered **5…60**, not
1…12 (ANA-4), which is why it is hand-drawn.

## 6. How to see what you are doing

There is no window here, but the drawing is inspectable. This pipeline is the single most useful tool
in the repo:

```sh
npm run build
node scripts/extract-svg.mjs 0 dist/preview/face-0.svg     # Nth face from the preview page
python scripts/svg_to_png.py dist/preview/face-0.svg out.png 2
```

Then look at `out.png`. `scripts/svg_to_png.py` is a small SVG rasteriser for the subset this renderer
emits; it parses the **real generated SVG**, so the image is genuine output. It is an inspection aid,
not a source of truth — the tests and the browser preview remain authoritative, and it ignores the
decimal point.

`scripts/glyph_boxes.py` complements it: it lists every glyph instance with its box and flags any that
leave the LCD. Useful when a test failure names coordinates rather than a screen.

**Use this whenever you change layout.** Every layout bug found so far was invisible in the markup and
obvious in the image — including one class (case print over a live field) that no test can see.

## 7. What is next

### Immediate: M8 — battery, illumination, polish and packaging

M0–M7 are complete: the whole verifiable core, all five screens, and every pusher gesture. What remains
splits cleanly into work that can be verified here and work that cannot.

**Verifiable here:**

- The battery drain model. The calibration is already written down — Casio's own 10 s of alarm plus
  1.5 s of illumination per day over ten years is 42 003.75 seconds of operation, which is what
  `controller.ts` divides by. `drainAlertSeconds` is the seam; nothing calls it yet, and **that is the
  one open half of BAT-2**: alarm sound is not currently charged to the cell. It wants a test with
  injected usage asserting the ten-year figure.
- The illumination duration's persistence and its effect on the readout (LIT-3, BAT-5).
- The context menu's actions, as controller methods (`resetBattery` exists; mode switch, settings and
  quit do not).

**Not verifiable here — needs a human at a desktop:**

- M1: tray, taskbar suppression, always-on-top yielding to fullscreen, position persistence, dragging.
- M8: the amber wash *in situ*, Windows notifications actually appearing and respecting Focus Assist,
  `electron-builder` packaging, the installed app's acceptance run.
- The 15 acceptance criteria in REQUIREMENTS.md §7. Several are already demonstrable from the preview;
  the window ones are not.

### Then: the three things that need a human, not an agent

Unchanged, and still the fastest route to a better-looking widget — open `dist/preview/index.html` and
compare it against the real watch:

1. **Colours.** Named tokens in `THEME`, one edit each.
2. **Segment proportions and stroke weight.** Authored by eye.
3. **The case proportions.** Now 450 × 445 units rather than the device's 450 × 421, for the reason
   recorded in RESEARCH.md §6. The product name `royale` is also still a placeholder.

- **M5 — World Time** (`WLD-*`): city scrolling eastward with fast scroll on hold, the home↔world swap
  (ADJUST+LIGHT), second synchronisation with Timekeeping, and the last-viewed city on re-entry. Mode
  cycling is `MOD-*`.
- **M6 — Alarm, Timer, Stopwatch** (`ALM-*`, `TMR-*`, `SW-*`): five alarms as Daily/One-time/Off plus
  the hourly signal, the 10-second alarm behaviour, the countdown's absolute-end-time persistence, and
  the stopwatch's three behaviours. The timer and stopwatch logic should be tested **against injected
  clocks**.
- **M7 — Pusher gestures** (`INT-*`): press, hold and chords with the watch's real durations (~1 s,
  ~2 s, ~3 s), flashing setting fields, Auto Display, auto-return after 2–3 minutes idle, and MUTE.

### Later: M1 and M8 — the Electron shell

Window citizenship (tray, no taskbar entry, always-on-top that yields to fullscreen, position
persistence), Windows notifications in the alarm category so Focus Assist is respected, the battery
simulation, the amber backlight, and packaging. **None of this can be verified in the sandbox** — it
needs a real desktop, where `ELECTRON_RUN_AS_NODE` is not set.

### Needs a human, not an agent

1. **Colours.** The research could not measure them from photography. They live as named tokens in
   `THEME` in `theme.ts` so a pass is one edit each.
2. **Segment proportions and stroke weight.** Authored by eye, never compared to the real watch.
3. **The case proportions**, now 450 × 445 rather than the device's 450 × 421. See RESEARCH.md §6.
4. **The product name.** `royale` is a placeholder and appears in packaging metadata.

Open `dist/preview/index.html` and compare it against the real watch. That is the fastest route to
correcting all four.

## 8. Repository state

Three commits on `main`: `requirements`, `grill me skill`, `Add the initial project note`.

**All of M0–M7 is uncommitted.** Everything described in this document and
[PROGRESS.md](PROGRESS.md) exists only in the working tree. If that matters — and it should — commit
before starting new work.

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

