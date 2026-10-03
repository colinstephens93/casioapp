# casioapp

A desktop clock widget modelled on the **Casio AE-1200WH** ("Royale", module 3198): the green LCD,
the world map with its lit time-zone band, the analog subdial, the four labelled pushers, and all
five screens the watch's three modes contain.

Status: **all five screens and every pusher gesture are built and tested.** The verifiable core is
complete; what remains is the Electron shell, the battery model and packaging. See
[docs/PLAN.md](docs/PLAN.md) for the milestone sequence and [docs/PROGRESS.md](docs/PROGRESS.md) for
what is verified and how.

This is a fan project. It is not affiliated with or endorsed by Casio. See [NOTICE.md](NOTICE.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Every requirement, with stable IDs (`WIN-*`, `TIM-*`, `DST-*`, …), acceptance criteria and explicit non-goals |
| [docs/PLAN.md](docs/PLAN.md) | Milestones M0–M8, architectural decisions, test strategy, risks |
| [docs/RESEARCH.md](docs/RESEARCH.md) | The watch's actual documented behaviour, with citations and everything that could not be verified |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | Sandbox obstacles and the workarounds, worth reading before running any command |
| [NOTICE.md](NOTICE.md) | MIT attribution for reused logic, and the trademark position |

## Getting started

Requires **Node 18.3 or later** (developed on 24.16).

```sh
npm install          # toolchain and the electron package wrapper
npm run fetch:electron   # downloads the electron binary — see below for why it is separate
```

`npm install` deliberately does **not** download the Electron binary. In the DSH sandbox this
project is developed in, npm cannot run install scripts at all (the sandbox forbids spawning a
child with piped stdio, which is how npm runs them), so the binary is fetched by an explicit step
that works both inside the sandbox and on an ordinary machine. Full explanation in
[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md). Approving electron's install script with
`npm install-scripts approve` **breaks the install** — do not.

Then:

```sh
npm test         # 361 unit tests: time, zones, DST, map, glyphs, face, screens, gestures, battery
npm run build    # compiles main/preload to CommonJS and shared/renderer to ESM, then verifies the preview
npm run typecheck  # four tsconfigs — the tests cannot see types, so this is not optional
npm start        # builds, then launches the widget
npm run watch    # rebuilds shared and renderer on change
```

### A trap when launching Electron

If the widget exits instantly with

```
TypeError: Cannot read properties of undefined (reading 'commandLine')
```

then the environment variable **`ELECTRON_RUN_AS_NODE` is set**, which makes `electron.exe` run as
plain Node — no GUI initialises, and `require('electron')` resolves to the npm wrapper package
(whose export is a *path string*) instead of Electron's built-in module. `npm start` goes through
`scripts/run.mjs`, which clears the variable for the child process, so prefer `npm start` over
calling `electron` directly.

## Layout

```
docs/            requirements, plan, research, environment notes
scripts/         build, watch, launcher and electron fetch (all Node, no bundler)
src/main/        Electron main process (CommonJS, .cts)
src/preload/     the narrow context-bridge surface (CommonJS, .cts)
src/renderer/    the face: case, LCD, screens (ESM, DOM)
src/shared/      logic with no DOM and no Electron dependency (ESM)
test/            unit tests, run directly by Node with no build step
```

### The one structural rule

`src/shared` is the lowest layer. It must not import from `src/main`, `src/renderer` or
`src/preload`, and must not touch the DOM. The renderer *bundles* it; nothing in it reaches
upward. This is what lets the same time and state logic run under Node for tests and in a browser
for preview, and it is what makes the widget's correctness testable without a window.

### Build toolchain

Source uses explicit `.ts` import specifiers, so **Node runs the tests directly with no build
step** via its native type stripping. Browsers cannot load `.ts` specifiers, so the renderer build
rewrites them to `.js` using the TypeScript compiler API — in process, because the sandbox forbids
spawning a child with piped stdio. There is no bundler and no transpiler dependency beyond
TypeScript itself.

## Progress

**361 tests passing, typecheck clean on all four configs.** The verifiable core is complete — see
[docs/PROGRESS.md](docs/PROGRESS.md) for the history and [docs/HANDOFF.md](docs/HANDOFF.md) for where
to pick up.

| Area | State |
|---|---|
| Toolchain, build, tests | Working; the build self-verifies the preview |
| Time engine: offsets, wall clock, ±1 day marker, DST, formatting | Built, 35 tests |
| City catalogue: the watch's 49 codes plus extended offsets | Built, verified against the manual's list |
| Seven-segment glyph encoding | Built, 18 tests, collisions declared and audited |
| Case, LCD, world map, analog subdial | Built, **visually verified** |
| Live state: four registers, DST, persistence | Built |
| Mode state machine: five screens, every pusher | Built, 69 transition tests |
| World Time: city scrolling, fast scroll, per-city DST, promotion | Working |
| Alarm: five alarms, the hourly signal, the test alarm, 10-second alerts | Working |
| Countdown Timer: 1 s–24 h, pause/resume, absolute-end persistence | Working |
| Stopwatch: elapsed, split, two finishes, 24-hour rollover | Working |
| Pusher gestures: press, hold at 1/2/3 s, chords, repeats | Working, 25 tests |
| Auto Display, auto-return, MUTE, flashing setting fields | Working |
| Battery simulation: drains from real alarm and backlight seconds | Working, calibrated to Casio's rating |
| Context menu, illumination duration | Working (controller half; the shell supplies the menu) |
| Browser preview with live controls | Working — open `dist/preview/index.html` |
| Notifications, tray, packaging | Not built; **cannot be run in the development sandbox** |

### Seeing it without running it

The widget cannot be launched in the development sandbox, but its **drawing** can be rendered and
inspected — which is how every layout defect so far was found, including one class that no test can
see. See [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) §7:

```sh
npm run build
node scripts/extract-svg.mjs 0 dist/preview/face-0.svg
python scripts/svg_to_png.py dist/preview/face-0.svg face.png 2
```

### Five things needing human eyes

The **colours** are modelled from product photography rather than measured, the **segment
proportions** were authored by eye, the **case is 5.7% taller than the device** so that the printed
`10 YEAR BATTERY` line has somewhere to sit (see [docs/RESEARCH.md](docs/RESEARCH.md) §6), **most city
names do not fit the World Time row** and are shown as their three-letter codes instead, and the
product name `royale` is a placeholder. All of them live as tokens or constants, so correcting them is
one edit each. The fastest route is to open `dist/preview/index.html` beside the real watch.
