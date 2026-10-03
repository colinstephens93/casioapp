# Requirements — Casio AE-1200WH Desktop Clock Widget

Status: **Draft for approval.** Everything below was settled in a requirements interview; nothing here is
implemented yet. Working directory name is `casioapp`; `royale` is the placeholder product name (see
BR-3) and can be vetoed at any time.

Source of authority for watch behaviour: Casio *Operation Guide 3198/3299* (manual code MA1205-EA) and
the AE-1200WH city code table, as reproduced by three independent manual archives and an authorised
dealer's copy of Casio's spec table. See [RESEARCH.md](RESEARCH.md) for citations, the two flagged
inconsistencies, and what could not be verified.

## 1. Summary

A single-window Windows desktop clock widget, modelled on the Casio AE-1200WH ("Royale", module 3198).
It is frameless, transparent, draggable by its case with the mouse, and reproduces the watch's full
function set — three modes containing five screens — with a faithful LCD, case, printed text, and
button behaviour.

### Goals

1. Look like the watch: the LCD, the case, the printed text, the 7-segment glyphs.
2. Work like the watch: all five screens, all four pushers, the hold and chord gestures.
3. Be a widget, not an app window: no taskbar entry, tray-resident, always-on-top, mouse-only.
4. Be genuinely useful rather than a museum piece: correct time zones forever, real alarms, real timer,
   real stopwatch.

### Non-goals

Enumerated in §9.

## 2. Functional requirements

### 2.1 Shell and window — `WIN-*`

| ID | Requirement |
|---|---|
| WIN-1 | The widget is a single Electron window: frameless, transparent, no native title bar or chrome. |
| WIN-2 | The window is draggable by the case using the mouse, and only by the case; interactive controls must not start a drag. |
| WIN-3 | The window appears in the tray. Tray menu provides Show/Hide and Quit. |
| WIN-4 | The window does **not** appear in the taskbar and does **not** appear in Alt+Tab. |
| WIN-5 | The window is always-on-top, **except** that it must not remain above fullscreen applications. |
| WIN-6 | The window may be resized freely from any edge or corner. |
| WIN-7 | On resize, the device scales to the largest size that fits the window, centred and letterboxed; leftover area is filled with the case material colour so it reads as bezel, never as broken layout. |
| WIN-8 | The device preserves its true proportions at all sizes. Aspect ratio is a property of the drawing, not of the window. |
| WIN-9 | Window position and size persist across restarts. |
| WIN-10 | The window is quiet when idle: no animation, no repaint, no polling beyond what the display needs. |

### 2.2 Interaction model — `INT-*`

| ID | Requirement |
|---|---|
| INT-1 | Interaction is mouse-only. No keyboard requirement for any function. |
| INT-2 | The four pushers are rendered on the case, labelled `MODE`, `ADJUST` (left edge) and `LIGHT`, `SEARCH` (right edge), and are clickable. |
| INT-3 | The LCD itself is a click target where the watch's own behaviour is display-adjacent. |
| INT-4 | Press, long-press and two-button chord gestures are all supported, because the watch requires all three. |
| INT-5 | Long-press durations match the watch: ~1 s for ADJUST-hold settings entry, ~2 s for Local Time city editing, ~3 s for Auto Display. |
| INT-6 | The chord **ADJUST + LIGHT** promotes the displayed city to Home City. |
| INT-7 | Right-clicking the case opens a context menu with: mode switch, settings, reset battery, quit. |
| INT-8 | A visual pressed state is shown for every pusher while pressed, and the chord state is visible while both are held. |

### 2.3 Modes and navigation — `MOD-*`

The watch has **three modes** on the MODE button and **two further screens** reachable inside them.

| ID | Requirement |
|---|---|
| MOD-1 | MODE cycles: Timekeeping → World Time → Alarm → Countdown Timer → Stopwatch → Timekeeping. |
| MOD-2 | Inside Timekeeping, SEARCH cycles the Multi Time registers T-1 → T-2 → T-3 → T-4. T-1 is the Home City. |
| MOD-3 | The T-number (T-1…T-4) is displayed for ~1 s when the Multi Time register changes, then gives way to the normal field. |
| MOD-4 | Re-entering World Time or Alarm restores the last-viewed city or alarm respectively. |
| MOD-5 | The widget auto-returns to Timekeeping after 2–3 minutes idle, as the watch does. |
| MOD-6 | MODE state and sub-state persist across restarts. |

### 2.4 Display architecture — `DIS-*`

| ID | Requirement |
|---|---|
| DIS-1 | All elements are hand-authored SVG. **No fonts and no raster images** anywhere in the face. |
| DIS-2 | Drawing geometry is authored at low resolution so the face keeps the LCD's chunky character, and scales without blur at any size. |
| DIS-3 | Layout: upper-left analog subdial; upper-centre dot-matrix world map; upper-right `MUTE` and `ALM`/`SIG` icon slots; centre-right day-of-week + month–day, with a 2–3 glyph field to its right; bottom-centre large `HH:MM` with a smaller 2-digit `SS` block. |
| DIS-4 | The main `HH:MM` field is the largest element. The `PM` indicator sits left of the hour digits and is shown in 12-hour format only. |
| DIS-5 | Everything is plain 7-segment plus colon/period, **except** the world map (dot-matrix) and the fixed icons. |
| DIS-6 | Day names and 3-letter city codes are drawn from an authored **7-segment letter glyph set**. No alphanumeric text rendering, because the watch has none. |
| DIS-7 | Indicators exist for: `DST`, `MUTE`, `ALM`, `SIG`, alarm-on, hourly-signal-on, alarm number, city code, `T-1`…`T-4`, and `SPL` in stopwatch split mode. |
| DIS-8 | The centre-right 2–3 glyph field shows the **city code** in World Time and the **alarm number** in Alarm mode. |
| DIS-9 | Colon and decimals behave as the watch's do, including the 1/10 s digit in the timer. |

### 2.5 The analog subdial — `ANA-*`

| ID | Requirement |
|---|---|
| ANA-1 | The subdial is always visible in every mode. It is not a mode. |
| ANA-2 | The subdial **always tracks T-1 (Home City)**, in every mode, never the selected world-time city. |
| ANA-3 | It renders hour, minute and second indications as dark segments on a solid disc. |
| ANA-4 | Its ring is numbered at 5-unit steps: `5 10 15 … 60`. Not 1–12. |
| ANA-5 | It has the dark centre hub with the pointer motif seen on the real dial. |

### 2.6 World map and the lit band — `MAP-*`

| ID | Requirement |
|---|---|
| MAP-1 | The map is a dot-matrix equirectangular world map, Greenwich-centred, drawn from the Natural Earth 110m 96×40 bitset. |
| MAP-2 | The zone of the currently displayed time is shown as a solid dark band running north–south. |
| MAP-3 | Band placement is computed from the zone's current UTC offset. |
| MAP-4 | **In Timekeeping and World Time the band follows the displayed zone. In Alarm, Timer and Stopwatch it shows the T-1 (Home City) zone.** |
| MAP-5 | The band wraps correctly at the antimeridian. |
| MAP-6 | The landmass outline remains visible inside the lit band. |
| MAP-7 | The map's proportions follow the equirectangular source; it letterboxes within its allotted region rather than stretching. |

### 2.7 Timekeeping and Multi Time — `TIM-*`

| ID | Requirement |
|---|---|
| TIM-1 | Timekeeping shows T-1: seconds, day of week, month–day, hour:minutes, PM indicator. |
| TIM-2 | Full auto-calendar is supported for 2000–2099, including leap years. |
| TIM-3 | ADJUST (press) on T-1 briefly replaces the day/date field with the Home City code and `T-1` for ~1 s. |
| TIM-4 | ADJUST (hold ~1 s) enters the setting screen. |
| TIM-5 | Setting screen field order: Seconds → City Code → DST → Hour → Minutes → 12/24-Hour Format → Year → Month → Day → Illumination Duration → exit. |
| TIM-6 | MODE advances the flashing field, SEARCH increments, LIGHT decrements, ADJUST exits. |
| TIM-7 | Context-specific single presses work as on the watch: SEARCH resets seconds to `00`, toggles DST, toggles 12/24, toggles illumination duration. |
| TIM-8 | Resetting the seconds field while it reads 30–59 increments the minutes. |
| TIM-9 | T-2/T-3/T-4 expose only city code and DST. ADJUST (hold ~2 s) until the city code flashes, then SEARCH (east) / LIGHT (west) to choose, MODE for the DST field, SEARCH to toggle, ADJUST to exit. |
| TIM-10 | ADJUST + LIGHT promotes the displayed Local Time to Home City. |
| TIM-11 | Auto Display is enabled by holding SEARCH ~3 s in Timekeeping, and any button turns it off. |
| TIM-12 | 12-hour and 24-hour formats are both supported and switchable. |

### 2.8 World Time — `WLD-*`

| ID | Requirement |
|---|---|
| WLD-1 | SEARCH scrolls city codes **eastward**; holding SEARCH scrolls at high speed. |
| WLD-2 | ADJUST (hold ~1 s) toggles DST/Standard **for the displayed city only**; other cities are unaffected. |
| WLD-3 | DST cannot be toggled while `UTC` is the displayed city. |
| WLD-4 | World Time seconds are synchronised with Timekeeping seconds. |
| WLD-5 | The ±1 day marker is shown where the civil date differs from the Home City's, computed by **civil date**, not by hours. |

### 2.9 Alarms — `ALM-*`

| ID | Requirement |
|---|---|
| ALM-1 | Exactly **5 alarms**, each configurable as **Daily** or **One-time**, plus one **Hourly Time Signal**. |
| ALM-2 | SEARCH scrolls alarm screens 1–5 plus the hourly-signal screen; holding SEARCH scrolls fast. |
| ALM-3 | On an alarm screen, ADJUST cycles Daily-on → One-time-on → Off. |
| ALM-4 | ADJUST (hold) enters the alarm setting screen. MODE moves Hour → Minutes → One-time/Daily; SEARCH increments, LIGHT decrements; SEARCH toggles the One-time/Daily selection; ADJUST exits. |
| ALM-5 | Entering an alarm's setting screen automatically arms its One-time mode. |
| ALM-6 | SEARCH (hold) fires the test alarm. |
| ALM-7 | A firing alarm sounds for **10 seconds** regardless of the current mode, and stops on any button press. |
| ALM-8 | The alarm-on indicator shows in all modes and flashes while the alarm is sounding. |
| ALM-9 | The hourly time signal is toggled on its own screen. |
| ALM-10 | Alarms fire a real Windows notification, registered in the alarm category so Windows Focus Assist / Do Not Disturb is respected. |
| ALM-11 | The face plays its alarm animation while sounding. |
| ALM-12 | No audible sound by default. An audible alarm is an explicit, off-by-default setting. |

### 2.10 Countdown Timer — `TMR-*`

| ID | Requirement |
|---|---|
| TMR-1 | Settable from **1 second to 24 hours**, in 1-second, 1-minute and 1-hour increments; 24 h displays as `24H`. |
| TMR-2 | Display unit is **1/10 second**: hours, minutes, seconds, tenths. |
| TMR-3 | ADJUST (hold) enters setting; MODE moves Hours → Minutes → Seconds; SEARCH increments, LIGHT decrements; ADJUST exits. |
| TMR-4 | SEARCH starts; SEARCH pauses; SEARCH resumes. |
| TMR-5 | To stop completely: pause, then ADJUST, which returns the timer to its start value. |
| TMR-6 | At zero the alarm sounds for 10 s or until any button, and the countdown **auto-resets to its start value**. |
| TMR-7 | The timer **does not auto-restart**. |
| TMR-8 | Timer state persists across restart as `running` with an **absolute end timestamp**, so an in-flight countdown survives a quit or crash. |

### 2.11 Stopwatch — `SW-*`

| ID | Requirement |
|---|---|
| SW-1 | Resolution **1/100 second**; capacity 23 h 59 min 59.99 s. |
| SW-2 | Three behaviours: elapsed time, split time, two finishes. |
| SW-3 | Elapsed: SEARCH start / SEARCH stop / SEARCH re-start / SEARCH stop; ADJUST clears. |
| SW-4 | Split: SEARCH start / ADJUST split (`SPL` displayed) / ADJUST split release / SEARCH stop / ADJUST clear. |
| SW-5 | Two finishes: SEARCH start / ADJUST split (first finisher's time shown) / SEARCH stop (second finisher) / ADJUST split release / ADJUST clear. |
| SW-6 | It keeps running when leaving the mode. |
| SW-7 | Leaving the mode while a split is frozen clears the split and returns to elapsed time. |
| SW-8 | At its limit it **resets to zero and continues running** until stopped. |
| SW-9 | There is **no lap memory**, no lap counter and no recall. |
| SW-10 | The stopwatch **resets on launch** and is never persisted. |

### 2.12 Zones and cities — `ZON-*`

| ID | Requirement |
|---|---|
| ZON-1 | The visible face uses the watch's full city code set, as printed in the manual's City Code Table. |
| ZON-2 | The city table is modelled as **data**, not code. Casio's "48 cities / 31 time zones" claim must not be hard-coded: the manual's own table yields 46 codes + UTC across 30 offsets. |
| ZON-3 | `UTC` is a selectable code and is distinct from the Home City. |
| ZON-4 | IANA zone identifiers back each city code, so DST transitions are correct indefinitely without manual intervention. |
| ZON-5 | timan's extended offsets are retained, including `+05:45` (Kathmandu) and `+12:45` (Chatham), which the watch itself cannot display. |
| ZON-6 | Any valid IANA zone can be assigned to T-1…T-4, including zones outside the watch's −11…+12 range. |
| ZON-7 | ICU's legacy zone spellings are normalised (`Asia/Calcutta` → `Asia/Kolkata`, `Asia/Katmandu` → `Asia/Kathmandu`). |
| ZON-8 | Offset display uses `−03:00` / `+05:45` form; the sign is rendered as the watch does. |

### 2.13 DST — `DST-*`

| ID | Requirement |
|---|---|
| DST-1 | DST is **manual per city**: changing it affects only the displayed city. |
| DST-2 | The default for every watch-table city is **`off`**, so out-of-the-box behaviour matches the hardware. |
| DST-3 | `auto → on → off` is supported as a **documented extension** over the watch's two-state toggle. Three taps replace the watch's two. |
| DST-4 | `auto` follows the IANA rules for that zone. `on`/`off` force the summer or standard offset, derived from the zone's own Jan 1 and Jul 1 offsets so the southern hemisphere is handled correctly. |
| DST-5 | Overriding a zone that has no DST has no effect, and the `DST` indicator stays off. |
| DST-6 | DST is **not settable for `UTC`**, matching the watch. |

### 2.14 Illumination — `LIT-*`

| ID | Requirement |
|---|---|
| LIT-1 | Pressing LIGHT washes the LCD in **amber** for the configured duration and feeds the battery simulation. |
| LIT-2 | The duration is selectable between **1.5 s and 3 s**, as on the watch. |
| LIT-3 | The selected duration is a field in the Timekeeping setting screen and persists. |
| LIT-4 | The amber colour is per the secondary visual source; the manual states only "LED". |

### 2.15 Battery simulation — `BAT-*`

| ID | Requirement |
|---|---|
| BAT-1 | `10 YEAR BATTERY` is a **real simulated battery**, not printed decoration: it starts at 100% and depletes. |
| BAT-2 | Drain is driven by **actual alarm-sound seconds** and **actual backlight seconds** used by the operator. |
| BAT-3 | The drain model is calibrated to Casio's own rating assumption: 10 s of alarm operation and 1.5 s of illumination per day gives approximately 10 years. |
| BAT-4 | Battery state persists across restarts and accumulates over the widget's lifetime. |
| BAT-5 | The reading is displayed in the `10 YEAR BATTERY` position, and its appearance changes as the level falls. |
| BAT-6 | The context menu offers an explicit battery reset, so the feature is never a one-way trip. |

### 2.16 Mute and tone — `MUT-*`

| ID | Requirement |
|---|---|
| MUT-1 | Holding MODE toggles the button operation tone on/off, as on the watch. |
| MUT-2 | The `MUTE` indicator shows in all modes while muted. |
| MUT-3 | Mute state persists. |

### 2.17 Persistence and time base — `PRS-*`

| ID | Requirement |
|---|---|
| PRS-1 | Persisted: T-1 city; T-2/T-3/T-4 cities; per-zone DST; 12/24-hour format; all 5 alarm definitions; hourly-signal state; mute state; illumination duration; simulated battery; window position and size; current mode and sub-state. |
| PRS-2 | Not persisted: the stopwatch, which resets on launch. |
| PRS-3 | The countdown timer persists as running with an absolute end timestamp. |
| PRS-4 | Configuration is a human-readable JSON file, editable outside the widget, and invalid or partial files fall back to defaults rather than failing to start. |
| PRS-5 | Time is always derived from absolute instants, never from accumulated ticks, so display drift cannot occur. |

### 2.18 Branding — `BR-*`

| ID | Requirement |
|---|---|
| BR-1 | The watch's printed case text is reproduced faithfully, because it is part of the design: `WORLD TIME`, `ILLUMINATOR`, `CASIO`, `5 ALARMS`, `WR100M`, `10 YEAR BATTERY`, `MODE`, `ADJUST`, `LIGHT`, `SEARCH`. |
| BR-2 | **No Casio logo or wordmark** is used anywhere. The `CASIO` case print is the model's own text and the single highest-exposure element; it is reviewed before any distribution. |
| BR-3 | The product carries a neutral name (`royale` is a placeholder) and never presents itself as a Casio product. |
| BR-4 | A "not affiliated with or endorsed by Casio" disclaimer ships with the project, in the spirit of the reference project's notice. |

## 3. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | **Stack:** Electron, single window, single renderer. No framework is required; the face is SVG and the logic is TypeScript. |
| NFR-2 | **Rendering:** every drawn element is hand-authored SVG. No fonts, no raster images, no icon libraries on the face. |
| NFR-3 | **Zero runtime dependencies for time logic:** time zones are computed via `Intl`, not a timezone library. |
| NFR-4 | **Performance:** idle CPU below ~0.5% of one core; the display updates at the rate the current screen needs and no faster. |
| NFR-5 | **Precision:** the stopwatch's 1/100 s and the timer's 1/10 s are computed from absolute timestamps, so they stay correct under load and across restarts. |
| NFR-6 | **Security:** context isolation on, node integration off in the renderer, a narrow preload IPC surface. |
| NFR-7 | **Portability of logic:** time, zone and map-band logic must run headlessly with no DOM and no Electron, so it can be unit-tested and reused. |
| NFR-8 | **Testability:** the time engine, city table, DST rules, mode state machine and battery model are unit-tested. Snapshots are used for drawing geometry where practical. |
| NFR-9 | **Accessibility floor:** every pusher has a label and the tray menu is keyboard-reachable. This is a deliberate limit, not a claim of full accessibility, because the design is a physical replica. |
| NFR-10 | **Licence hygiene:** MIT obligations are met for any reused code, with attribution. |
| NFR-11 | **Config integrity:** the config file is written atomically, so a crash cannot leave it truncated. |

## 4. Data requirements — `DAT-*`

| ID | Requirement |
|---|---|
| DAT-1 | The city table is a data file: code, city name, IANA zone, reference offset. |
| DAT-2 | The world map is a 96×40 bitset generated from Natural Earth 110m land data, committed as data with its generator script. |
| DAT-3 | The 7-segment digit, letter and icon glyph geometry is authored once as SVG path data and referenced, not duplicated per instance. |
| DAT-4 | Band placement maths is shared between the map renderer and any other consumer. |

## 5. Reuse from the reference project

The reference project (`israelfsilva/timan`, MIT) contributes logic and data only. **All drawing is rebuilt**,
because its renderer is ANSI terminal escape codes and box-drawing characters.

| Source module | Decision | Why |
|---|---|---|
| `src/time.ts` | **Reuse** | Written against standard `Intl`. Handles offsets, wall clock, civil-day difference, DST override, ICU renames. Verified free of Node-only APIs. |
| `src/catalog.ts` | **Reuse as a starting point** | 39 curated entries covering −11:00…+14:00 including fractional offsets. Must be **extended** to the watch's full 46-code table. |
| `src/world.ts` | **Reuse the data** | 480-byte 96×40 Natural Earth bitset, committed with its generator. |
| `bandColumn` / `bandColumns` | **Reuse the maths** | Pure offset→column mapping. |
| `worldmap.ts`, `braille.ts`, `lcd.ts`, `digital.ts`, `panel.ts`, `theme.ts`, `table.ts`, `tui.ts`, `main.ts` | **Do not reuse** | Terminal-specific rendering and layout. |

MIT attribution is required in the repository.

## 6. Watch behaviours that are easy to get wrong

Collected here because each one was a near-miss during the interview. These are requirements, not trivia.

1. **Three modes, five screens.** MODE cycles three; Timer and Stopwatch are screens inside the cycle, not separate modes.
2. **`SPL` and the Multi Time T-number are transient indicators**, not permanent fields.
3. **The map band leaves the displayed zone in Alarm, Timer and Stopwatch** and shows the Home City instead (`MAP-4`).
4. **The analog subdial is T-1 always**, even while displaying Tokyo (`ANA-2`).
5. **No auto-DST on the watch.** `auto` is our documented extension and defaults to `off` (`DST-2`, `DST-3`).
6. **Alarms sound for 10 seconds and stop on any button** (`ALM-7`).
7. **Entering an alarm's setting screen arms it** (`ALM-5`).
8. **The timer auto-resets but never auto-restarts** (`TMR-6`, `TMR-7`).
9. **The stopwatch rolls over at 24 h and keeps running** (`SW-8`), and leaving mid-split clears the split (`SW-7`).
10. **Seconds 30–59 roll the minutes** when reset (`TIM-8`).
11. **DST cannot be touched while `UTC` is selected** (`DST-6`, `WLD-3`).
12. **The ring is numbered 5–60, not 1–12** (`ANA-4`).

## 7. Acceptance criteria

The widget is accepted when all of the following are true:

1. It launches, shows only the watch with no window chrome, and can be dragged by the case and dropped anywhere.
2. It survives a restart in the same position, size, mode and configuration.
3. It never appears in the taskbar or Alt+Tab, and the tray icon shows, hides and quits it.
4. Resizing to an extreme aspect ratio looks deliberate — the watch stays in proportion and the remainder reads as bezel.
5. All five screens are reachable and complete: Timekeeping (with T-1…T-4), World Time, Alarm, Timer, Stopwatch.
6. Every pusher gesture in §2.2 works, including the ADJUST+LIGHT chord and every hold duration.
7. A city in each fractional-offset zone displays the correct time and offset, including `+05:45` and `+12:45`.
8. DST behaves correctly for a northern-hemisphere and a southern-hemisphere city in `auto`, and is inert for `UTC`.
9. An alarm fires a real Windows notification, animates the face for 10 seconds, and respects Focus Assist.
10. A countdown survives a mid-flight restart and still completes on schedule.
11. The stopwatch's 1/100 s display stays accurate over an hour of running.
12. The map band is correct in all five screens, including the Home City fallback in Alarm, Timer and Stopwatch.
13. The simulated battery visibly falls after sustained alarm and backlight use, and resets from the context menu.
14. The LCD is crisp at every size, with no fonts and no raster assets in the face.
15. The unit tests for time, zones, DST, the mode state machine and the battery model pass.

## 8. Decisions of record

| Decision | Choice | Rejected alternative |
|---|---|---|
| Product surface | Desktop widget, Electron | Terminal TUI; browser page |
| Reference device | Casio AE-1200WH | LF-30W; both switchable |
| Scope | All five screens, all functional | World time only; inert decoration |
| Visual construction | Hand-authored SVG, low-res authored | Seven-segment webfont; traced bitmap |
| Resize | Free resize, letterboxed, case-coloured fill | Aspect-locked; layered extra detail |
| Window citizenship | Tray only, no taskbar, no Alt+Tab | Normal app window |
| Always-on-top | Yes, but not over fullscreen | Above everything; never |
| Zones | Watch's 46 codes on the face, IANA behind, extended offsets kept | Watch's fixed table only |
| DST | Manual per city, `auto` as documented extension, default `off` | IANA auto only; manual only |
| Battery | Real simulation drained by actual use | Printed decoration; real OS battery |
| Backlight | Amber wash, 1.5 s / 3 s, feeds battery | No backlight |
| Persistence | Settings persist; stopwatch resets; timer uses absolute end time | Everything persists; nothing persists |
| Interaction | Mouse-only via rendered pushers | Keyboard shortcuts; settings panel |
| Naming | Neutral name, no Casio logo, disclaimer | Casio-branded |

## 9. Explicitly out of scope

Not in v1, and not to be built without a new decision:

1. Real system battery or uptime readout in the `10 YEAR BATTERY` position.
2. Stopwatch lap memory, lap counter or recall — the watch has none.
3. Alarm snooze or repeat-beyond-daily.
4. Any settings UI inside the widget; configuration is the JSON file plus the watch's own setting screens.
5. An LF-30W variant, theme switcher or alternate face.
6. Automatic start with Windows.
7. Audible alarm sound by default, or any sound beyond the alarm and the mute-able button tone.
8. Keyboard shortcuts as a requirement.
9. macOS or Linux packaging.
10. Cloud sync, accounts, or any network feature at runtime.
11. Recreating the watch's strap, buckle or caseback.
12. Manual re-entry of the watch's "48 cities / 31 time zones" claim as though it were consistent.

## 10. Open items

| ID | Item | Impact |
|---|---|---|
| OI-1 | Product name is a placeholder (`royale`). | Cosmetic; blocks packaging and any distribution. |
| OI-2 | Exact LCD, case and accent colours are described by appearance, not measured. | Needs a colour pass against good reference photography. |
| OI-3 | Printed typeface is unidentified. | Case lettering is reproduced as drawn SVG, so the face is unaffected. |
| OI-4 | Module number is 3198 or 3299 depending on market; procedures are identical. | None functionally. |
| OI-5 | Sandbox HTTPS egress is broken, so `npm install` may fail here. | Could block the build in this environment. See [PLAN.md](PLAN.md) risks. |
