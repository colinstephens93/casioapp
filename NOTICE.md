# Notices

## Reference project

This project reuses logic and data from **timan** by Israel Silva, which is MIT licensed.

- Source: <https://github.com/israelfsilva/timan>
- Licence: MIT

Reused, with the reference project's own wording preserved where the behaviour is subtle:

| Item | Where it lives here | Notes |
|---|---|---|
| `src/time.ts` | `src/shared/time.ts` | Offset maths via `Intl`, wall-clock derivation, civil-day difference, DST override and labelling, ICU legacy-zone rename table, formatting helpers. Re-typed; the algorithm and the rename table are the reference project's work. |
| `src/catalog.ts` | `src/shared/catalog.ts` | The curated one-city-per-offset idea and its extended fractional offsets. **Extended here** to the watch's full 49-code table. |
| `src/world.ts` | `src/shared/map.ts` | The 96×40 Natural Earth 110m land bitset, committed inline as `WORLD_BASE64`, with `bandColumn` for placement. The world-time board samples that bitset down to a 64×16 grid. |

The reference project's terminal renderer is not copied. `worldmap`, `braille`, `lcd`, `digital`, `panel`, `theme`, `table`, `tui`, and `main` were reviewed and left as terminal code. Two drawings were written here instead:

- The desktop board (`src/renderer/board.ts`, `src/renderer/styles.css`) follows Timan's arrangement and palette: analog and map, city beside a digital clock, then the zone list. It is HTML and CSS, with its own seven-segment block digits.
- The AE-1200WH face (`src/renderer/face.ts`) is hand-authored SVG. No pixel of it comes from the terminal renderer.

## Reference hardware

The face this project models is the **Casio AE-1200WH** (module 3198). Its printed case text is reproduced because it is part of the design, under [REQUIREMENTS.md](docs/REQUIREMENTS.md) §2.18:

- The word **CASIO** is printed on the face, as SVG text on the black bezel panel, and on the world-time board, as the dim label at the top right (`p.mark`).
- There is no Casio logo image.
- The project name is `casioapp`. `royale` remains a placeholder in the installer id. The project is not affiliated with or endorsed by Casio.

"Casio", "AE-1200WH", and "ILLUMINATOR" are trademarks of Casio Computer Co., Ltd. Watch behaviour was established from Casio's own *Operation Guide 3198/3299* (manual code MA1205-EA) via the reproductions cited in [RESEARCH.md](docs/RESEARCH.md).

## Map data

The world map uses **Natural Earth** 110m land data (public domain), the same source the reference project generated its bitset from. The bitset lives in `src/shared/map.ts`.
