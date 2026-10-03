# Development Plan — Casio AE-1200WH Desktop Clock Widget

Companion to [REQUIREMENTS.md](REQUIREMENTS.md). Every task below traces to requirement IDs; nothing here
should be built that those requirements do not ask for.

## 1. How this plan is organised

Work proceeds in nine milestones. **M0 is a gate**: if the toolchain cannot be installed in this
environment (see R-1), the plan changes shape and nothing else should start until that is resolved.
Everything after M3 is independently useful, so the widget is demonstrable long before it is complete.

| Milestone | Theme | Requirements | Size | Demonstrable result |
|---|---|---|---|---|
| M0 | Toolchain gate and repo scaffold | NFR-1, NFR-6, NFR-10, NFR-11 | S | `npm start` opens an empty frameless window |
| M1 | Window citizenship, tray, persistence | WIN-1…WIN-10, PRS-1, PRS-4 | M | A draggable transparent box that survives restart |
| M2 | The shell: case and LCD | DIS-1…DIS-9, DAT-3, BR-1, BR-2 | L | A convincing blank watch you can resize |
| M3 | Time engine | ZON-1…ZON-8, DST-1…DST-6, PRS-5, DAT-1, NFR-3, NFR-7 | M | Correct offsets and DST, unit-tested, no UI |
| M4 | Timekeeping, subdial, world map | TIM-1…TIM-12, ANA-1…ANA-5, MAP-1…MAP-7, DAT-2, DAT-4 | L | A working world clock on screen |
| M5 | World Time and Multi Time | WLD-1…WLD-5, MOD-1…MOD-6 | M | **Done.** All four registers, band follows the city |
| M6 | Alarm, Timer, Stopwatch | ALM-1…ALM-12, TMR-1…TMR-8, SW-1…SW-10 | L | **Done.** All five screens functional |
| M7 | Interaction fidelity | INT-1…INT-8, MUT-1…MUT-3, TIM-4…TIM-11, ALM-4 | M | **Done.** Hold, chord, flashing fields, mute, Auto Display |
| M8 | Battery, illumination, polish, packaging | BAT-1…BAT-6, LIT-1…LIT-4, NFR-4, NFR-8, NFR-9 | M | Shippable installer |

Sizes are relative effort, not calendar time.

### What M5–M7 actually delivered, and where it differs from the plan above

The plan's milestone list is unchanged and every requirement ID kept its owner. Three things are worth
recording because they were decisions rather than transcription:

1. **The logic split further than planned.** The plan put the mode state machine in the renderer
   (`src/renderer/state/machine.ts`). It is in `src/shared/machine.ts` instead, with a separate
   `controller.ts` holding every timer. The reason is that the machine is a **pure reducer** and the
   controller is the only object with a clock in it, which is what let 69 transition tests run without
   a single real millisecond passing — and it is what makes the same code usable from the Electron
   main process later without dragging the DOM along.
2. **`src/shared/watch.ts` is no longer the widget's state.** `controller.ts` supersedes it: the
   controller owns the same four registers plus the screens, alarms, timer, stopwatch and gestures.
   `watch.ts` remains because `map.ts`'s tests and the map band's Home City rule still use it, and
   because deleting a working, tested module is not this milestone's job. **A future session should
   fold the two together** — there is currently one concept ("the live watch") with two owners.
3. **The alarm screen's sixth slot is modelled as a position, not a sixth alarm.** The hourly signal
   has no time of its own, so giving it an `AlarmDef` with a dummy time would have made it printable by
   mistake. `screenIndex.alarm` is a position in `1 2 3 4 5 SIG`, and `alarmSlot()` maps it to the
   label. Conflating the position with the slot number was a real bug (see PROGRESS.md).


## 2. Architectural decisions taken before coding

These are settled here because unwinding them later is expensive.

1. **Process split.** Electron main owns the window, tray, notifications and config file. The renderer
   owns all drawing and the mode state machine. The preload exposes a deliberately narrow API.
2. **Headless-first logic.** `time`, `catalog`, `map` and `battery` must import nothing from Electron or
   the DOM. This is what makes NFR-7 and NFR-8 achievable, and it is the single most important structural
   rule in the plan.
3. **The mode state machine is headless too.** Screens are pure render functions over a state object;
   the transition logic (what MODE, SEARCH, LIGHT and ADJUST do per screen) lives outside the DOM so it
   can be tested exhaustively. This is how §6 of the requirements gets verified rather than hoped for.
4. **SVG construction.** Glyph geometry is authored once in a sprite (`<defs><symbol>`) and instanced
   with `<use>`. Segment on/off is a CSS class on the instance, driven by style rules only — never by
   per-instance geometry — so a digit stays hairline at 120 px and chunky at 700 px with no font and no
   blur. The map is a discrete grid of rects, not a scaled bitmap, for the same reason.
5. **Time base.** The stopwatch uses a monotonic high-resolution source (`performance.now()`), because
   wall-clock adjustment must not corrupt elapsed time. Alarms and the countdown use absolute epoch
   timestamps, because they must survive a restart.
6. **Config schema is versioned from the first commit** (`{"version": 1, …}`), and is written atomically
   (temp file + rename) so a crash at the wrong moment cannot truncate it.
7. **No drawing reuse from the reference project.** Only its logic and data are lifted, under MIT.
8. **One-way dependency.** `src/shared` is the lowest layer: it must not import from `src/main`,
   `src/renderer` or `src/preload`, and must not touch the DOM. The renderer *bundles* `src/shared`;
   nothing in `src/shared` may reach upward. This is what lets the same logic run under Node for tests
   and in the browser for the preview, and it is enforced by review, not by tooling.

### Revised build order (why the plan was reordered)

M0 established that **the Electron GUI cannot run in this development sandbox**: DSH executes commands
on a non-interactive desktop, so no window can be shown, and Chromium's multi-process IPC needs the
named pipes this sandbox forbids. See [ENVIRONMENT.md](ENVIRONMENT.md) for the diagnostics.

The consequences for sequencing, effective immediately:

- The **verifiable core is built first** — `src/shared` plus the case and LCD as pure SVG. These are
  testable and previewable here, and they are where correctness and fidelity actually live.
- The **renderer stays Electron-free** and is built to a standalone HTML file, so the face can be
  opened in an ordinary browser and judged by eye. This is the only way to review fidelity in this
  environment.
- **Electron integration moves last.** It is written, but its verification is deferred to a normal
  desktop where `ELECTRON_RUN_AS_NODE` is not set.
- Consequently M0's "exit criteria" is met in build terms only; its launch criterion is deferred rather
  than claimed.

This reordering changes *when* work happens, not *what* is required: every requirement ID keeps its
milestone owner.

### Proposed repository layout

```
package.json  tsconfig.json  electron-builder.yml  README.md
docs/         RESEARCH.md  REQUIREMENTS.md  PLAN.md
src/
  main/       main.ts  window.ts  tray.ts  notifications.ts  config.ts
  preload/    preload.ts
  renderer/   index.html  styles.css
              index.ts
              sprite.ts          # digit, letter and icon glyph geometry
              case.ts            # case, bezel, printed text, pushers
              lcd.ts             # LCD composition and element placement
              subdial.ts         # analog subdial (ANA-*)
              map.ts             # map rendering and band placement
              screens/
                timekeeping.ts  worldtime.ts  alarm.ts  timer.ts  stopwatch.ts  settings.ts
              state/
                machine.ts       # mode and sub-mode transitions, headless
                interact.ts      # press, hold, chord recognition
  shared/     time.ts  catalog.ts  cities.data.ts  mapband.ts  battery.ts  types.ts
assets/       world-bitset.ts     # generated 96x40 Natural Earth data
test/         time.test.ts  dst.test.ts  catalog.test.ts  machine.test.ts  battery.test.ts  mapband.test.ts
scripts/      gen-map.ts
```

## 3. Milestones

### M0 — Toolchain gate and repo scaffold

**Goal:** prove the project can be built in this environment before investing in it.

- Confirm `node --version` is 18.3+ and `npm` is usable.
- **Run `npm install electron` as the very first action and treat failure as a plan-level event.** The
  session's shell has broken HTTPS egress (only plain HTTP works), so this may fail; see R-1.
- Initialise `package.json`, TypeScript config, and the `src/main|preload|renderer|shared` skeleton.
- Set `contextIsolation: true`, `nodeIntegration: false` (NFR-6).
- Add MIT attribution for the reference project (NFR-10).
- Open an empty frameless window to prove the pipeline end to end.

**Exit criteria:** `npm start` opens an empty frameless window; `tsc --noEmit` is clean.

### M1 — Window citizenship, tray, persistence

- Frameless, transparent window; `-webkit-app-region: drag` on the case only (WIN-1, WIN-2).
- **Every interactive child must set `-webkit-app-region: no-drag`**, or pushers will be swallowed by the
  drag region — the classic failure of this pattern.
- Suppress the taskbar entry and Alt+Tab presence (WIN-4).
- Always-on-top that yields to fullscreen (WIN-5): use the normal level, not a screen-saver level, and
  verify against a fullscreen video and a fullscreen game.
- Tray icon with Show/Hide and Quit (WIN-3). The tray is the recovery path if the window is ever
  off-screen, so it must also offer a "reset position" action beyond the requirements' minimum.
- Persist and restore position and size; clamp a restored position into the visible work area so a
  disconnected monitor cannot strand the widget (WIN-9, PRS-1).
- Atomic config write with schema version and defaults-on-invalid (PRS-4, NFR-11).

**Exit criteria:** the widget survives restart in place; it is absent from taskbar and Alt+Tab; it does
not cover a fullscreen video.

### M2 — The shell: case and LCD

- Author the 7-segment digit glyph set, the letter glyph set for day names and city codes, and the icon
  set (`DST`, `MUTE`, `ALM`, `SIG`, `T-1`…`T-4`, `PM`, `SPL`) as SVG in a sprite (DIS-5, DIS-6, DAT-3).
- Author the case: matte black clipped-corner silhouette, centre seam, the four pushers, and the printed
  text `WORLD TIME`, `ILLUMINATOR`, `CASIO`, `5 ALARMS`, `WR100M`, `10 YEAR BATTERY`, `MODE`, `ADJUST`,
  `LIGHT`, `SEARCH` (DIS-1, BR-1, BR-2).
- Compose the LCD with all fields in their true positions, unlit (DIS-3, DIS-4, DIS-9).
- Implement letterbox resize: device scaled to fit, centred, leftover filled with case colour (WIN-6,
  WIN-7, WIN-8).
- Colour pass against reference photography (OI-2).

**Exit criteria:** a convincing blank watch, crisp at 200 px and at 1200 px wide, at any window aspect.

### M3 — Time engine

Lift `time.ts` and the band maths from the reference project (MIT, attributed), then extend.

- Offsets, wall clock, civil-day difference, `formatOffset`/`formatClock`, ICU rename normalisation
  (ZON-7, ZON-8, PRS-5).
- Build the full 46-code city table **as data** with IANA zones, including the reference project's
  extended fractional offsets (ZON-1…ZON-6, DAT-1). Do not hard-code "48 cities / 31 time zones".
- DST: manual per city, default `off`, with `auto` as the documented extension and correct southern
  hemisphere handling; inert for `UTC` (DST-1…DST-6).
- Unit-test all of it, including the southern-hemisphere and no-DST cases, `UTC`, and a leap year.

**Exit criteria:** tests pass; `+05:45` and `+12:45` resolve correctly; no dependency beyond `Intl`.

### M4 — Timekeeping, subdial, world map

- Timekeeping screen: seconds, day of week, month–day, hour:minutes, `PM`, auto-calendar 2000–2099
  (TIM-1, TIM-2, DIS-4).
- Analog subdial, always T-1, ring numbered 5–60, centre hub (ANA-1…ANA-5). Verify it does **not** move
  when the displayed city changes.
- World map from the 96×40 bitset: land grid, band placement, antimeridian wrap, land visible inside the
  band (MAP-1…MAP-3, MAP-5, MAP-6, DAT-2, DAT-4).
- **Implement the band-follows-displayed-zone rule and its Home City fallback now**, with the mode as an
  input to the render function, so the fallback exists structurally rather than being retrofitted (MAP-4).

**Exit criteria:** correct local time; band tracks the city you select; subdial stays on T-1.

### M5 — World Time and Multi Time — **done**

- MODE cycling across the three modes and two inner screens (MOD-1).
- SEARCH cycles T-1…T-4 with the transient T-number (MOD-2, MOD-3).
- World Time: eastward scroll, fast scroll on hold, per-city DST toggle, `UTC` exclusion, second
  synchronisation with Timekeeping, ±1 day marker computed by civil date (WLD-1…WLD-5, DST-6).
- Last-viewed city and alarm restored on re-entry (MOD-4); mode state persists (MOD-6).

**Exit criteria:** four registers all reachable and correct; the map band and the day marker follow.

### M6 — Alarm, Timer, Stopwatch — **done, except the notification**

- Five alarms plus the hourly signal; Daily/One-time/Off cycle; auto-arm on entering settings; test alarm
  on hold; 10-second sound stopping on any button; flashing indicator in all modes (ALM-1…ALM-9).
- Windows notification registered in the alarm category so Focus Assist is respected, plus the on-face
  animation, with audible output off by default (ALM-10…ALM-12).
- Timer: 1 s–24 h, 1/10 s display, `24H`, start/pause/resume, full stop returns to start value,
  auto-reset at zero, never auto-restart, absolute-end-time persistence (TMR-1…TMR-8).
- Stopwatch: 1/100 s, 23:59′59.99″, elapsed/split/two finishes, keeps running across modes, clearing a
  frozen split on exit, 24 h rollover, no lap memory, resets on launch (SW-1…SW-10).
- Unit-test the timer and stopwatch logic against injected clocks, including rollover and restart.

**Exit criteria:** a real alarm fires a Windows notification; a countdown survives a mid-flight restart.

### M7 — Interaction fidelity — **done, except the context menu**

- Press, hold and chord recognition, with visible pressed state and visible chord state (INT-4, INT-8).
- The exact hold durations: ~1 s, ~2 s, ~3 s (INT-5).
- Setting screens with flashing fields and the watch's per-screen field orders (TIM-4…TIM-11, ALM-4,
  TMR-3).
- ADJUST+LIGHT promotes the displayed city to Home City (INT-6, TIM-10).
- Auto Display via hold SEARCH, cancelled by any button (TIM-11).
- Auto-return to Timekeeping after 2–3 minutes idle (MOD-5).
- Mute on hold MODE, indicator shown, state persisted (MUT-1…MUT-3).
- Context menu: mode switch, settings, reset battery, quit (INT-7).

**Exit criteria:** every gesture in §6 of the requirements is demonstrable and, where logic-only,
unit-tested in the state machine.

### M8 — Battery, illumination, polish, packaging

- Simulated battery: 100% start, drain from actual alarm-sound and backlight seconds, calibrated to
  Casio's 10 s + 1.5 s per day over 10 years, persisted and displayed, resettable (BAT-1…BAT-6, LIT-1,
  LIT-3).
- Amber illumination wash at the selectable 1.5 s / 3 s duration, feeding the battery (LIT-2, LIT-4).
- Performance pass to meet the idle budget; confirm no idle repaint (NFR-4).
- Accessibility floor: pusher labels, keyboard-reachable tray menu (NFR-9).
- Package with `electron-builder` for Windows; confirm the known ~150 MB size is acceptable (NFR-1).
- Write `docs/RESEARCH.md` with the watch citations, then finalise `README.md`.

**Exit criteria:** a shippable installer; all 15 acceptance criteria in the requirements pass.

## 4. Test strategy

| Layer | Approach |
|---|---|
| Time, zones, DST | Pure unit tests with injected instants. Must cover: fractional offsets, southern hemisphere, no-DST zones, `UTC`, a leap year, and the ICU rename table. |
| Map band | Unit tests on offset→column maths, including the antimeridian wrap and every fractional offset in the table. |
| Mode state machine | Exhaustive transition tests: for each screen, assert what each of the four pushers does on press, hold and chord. This is where §6 of the requirements becomes enforced rather than documented. |
| Battery model | Deterministic tests with injected usage: 10 s alarm + 1.5 s light per day must land near 10 years. |
| Drawing | Snapshot tests on generated SVG where practical; visual check at three window sizes and three aspect ratios. |
| Manual | The 15 acceptance criteria, checked by hand once per milestone that touches them. |

## 5. Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-1 | **`npm install` fails here** — the session's shell has broken HTTPS egress (plain HTTP only), and `casio.com` already returns 403. | High | Blocks the entire Electron plan | Attempt the install as the **first** M0 action. If it fails, escalate for a permission that allows network egress, or fall back to a zero-dependency static implementation: plain HTML/CSS/JS/SVG opened in a browser, losing only tray, notifications and always-on-top. Decide at the gate, not later. |
| R-2 | `-webkit-app-region: drag` swallows clicks on pushers inside the case. | High | Every pusher dead | `no-drag` on all interactive elements; explicitly tested in M1 before any drawing work. |
| R-3 | Transparent frameless windows on Windows intercept mouse events over fully transparent regions, so the widget behaves like an invisible box. | Medium | Feels broken, blocks desktop clicks | Test `setIgnoreMouseEvents` with `forward: true` early; if needed, give the case a subtle opaque backdrop so the hit area matches the visible device. |
| R-4 | Always-on-top will not yield to fullscreen on Windows. | Medium | Covers games and films — the exact thing WIN-5 forbids | Verify with a real fullscreen video and game in M1; if the normal level is insufficient, detect fullscreen foreground windows and drop the top level for the duration. |
| R-5 | Authoring the 7-segment letter glyph set is larger than it looks — day names plus ~46 city codes. | Medium | Slips M2 | Author geometry once in a sprite (DAT-3) and generate the code set from the city table rather than drawing letters by hand; test that every code in the table renders. |
| R-6 | Accumulated-tick timing drifts, making the stopwatch wrong — precisely what SW-1 forbids. | Medium | Silent accuracy failure | Absolute and monotonic time sources only (PRS-5, NFR-5); unit-test after simulated long runs. |
| R-7 | The 10-year battery model shows no visible change, making the feature look broken. | Medium | Wasted work, user confusion | The model is honest by design; expose the computed rate in settings documentation, make the reset obvious, and consider a visible state change at threshold milestones rather than pretending time passes faster (BAT-5). |
| R-8 | Exact colours and glyph shapes are guesses from photography (OI-2). | Medium | Looks off to anyone who owns the watch | Dedicated colour pass in M2 against good reference photos; keep colours as named tokens so they are one edit each. |
| R-9 | Notifications are silently suppressed by Windows settings, looking like a bug. | Low | Alarm appears not to work | Verify in M6 against Focus Assist on and off; always pair the notification with the on-face animation (ALM-11) so the alarm is visible regardless. |
| R-10 | Reused logic from the reference project drags in terminal assumptions. | Low | Rework in M3 | Only `time.ts`, the city data and the band maths are lifted, all verified free of Node-only APIs; all rendering is rebuilt. |

## 6. Definition of done

The project is done when:

1. All 15 acceptance criteria in [REQUIREMENTS.md](REQUIREMENTS.md) §7 pass.
2. Every requirement ID in §2 and §3 is either implemented and verified, or explicitly deferred with a
   recorded decision.
3. The unit tests in §4 pass, including the state-machine coverage of every pusher gesture per screen.
4. `docs/RESEARCH.md` and `README.md` are complete, and MIT attribution is present.
5. The Windows installer builds and installs, and the installed app meets the acceptance criteria.
6. Nothing in §9 of the requirements has been built by accident.
