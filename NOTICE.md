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
| `src/world.ts` | not yet ported | A generated 96×40 Natural Earth 110m land bitset, to be committed as data with its generator when the map is built (M4). Its maths (`bandColumn`, `bandColumns`) is likewise reusable. |

**No drawing code is reused.** The reference project renders to a terminal with ANSI escapes,
braille characters and box-drawing glyphs; every pixel of this widget is rebuilt as SVG. The
modules `worldmap`, `braille`, `lcd`, `digital`, `panel`, `theme`, `table`, `tui` and `main` were
reviewed and deliberately not reused.

## Reference hardware

The device this widget models is the **Casio AE-1200WH** (module 3198), and its documented
behaviour is reproduced under the terms described in [REQUIREMENTS.md](REQUIREMENTS.md) §2.18:
the watch's printed case text is reproduced because it is part of the design, but **no Casio logo
or wordmark is used**, the project carries a neutral name, and it is not affiliated with or
endorsed by Casio.

"Casio", "AE-1200WH" and "ILLUMINATOR" are trademarks of Casio Computer Co., Ltd. Watch behaviour
was established from Casio's own *Operation Guide 3198/3299* (manual code MA1205-EA) via the
reproductions cited in [RESEARCH.md](RESEARCH.md).

## Map data

The world map uses **Natural Earth** 110m land data (public domain), the same source the reference
project generated its bitset from.
