# Next session starts here

Written 2026-10-04. Read this first, then [HANDOFF.md](HANDOFF.md).

The earlier copy of this file asked for a browser check of the silver AE-1200 face, then deletion of the flat glyph route, then the Electron desktop checklist. The colour measurements from that work are in [RESEARCH.md](RESEARCH.md) §7 and in `THEME` (`src/shared/theme.ts`). The window people open has since become the world-time board. Resume from the board.

## RESUME HERE

The desktop window is the world-time board.

```powershell
cd C:\Users\colin\Documents\DeepSeek\harness_playground\casioapp
npm run build
```

Then double-click `World time.vbs`, or a shortcut that points at that script. It opens `dist/renderer/widget.html` in an Edge app window. There is no terminal. A missing Edge or a missing `widget.html` produces a message that says to run `npm run build`.

`npm start` builds and launches Electron. On this PC `electron.exe` 40.10.6 exits before a window appears. A silent Electron exit means that crash, which [ENVIRONMENT.md](ENVIRONMENT.md) and the comment in `World time.vbs` already record. The shortcut is the launch path.

The watch face is the preview. After the same build, open `dist/preview/index.html`. The Live card is first and the controls are above the gallery. Index 0 from `scripts/extract-svg.mjs` is that Live card.

## What the board does

| | |
|---|---|
| Drawing | `src/renderer/board.ts` and `src/renderer/styles.css`. Timan's arrangement and palette, as HTML. `THEME` colours the watch face. The board's colours are the literals in those two files. |
| State | `src/shared/desk.ts`. System zone as T0, up to nine favourites. Defaults: New York, London, Tokyo, Hong Kong, 12-hour, focus on New York. |
| Persistence | Edge has no preload bridge, so the board is stored in `localStorage` under `worldtime.desk`. Electron still saves through the bridge into the config file. A payload without `desk: 1` is an old watch blob and is replaced with the defaults. |
| Keys | ↑↓ selection, ←→ favourites, `f` favourite, `d` DST on a favourite, `t` 12/24. The footer buttons do the same three actions. |
| List | The catalogue omits a zone that is already showing. A favourite that is also the system zone appears twice, as T0 and as its slot. The selected row shows ▸. A favourite that is not selected shows ★. |
| Map | 64×16 cells sampled from the 96×40 bitset. The band is two columns. Only land in those columns is marked `land band`. Ocean cells in the band stay empty, so there is no full-height bar. |
| Digits | Block glyphs joined with a space, so the seconds are two digits. Unlit segments are `#101612`. Main digits use width 9. Seconds use width 3. |
| Mark | `<p class="mark">CASIO</p>`, top right, colour `#6f8571`, the same dim green as the panel labels. |
| Resize | The grip clamps to 760×540 through 1100×780. With no bridge it calls `window.resizeTo`. The Edge window moves by its title bar. |
| Power | `navigator.getBattery` when present. The line is blank when the API is missing. That figure is the operating-system battery. The simulated 10-year cell is the watch controller's. |
| Second click | The script starts Edge with `%LOCALAPPDATA%\WorldTime` every time. It does not search for an existing window. |

`widget.html` is the classic bundle `widget.js`. `index.html` is the ES module page Electron's `loadFile` uses. Edge blocks that module page on `file://`.

## Checks

`npm test` on 2026-10-04: **439 tests, 94 suites, 15 files, 0 failures.** `npm run check` is typecheck, then build, then tests. The wiring tests need `dist/` to exist, which `npm run check` provides and a bare `npm test` on a fresh checkout does not.

`npm run build` and `npm run check` delete `dist/`. Review rasters belong in `review/`.

## Still open

1. **Electron has not produced a window on this PC.** Tray, toasts, always-on-top, Focus Assist, and the installer are unrun. [ENVIRONMENT.md](ENVIRONMENT.md) §9 is that checklist. It describes the Electron shell. The Edge window is a separate, working launch.
2. **The flat glyph route is still in the build** (`src/renderer/flat-probe.ts`, `scripts/make-flat-probe.mjs`, `dist/preview/route-probe.html`). It was kept until a browser said which card draws. That answer was never recorded. HANDOFF.md lists the files to delete once both cards draw, or to keep if only the flat card draws.
3. **`royale`** is still the `appId` in `electron-builder.yml` and `APP_USER_MODEL_ID` in `src/main/notify.ts`. Changing it after an install is a migration.
4. **The case ratio, `ILLUMINATOR` placement, and map resolution** on the watch face are the open design notes in [RESEARCH.md](RESEARCH.md) §7 and HANDOFF.md. They apply to the preview face.

## Where the old instructions went

The colour-pass session measured the LCD as pale (`#aab4b4`) with dark blue segments (`#0c1a24`) on a steel case (`#d8d8d8`). The first measurement had inverted the contrast by sampling shadows. That correction is in RESEARCH.md §7 and in the comment at the top of `THEME`. The stylesheet fix, the rasteriser rule, and the launcher fix are in HANDOFF.md and [PROGRESS.md](PROGRESS.md).
