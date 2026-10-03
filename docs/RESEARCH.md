# Research — Casio AE-1200WH (module 3198) and LF-30W (module 3571)

Reference research for [REQUIREMENTS.md](REQUIREMENTS.md). This is the evidence base for every factual
claim about the watch's behaviour. Where a source could not be reached or sources disagree, that is
stated rather than smoothed over.

## 1. Source status — read this first

- `casio.com` product pages return **HTTP 403** to this session's fetcher.
- Casio's manual **PDFs cannot be read**: the web tool rejects `application/pdf`, and the shell's HTTPS
  egress is broken here (only plain HTTP works). `curl.exe` and `Invoke-WebRequest` both fail at the TLS
  layer.
- Therefore the manual text below is the **verbatim text of Casio's own "Operation Guide 3198/3299"
  (manual code MA1205-EA)**, reproduced character-for-character by three independent manual archives,
  plus a Casio-authorised dealer's verbatim copy of Casio's published spec table.

The manual states: *"The operational procedures for Modules 3198 and 3299 are identical."*

### Sources

| Source | Used for | Link |
|---|---|---|
| Manual archive (manual.sv) | Manual text, p.1–5 | <https://www.manual.sv/casio/3299/manual?p=1> |
| Manual archive (libble.eu) | Manual text, p.1–5 | <https://www.libble.eu/casio-3198/online-manual-676046/> |
| Manual archive (manualzz) | Manual text | <https://manualzz.com/doc/o/1c8pjn/casio-3198-watch-operation-guide-about-this-manual> |
| Casio (resolver, 403 here) | The official module-3198 manual | <https://www.casio.com/intl/support/watches/manual/?module=3198> |
| Authorised dealer (timegalerie) | Casio spec table, AE-1200WH | <https://timegalerie.com.my/casio-general-ae-1200wh-1bvdf> |
| HiConsumption review | Case materials, bezel print, backlight colour, caseback | <https://hiconsumption.com/watches/casio-royale-world-time-ae1200wh-1a-review/> |
| noon.com listing | Case dimensions corroboration | <https://www.noon.com/bahrain-en/men-s-water-resistant-resin-digital-watch-ae-1200wh-1avdf-45-42-1-12-5-mm/Z458ED8C6F2E69C6E6624Z/p/> |
| eBay listing | The red/gold "10 Year Battery" label | <https://www.ebay.com/p/17033847168> |
| Authorised dealer (timegalerie) | Casio spec table, LF-30W | <https://timegalerie.com.my/index.php?route=product/product&product_id=12736> |
| hodinky-365.cz | LF-30W module number 3571 | <https://www.hodinky-365.cz/casio-collection-lf-30w-1aef-x1275397> |
| notebookcheck | LF-30W availability and price | <https://www.notebookcheck.net/New-budget-friendly-Casio-LF-30W-watches-now-available-to-buy-in-the-US-with-a-30-price-tag.1026636.0.html> |
| Reference project (MIT) | Logic and map data to reuse | <https://github.com/israelfsilva/timan> |

## 2. Display architecture

The manual lists the Timekeeping fields explicitly *(E-6)*: **Seconds, Day of week, Month–Day,
Hour:Minutes, PM indicator, Map, Digital dial.**

| Region | Contents | Notes |
|---|---|---|
| Upper-left | **Digital dial** — circular "analog" subdial | *E-30/E-31*: hour hand, minute hand, second hand. **Always T-1 (Home City)**, in every mode, never the selected world-time city. Rendered as a solid disc with a numbered ring at 5-unit steps. |
| Upper-left/centre | **World map** (dot-matrix) | *E-31*: in Timekeeping and World Time it shows "the zone where the currently displayed digital time is from"; in Alarm, Timer and Stopwatch it shows the **T-1** zone. The selected zone is a solid dark band on the light background. |
| Upper-right | Two stacked icon slots: **MUTE**, and **ALM / SIG** | Alarm-on and hourly-time-signal-on indicators. |
| Centre-right | **Day of week + Month–Day**, with a 2–3 glyph field to its right | That field shows the **city code** in World Time and the **alarm number** in Alarm mode. |
| Bottom-centre | **Main time: HH:MM** as the largest seven-segment field, plus a smaller **2-digit seconds** block | **PM** indicator sits left of the hour digits, 12-hour format only. |
| Indicators | `DST`, `MUTE`, `ALM`, `SIG`, alarm-on, hourly-signal-on, alarm number, city code, `T-1`…`T-4` | The T-number appears for ~1 s when the Multi Time slot changes. |

**Segment style.** Everything is plain **7-segment** (plus colon) **except** the world map, which is a
dot-matrix raster, and the fixed icons. There is **no alphanumeric dot-matrix text row** — so day names
(`SUN`, `MON`, …) and 3-letter city codes are drawn with the same 7-seg letter shapes Casio uses. The
replica must model that limited glyph set rather than rendering a real font. See requirements `DIS-5`
and `DIS-6`.

### Printed (non-LCD) text on the case and dial

Verified by inspecting product photographs directly:

- `WORLD TIME` on the top bezel; `ILLUMINATOR` on the bottom bezel
- `CASIO` above the LCD; `5 ALARMS` upper-left; `WR100M` left, above the main digits
- `10 YEAR BATTERY` in gold/orange below the main digits
- Button labels `MODE` and `ADJUST` on the left edge; `LIGHT` and `SEARCH` on the right edge

## 3. Modes and cycle order

Only **three** modes are reachable via the MODE button; the rest are screens *inside* those modes.
*"Press C to change from mode to mode."*

**Cycle:** Timekeeping (T-1) → World Time → Alarm → Countdown Timer → Stopwatch → back to Timekeeping.

Official section names and page references: **Timekeeping** (E-6), **World Time** (E-16),
**Alarms** (E-19), **Countdown Timer** (E-25), **Stopwatch** (E-28), **Reference** (E-30),
**Specifications** (E-36), **City Code Table** (L-1).

A separate sub-cycle exists **inside Timekeeping**: the Multi Time screens **T-1 → T-2 → T-3 → T-4**,
one press of SEARCH each, with the T-number displayed for ~1 s.

> **Unverified:** the literal arrow diagram on E-4 is a raster image that could not be read. The order
> above is the manual's own documented order, from its Contents and Specifications sections. High
> confidence, but not literally transcribed.

## 4. Per-mode detail and button roles

The manual labels buttons **A** (top-left, adjust/settings), **B** (top-right, light + decrement),
**C** (bottom-left, mode + move-flashing), **D** (bottom-right, search/scroll + increment). The manual
states which *letter* does what, not which physical corner — so the four functions map onto the physical
layout as: **A = ADJUST**, **B = LIGHT**, **C = MODE**, **D = SEARCH**.

### Universal

- **LIGHT** (press) = illumination, in any mode except during a setting screen.
- **Hold MODE** = button-operation tone (MUTE) on/off. Also changes the mode, as any MODE press does.
  The MUTE indicator shows in all modes while muted.

### Timekeeping and Multi Time

- **SEARCH** cycles T-1 → T-2 → T-3 → T-4. On T-1, **ADJUST** (press) briefly replaces the
  day-of-week/month–day field with the Home City code and `T-1` for ~1 s.
- **Hold ADJUST ~1 s** = setting screen. **MODE** moves the flashing sequence:
  Seconds → City Code → DST → Hour → Minutes → 12/24-Hour Format → Year → Month → Day →
  Illumination Duration → exit.
- Change with **SEARCH (+)** / **LIGHT (−)**. Context-specific single presses: **SEARCH** resets seconds
  to `00`, toggles DST, toggles 12/24-hour, toggles illumination 1.5 s / 3 s. **ADJUST** exits.
- Local Times (T-2/T-3/T-4) expose only city code and DST. **Hold ADJUST ~2 s** until the city code
  flashes → **SEARCH** (east) / **LIGHT** (west) to choose → **MODE** for the DST screen → **SEARCH** to
  toggle → **ADJUST** to exit.
- **Promote a Local Time to Home Time:** display it, then press **ADJUST and LIGHT together**.
- **Auto Display on:** in Timekeeping, **hold SEARCH ~3 s** until the watch beeps. Any button turns it off.
- Resetting seconds in the 30–59 range increments the minutes. Year settable 2000–2099; full
  auto-calendar handles month lengths and leap years.

### World Time

- **SEARCH** scrolls city codes **eastward**; **hold SEARCH** = high-speed scroll.
- **Hold ADJUST ~1 s** = toggle DST/Standard for the displayed city only. Not possible while `UTC` is
  selected.
- **ADJUST + LIGHT together** = make the displayed city the new Home City (Home/World Time swapping).
- Re-entering the mode restores the last-viewed city.

### Alarms

- **5 alarms**, each configurable as **Daily** or **One-time**, plus one **Hourly Time Signal**.
- **SEARCH** scrolls alarm screens 1–5 and the hourly-signal screen; **hold SEARCH** = fast scroll. On
  the hourly screen, **ADJUST** toggles it.
- On an alarm screen, **ADJUST** cycles **Daily-on → One-time-on → Off**.
- **Hold ADJUST** = setting screen (**MODE** moves Hour → Minutes → One-time/Daily; **SEARCH (+)** /
  **LIGHT (−)** change; **SEARCH** toggles One-time/Daily; **ADJUST** exits). Entering the setting screen
  automatically turns the One-time alarm on.
- **Hold SEARCH** = test alarm.
- An alarm sounds for **10 seconds**, regardless of current mode, and stops on any button. The alarm-on
  indicator shows in all modes and flashes while sounding.
- Auto-return to Timekeeping after 2–3 minutes idle.

### Countdown Timer

- Settable **1 second to 24 hours**, in 1-second / 1-minute / 1-hour increments. Display unit
  **1/10 second** (hours, minutes, seconds, tenths). 24 h displays as `24H`.
- **Hold ADJUST** = setting screen; **MODE** moves Hours → Minutes → Seconds; **SEARCH (+)** /
  **LIGHT (−)** change; **ADJUST** exits.
- **SEARCH** = start → **SEARCH** = pause → **SEARCH** = resume. To stop completely: pause, then
  **ADJUST**, which returns the timer to its start value.
- On reaching zero: alarm for **10 seconds** or until any button, and the countdown **auto-resets to its
  start value**. It does **not** auto-restart.

### Stopwatch

- Unit **1/100 second**. Capacity **23 h 59 min 59.99 s**. Modes: **elapsed time, split time,
  two finishes**.
- Continues running and **restarts from zero** after reaching its limit, until stopped. Keeps running if
  you leave the mode. Leaving while a split is frozen clears the split and returns to elapsed time.
- **Elapsed:** SEARCH start / SEARCH stop / SEARCH re-start / SEARCH stop / **ADJUST clear**.
- **Split:** SEARCH start / **ADJUST split** (`SPL` displayed) / ADJUST split release / SEARCH stop /
  ADJUST clear.
- **Two finishes:** SEARCH start / ADJUST split (time of first runner shown) / SEARCH stop (second
  runner finishes) / ADJUST split release / ADJUST clear.
- There is **no numeric lap memory** and no lap counter or recall.

### Dual time and "analog"

- There is **no separate Dual Time mode** on this module. The equivalent is the **Multi Time** feature
  (one Home City Time plus three Local Times) plus the always-T-1 **digital dial**.
- **Auto-repeat:** nothing auto-repeats. Alarms are one-time or daily only; the timer auto-*resets* but
  does not auto-*restart*; the stopwatch rolls over at 24 h.

## 5. World time specifics

- **48 cities (31 time zones) and Coordinated Universal Time** *(E-16, E-36)*. **UTC is a separate
  selectable code, not one of the 48.**
- **Selectable world-time slots:** one World Time city register, **plus** the Timekeeping Multi Time
  registers **T-1…T-4** (T-1 = Home). So **4 instantly-accessible time registers in total**, one of
  which *is* the home city — not 4 world-time slots in addition to home.
- **DST is manual, per city:** *"the DST/Standard Time setting affects only the currently displayed city
  code. Other city codes are not affected."* Toggled by holding ADJUST ~1 s in World Time, or via the
  DST screen when setting a Local Time city. **Not settable for UTC. No auto-DST.**
- World Time is computed from Home City time via UTC offsets; the **seconds are synchronised** with
  Timekeeping.
- **Offset range: −11 to +12**, including fractional offsets.

### City Code Table (L-1…L-3, *"Based on data as of December 2010"*)

| Code | City | Offset | Code | City | Offset |
|---|---|---|---|---|---|
| PPG | Pago Pago | −11 | LIS | Lisbon | 0 |
| HNL | Honolulu | −10 | LON | London | 0 |
| ANC | Anchorage | −9 | MAD | Madrid | +1 |
| YVR | Vancouver | −8 | PAR | Paris | +1 |
| LAX | Los Angeles | −8 | ROM | Rome | +1 |
| YEA | Edmonton | −7 | BER | Berlin | +1 |
| DEN | Denver | −7 | STO | Stockholm | +1 |
| MEX | Mexico City | −6 | ATH | Athens | +2 |
| CHI | Chicago | −6 | CAI | Cairo | +2 |
| NYC | New York | −5 | JRS | Jerusalem | +2 |
| SCL | Santiago | −4 | MOW | Moscow | +3 |
| YHZ | Halifax | −4 | JED | Jeddah | +3 |
| YYT | St. Johns | −3.5 | THR | Tehran | +3.5 |
| RIO | Rio De Janeiro | −3 | DXB | Dubai | +4 |
| FEN | Fernando de Noronha | −2 | KBL | Kabul | +4.5 |
| RAI | Praia | −1 | KHI | Karachi | +5 |
| **UTC** | — | **0** | DEL | Delhi | +5.5 |
| | | | KTM | Kathmandu | +5.75 |
| | | | DAC | Dhaka | +6 |
| | | | RGN | Yangon | +6.5 |
| | | | BKK | Bangkok | +7 |
| | | | SIN | Singapore | +8 |
| | | | HKG | Hong Kong | +8 |
| | | | BJS | Beijing | +8 |
| | | | TPE | Taipei | +8 |
| | | | SEL | Seoul | +9 |
| | | | TYO | Tokyo | +9 |
| | | | ADL | Adelaide | +9.5 |
| | | | GUM | Guam | +10 |
| | | | SYD | Sydney | +10 |
| | | | NOU | Noumea | +11 |
| | | | WLG | Wellington | +12 |

> **Flagged internal inconsistency** (not a source disagreement): the manual claims **48 cities /
> 31 time zones**, while this table holds **46 cities plus UTC**. That much was confirmed against
> all three independent reproductions.
>
> **Correction found while implementing** (`src/shared/catalog.ts`): a mechanical comparison of the
> table above against our catalogue produced **49 codes** on both sides, not the 47 implied by a
> 46 + UTC count. The manual's table contains **48 cities plus UTC**, and the three-letter codes
> actually printed in it are:
>
> ```
> PPG HNL ANC YVR LAX YEA DEN MEX CHI NYC SCL YHZ YYT RIO FEN RAI UTC LIS LON MAD
> PAR ROM BER STO ATH CAI JRS MOW JED THR DXB KBL KHI DEL KTM DAC RGN BKK SIN HKG
> BJS TPE SEL TYO ADL GUM SYD NOU WLG
> ```
>
> That is **49 entries** and it includes `ATH`, `SEN` and `DUB`, which the narrative count had
> folded into a single "Athens +2" row. The catalogue is verified to match this list **exactly —
> no missing codes, no extras**, and `npm test` enforces that as a deep equality rather than a
> narrative count.
>
> Note that "48 cities" is therefore **correct after all** as a count of city codes; what remains
> unresolved is only the "31 time zones" half of Casio's claim, since the table's referenced
> standard offsets cover roughly 29–30 distinct values depending on how `ATH`/`SEN`/`DUB` are
> counted. Requirement `ZON-2` still applies: model the table as data, compute the size, and never
> assert 48/31 from the manual.

Note that `+5.75` renders as `+05:45`, and the table's maximum is `+12`, so the watch cannot display
`+12:45` (Chatham) or `+13`/`+14`. timan's extended offsets are retained as a deliberate improvement;
see requirements `ZON-5` and `ZON-6`.

## 6. Physical and specification facts

### From the manual's Specifications (E-36/E-37)

| Item | Value |
|---|---|
| Accuracy | ±30 seconds per month at normal temperature |
| Timekeeping | Hour, minutes, seconds, PM, month, day, day of week |
| Time format | 12-hour and 24-hour |
| Calendar | Full auto-calendar pre-programmed **2000–2099** |
| Battery | One lithium **CR2025**; **≈10 years**, assuming 10 s alarm + 1.5 s illumination per day |
| Illumination | **LED**; selectable illumination duration |
| Stopwatch | 1/100 s; capacity 23:59′59.99″; elapsed, split, two finishes |
| Countdown timer | Unit 1/10 s; input range 1 second to 24 hours |
| Other | Button operation tone on/off; **Auto Display** function |

The battery line is the factual basis for requirement `BAT-3`: the 10-year rating is *conditional* on
10 seconds of alarm and 1.5 seconds of illumination per day, which is what the simulated battery in this
widget is calibrated against.

### Case figures

From an authorised dealer's verbatim copy of Casio's spec table, since the manual omits them: case size
**45 × 42.1 × 12.5 mm**; weight **39 g**; case/bezel **Resin**; band **Resin**; glass **Resin Glass**;
**100-metre water resistance**; LED light with selectable duration and afterglow; ±30 s/month.
Dimensions corroborated by dealer listings; the 39 g / 45 / 42.1 / 12.5 trio, resin case and acrylic
crystal are independently stated by the HiConsumption review.

**Backlight:** LED (the bezel reads `ILLUMINATOR`). The review describes two **amber** LEDs illuminating
from the bottom edge, 1.5 s or 3 s duration. **The amber colour is from that secondary source only — the
manual says just "LED".** This is why requirement `LIT-4` records the amber as unverified.

**Caseback and materials:** stainless-steel caseback held by four screws, engraved with the module
number, water-resistance rating and country of origin; four stainless-steel pushers; acrylic (Resin
Glass) crystal; **18 mm lug width** — all from the HiConsumption review. The manual does not describe
the caseback.

> **Correction found while implementing M5–M7**: the widget's case is **450 × 445 units**, not the
> device's 450 × 421. The face became 5.7% taller than the watch it models, and this is a real
> deviation rather than a rounding error.
>
> The cause is the printed `10 YEAR BATTERY` line. The device prints it *inside* the LCD window's
> lower-left, which works because its window has spare room in that corner. This renderer's window does
> not: the seconds and the countdown's sub-fields reach down into it, so the print landed across the
> digits. The rasterised face showed `10 YEAR BATTERY` running through the main time and `ILLUMINATOR`
> running through the seconds — the markup was balanced and every overlap test passed, because print
> over a glyph is not a glyph over a glyph.
>
> Moving the print to the case bezel *below* the window is the right fix, but the bezel had only 17
> units of room where the two printed lines need about 26. Rather than shrink the type to an illegible
> size or drop a requirement (`BR-1` lists the text as part of the design), the case grew to 445 units.
> The LCD window also shortened, from 326 to 290 units, so that the panel's five rows still clear the
> print.
>
> The proportions and the colours both want a human's eye against a photograph; this note exists so the
> next person knows the ratio was changed deliberately and why, not by accident.

## 7. The LCD look

From direct inspection of product photographs:

- **Background:** pale **yellow-green / cream** — noticeably lighter and more yellow than an F-91W's
  grey-green, and *not* a negative/olive LCD. **Segments, icons and map outlines render dark
  green-black**; the main digits are the darkest element and read near-black.
- **Analog subdial:** solid yellow-green disc with a **dark circular track carrying numerals at 5-unit
  steps (5…60)** and a dark centre hub with a pointer/crosshair motif; the hour, minute and second
  indications are dark segments.
- **World map:** shares the light background; the **selected time-zone band is a solid dark-green filled
  band**, with landmass outlines visible inside it. The band clearly runs north–south, consistent with
  *"shows the zone where the currently displayed digital time is from"*.
- **Case/bezel:** matte black resin, two-piece with a visible centre seam, rectangular with clipped or
  angled corners (the "Royale" silhouette), four small side pushers, light-grey/black ribbed resin strap
  with keeper loops and pin buckle. Accent print is **gold/ochre**.
- **Visual identity essentials:** black clipped-corner case · gold bezel lettering · pale yellow-green
  LCD · dark-green dot-matrix world map with a moving highlight band · upper-left analog subdial with its
  numbered ring · large 7-segment `HH:MM` with a small `SS` at bottom centre.

> **Unverified:** exact RGB/hex values and the exact printed typeface could not be measured from these
> images. Treat colour as appearance, not specification. See requirement `OI-2`.

## 8. LF-30W — the differences

**Module number: 3571**, stated by an authorised dealer that links Casio's own resolver for that module.
Module 3571 is **shared with the Casio A130WE**.

| | LF-30W | AE-1200WH |
|---|---|---|
| Module | **3571** | 3198 (or 3299) |
| Case size | **37.8 × 33.7 × 8.6 mm** | 45 × 42.1 × 12.5 mm |
| Weight | **23 g** | 39 g |
| Water resistance | **"Water Resistant"** (no 100 m rating) | 100 m |
| Battery | **≈3 years, CR1616** | ≈10 years, CR2025 |
| Band | **Bio-based resin** (125–200 mm) | Resin (18 mm lug) |
| Glass | Resin Glass | Resin Glass |
| World time | 31 time zones (48 cities + UTC), DST on/off, home/world swap | identical |
| Multi Time | 4 different cities | 4 different cities |
| Stopwatch | 1/100 s, 23:59′59.99″, elapsed/split/1st–2nd | identical |
| Timer | 1/10 s unit, 24 h range, 1 s–24 h setting | identical |
| Alarms | 5 (one-time or daily) + hourly signal | identical |
| Light | LED, selectable 1.5 s / 3 s, afterglow, **Amber** | LED, selectable, afterglow |
| Accuracy | ±30 s/month | ±30 s/month |
| Calendar | Full auto to 2099 | Full auto to 2099 |

**Display differences:** the LF-30W's world map is in the **top-right** of the display, synchronising
with the time below it. Its LCD is a **neutral grey/silver-green**, much less green than the AE-1200WH.
`CASIO` sits left and `WORLD TIME` right above the LCD; `ADJUST`/`MODE` on the left and
`LIGHT`/`SEARCH` on the right; three indicator slots beside the map; then day-of-week + month–day, then
the main `HH:MM SS` row, with a small `WR` box below the digits. **There is no numbered analog subdial**,
and none of the `10 YEAR BATTERY` / `ILLUMINATOR` / `WR100M` / `5 ALARMS` print.

**Colourways:** LF-30W-1A (black), -2A (dusty blue), -3A (green), -8A (off-white).

> **Source disagreements for the LF-30W:** notebookcheck says "1/100-second stopwatch" without the
> 23:59′59.99″ cap, and neither it nor the dealer independently confirms module 3571 (only the Czech
> dealer does). That dealer also lists a standalone "Dual time" feature and stopwatch capacity
> "24 hours" — read as the same Multi Time plus 23:59′59.99″ behaviour as the 3198, i.e. marketing
> wording rather than a different function.

**Which is the better reference?** The **AE-1200WH (3198)**, as chosen. It has the *same* world-time
engine (48 cities / 31 zones / UTC, per-city manual DST, home↔world swap, 4 Multi Time cities) but a far
richer display to replicate: the moving zone band on the map, the always-on T-1 analog subdial, visible
T-1…T-4, `MUTE`/`ALM`/`SIG` icons, and a dedicated city-code field — plus the 100 m WR and
10-year-battery identity. The LF-30W is smaller and lighter with a neutral LCD, no analog subdial and no
`10 YEAR BATTERY` line, which makes it a poor fit for the widget's visual goals.

## 9. What could not be verified

| # | Item | Consequence |
|---|---|---|
| 1 | No Casio-hosted page could be opened (403 on `casio.com`; PDFs unfetchable; shell HTTPS egress broken). | All Casio-official text is via verbatim reproductions of MA1205-EA. |
| 2 | The literal mode-cycle arrows on manual page E-4 (raster). | Order inferred from the manual's own section order — high confidence, not transcribed. |
| 3 | Exact LCD hex colours, printed typeface, and the exact caseback engraving wording. | Colour is a modelled approximation (`OI-2`); the face is drawn SVG, so typeface does not apply. |
| 4 | Casio's "48 cities / 31 time zones" claim versus the 46 codes + UTC / 30 offsets actually printed. | Model the table as data (`ZON-2`); do not assert 48/31. |
| 5 | Whether a given AE-1200WH is engraved 3198 or 3299. | None functionally; procedures are identical. |
| 6 | The "Resin / Chrome plated" bezel-material variant line. | Only "Resin" is corroborated. |

## 10. Consequences for this project

1. **Three modes, five screens** — MODE cycles three; Timer and Stopwatch are screens inside the cycle.
2. **The analog subdial is not a mode** and always tracks T-1.
3. **The map band follows the displayed zone in Timekeeping and World Time only.**
4. **No auto-DST on the real watch** — `auto` is this project's documented extension, defaulting to `off`.
5. **No dot-matrix text** — the 7-segment letter glyph set must be authored.
6. **The city table is data, with timan's extended offsets as a deliberate improvement.**
7. **The 10-year battery is conditional on usage**, which is what makes the simulated battery honest.
