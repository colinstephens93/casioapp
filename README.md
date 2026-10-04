# casioapp

A desktop world-time widget. The window is a green terminal-style board: an analog clock, a world map with a lit time-zone band, a seven-segment digital clock, and a list of cities. The layout and palette follow [timan](https://github.com/israelfsilva/timan) (MIT). The board is HTML, so it can live in a window.

The Casio AE-1200WH ("Royale", module 3198) is still in the project. Its five screens, pushers, and steel case are the preview page, `dist/preview/index.html`, drawn as SVG. That page is how the watch face is inspected. The desktop shortcut opens the board.

This is a fan project. It is not affiliated with or endorsed by Casio. See [NOTICE.md](NOTICE.md).

## Open the widget

Requires **Node 18.3 or later** (developed on 24.16). After a build:

```sh
npm run build
```

Double-click `World time.vbs` in this folder, or a desktop shortcut that points at that script. It opens `dist/renderer/widget.html` in its own Edge window, 920×640, with a profile at `%LOCALAPPDATA%\WorldTime`. There is no terminal. If Edge or `widget.html` is missing, the script says to run `npm run build`.

`widget.html` is one classic script, `widget.js`. Edge blocks ES module imports on `file://`, so the shortcut cannot open `dist/renderer/index.html`. `scripts/bundle-preview.mjs` strips both `.ts` and `.js` from `require` specifiers. Leaving `.ts` on makes the page throw `module not found: renderer/board.ts`.

`npm start` still builds and launches Electron. On this PC `electron.exe` 40.10.6 exits before a window appears. The comment at the top of `World time.vbs` records why the shortcut uses Edge. Details are in [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).

## The board

| | |
|---|---|
| State | `src/shared/desk.ts`. Home zone plus up to nine favourites. Defaults: New York, London, Tokyo, Hong Kong, 12-hour clock, focus on New York. |
| Saved where | In Edge, `localStorage` key `worldtime.desk`. Under Electron, the config file, through the preload bridge. A saved watch-face blob is ignored and replaced with these defaults. |
| Keys | ↑↓ move the selection. ←→ move among favourites. `f` toggles a favourite. `d` cycles DST on a favourite. `t` toggles 12/24-hour. The footer buttons do `f`, `d`, and `t`. |
| List | T0 is always the system zone. Favourites follow, then the catalogue. A zone already on the board is left out of the catalogue. A favourite that is also the system zone is listed twice. The selected row shows ▸. Another favourite shows ★. |
| Map | 64×16 cells, sampled from the 96×40 Natural Earth bitset in `src/shared/map.ts`. The time band is two columns, and only land in those columns is lit. |
| Mark | The word CASIO sits at the top right of the board, in the same dim green as the panel labels. |
| Resize | The corner grip clamps the window to 760×540 through 1100×780. With no Electron bridge it calls `window.resizeTo`. |
| Power line | `navigator.getBattery`, when the browser provides it. The line is empty when it does not. This is the operating-system battery. The simulated 10-year cell belongs to the watch face. |

The board is dragged with `-webkit-app-region` for a frameless Electron window. The Edge window moves by its title bar. The zone list, the footer buttons, and the resize grip opt out of that drag region.

## Documentation

| Document | Contents |
|---|---|
| [docs/NEXT-SESSION.md](docs/NEXT-SESSION.md) | Where the work stands, and what to open first |
| [docs/HANDOFF.md](docs/HANDOFF.md) | How the code is put together, and the traps that already cost a session |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | The original AE-1200WH widget specification, with stable IDs |
| [docs/PLAN.md](docs/PLAN.md) | Milestones M0–M8 for that specification |
| [docs/RESEARCH.md](docs/RESEARCH.md) | The watch's documented behaviour, with citations |
| [docs/PROGRESS.md](docs/PROGRESS.md) | What was built, in order |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | Sandbox limits, and why the shortcut uses Edge |
| [NOTICE.md](NOTICE.md) | MIT attribution, the map data, and the trademark position |

## Getting started

```sh
npm install              # toolchain and the electron package wrapper
npm run fetch:electron   # downloads the electron binary — see below for why it is separate
```

`npm install` does not download the Electron binary. In the DSH sandbox this project is developed in, npm cannot run install scripts (the sandbox forbids spawning a child with piped stdio, which is how npm runs them). The binary is fetched by an explicit step that works in the sandbox and on an ordinary machine. Full explanation in [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md). Approving electron's install script with `npm install-scripts approve` breaks the install.

Then:

```sh
npm test           # 439 unit tests. The wiring tests read dist/, so build once first
npm run check      # typecheck, build, tests — the command for a clean checkout
npm run build      # compiles, bundles the preview and widget.html, verifies both pages
npm run typecheck  # four tsconfigs — the tests cannot see types, so this is not optional
npm start          # builds, then launches Electron (see "Open the widget")
npm run watch      # rebuilds shared, renderer, and main on change
npm run package    # builds, then makes a Windows installer (electron-builder is not installed here)
```

Prefer `npm run check` for a clean checkout: `test/wiring.test.ts` runs the built `dist/main` artifacts.

### A trap when launching Electron

If Electron exits instantly with

```
TypeError: Cannot read properties of undefined (reading 'commandLine')
```

then **`ELECTRON_RUN_AS_NODE` is set**, which makes `electron.exe` run as plain Node. `require('electron')` resolves to the npm wrapper package (whose export is a path string). `npm start` goes through `scripts/run.mjs`, which clears the variable for the child process.

## Layout

```
docs/            requirements, plan, research, environment notes
scripts/         build, bundle, preview, rasteriser, launcher, electron fetch
src/main/        Electron main process (CommonJS, .cts) plus Electron-free modules (.ts)
src/preload/     the narrow context-bridge surface (CommonJS, .cts)
src/renderer/    the board (board.ts), the watch face (face.ts), the preview page
src/shared/      logic with no DOM and no Electron dependency, including desk.ts
test/            unit tests, run directly by Node
review/          watermarked rasters of the watch face, kept outside dist/
World time.vbs   the desktop shortcut's script
```

`src/shared` is the lowest layer. It must not import from `src/main`, `src/renderer`, or `src/preload`, and must not touch the DOM. The renderer bundles it. The same time and desk logic runs under Node for tests and in the page.

Source uses explicit `.ts` import specifiers, so Node runs the tests directly with its native type stripping. Browsers cannot load `.ts` specifiers, so the renderer build rewrites them to `.js` using the TypeScript compiler API, in process, because the sandbox forbids spawning a child with piped stdio.

## Two pages

**The board** is `dist/renderer/widget.html` after `npm run build`. That is the shortcut.

**The watch face** is `dist/preview/index.html`. Nineteen cards: the Live face first, then eighteen fixed screens. The live controls are at the top of the page. Right-clicking the case on that page opens the context menu the Electron shell is written to supply.

```sh
npm run build
node scripts/extract-svg.mjs 0 dist/preview/face-0.svg
python scripts/svg_to_png.py dist/preview/face-0.svg review/face-0.png 2 --label "what this is"
```

Index 0 is the Live card. The rasteriser reads colours from the SVG it is given. It is an inspection aid for the face. A browser is what shows the illumination wash and the type. `npm run build` deletes `dist/`, so write review images under `review/`.

## Status

**439 tests passing, 94 suites, 15 files. Typecheck is clean on all four configs.** Checked 2026-10-04 with `npm test`.

| Area | State |
|---|---|
| World-time board, desk state, shortcut script | Built. The shortcut opens Edge. |
| Time engine, 49-code city table, map bitset | Built and tested |
| Watch face: five screens, pushers, gestures, simulated battery | Built and tested, shown on the preview page |
| Face colours | Measured from the reference photographs and stored in `THEME` (`src/shared/theme.ts`). See [docs/RESEARCH.md](docs/RESEARCH.md) §7 |
| Electron window, tray, notifications, installer | Written, wiring tested against a fake Electron. On this PC the process exits before a window appears |
| Flat glyph route and `route-probe.html` | Still generated by the build. Kept until a browser confirmed the sprite route; that confirmation was never recorded |
| Product name | `royale` is still the placeholder in `electron-builder.yml` `appId` and `APP_USER_MODEL_ID` |

Before this documentation pass, HEAD was `e5c99c7` ("Final MVP"), 11 commits, with a clean working tree.
