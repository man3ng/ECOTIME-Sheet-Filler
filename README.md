# Ecotime Autofill

A Tampermonkey userscript that fills and clears UCSD Ecotime timesheets. Set your weekly hours once; one click fills every day of the pay period and saves each one.

Version 1.0 Prod

---

## Requirements

**Tampermonkey** — a browser extension that runs userscripts. This script will not work without it. It is free.

| Browser | Where to get it |
|---|---|
| Chrome | Chrome Web Store → "Tampermonkey" |
| Edge | Edge Add-ons → "Tampermonkey" |
| Firefox | Firefox Add-ons → "Tampermonkey" |
| Safari | Mac App Store → "Tampermonkey" |
| Brave / Opera / Vivaldi | Chrome Web Store version works |

Greasemonkey and Violentmonkey will probably work too, but Tampermonkey is what this was built and tested against.

---

## Install

1. Install Tampermonkey and pin it to your toolbar.
2. Chrome only: go to `chrome://extensions`, and turn on **Developer mode** (top right). Since Chrome 138 (mid-2025 Stable Release) Tampermonkey needs this to run scripts.
3. Click the Tampermonkey icon → **Create a new script…**
4. Select everything in the editor and delete it.
5. Paste the entire contents of `ecotime-autofill-prod-v1.user.js`.
6. **File → Save**, or Ctrl+S.
7. Open Ecotime and go to your timesheet. Buttons appear at the bottom right.

If no buttons appear, see Troubleshooting below.

---

## The buttons

| Button | Hotkey | What it does |
|---|---|---|
| ✨ **Autofill DAY** | Ctrl+Shift+Z | Fills just the day currently open, using that weekday's hours, then saves |
| 🚀 **Autofill FULL PAY PERIOD** | — | Walks every scheduled day in the pay period, filling and saving each |
| 🗑 **Clear DAY** | Ctrl+Shift+X | Deletes every populated entry row on the open day |
| 🗑 **Clear FULL PAY PERIOD** | — | Deletes entries across the whole pay period |
| 🛑 **STOP Automation** | — | Aborts a run in progress. Only visible while running |
| 🔍 **Debug** | Ctrl+Shift+D | Hidden by default. Dumps what the script can see on the page |

Both full-period buttons show you an itemized list and ask for confirmation before touching anything.

---

## Setting your hours

Open the script in Tampermonkey and find the `SCHEDULE` block at the very top. It is the first thing in the file.

```js
const SCHEDULE = {
    Mon: { in: '8:30 AM', out: '5:00 PM', meal: 30 },
    Tue: { in: '8:30 AM', out: '5:00 PM', meal: 30 },
    Wed: { in: '8:30 AM', out: '5:00 PM', meal: 30 },
    Thu: { in: '8:30 AM', out: '5:00 PM', meal: 30 },
    Fri: { in: '8:30 AM', out: '5:00 PM', meal: 30 },
    Sat: null,
    Sun: null
};
```

- `in` / `out` — clock in and clock out times
- `meal` — unpaid break in **minutes** (`0` for none)
- `null` — that weekday is never filled

**Each weekday is entered once and applies to both weeks of the pay period.** Whatever you write for `Mon` is used for both Mondays, `Tue` for both Tuesdays, and so on. A pay period is two weeks, so five weekday entries cover ten days.

Time formats that work: `'8:30 AM'`, `'10 AM'`, `'7:00 PM'`, `'19:00'`, `'8:30am'`.

### A varied week

```js
const SCHEDULE = {
    Mon: { in: '9:00 AM',  out: '12:00 PM', meal: 0  },   // 3 hours
    Tue: { in: '10:00 AM', out: '4:00 PM',  meal: 60 },   // 5 hours
    Wed: { in: '1:00 PM',  out: '6:00 PM',  meal: 0  },   // 5 hours
    Thu: null,                                            // day off
    Fri: { in: '8:00 AM',  out: '4:30 PM',  meal: 30 },   // 8 hours
    Sat: null,
    Sun: null
};
```

### One-off exceptions

For a single date that breaks the pattern, use `DATE_OVERRIDES` just below `SCHEDULE`. Dates are `MM/DD` exactly as they appear on the timesheet.

```js
const DATE_OVERRIDES = {
    '08/19': { in: '9:00 AM', out: '1:00 PM', meal: 0 },  // left early that day
    '08/26': null                                          // holiday, skip entirely
};
```

Leave it empty (`{}`) when you have no exceptions.

---

## Getting an AI agent to write your schedule

If you would rather describe your hours in plain English or using a screenshot of your hours through calendars from Google, Apple, or WhenIwork than edit JavaScript, paste the prompt below into ChatGPT, Claude, Gemini, Copilot, or any other assistant. It contains everything the agent needs — you do **not** need to send a screenshot of your timesheet or share the script.

Copy from the line below through the end of the block, fill in your hours where marked, and send it.

---

````
I use a Tampermonkey userscript that autofills my UCSD Ecotime timesheet. I need you
to convert my work schedule (from the attached screenshot or text below) into its 
JavaScript config format. Output ONLY the code and hours breakdown, with no other conversational filler.

FORMAT SPEC

Produce exactly two constants: SCHEDULE and DATE_OVERRIDES.

const SCHEDULE = {
    Mon: { in: '<time>', out: '<time>', meal: <minutes> },
    Tue: { ... },
    Wed: { ... },
    Thu: { ... },
    Fri: { ... },
    Sat: null,
    Sun: null
};

const DATE_OVERRIDES = {
    // 'MM/DD': { in: '<time>', out: '<time>', meal: <minutes> },
    // 'MM/DD': null
};

RULES
1. All seven keys must be present in SCHEDULE, in order Mon through Sun.
2. A day not worked must be exactly `null` (no quotes, no empty object).
3. `in` and `out` are single-quoted strings formatted as 12-hour AM/PM (e.g., '7:45 AM', '4:15 PM').
4. `meal` is an unquoted whole number of MINUTES:
   - For shifts ≥ 6 hours where meal isn't specified, default to standard 30 minutes (or 0 if < 6 hours).
5. A pay period is two weeks. If the weekly pattern repeats identically in both weeks, 
   put it in SCHEDULE and leave DATE_OVERRIDES empty.
6. Use DATE_OVERRIDES for specific dates (format 'MM/DD') that deviate from the standard weekly cycle.
7. After the code block, list every day worked with its computed paid hours: 
   (out - in) - meal, in decimal format. Flag any day > 8.00 hours or week > 40.00 hours.
8. If reading an attached image, extract the exact start/end times per day from the calendar cells.
9. Do not invent hours I did not state. If something is ambiguous, ask me before
   producing the code.

MY SCHEDULE
<<< Attach screenshot here OR describe hours in plain English. Examples of the kind of thing that works:

    "Mon Wed Fri 9am to 2pm no lunch, Tue and Thu 8:30 to 5 with a half hour lunch,
     weekends off"

    "I work 10 to 7 every weekday with an hour lunch"

    "Monday 3 hours starting at 9, Tuesday 5 hours starting at 10, Wednesday 5 hours
     starting at 1pm, Thursday off, Friday 8 hours starting at 8am with 30 min lunch"

    "Tue/Thu 1pm-6pm, and on 08/19 I only worked 9am to 1pm" >>>
````

---

Then paste the `SCHEDULE` and `DATE_OVERRIDES` blocks the agent gives you over the matching blocks in the script, replacing them entirely. Save with Ctrl+S and reload Ecotime.

**Check the agent's arithmetic against your own before you save.** The hours breakdown in rule 7 is there so you can eyeball it. The confirmation dialog in the script also lists every date with its computed hours before anything is written, which is your second chance to catch a mistake.

---

## Options

Just below `DATE_OVERRIDES`:

```js
const OPTIONS = {
    devMode: false,
    skipFutureDates: false,
    clearWeekends: true,
    clearOnlyDaysWithHours: true,
    skipDaysAlreadyMatching: false,
    saveAfterDelete: false
};
```

| Option | Default | Effect |
|---|---|---|
| `devMode` | `false` | Always show the Debug button and log timings |
| `skipFutureDates` | `false` | Don't fill days that haven't happened yet |
| `clearWeekends` | `true` | Include Sat/Sun when clearing the pay period |
| `clearOnlyDaysWithHours` | `true` | Skip days the summary already shows as 0.00. Big speedup |
| `skipDaysAlreadyMatching` | `false` | Skip filling days whose total already equals the target. See caveat in DOCUMENTATION.md |
| `saveAfterDelete` | `false` | Also press Save after a delete posts back |

---

## Troubleshooting

**No buttons appear.** Confirm Tampermonkey is enabled and shows "1" on its icon while on Ecotime. On Chrome, check that Developer mode is on at `chrome://extensions`. Confirm the Ecotime URL matches one of the `@match` lines near the top of the script; if your campus uses a different hostname, add it. Note: as of now, I have only tested this UCSD's Ecotime, please let me know if it is also working with other variation of Ecotime at different institutions.

**"Nothing to fill."** Every weekday in `SCHEDULE` is `null`, or `skipDaysAlreadyMatching` is on and everything already matches. Press Ctrl+Shift+D and click Debug to see the queue.

**A run stopped partway.** The alert includes a diagnostics dump. The two lines that matter most are `Save button found` and `Date links found`. Nothing is left half-saved — each day is saved before the next begins.

**Times don't match my dropdowns.** Some Ecotime configurations use 15-minute increments. If your minute dropdown has no `:30`, pick a value it does offer.

For anything deeper, see `DOCUMENTATION.md`.

---

## Notes
Made by me and A.I. coding assistants

This is an unofficial tool, not affiliated with UCSD or Ecotime, and it may break whenever Ecotime changes its pages.

It automates data entry; it does not decide what your hours were. You are responsible for the accuracy of what gets submitted. Review the confirmation dialog before each run and check the Timesheet Summary afterward. Clearing a pay period cannot be undone.
