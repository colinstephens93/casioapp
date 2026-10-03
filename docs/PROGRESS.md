# Progress

A chronological record of what has been built, what was learned, and what is verified. Written for
someone picking this up cold. For *how to work on it*, see [HANDOFF.md](HANDOFF.md).

Last updated: after the Electron shell (M1, and M8's window half).

## At a glance

| Metric | Value |
|---|---|
| Tests | **393 passing**, 0 failing, across 84 suites and 13 files |
| Typecheck | Clean on all four `tsconfig` files, including the Electron main process |
| Build | Clean, single pass, and self-verifying: it verifies the preview page *and* the widget page |
| Screens | All five (Timekeeping, World Time, Alarm, Timer, Stopwatch) plus six setting screens |
| Shell | Window, tray, config file, notifications, context menu and packaging are **written but cannot be run here** — ENVIRONMENT.md §9 is the checklist |
| Can the watch run? | **No** — see [ENVIRONMENT.md](ENVIRONMENT.md). Its *drawing* can be rendered and inspected, and its logic is fully tested. |
| Git | Committed through M7 (`Continued development`); everything since is uncommitted. |

### Test breakdown

| File | Tests | Covers |
|---|---|---|
| `test/time.test.ts` | 35 | Offsets, wall clock, ±1 day marker, DST, formatting, zone validation |
| `test/watch.test.ts` | 10 | The zone-and-clock derivation: offsets, gap, day marker, DST label move together |
| `test/face.test.ts` | 45 | Face composition, layout bounds, glyph overlap, glyph overflow, name fitting |
| `test/map.test.ts` | 28 | Land bitset, band placement, Home City fallback, fitting |
| `test/machine.test.ts` | 69 | Every pusher on every screen: press, hold and chord; the five screens' rules |
| `test/alarms.test.ts` | 18 | The five alarms, the crossing test, the midnight and DST cases, repair |
| `test/timer.test.ts` | 23 | The countdown against an injected clock, pause/resume, rollover, persistence |
| `test/stopwatch.test.ts` | 18 | The three behaviours, the 24-hour rollover, formatting |
| `test/gestures.test.ts` | 25 | Press, hold at each real duration, chord, repeat cadence |
| `test/controller.test.ts` | 62 | Cadence, the battery model, the seconds reset, restart, notifications, the host's controls |
| `test/shell.test.ts` | 32 | The config schema, its repair, the atomic write, window clamping, the toast payload and XML |
| `test/catalog.test.ts` | 19 | The watch's 49-code table, extended zones, sorting and exclusion |
| `test/glyphs.test.ts` | 18 | Glyph coverage, digit uniqueness, collision audit |

## Milestones

### M0 — Toolchain and scaffolding — **done, launch criterion deferred**

Established that the project builds and tests inside the DSH sandbox, and that the **widget cannot be
launched there**. Three environment traps were found and solved; all are documented in
[ENVIRONMENT.md](ENVIRONMENT.md):

1. npm and `@electron/get` cache outside the workspace, where the file sandbox forbids writes.
   Redirected via `.npmrc` and a fetch script.
2. The sandbox **cannot spawn a child with piped stdio**, which is how npm runs install scripts. The
   trap inside the trap: approving electron's install script makes `npm install` *fail*, because npm
   then attempts the spawn. Leaving it unapproved is correct.
3. `ELECTRON_RUN_AS_NODE=1` is set in this session, so `electron.exe` runs as plain Node and
   `require('electron')` returns a *path string*. `scripts/run.mjs` clears it.

Electron itself is installed and reports **v24.15.0**, and the main process is scaffolded, but it
cannot open a window here: DSH runs commands on a non-interactive desktop (Notepad gets
`MainWindowHandle = 0`), and Chromium additionally needs the named pipes the sandbox forbids.

### M3 — Time engine — **done**

`src/shared/time.ts`, ported from the reference project's logic (MIT) and re-typed, plus
`src/shared/catalog.ts`.

- Offsets for any instant via `Intl`, wall-clock derivation, the civil-date ±1 day marker, DST with
  `auto`/`on`/`off` and correct southern-hemisphere handling, ICU legacy-zone renames, formatting.
- The watch's **full 49-code city table** (48 cities plus UTC) with IANA zones behind it, plus
  extended zones the watch cannot display (`+12:45` Chatham, `+14:00` Kiritimati, `−09:30` Marquesas).

**Research correction found by implementing:** the researcher's narrative said "46 cities + UTC = 47",
but a mechanical comparison found the manual's printed table holds **49 codes**, including `ATH`, `SEN`
and `DUB` as separate entries. The catalogue matches the manual **exactly** — no missing codes, no
extras — and that is enforced as a deep-equality test rather than a comment. Casio's "48 cities" claim
turned out to be correct after all; only the "31 time zones" half remains unverified.

### M2a — Seven-segment glyph engine — **done**

`src/shared/glyphs.ts`. The watch has **no dot-matrix text row**, so every letter and digit on the LCD
is drawn from the same seven segments — this one table *is* the typography of the whole widget.

**Seven segments cannot encode 26 letters uniquely.** Four collisions are unavoidable and are declared
rather than hidden: `0`/`O`, `5`/`S`, `2`/`Z`, `K`/`X`. The test asserts the declared list is exactly
the set that exists.

Getting here took **four wrong attempts**, each from reasoning instead of computing. The final
character set was derived mechanically from the strings the LCD renders, after which `K`, `Q` and `B`
turned out to be required (city *names* use every letter, not just the three-letter codes).

### M2b — Case, LCD and world map — **done**

`src/shared/svg.ts` (segment geometry and sprite), `src/shared/theme.ts` (colour tokens and the face
grid, in millimetres), `src/shared/map.ts` (land bitset and band maths), `src/renderer/face.ts` (the
single layout authority).

**A real bug fixed here, inherited from the reference project's formula:** offsets above +12 wrapped
*backwards*, so Kiritimati (+14) rendered west of the +12 ceiling — the wrong ocean. The corrected
mapping rounds rather than floors and lets the wrap do its job. Independent cross-check: it yields
**column 71 for Kathmandu**, exactly what the research derived separately from the source map's
7.5-degree cells.

### M2c — Browser preview and a custom SVG rasteriser — **done**

`src/renderer/preview.ts` renders eight fixed scenarios into one standalone HTML file that needs no
server (a small in-house bundler works around `file://` blocking ES module imports).

**This milestone's real discovery: visual verification *is* possible here.** Every ready-made
rasteriser is blocked — Edge and Chromium die at Chromium's named-pipe IPC, and no SVG library is
installed — but Pillow is, so `scripts/svg_to_png.py` implements the small SVG subset the renderer
emits. It parses the **real generated SVG**, so what it draws is genuine output.

The first rasterisation exposed **four defects that all 129 tests then passing had missed**:

1. `text-anchor="center"` — not a valid SVG value, so the bezel lettering was silently left-aligned.
   `tsc` catches this; tests do not.
2. The subdial was drawn **over** the date field, rendering `THU` as a malformed `EHU`.
3. The date field ran into the city code by **0.18 units**, fusing `7-16` and `TYO`.
4. The seconds block was **clipped** by the LCD's foot, and `ALM` overlapped the world map.

A systematic **rendered-glyph overlap test** was added to catch this class automatically. It
immediately found three more collisions (`DST` on `TYO`, `ALM` on the city code, `ALM` on the main
digits), which forced the layout into genuinely separated bands.

### M4 — Live watch state and interactive preview — **done**

`src/shared/watch.ts`: four zone registers (T-1 Home plus T-2…T-4), the clock, per-register DST,
settings repair, and persistence behind an injectable store. Offsets are derived **once per sync**, so
the digits, map band, day marker and DST label cannot disagree with each other mid-render.

The preview was refactored to call `syncWatch` instead of duplicating that maths — there is now exactly
**one** implementation, so the preview and the future widget cannot drift. The preview gained live
controls: register selection, 12/24-hour toggle, DST cycling, and nine quick zones covering the awkward
offsets. It persists to `localStorage`.

**Two more bugs found:**

1. **Bundler module ids used backslashes** on Windows (`shared\watch`) while the page required
   `shared/watch`. Every `require` in the live script would have failed, leaving the controls silently
   dead. Invisible on disk; found only by asserting the bundle contains the ids the page asks for.
2. `erasableSyntaxOnly` rejected a constructor parameter property. Tests pass either way because Node
   strips types and ignores the config — **only `tsc` checks it.**

The preview verifier now runs as part of `npm run build`, because the inline script lives in a template
string that neither `tsc` nor the tests ever parse.

### M5 and M6 — the remaining screens — **done**

Four new `src/shared` modules and the state machine that drives them:

| Module | What it owns |
|---|---|
| `alarms.ts` | The five alarms, the `Daily`/`One-time`/`Off` cycle, the hourly signal, and *which* alarm a pair of clock readings crossed into |
| `timer.ts` | The countdown: absolute end instant, pause/resume, field stepping, repair |
| `stopwatch.ts` | The three behaviours from three pieces of state, the 24-hour rollover, no lap memory |
| `machine.ts` | Every screen and sub-screen, the mode cycle, city scrolling, promotion, the setting screens, alerts |
| `controller.ts` | Everything with a clock in it: the tick loop and its per-screen cadence, persistence, notifications, the backlight |
| `gestures.ts` | Press, hold and chord, at the watch's own durations (M7) |

**The design decision worth recording: the alarm comparison is a *crossing*, not an equality.**

Asking "is it 07:30 now?" once a second fires an alarm sixty times a minute. Asking "did the clock
*enter* 07:30 between the previous reading and this one?" fires it once — and is also correct when a
tick is late, which a suspended process makes routine. The previous reading is passed in by the
controller rather than reconstructed from a nominal cadence, because only the controller knows when it
last ran. A second guard blocks the rest of the minute, because a daily alarm firing at 07:30:05 would
otherwise fire again at 07:30:15 as soon as its first alert expired.

**The other decision: the timer's persistence is an absolute instant, and the stopwatch's is nothing.**

The countdown stores the epoch time at which it will reach zero (TMR-8), so a quit mid-flight resumes
an hour further along rather than an hour behind. The stopwatch stores nothing at all (SW-10) and
rebuilds from zero on launch, because a stopwatch that survived a restart would be measuring the time
the widget was closed.

**Eleven bugs found, and the pattern is worth reading.** Eight were mine, three were in the existing
layout, and every one was caught by a test I had written for a *different* reason:

1. **`alarmSlot` returned a slot number and the reducer stored it as an array index**, so the alarm
   screens advanced two at a time: 1 → 3 → 5 → 1. The rendered screens looked plausible; only the
   transition test saw it.
2. **The stopwatch *clamped* at its 24-hour limit instead of wrapping** (`Math.min(limit, raw)`). It
   read `23'59'59.99` exactly as it should and then stayed there forever. The test asserted the value
   *past* the limit, not only at it.
3. **`LIGHT` was illumination-only**, so `stepWorld(-1)` was unreachable on a press and the only way
   west was a repeat. The machine test wrapped in both directions; the manual only names the eastward
   one.
4. **`reduce` treated any button as "silence the alarm, and return"**, so the press that silenced an
   alarm did nothing else — Auto Display was unreachable for a full three-second hold.
5. **`SEARCH` repeated in Timekeeping**, so a three-second hold cycled the registers before Auto
   Display could be recognised. The gesture reader now refuses to give one pusher both a terminal hold
   and a repeat, which is the distinction the watch itself makes.
6. **The seconds-reset offset had its sign inverted**, and TIM-8's minute carry was missing entirely.
   `22:48:38` reset to `22:48:16` instead of `22:49:00`.
7. **The catalogue was not actually in eastward order.** `ATH` follows `STO` in the manual's own
   column at the same offset, so scrolling west from Pago Pago wrapped past the whole table. The order
   is now *derived* by sorting on `refOffset`.
8. **A day is not 1440 minutes.** The first alarm-range calculation used epoch milliseconds, which is
   wrong on a spring-forward date; it now works on calendar fields. There is a test for the European
   transition specifically.
9. **The stopwatch's reading was thirteen glyphs wide** and ran off the LCD. No glyph *overlapped*,
   so the pairwise overlap test was perfectly happy — a new **LCD-bounds test** was needed, and that
   is the third distinct class of layout failure this project has found.
10. **The apostrophe does not exist in the sprite.** `00'12` rendered as `00 12`; the markup gave no
    hint. The separator is now the colon, which is a real glyph.
11. **The case print sat on top of the digits** — `10 YEAR BATTERY` across the main time and
    `ILLUMINATOR` across the seconds. Fixing it properly required the LCD window to be *shortened*,
    because there was no vertical room for both inside it; that is now a solved stack rather than
    five hand-picked coordinates (see below).

**The layout lesson, which cost the most time.** The lower half of the panel carries five rows in a
fixed order, and I picked their y-coordinates one at a time. Four successive collisions followed, each
caught by a test but only after a round trip through the renderer. The fix was to stop choosing: the
rows' cell heights are fixed by the text sizes, and working up from the LCD's foot with a uniform gap
**solves** the stack. The numbers in `theme.ts` are that solution, with the derivation in the comment.
`svg_to_png.py` is what showed all four failures; the markup was balanced every time.

### M7 — interaction fidelity — **done**

`src/shared/gestures.ts`, plus the parts of `machine.ts` they drive.

- **Press, hold and chord**, at the watch's real durations: 1 s for the setting screens and MUTE, 2 s
  for the Local Time city picker, 3 s for Auto Display and the alarm test.
- **Chords are suppressed as their components.** While both pushers of `ADJUST + LIGHT` are down,
  neither one's hold fires; the chord is emitted once, on release.
- **Fast scroll** repeats at 90 ms after a 400 ms delay, and only for pushers the current screen
  declares as repeaters.
- **A chase the design cannot avoid, stated rather than hidden:** a press is emitted as the pusher goes
  down, before it is known whether a chord is coming, because a clock's pad has to feel instant. The
  consequence is that the leading half of a chord has already acted, and `machine.ts` is written to
  tolerate it.
- **Auto Display** (TIM-11) cycles the registers every two seconds, and any button cancels it.
- **Auto-return** (MOD-5) to Timekeeping after two minutes idle.
- **MUTE** (MUT-1) on a MODE hold, shown as the LCD's triangle and persisted.

**The controller's tick cadence is per screen** (NFR-4): 1000 ms for the clock, 50 ms for a running
stopwatch or countdown, 500 ms for the scrolling screens. Ticking everything at the fastest rate would
work and would burn twenty times the CPU to redraw the same picture.

### The M8 pass — the battery, and two bugs the cleanup found

Four things, in the order they mattered.

**1. The battery now charges for alarm sound, which was the open half of BAT-2.** The seam was one
line; the work was the meter. The controller records the instant an alert appears and charges for the
real elapsed time when it goes away, so an alarm silenced after three seconds costs three seconds and
not ten. A test alarm is exempt, because it is the operator exercising the alarm rather than the alarm
firing, and Casio's rating is about firings.

**The first version of the meter measured zero, always.** `settleAlert` re-armed itself on every call,
and there are two calls per tick — `dispatch` and `tick` both end in `afterReduce`. So the elapsed time
was always zero and the battery never moved. No error, no exception, a green suite: the only symptom
was a number that stayed at 1. It now recognises an alert it has already seen, keyed on kind plus end
instant, which is the identity the notification deduplication already uses.

The model is calibrated to Casio's own stated assumption and the test derives that figure
independently rather than importing it: 10 s of alarm plus 1.5 s of light per day, 3652.5 days per
decade, 42 003.75 seconds of operation for the whole cell.

**2. Two bugs in the config reader, both found by auditing what the *deleted* code had been doing.**

- **An unrecognised zone in the config file crashed the widget on every frame.** `watch.ts` validated
  stored zones; `controller.ts` did not. An invalid zone reaches `offsetMinutes`, which throws — and it
  throws inside both `faceState()` and `tick()`, so the widget died on startup and again on every tick,
  on exactly the input requirement PRS-4 singles out. The check is now `resolveZone` in the controller,
  with a test that asserts neither call throws.
- **The register was silently reset to T-1.** M0–M4 wrote `selected`; M5 renamed the field to
  `register`. The new reader looked only for the new name, so every existing widget's register reverted
  to T-1 on the next restart. A data regression rather than a crash, and therefore the kind that
  survives a green suite until it is asserted.

Neither was found by a test. Both were found by reading what the old code accepted before deleting it,
which is the lesson: **the risk in deleting a module is the validation it was doing, not the features
it was providing.**

**3. `watch.ts` is now a pure function, not a second owner of the watch.** The `Watch` class, its
config reader and its writer had no caller outside their own test — `controller.ts` had superseded all
of it, and nothing had removed it. The file is now `syncWatch` and its types: a pure settings-to-
snapshot derivation, which is the simplest statement of the offset rules and what the map band is
verified against. The class, `parseSettings`, `serialiseSettings` and `WatchStore` are gone, and
`watch.test.ts` was rewritten around the derivation. Having two owners of "the live watch" is how the
two bugs above got in.

**4. The context menu and the illumination setting are reachable.** `contextAction` handles the two
actions the controller owns (`mode`, `battery-reset`) and returns quietly for the two the window owns
(`settings`, `quit`) rather than pretending. `setMode` steps through the real cycle instead of
assigning the mode, so the departure rules still apply — leaving the stopwatch clears a frozen split.
Both are exercised in the preview, where the case can be right-clicked.

**The World Time name rule was wrong, and the picture caught it.** The name was truncated to fit, which
turned `RIO DE JANEIRO` into `RIO DE J` and `FERNANDO DE NORONHA` into `FERNANDO D` — neither of which
is a place. A floor on the length did not help, because `FERNANDO D` is ten glyphs and still nonsense.
The rule is now: **show the name whole, or show the city code.** Eleven of the catalogue's names fit
and thirty-eight do not, and `RIO` says more than `RIO DE J` does and says nothing false.

That change exposed a second defect the rendered face had been showing all along: the `T-n` register
indicator was placed at a fixed `codeField.x - 46`, which had been correct until the code field moved,
and it was landing on the code it was meant to replace. The two runs did not *overlap* — they
interleaved into `T-2TYO`, which is invisible to a pairwise overlap test. The indicator is now
right-aligned by its own measured width, and the name yields to it, because the name is the elastic
field.

### The Electron shell — **written, not run**

M1 and M8's window half. Nine source files, 32 tests, and a verifier — but the honest summary is that
this is the first substantial block of work in the project that **cannot be executed here at all**.

| Piece | What it does | Requirement |
|---|---|---|
| `main.cts` | Lifecycle, single-instance lock, IPC, context menu | WIN-1, INT-7, NFR-6 |
| `window.cts` | Frameless transparent window, letterbox contract, drag rules, fullscreen yield | WIN-1, WIN-2, WIN-4, WIN-5, WIN-7 |
| `tray.cts` | Tray icon (drawn, not shipped) and menu | WIN-3, INT-7, NFR-9 |
| `config.ts` | Schema, per-field repair, clamping, atomic write | PRS-1, PRS-4, WIN-9, NFR-11 |
| `notify.ts` | Toast payload and Windows toast XML | ALM-10, ALM-12 |
| `notifications.cts`, `tray.cts` | The Electron-facing halves | ALM-11 |
| `renderer/index.ts` | The widget: binds `WatchController` to the bridge | everything on the face |
| `styles.css`, `index.html` | The letterbox and the drag regions | WIN-6, WIN-7, WIN-8 |
| `electron-builder.yml` | NSIS packaging, AppUserModelID pairing | NFR-10 |

**What the archive revealed: the ESM/CommonJS boundary is a real trap, and it is now a convention.**
`src/main` is CommonJS because Electron is; `src/shared` is ESM because the renderer is a page and the
tests load it directly. The two meet in three places, and each cost time:

1. `require()` cannot load the ESM `dist/shared/*.js`. So a main-process module may not import `shared`.
2. A `.cts` file cannot be loaded by the test runner — CommonJS by extension, so the ESM loader refuses
   it, and `createRequire` refuses the `import` statements inside it.
3. **The subtle one:** `tsconfig.main.json` with `module: "CommonJS"` **downlevels a dynamic `import()`
   to `require()`**, which cannot load ESM. The build succeeds, the types are right, and the app dies at
   startup with `ERR_REQUIRE_ESM`. `module: "Node16"` is what makes a CommonJS main process able to
   reach an ESM neighbour, and `scripts/verify-widget.mjs` now asserts the emitted form rather than
   trusting the source.

The resolution is a rule rather than a workaround: **the file extension says which module system a file
is.** Pure main-process logic goes in `src/main/*.ts` (ESM, Electron-free, unit-tested); Electron-facing
code goes in `src/main/*.cts`. That is what makes the config schema, the clamping rules and the toast
payload testable at all — 32 tests that would otherwise have been impossible.

**Two bugs the new tests found in code written the same hour.** `differsFromStored` compared
`JSON.stringify` output, which preserves key order, so a correctly-formatted settings file was reported
as damaged. And `ConfigFile.load` ran the repair comparison before the future-version check, so a file
from a newer build was reported as needing repair when it should simply have been left alone.

**And one in the verifier itself:** the sandbox check built a `RegExp` from `require(`, whose
unbalanced parenthesis threw *inside the verifier*. A verifier that crashes on its own check is worse
than no check — the build reports a failure that is not the code's. `RegExp.escape` now does the
escaping, and the verifier was confirmed to catch a real break by renaming the `#case` element.

## A recurring failure worth recordingAcross M2 and M4 I repeatedly **asserted values from memory instead of computing them**, and every
single one was wrong:

| Assertion | Reality |
|---|---|
| "`D` and `V` are the only missing glyphs" | Also `Z`, `X`, `B`, `K`, `Q` |
| "`K` and `Q` aren't needed — no code uses them" | All 26 letters are needed, by city *names* |
| "Collisions are `O`/`0` and `G`/`P`" | `G`/`P` was invented; real ones were `0O`, `5S`, `2Z` |
| "`H`/`K` collide" | They don't; `K`/`X` do |
| "One hour is two map cells" | Four, at this map's 96 cells. Two applies to a 48-cell map |
| "Pago Pago is column 25" | Column 4 |
| "New York is column 32" | Column 28 |
| Seconds fit at y=385 with a 26-cell | 41.7 tall, 5 units past the LCD foot |

And once I nearly "fixed" **correct** code: a test failed with "step 4, expected 2", and I had
conflated the 48-cell geometry the research quoted with this map's 96 cells. The distribution output
showed 4 for all 22 pairs, which is right.

**The lesson: compute, then assert.** The tests caught each error, but only because the assertions
were mechanical rather than remembered.

## What is verified, and how

| Claim | Evidence |
|---|---|
| The time engine is correct | 35 tests including fractional offsets, both hemispheres, leap years, `UTC` |
| The city table matches the manual | Deep-equality test against the transcribed code list |
| Every LCD string is renderable | Glyph coverage test over all 49 codes, 7 day names, 12 month names |
| Glyph collisions are fully declared | Mechanical audit asserting the declared list is exact |
| Band placement is physically right | 28 tests including monotonicity, cell size, wrap direction |
| The face is well-formed SVG | Balanced tags, zero `NaN`, zero `undefined`, no fonts or rasters |
| Nothing overlaps | Systematic pairwise glyph-box intersection over every scenario, both clock formats |
| Nothing overflows | Every glyph's box against the LCD rect, on every screen |
| State cannot drift | Forced-DST test asserting digits, offsets and day marker move together |
| **Every pusher does the right thing on every screen** | 69 transition tests: press, hold and chord, per screen, plus the sub-screen and setting-screen walks |
| **The mode cycle is complete** | Asserted to be a permutation of the five screens, not a chain of `if`s |
| **An alarm fires once per minute, not sixty times** | Crossing test, late-tick test, midnight test, spring-forward test, next-day test |
| **The countdown survives a restart** | Driven through a fake store: a session that quit ten minutes into twenty resumes with eleven left |
| **The stopwatch cannot drift** | 3 600 assertions over an hour of injected time, plus a three-capacity suspension |
| **The hold durations are the watch's** | Asserted against named constants: 1 s, 2 s, 3 s, and no others |
| **A chord is one gesture** | No hold fires while both pushers are down, and the chord is emitted exactly once |
| **CPU is bounded per screen** | Per-screen cadence asserted, including that an idle clock is not ticked at the stopwatch's rate |
| **The battery model is calibrated** | The decade's arithmetic derived independently of the implementation; ten seconds of alarm charges 1/42003.75 of the cell |
| **An alarm's cost matches how long it sounded** | A silenced alarm charges less than a full one, and a test alarm charges nothing |
| **A bad config file cannot crash the widget** | An invalid zone asserted not to throw from `faceState()` or `tick()` |
| **An older config file still loads** | The legacy `selected` field is read, so a rename did not reset every widget's register |
| **Every catalogue name fits or steps down to its code** | All 49 cities rendered and their glyphs measured |
| **The config file cannot lose itself** | Twenty successive atomic writes each re-read and parsed; a future-version file refused and left byte-identical |
| **A window can always be recovered** | Clamping swept over a 6 000-unit grid of positions, asserting a grab handle stays on screen every time |
| **The toast carries the alarm category** | The `scenario="alarm"` attribute asserted in the XML, since there is no Electron option for it |
| **The build stays inside the sandbox** | The widget verifier asserts no `require`, `process.env` or `__dirname` reaches the renderer, and that every import resolves |
| The preview actually works | Build-time verifier: inline script parses, modules resolve, every control id exists |
| The widget page is wired | Build-time verifier: HTML references files that exist, the entry parses, `main.cjs` keeps its dynamic `import()` |

## What is *not* verified

- **Colours.** Modelled from product photography; the research could not measure exact values.
- **Segment proportions and stroke weight.** Authored by eye, never compared to the real watch.
- **The entire running shell.** Window, tray, dragging, taskbar suppression, always-on-top's fullscreen
  yield, notifications actually appearing, Focus Assist, packaging and the installed app. None of it can
  be executed here — `docs/ENVIRONMENT.md` §4 explains why and §9 is the sixteen-item checklist for
  whoever has a desktop.
- **Whether the notification category works.** The XML is asserted; whether Windows honours it under
  Focus Assist is not knowable from here.
- **The rasteriser's own fidelity.** It is an inspection aid, not a source of truth, and it ignores the
  decimal point (emitted as an arc).
- **The case proportions.** The window is 450 × 445 units where the real case is 450 × 421. It had to
  grow to hold the printed `10 YEAR BATTERY` line *below* the LCD rather than across it. This is a
  deviation from the device and it is visible to anyone who owns one — see "Known rough edges".
- **The CPU budget in absolute terms.** What is asserted is the *wake rate*, which is the number the
  controller controls. The cost of the redraw it triggers is not measured, and on a machine with a
  compositor it is the larger term. NFR-4's "below half a percent" is therefore argued rather than
  demonstrated.

## Known rough edges

- **The case is 5.7% taller than the real watch**, for the reason above. The alternative was printing
  `10 YEAR BATTERY` across the main digits, which the rasterised face showed immediately.
- **Thirty-eight of the catalogue's forty-nine city names do not fit the World Time row** and are
  shown as their three-letter code instead. That is the honest rule (a truncated name is a wrong
  name), but it means the screen shows names for the short-named cities and codes for the rest, which
  is inconsistent to look at. Widening the row would mean giving up the code field or the register
  indicator.
- **The timer's sub-field row and the seconds share a line**, in separate columns. The columns are a
  compromise: moving the seconds right to close the gap with the main digits puts them through the
  stopwatch's sub-field, which the layout test caught when it was tried.
- **The stopwatch's hundredths are small** (a 16-unit cell against the main digits' 26). Ten glyphs do
  not fit one row of a 340-unit LCD at a readable size, and the real module makes the same trade.
- `SIG` on the LCD is visually near the case's printed `SEARCH` label.
- `royale` is still a placeholder product name and appears in packaging metadata.
- Colours live in `THEME` in `theme.ts` for exactly this reason: a colour pass is one edit per token.

## The next session should start here

**Run the shell on a desktop.** Everything that can be built without a window is built, and everything
that can be tested without one is tested. The next step is not more code — it is
`docs/ENVIRONMENT.md` §9's sixteen-item checklist on a real machine.

Expect problems. The three most likely, in order:

1. **Always-on-top will not yield to fullscreen** (item 6). This is the plan's risk R-4, and the code is
   an acknowledged approximation: Electron exposes no foreground-window handle, so `foregroundLooksFullscreen`
   uses a proxy. If it misbehaves, the fix is a native `GetForegroundWindow` call, which means the
   project's first native dependency.
2. **The toast never appears, or Focus Assist suppresses it** (item 10). Check `app.setAppUserModelId`
   runs before the first toast, then that `appId` in `electron-builder.yml` matches `APP_USER_MODEL_ID`.
   §11 of ENVIRONMENT.md is the diagnosis order.
3. **The window is a transparent rectangle that eats clicks** (item 3). Plan risk R-3. The `no-drag`
   rules in `styles.css` are the fix if the pushers drag instead of clicking.

After that: colours, segment proportions, and the case ratio — the four things in "Known rough edges"
that need eyes rather than tests.
