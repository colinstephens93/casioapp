# Next session starts here

Written at the end of the desktop-testing session, 2026-10-03. Read this first, then HANDOFF.md.

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
AE-1200WH is a **stainless steel** watch:

| | Real AE-1200WH | What is built |
|---|---|---|
| Case and bezel | brushed silver steel, with visible screws | near-black, gold lettering |
| LCD window | small; grey-green time panel in a black surround | large, uniform pale green |
| Subdial | silver disc, dark ticks and a black needle | flat olive disc |
| Map window | its own dark-framed panel | drawn straight onto the LCD |
| "5 ALARMS" / "CASIO" | inside the black bezel band, small | printed on the case in gold |

This is not a tweak. The single thing a person recognises about this watch — that it is a silver steel
Casio — is absent, and the built face reads as a black plastic watch instead. It also explains the
"design" reaction that was parked earlier in the session and should not have been.

---

## 2. State of the repository

- **429 tests passing**, typecheck clean on all four configs, build clean and self-verifying.
- Everything is committed as of the end of this session except the working tree listed below.
- The route probe (`dist/preview/route-probe.html`, `src/renderer/flat-probe.ts`,
  `scripts/make-flat-probe.mjs`) is **temporary diagnostic scaffolding**. It was built to answer "which
  glyph construct does the browser render", and that question turned out not to be the bug. **Delete all
  three once the browser is confirmed fixed.**

### One file cannot be removed

`casio.webp` sits at the repository root and the sandbox denied deleting it (a copy is safe in
`notes/`). It is gitignored, so it cannot be committed, but please remove it by hand:

```powershell
cd C:\Users\colin\Documents\DeepSeek\harness_playground\casioapp
Remove-Item casio.webp
```

---

## 3. Next steps, in order

### Step 1 — Confirm the browser now draws the watch (2 minutes)

This is the only thing that proves the stylesheet fix worked, and it cannot be checked here.

```powershell
cd C:\Users\colin\Documents\DeepSeek\harness_playground\casioapp
npm run check
start dist\preview\index.html
```

- The **live controls are at the very bottom of that page**, after 19 static cards. Scroll past them.
  That placement is a mistake and is listed as fixed work below.
- Compare what appears against `dist/preview/ref.png`, which is watermarked and is the intended face.

Then open the route probe and confirm **both** cards draw:

```powershell
start dist\preview\route-probe.html
```

If both draw, the `<symbol>`/`<use>` construction was never the problem — delete the flat route, the
probe and `make-flat-probe.mjs`, and keep `glyphPaths` deleted too.

### Step 2 — The colour pass (the big one)

Work from `notes/casio-ae1200wh-reference.webp`. Every colour is a token in `THEME` in
`src/shared/theme.ts`, so this is one edit per token and no geometry moves.

What has to change:

1. **`caseBody`** — from near-black to a brushed silver. The single highest-impact change.
2. **`caseText` / `caseAccent`** — the bezel lettering is white/light grey on black in the real watch,
   not gold on black.
3. **The LCD** — the real time panel is a smaller, greyer green. The pale yellow-green currently used is
   too bright and covers too much of the case.
4. **`dialFace`, `dialRing`, `dialTick`** — the subdial is silver with dark markings, not olive.
5. **The map panel** — the real one is a discrete framed window, not land drawn onto the LCD.

This is a design decision, not a mechanical one, so it needs the user in the loop. Generate a watermarked
raster for each iteration:

```powershell
node scripts/extract-svg.mjs 0 dist/preview/ref.svg
python scripts/svg_to_png.py dist/preview/ref.svg dist/preview/ref.png 2 --label "colour pass N"
```

### Step 3 — The desktop shell test, still never run

`docs/ENVIRONMENT.md` §9 is the sixteen-item checklist. **Not one line of the Electron shell has ever
executed.** `npm start` was broken until this session (the launcher hard-coded `dist/main/main.js` while
the build emits `main.cjs`), so the first run is still ahead.

Order: launch, frameless/transparent, no taskbar entry, Alt+Tab, drag by the case, **click a pusher
without dragging**, extreme resize, always-on-top versus fullscreen. Then tray, persistence, and the
alarm and Focus Assist.

### Step 4 — Fix the preview page's layout

The live controls are 600 KB into a 612 KB page, behind 19 static cards. They should be at the **top**,
with the gallery below as reference. This is a small change in `renderPreview` in
`src/renderer/preview.ts` and it cost the user real confusion this session.

### Step 5 — Packaging

Only after the shell runs. `npm install electron-builder`, `npm run package`, install, and re-check
§9 items 15–16 including the AppUserModelID pairing.

---

## 4. Verification: what now counts as evidence

Three separate times this session a tool of mine agreed with itself rather than with reality. This is the
most important lesson in the file.

1. **`scripts/svg_to_png.py` does not implement SVG.** It re-implements the sprite lookup and hard-codes
   the class→colour table a second time. It drew a perfect face while a real browser drew a green
   rectangle. **It cannot be used as evidence that a browser will render something.** It is useful for
   geometry and for layout, and it is now labelled as such in its own docstring.
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

1. **The case colour.** Silver is what the photograph shows. Confirm that is the intent, since it changes
   the widget's whole character.
2. **The case ratio.** Built at 450 × 445 where the real watch is 450 × 421 — it grew so the printed
   `10 YEAR BATTERY` line sits below the LCD rather than across it. Veto or accept.
3. **The product name.** `royale` is a placeholder and now appears in `electron-builder.yml`'s `appId`.
   Changing it after anyone installs is a migration, not an edit.
4. **The world map.** It reads as noise at the size the face gives it. Whether to keep it, simplify it, or
   drop it in favour of the real watch's discrete panel is a design call.
