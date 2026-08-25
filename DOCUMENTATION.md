# Ecotime Autofill — Technical Documentation

Version 24.0. Companion to `README.md`, which covers install and everyday use. This document explains how the script works, why it works that way, and what to do when it doesn't.

---

## Table of contents

1. [Page model](#1-page-model)
2. [Discovery](#2-discovery)
3. [The state machine](#3-the-state-machine)
4. [Filling a row](#4-filling-a-row)
5. [Deleting rows](#5-deleting-rows)
6. [Performance design](#6-performance-design)
7. [Configuration reference](#7-configuration-reference)
8. [Diagnostics reference](#8-diagnostics-reference)
9. [Troubleshooting](#9-troubleshooting)
10. [Limitations](#10-limitations)
11. [Adapting the script](#11-adapting-the-script)

---

## 1. Page model

Ecotime is a frameset. A typical timesheet page exposes three documents: a toolbar frame holding the Save icon, a content frame holding the Timesheet Summary and the entry table, and the top-level frameset itself.

Tampermonkey injects the script into **every** frame that matches `@match`. Three copies run simultaneously and share one `sessionStorage` (taken from `window.top`, so all copies see the same keys).

This creates the central design constraint: any given copy of the script may be running in a frame that can see almost nothing. Two rules follow, and violating either was the cause of the early bugs in this script's history:

- **A frame that cannot see something must not conclude the thing does not exist.** It returns and waits.
- **Only one frame drives the loop.** The gate is `uiInjected`, which is only true in the frame containing `Timesheet Summary` or `Meal Break`.

`allDocs()` collects every reachable document by walking `window.top.frames` recursively, guarding each access in `try/catch` for cross-origin frames. Element lookups run across all of them, so it does not matter which frame holds the entry row versus the Save button.

---

## 2. Discovery

Nothing is hardcoded to Ecotime's markup beyond a few text labels. Everything else is found structurally.

### Day links

`dateLinks()` scans `a, [onclick], [href]` across all frames and keeps any element whose visible text is short (≤24 chars) and contains **exactly one** `MM/DD`.

The "exactly one" test rejects pay-period range labels like `08/16 - 08/29`. The length cap rejects paragraphs that happen to contain a date.

Ecotime wraps the day name and date in a single anchor, so the text is `"Mon08/17"`, not `"08/17"`. An earlier version anchored the regex with `^...$` and found zero links as a result. Matching a date *anywhere* inside short clickable text handles both shapes. When several nested elements match the same date, the one with the shortest label wins — that is the innermost element, i.e. the actual link rather than its container.

### Weekday determination

Weekdays are **computed, never scraped**:

```js
const jsDate = new Date(year, month - 1, day);
const dow = jsDate.getDay();   // 0 = Sunday … 6 = Saturday
```

The year comes from `yearHint()`, which reads the page's own `Worked Hours on Tuesday 08/25/26`. December/January rollover is handled explicitly.

This matters because it removes any dependence on table layout. Whether the day name sits in the same cell, a separate row, or nowhere at all is irrelevant.

### Summary totals

`summaryDayTotals()` parses the Timesheet Summary into `{ '08/17': 8, '08/18': 8, … }`. It finds the header row containing five or more parseable dates to build a date→column map, then reads the first row whose leading cell begins with `total`.

On any parse failure it returns `null`, and every caller treats `null` as "skip nothing." A misparse can therefore cost speed but never correctness.

### The entry row

`findRow()` returns the first `<tr>` anywhere with **7 or more `<select>` elements**. The Worked Hours row has nine: hour, minute, meridiem (in), hour, minute, meridiem (out), meal break, Position ID, Pay Codes. The Exception Time rows have only two, so they are never matched. This threshold is what keeps the script off the exception table.

---

## 3. The state machine

A run is four `sessionStorage` keys:

| Key | Contents |
|---|---|
| `eco_active` | `'true'` while a run is in progress |
| `eco_mode` | `'fill'` or `'clear'` |
| `eco_queue` | JSON array of target dates, e.g. `["08/17","08/18",…]` |
| `eco_pos` | Index of the current target |
| `eco_t0` | Run start timestamp, for the elapsed-time report |

The queue holds **dates, not element references**. Element references do not survive a page load; dates do. Each page load re-derives its links from the fresh DOM.

`runMachine()` runs on a 50 ms tick and performs at most one action per page load, gated by the module-level `acted` flag. Because every page load creates a fresh script instance, `acted` resets naturally — it is a "once per page" latch that needs no cleanup.

Per tick, in order:

1. Not active, or already acted → return.
2. Not the driving frame → return.
3. `eco_pos` past the end of the queue → finish, report, stop.
4. Current day equals the target → act on it (fill or clear).
5. Otherwise → click that date's link.

### Ordering guarantee

`eco_pos` is incremented **before** the fill begins, not after. If the save reloads the page mid-operation, the reloaded instance reads the already-advanced position and moves to the next day. A day can never be processed twice, and the loop cannot deadlock on a day that fails.

### The watchdog

After an action that should trigger a page load, `armWatchdog()` sets a 1100 ms timer that clears `acted`. Two outcomes:

- **The page navigates.** `beforeunload`/`pagehide` clear the timer; the new instance starts clean.
- **The page doesn't navigate** — Ecotime handled it as an in-place postback. The timer fires, `acted` clears, and the next tick re-evaluates and proceeds.

Both are handled without knowing in advance which will happen. If your Ecotime is slow enough that a save has not committed within 1100 ms *and* produces no navigation, raise `C.settleMs`.

---

## 4. Filling a row

`applyRow(row, spec)` is **idempotent** — safe to call repeatedly. It reports two booleans: `complete` (every field found and set) and `changed` (this pass had to modify something).

`fillAndSave()` calls it on a 20 ms poll and saves once two consecutive passes report `complete && !changed`.

### Why polling instead of fixed delays

Selecting a Position ID triggers a server postback that repopulates the Pay Codes dropdown. `Hours Worked` does not exist as an option until that lands.

The original script handled this with `fill → wait 150ms → fill again → wait 150ms → save`: always at least 300 ms, and not always enough. Polling waits for the actual condition — typically settling in 50–75 ms, while tolerating a slow server up to `maxFillMs` (5 s).

### Option matching

Dropdown values are compared with dots and whitespace stripped, uppercased, against a candidate list. `'A.M.'`, `'AM'`, and `'a.m.'` all match; `'8'` and `'08'` are both offered. This removes a whole class of silent failure where the config's format didn't match the site's.

Position and Pay Code selects are identified by inspecting their option text (`POS#`/`Position ID` versus `Pay Code`/`Hours Worked`), not by index, so column reordering wouldn't break them.

### Early exit

If the *first* pass reports `complete && !changed`, the row already matches the target exactly. The save is skipped and the loop advances with no page load. Re-running a fill over an already-correct period costs one page load per day instead of two.

---

## 5. Deleting rows

The delete flow mirrors the manual steps: tick the Delete checkbox on each row, then press the Delete button once.

**Column identification.** `deleteColIndex()` finds the header cell whose text is exactly `delete` and returns its index. `deleteCheckbox()` reads that cell on each data row. Only if the header lookup fails does it fall back to "last checkbox in the row."

This matters because each row has three checkboxes — Overnight, Extra Unschd, Delete. Positional guessing would eventually tick the wrong one.

**Row selection.** `rowHasData()` marks a row if any time dropdown has `selectedIndex > 0`, any text input parses above zero, or a real `POS#` is selected. Empty rows are left alone. Multiple populated rows on one day are all ticked, then removed by a single Delete press.

**Checkbox activation.** The box is set to `checked = true`, sent a real bubbling `MouseEvent('click')`, then re-asserted to `checked = true` and sent a `change` event. The re-assert guards against ASP handlers that toggle the box on click.

**Empty days cost nothing.** `clearDay()` returning 0 releases `acted` immediately without arming the watchdog, so the loop advances to the next date with no page load at all.

---

## 6. Performance design

Two page loads per day is the floor for a filled day: one to navigate, one to save. That is Ecotime's round-trip and cannot be optimized away from the client. Everything here is about eliminating loads that aren't needed and removing script-side latency around the ones that are.

### What was slow, and what fixed it

| Problem | Fix |
|---|---|
| UI detection ran on a 1000 ms interval, and the machine wouldn't act until it succeeded — up to 1 s of dead time per page load | Detection moved onto the fast tick and runs until it succeeds |
| Machine ticked at 250–400 ms | Now 50 ms |
| `allText()` concatenated all three frames' `textContent` every tick | Memoized 200 ms; checks the local frame first |
| Loop waited for the interval after a reload | Hooks `readystatechange` (fires at `interactive`), `DOMContentLoaded`, and `load` |
| Fixed 300 ms fill delay | Adaptive polling, typically 50–75 ms |
| Re-filling a correct day still saved | First-pass early exit, no save |
| Clearing visited all 14 days | Summary totals prefilter skips 0.00 days entirely |

### The prefilter

This is the largest remaining win, because it removes page loads rather than shaving milliseconds:

- **Clear** (`clearOnlyDaysWithHours`, default on) — reads the summary before starting and queues only days showing hours. Clearing a period with three filled days costs three navigations, not fourteen.
- **Fill** (`skipDaysAlreadyMatching`, default **off**) — skips days whose summary total already equals the computed target.

`skipDaysAlreadyMatching` is off by default for a real reason: **matching totals do not prove matching times.** A day recorded as 9:00–5:30 and a day recorded as 8:30–5:00 both total 8.00 hours. With this on, the script would leave the wrong one in place. Only enable it if you care about hour counts rather than clock times.

### Measuring

Turn on dev mode (Ctrl+Shift+D) and watch the console:

```
[Ecotime] day 08/24 ready after 1840 ms      ← Ecotime's page load
[Ecotime] fill settled in 68 ms              ← the script's own work
```

If `ready after` dominates, you are waiting on the server and there is nothing left to tune client-side. If `fill settled` is high, the Position ID postback is slow — a lower `C.pollMs` will not help, since the wait is the round trip.

The completion alert reports total wall-clock time for the run.

---

## 7. Configuration reference

### SCHEDULE

Seven keys, `Mon` through `Sun`. Each is either `null` or an object with `in`, `out`, and `meal`.

Lookup is by **day of week**, computed from the date. This is why one entry covers both weeks of the pay period — the second Monday resolves to the same `SCHEDULE.Mon`.

Times are parsed by `parseTime()`, which accepts `H`, `H:MM`, with optional `AM`/`PM` in any casing, with or without periods. Absent a meridiem, the value is read as 24-hour. `meal` is whole minutes.

`compileSpec()` precomputes paid hours as `(out − in) − meal`, adding 24 hours if `out` precedes `in` so overnight shifts compute correctly. This figure appears in the confirmation dialog and drives `skipDaysAlreadyMatching`.

### DATE_OVERRIDES

Keyed by `'MM/DD'`, checked before `SCHEDULE`. A value of `null` skips that date. Note that these are month/day only — they apply to whichever pay period contains that date, in any year.

### OPTIONS

| Option | Default | Notes |
|---|---|---|
| `devMode` | `false` | Also toggleable at runtime; the runtime setting persists in `localStorage` |
| `skipFutureDates` | `false` | Useful if Ecotime rejects future-dated entries |
| `clearWeekends` | `true` | Saves two page loads per week when off |
| `clearOnlyDaysWithHours` | `true` | Silently does nothing if the summary can't be parsed |
| `skipDaysAlreadyMatching` | `false` | Read the caveat in §6 before enabling |
| `saveAfterDelete` | `false` | Enable only if deletes don't persist on their own |

### Internal tuning (`C`)

Rarely needed. `settleMs` (watchdog, 1100 ms) is the one worth raising on a slow connection. `pollMs` (20 ms) and `stableTicks` (2) control fill confirmation. `maxFillMs` (5000 ms) is the ceiling before saving regardless. `maxBlindTicks` (180 ≈ 9 s) is how long the loop waits for a missing link before giving up.

---

## 8. Diagnostics reference

Ctrl+Shift+D, then click 🔍 Debug. Output also goes to the console.

| Line | Healthy value | If wrong |
|---|---|---|
| `Frames reachable` | 3 | 1 means frame access is blocked |
| `Year hint` | Weekday and date matching the open day | `none` means the header text wasn't found |
| `Current day open` | `MM/DD` of the open day | `none` means you're on a summary view, or the header changed |
| `Summary totals parsed` | `yes` | `no` disables both prefilters; not fatal |
| `Date links found` | 14 for a two-week period | 0 means link detection failed — see §9 |
| Per-date lines | Correct weekday and your configured hours | Wrong weekday implicates the year hint |
| `Fill queue` / `Clear queue` | The dates that will be visited | Empty means everything was filtered out |
| `Entry row found` | `yes` on a day view | `no` means fewer than 7 selects were found |
| `Save button found` | `yes` | `no` means fills won't persist |
| `Delete column index` | ≥ 0 | `-1` means the fallback is in use — works, but verify before bulk deleting |
| `Delete button found` | `yes` on a day view | `no` means clears won't execute |
| `Populated rows here` | Number of rows a clear would remove | — |

---

## 9. Troubleshooting

**Buttons never appear.** The frame check requires `Timesheet Summary` or `Meal Break` in the frame's text. Confirm Tampermonkey shows "1" on its icon. On Chrome 138+, Developer mode must be on at `chrome://extensions`. Check that your Ecotime hostname matches an `@match` line.

**`Date links found: 0`.** Day headers aren't anchors, or their text doesn't fit the pattern. Get the actual markup — open the console and run:

```js
[document, ...[...top.frames].map(f => { try { return f.document } catch(e) { return null } })]
  .filter(Boolean).forEach(d => {
    const t = [...d.querySelectorAll('table')].find(x => x.textContent.includes('Timesheet Summary'));
    if (t) console.log(t.rows[0].outerHTML, '\n---\n', t.rows[1].outerHTML);
  });
```

The `Clickable labels sampled` line in the diagnostics also shows the first twenty short clickable labels found, which usually reveals the shape immediately.

**Fill runs but nothing saves.** `Save button found: no`. Inspect the Save icon and widen the selector in `findSave()`.

**A day gets skipped during a run.** The watchdog fired before the save committed. Raise `C.settleMs` to 2000.

**Wrong weekday against a date.** `Year hint` is wrong. Verify the page really shows `Worked Hours on <Weekday> MM/DD/YY`.

**Delete ticks the wrong checkbox.** `Delete column index: -1` means the header lookup failed and the last-checkbox fallback is running. Check the header cell's exact text and adjust the comparison in `deleteColIndex()`.

**A run is stuck.** Press 🛑 STOP. If the button isn't visible, run `sessionStorage.clear()` in the console and reload.

---

## 10. Limitations

- **Fills the first entry row only.** Split shifts (two blocks in one day) need the second row entered manually.
- **Worked hours only.** The Exception Time table — sick, vacation, holiday — is never touched.
- **No approval or submission.** The script saves entries; submitting the timesheet stays manual and deliberate.
- **Position selection is naive.** It takes the first option containing `POS#`. Multiple concurrent appointments would need explicit handling.
- **`DATE_OVERRIDES` ignores the year.** `'08/19'` matches August 19 in any year.
- **No undo.** Clearing a pay period is irreversible through this tool.
- **Markup-dependent.** Any Ecotime redesign can break detection. The diagnostics panel exists to make that failure legible rather than mysterious.

---

## 11. Adapting the script

**Another campus or hostname.** Add an `@match` line in the header block.

**A different pay code.** Change `C.payCode` from `'Hours Worked'`.

**Longer pay periods.** Nothing assumes fourteen days. The queue is built from whatever date links exist, and weekday lookup handles any number of weeks.

**Different dropdown granularity.** If minutes come in 15-minute increments, use values the dropdown actually offers. `parseTime()` will happily produce `:37`, and `applyRow` will then report `complete: false` and spin until `maxFillMs`.

**Changing the fill target row.** `findRow()` returns the first row with ≥7 selects. To target a different row, filter `entryRows(entryTable())` instead.
