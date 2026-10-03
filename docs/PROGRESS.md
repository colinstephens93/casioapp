# Progress

A chronological record of what has been built, what was learned, and what is verified. Written for
someone picking this up cold. For *how to work on it*, see [HANDOFF.md](HANDOFF.md).

Last updated: after M7 (all five screens, every pusher gesture, Auto Display, MUTE).

## At a glance

| Metric | Value |
|---|---|
| Tests | **358 passing**, 0 failing, across 78 suites and 12 files |
| Typecheck | Clean on all four `tsconfig` files, including the Electron main process |
| Build | Clean, single pass, and self-verifying (`npm run build` includes preview verification) |
| Screens | All five (Timekeeping, World Time, Alarm, Timer, Stopwatch) plus six setting screens |
| Can it run? | **No** — see [ENVIRONMENT.md](ENVIRONMENT.md). Its *drawing* can be rendered and inspected. |
| Git | Three commits (`requirements`, `grill me skill`, `Add the initial project note`). **All of M0–M7 is uncommitted.** |

> **Uncommitted work.** Everything described below exists only in the working tree. If this matters,
> commit it before starting new work — a lost working tree would take the whole project with it.

### Test breakdown

| File | Tests | Covers |
|---|---|---|
| `test/time.test.ts` | 35 | Offsets, wall clock, ±1 day marker, DST, formatting, zone validation |
| `test/watch.test.ts` | 31 | Live state, registers, persistence, repair, controller |
| `test/face.test.ts` | 34 | Face composition, layout bounds, glyph overlap, glyph overflow, conditionals |
| `test/map.test.ts` | 28 | Land bitset, band placement, Home City fallback, fitting |
| `test/machine.test.ts` | 69 | Every pusher on every screen: press, hold and chord; the five screens' rules |
| `test/alarms.test.ts` | 18 | The five alarms, the crossing test, the midnight and DST cases, repair |
| `test/timer.test.ts` | 23 | The countdown against an injected clock, pause/resume, rollover, persistence |
| `test/stopwatch.test.ts` | 18 | The three behaviours, the 24-hour rollover, formatting |
| `test/gestures.test.ts` | 25 | Press, hold at each real duration, chord, repeat cadence |
| `test/controller.test.ts` | 31 | Cadence, the seconds reset, restart, notifications, the backlight, persistence |
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

## A recurring failure worth recording

Across M2 and M4 I repeatedly **asserted values from memory instead of computing them**, and every
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
| The preview actually works | Build-time verifier: inline script parses, modules resolve, controls exist |

## What is *not* verified

- **Colours.** Modelled from product photography; the research could not measure exact values.
- **Segment proportions and stroke weight.** Authored by eye, never compared to the real watch.
- **Anything needing a visible window:** dragging, tray, taskbar suppression, always-on-top, resize
  behaviour, Windows notifications, the audible alarm. None of it can be exercised here.
- **The rasteriser's own fidelity.** It is an inspection aid, not a source of truth, and it ignores the
  decimal point (emitted as an arc).
- **The case proportions.** The window is 450 × 445 units where the real case is 450 × 421. It had to
  grow to hold the printed `10 YEAR BATTERY` line *below* the LCD rather than across it. This is a
  deviation from the device and it is visible to anyone who owns one — see "Known rough edges".

## Known rough edges

- **The case is 5.7% taller than the real watch**, for the reason above. The alternative was printing
  `10 YEAR BATTERY` across the main digits, which the rasterised face showed immediately.
- **The timer's sub-field row and the seconds share a line**, in separate columns. The columns are a
  compromise: moving the seconds right to close the gap with the main digits puts them through the
  stopwatch's sub-field, which the layout test caught when it was tried.
- **The stopwatch's hundredths are small** (an 16-unit cell against the main digits' 26). Ten
  glyphs do not fit one row of a 340-unit LCD at a readable size, and the real module makes the same
  trade.
- `SIG` on the LCD is visually near the case's printed `SEARCH` label.
- `royale` is still a placeholder product name and appears in packaging metadata.
- Colours live in `THEME` in `theme.ts` for exactly this reason: a colour pass is one edit per token.

## The next session should start here

M8 — battery, illumination, polish and packaging — plus the Electron shell (M1 and the M8 window
work). Neither can be *verified* in this sandbox, which is why they are last, but the headless parts
can be: the drain model has a calibration already written down in `controller.ts` (42 003.75 seconds
of operation, from Casio's own 10 s + 1.5 s per day over ten years), and `drainAlertSeconds` is the
seam waiting for the alert lifecycle to call it. Nothing currently charges the battery for alarm
sound, which is the one open half of BAT-2.
