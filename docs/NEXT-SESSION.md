# Next session starts here

Written at the end of the desktop-testing session, 2026-10-03. Read this first, then HANDOFF.md.

> **Updated at the end of the colour-pass session that followed it.** Two of the five steps below are
> now done, one is partly done, and two findings changed what the next step should be. The update is at
> the top of each step rather than in a separate file, so nothing here contradicts itself.

---

## RESUME HERE — the validation run was handed to the user and has not come back yet

The work is **complete and green** (429 tests, typecheck, build+verify). It is **uncommitted in the
working tree** — see `HANDOFF.md` §8 for the file list.

Nothing further should be built until the user runs the validation below, because two of its outcomes
change what the right next action is:

- **If digits do not draw in the browser**, that is a rendering fault, not a design question: stop and
  fix it before any further colour or layout work.
- **If the route-probe answer is "only card 2",** the sprite route has a second, independent problem and
  the flat route must become the default instead of being deleted.

The test plan was given to the user verbatim; the essentials are reproduced here so this file is
self-sufficient.

### The commands

```powershell
cd C:\Users\colin\Documents\DeepSeek\harness_playground\casioapp
npm run check
start dist\preview\index.html
start dist\preview\route-probe.html
```

> **Do not run `npm run build` while review artifacts are wanted.** `npm run check` and `npm run build`
> both **reclean `dist/`**, which deletes any PNG produced by `svg_to_png.py`. The review rasters from
> this session were lost exactly that way, so they now live in **`review/`** (not gitignored, safe to
> commit). Regenerate with:
>
> ```powershell
> node scripts/extract-svg.mjs 1 dist/preview/face-1.svg
> python scripts/svg_to_png.py dist/preview/face-1.svg review/colour-pass-2-timekeeping.png 2 --label "colour pass 2"
> ```
>
> Remember `extract-svg.mjs 0` is the **Live** card and `1` is the first fixed scenario.

### What to ask, and what each answer means

| # | Test | Answer → action |
|---|---|---|
| 1 | Do the large digits draw on the Live (first) card? | **draw** → the blank digits really were the missing stylesheet; proceed. **blank** → rendering fault, stop everything else |
| 2 | Do the colours match `Casio-AE1200-1.webp`? Pale LCD, dark **blue** digits, silver case, black panel | veto any token that is wrong; `THEME` is one edit per token |
| 3 | On the route probe, which cards show digits? | **both** or **only 1** → delete the flat route (Step 1 list). **only 2** → make flat the default. **neither** → different fault |
| 4 | Do the controls and pushers work? (hold a pusher, right-click the case, chord ADJUST+LIGHT) | never once executed; report per-item |
| 5 | Does the *Illuminated* card look like a backlight? | the amber wash is `mix-blend-mode: screen`, which the rasteriser **cannot** render — a browser is the only answer |
| 6 | Is the `THU 7-16` overlap with the subdial acceptable? | known, pre-existing, deliberately not silently changed |

### Two open questions the user was asked directly

1. **`ILLUMINATOR` placement.** On the real watch it is printed on the **steel** below the black panel;
   in the current build it is **inside the panel**, because the battery label occupies that band and
   moving it is a geometry change. This is the most likely rejection.
2. **The world map's resolution.** It is still full-resolution dot-matrix, which reads as noise at the
   size the face gives it. Simplifying it is a rendering change, not a colour one.

---

## 0. Colour-pass session: what changed

**Done:**

- **Step 4 (preview layout) is finished.** The live controls are now at the top of the page and the
  *Live* card is the first card in the gallery. `renderPreview` was restructured around a `.controls`
  section followed by a `.gallery` section, and `scenarios()` now returns the Live entry first.
  **`extract-svg.mjs 0` therefore now yields the Live card; the fixed gallery starts at index 1.**
- **Colour pass 1 is applied** — every token in `THEME` was replaced with a value **measured** from the
  reference photographs rather than estimated. Silver steel case, a black display panel with white
  lettering, the four screws, a lit subdial disc and a discrete framed map window. It is committed as an
  iteration for review, not as a finished design.
- **Pass 1's first measurement was wrong, and pass 2 corrected it.** Sampling large regions of
  `notes/casio-ae1200wh-reference.webp` measured its **shadowed recesses** rather than its panel, which
  produced a dark olive LCD with pale accents — the contrast *inverted*, and the rendered face came out
  muddy. `Casio-AE1200-1.webp` (supplied afterwards) resolves it: the LCD's lit panels are **light**
  (`#aab4b4`), the segments are a **dark blue** (`#0c1a24`, not black), and the steel is `#d8d8d8`.
  The two photographs disagree visibly on warmth, which is what requirement `OI-2` predicts. See
  `docs/RESEARCH.md` §7 for both errors recorded, and the note at the top of `THEME` for the values.
- **The rasteriser can no longer lie about colour.** `scripts/svg_to_png.py` used to carry its own
  hand-written copy of the theme, so a colour pass would have produced a review image drawn in the
  *old* palette. It now parses the `<style>` block out of the SVG it is given, resolves `var(--token)`
  against it, reads `stroke`/`stroke-width`/`font-size` too, and fails loudly if the SVG carries no
  stylesheet. See `docs/ENVIRONMENT.md` §7.

**New finding — headless screenshots are impossible here, so stop trying.** Chrome and Edge are both
installed, and both die at `mojo platform_channel.cc: Check failed: Access is denied (0x5)` under
`--headless=new`, `--headless=old`, and with `--single-process --no-zygote --no-sandbox`. That is the
named-pipe requirement, so no flag combination fixes it. Recorded in `docs/ENVIRONMENT.md` §4a. **An
agent in this sandbox cannot see what a browser sees**; every visual change needs the human.

**Still open, and now the highest-value question:** does the face look right *in a browser*? The
rasteriser does not honour the CSS cascade, `mix-blend-mode`, or text metrics beyond one monospace
face, so the preview page is the only authority on the illumination wash, the strokes and the type.

**Not done:** the flat-route scaffolding still exists, deliberately — see Step 1.

---

## 1. What happened in this session

Two things, and the second one matters more than the first.

### The face's stylesheet was not in the SVG

**Found by the user, not by me.** The digits were completely blank in their browser while the case, map
and subdial drew. After that was chased down, the actual cause turned out to be much bigger than the
digits:

- The face's complete stylesheet lived in `src/renderer/preview-css.ts` and was inlined into the
  **preview page**.
- `renderFace()` embedded only `themeCss()`, which emits the CSS **variables** and **no rules that use
  them**.
- So the class names travelled with the SVG and the appearance did not.

Consequences, none of which any test could see:

| | Had the rules |
|---|---|
| Preview page | yes — which is why it looked right |
| **The widget** | **no** — black glyphs and black map land on a pale LCD, and a black case on a black background |
| Any SVG opened on its own | no — which is how the face was being inspected |

**Fixed:** `FACE_CSS` moved into `src/shared/theme.ts` beside the tokens it consumes, and `themeCss()`
now returns the variables *plus* every rule. `preview-css.ts` is a one-line re-export, so there is
exactly one copy. The SVG is self-contained.

**Guarded:** `test/face.test.ts` asserts that every class the face emits has a rule in the stylesheet it
carries. Mutation-tested by reinstating the original bug — caught immediately.

### The colour model is wrong at the case level

The user supplied a photograph of the real watch (`notes/casio-ae1200wh-reference.webp`). It shows the
AE-1200WH is a **stainless steel** watch. The table below is how the face stood **before** the colour
passes; the "now" column records what the passes changed it to, and it is what needs review.

| | Real AE-1200WH | Built *then* | Built *now* |
|---|---|---|---|
| Case and bezel | brushed silver steel, visible screws | near-black, gold lettering | silver steel `#d8d8d8`, white lettering, four screws |
| LCD | pale panel, dark **blue** segments | large uniform pale **olive-green** | pale `#aab4b4` panel, **`#0c1a24` blue** segments |
| Subdial | light disc, dark ticks, black needle | flat olive disc | light disc, dark ring and ticks |
| Map window | its own discrete dark-framed panel | drawn straight onto the LCD | framed lit window |
| "5 ALARMS" / "CASIO" | inside the black display panel | printed on the case in gold | inside the black panel, in white |

The one row still wrong is the LCD's **cast**: the first measurement read it as olive because it sampled
shadowed recesses, and pass 2 corrected the polarity and the blue but the warmth is taken from a
different photograph than the original reference. If the colour looks off, that is the row to distrust.

This was not a tweak. The single thing a person recognises about this watch — that it is a silver steel
Casio — was absent, and the built face read as a black plastic watch instead. It also explains the
"design" reaction that was parked earlier in the session and should not have been. **The colour passes
have since addressed the case, the panel and the LCD; whether they got it right is the open question.**

---

## 2. State of the repository

- **429 tests passing**, typecheck clean on all four configs, build clean and self-verifying. That is
  the count *after* the colour pass: the palette, the bezel panel, the screws, the map window and the
  preview restructure changed no assertion, which is the intended shape of a token-only colour pass.
- Everything is committed as of the end of the stylesheet session. The colour pass and the preview
  restructure are in the working tree of the session that followed.
- The route probe (`dist/preview/route-probe.html`, `src/renderer/flat-probe.ts`,
  `scripts/make-flat-probe.mjs`) is **temporary diagnostic scaffolding**, still present on purpose —
  see Step 1 for why it was kept and the exact list of what to delete.

### One file cannot be removed — DONE

`casio.webp` was at the repository root and has since been removed by hand, with the copy in `notes/`
kept. Nothing to do here.

---

## 3. Next steps, in order

### Step 1 — Confirm the browser now draws the watch (2 minutes) — STILL NOT DONE

This is the only thing that proves the stylesheet fix worked, and it cannot be checked here. **It is
also now the blocker on deleting the flat route**, which is why that deletion was deliberately *not*
made in the colour-pass session.

```powershell
cd C:\Users\colin\Documents\DeepSeek\harness_playground\casioapp
npm run check
start dist\preview\index.html
```

- The **live controls are now at the top of the page**, and the *Live* card is the first card in the
  gallery below them. That was Step 4 and it is done, so there is no scrolling to find anything.
- Compare what appears against the photo in `notes/` and `Casio-AE1200-1.webp` at the root, which are
  the intended face. The watermarked iteration rasters from the last pass are in **`review/`**
  (`colour-pass-2-timekeeping.png` and `colour-pass-2-live.png`).

Then open the route probe and confirm **both** cards draw:

```powershell
start dist\preview\route-probe.html
```

#### Why the flat route was kept

The handoff's plan was to delete it as soon as the browser was confirmed. Note what the fix commit
(`75e7c6f`) says about its origin, though: the route was written while the blank digits were
**misattributed** to `<use>`/`<symbol>`, and the actual cause was the missing stylesheet. So the
construct was never the problem, and the route is dead code either way.

It is still worth confirming first, because the deletion is irreversible in a way the waiting is not:
if the sprite route turned out to have a *second*, independent problem, that route is the only fallback
in existence. One look at the probe page settles it.

If both draw, delete in one commit and keep `glyphPaths` deleted too:

- `dist/preview/route-probe.html` (a build product, regenerated)
- `src/renderer/flat-probe.ts`
- `scripts/make-flat-probe.mjs`
- the `run('make-flat-probe.mjs', 'route probe')` line in `scripts/build.mjs`
- `textRunPaths`/`glyphPaths` in `src/shared/svg.ts`, the `GlyphRoute` type, the `activeRoute`
  module-scope seam and the `route` parameter in `src/renderer/face.ts`
- the `describe('the glyph routes (flat vs sprite)')` block in `test/face.test.ts`, and the two
  `renderFace(state, 'sprite')` call sites that pass a route redundantly

### Step 2 — The colour pass — PASS 1 APPLIED, NEEDS REVIEW

Work from the two reference photographs, both gitignored:
`notes/casio-ae1200wh-reference.webp` (720×720, lit product shot) and `Casio-AE1200-1.webp` at the
repository root (2000×1333, worn on a wrist — the higher-resolution one, and the one that settled the
palette). Every colour is a token in `THEME` in `src/shared/theme.ts`, so a further pass is one edit per
token and no geometry moves.

Pass 1 replaced the estimated palette with measured values, and pass 2 corrected pass 1's polarity
error. The measurements are recorded in the comment at the top of `THEME`, and the two headlines are:

1. **The LCD is pale and the segments are dark blue.** The lit panels measure `#aab4b4`; the segments
   `#0c1a24` — blue, not black. The substrate between panels is only slightly darker than a panel
   (`#9aa5a6`), because on a real LCD the unlit areas *are* the pale background with a faint ghost.
2. **The case is steel around a black display panel.** `caseBody` is `#d8d8d8`, and the bezel lettering
   is white **on that panel**, not gold on the case.

Geometry did move, for two reasons, so those are review items too:

1. **A new `FACE.bezelPanel`** — the black display panel that the bezel lettering is now printed
   *inside*, with `FACE.screws` for the four case screws. `WORLD TIME`, `5 ALARMS`, `CASIO`, `WR100M`,
   `MUTE`, `ILLUMINATOR` and `10 YEAR BATTERY` were all repositioned onto it.
2. **A lit window for the map** (`map-frame` + `lit-panel` in `map.ts`), because the real watch draws
   the map as a discrete framed panel rather than printing land onto the LCD substrate.

Deliberately **not** done, and still open design calls: the `ILLUMINATOR` band still sits inside the
panel rather than on the steel below it, the case is still `450 × 445` against the device's
`450 × 421`, and the world map is still full-resolution dot-matrix. Those are in §5.

To regenerate a watermarked iteration:

```powershell
node scripts/extract-svg.mjs 1 dist/preview/ref.svg
python scripts/svg_to_png.py dist/preview/ref.svg review/colour-pass-N.png 2 --label "colour pass N"
```

### Step 3 — The desktop shell test, still never run

`docs/ENVIRONMENT.md` §9 is the sixteen-item checklist. **Not one line of the Electron shell has ever
executed.** `npm start` was broken until this session (the launcher hard-coded `dist/main/main.js` while
the build emits `main.cjs`), so the first run is still ahead.

Order: launch, frameless/transparent, no taskbar entry, Alt+Tab, drag by the case, **click a pusher
without dragging**, extreme resize, always-on-top versus fullscreen. Then tray, persistence, and the
alarm and Focus Assist.

### Step 4 — Fix the preview page's layout — DONE

The live controls were 600 KB into a 612 KB page, behind 19 static cards. They are now the first thing
on the page (at ~8 KB) and the *Live* card leads the gallery. `renderPreview` in
`src/renderer/preview.ts` now emits `header → .controls → .gallery > .cards`, and `scenarios()` returns
the Live entry first. The change is DOM order only: the inline script binds by `id` and by
`.card.live .watch-slot`, never by position, and `verify-preview.mjs` asserts ids rather than order, so
nothing needed a second edit.

One consequence to remember: **`extract-svg.mjs 0` is now the Live card.**

### Step 5 — Packaging

Only after the shell runs. `npm install electron-builder`, `npm run package`, install, and re-check
§9 items 15–16 including the AppUserModelID pairing.

---

## 4. Verification: what now counts as evidence

Three separate times this session a tool of mine agreed with itself rather than with reality. This is the
most important lesson in the file.

1. **`scripts/svg_to_png.py` does not implement SVG.** It re-implements the sprite lookup, and it used
   to hard-code the class→colour table a second time as well. It drew a perfect face while a real
   browser drew a green rectangle. **It cannot be used as evidence that a browser will render
   something.** Since the colour-pass session it reads the palette out of the SVG's own `<style>` block
   instead of mirroring it, so it can no longer disagree about *colour* — but the cascade, the blend
   mode, stroke joins and text metrics are still approximations. It is useful for geometry and for
   layout, and it is labelled as such in its own docstring.
2. **`test/shell.test.ts` and `test/wiring.test.ts` assert what the shell *passes*, not what Electron
   *does*.** A fake that is the wrong shape is worse than no fake — `isDestroyed` as a property where
   Electron has a method made a correct guard look like a bug.
3. **A test that cannot fail is not evidence.** Every new guard this session was checked by deliberately
   breaking the thing it guards.

**The practices that still hold, unchanged:**

- Run `npm run check`, not just `npm test`.
- Compute, then assert — never enumerate values from memory.
- When a layout test fails, the constants are wrong, not the test.
- Say which it is: a broken test or broken code.
- If a test fails and the code looks right, suspect the test's *scope* — twice this session a correct
  assertion was searching the wrong text.
- **Render it and look at it — with your own eyes, in a real browser.** A rasteriser is not eyes.

---

## 5. Open questions for the user

1. **Does the face look right in a browser?** Still the top question, and still unanswerable here —
   see §0 and `docs/ENVIRONMENT.md` §4a. Pass 1's colours are measured rather than guessed, but the
   rasteriser does not honour the cascade, the blend mode or text metrics, so the illumination wash,
   the stroke weights and the type are only truly visible on the real page.
2. **The `ILLUMINATOR` band.** On the real watch it is printed on the **steel** below the black panel;
   in pass 1 it sits inside the panel to avoid colliding with the battery label, which the layout has
   already moved onto the panel. Moving it to the steel is a geometry change, so it was left alone.
3. **The case ratio.** Built at 450 × 445 where the device is 450 × 421. Unchanged by pass 1. Veto or
   accept.
4. **The world map.** Pass 1 gave it the real watch's discrete framed window, but the land is still
   full-resolution dot-matrix and still reads as noise at this size. Simplifying the resolution is a
   rendering change, not a colour one, so it needs a decision.
5. **The product name.** `royale` is a placeholder and now appears in `electron-builder.yml`'s `appId`.
   Changing it after anyone installs is a migration, not an edit.
6. **What to do about the subdial.** The real AE-1200WH subdial has a light disc, dark numerals at
   5…60 and a black needle — pass 1 now matches that, but the needle is drawn as strokes whose weight
   the rasteriser cannot show faithfully. Worth a look in the browser.
