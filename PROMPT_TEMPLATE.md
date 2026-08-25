# Schedule → Config Prompt Template

Copy the block below into any AI assistant (ChatGPT, Claude, Gemini, Copilot, or anything else), replace the bracketed section at the bottom with your hours in plain English, and send it.

You do **not** need to attach a screenshot of your timesheet, and you do **not** need to give the agent the script. Everything it needs is in the prompt.

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
<<< Attach screenshot here OR describe hours in plain English >>>
````

---

## Examples of schedule descriptions that work

Any of these can go in the `MY SCHEDULE` section:

> Mon Wed Fri 9am to 2pm no lunch, Tue and Thu 8:30 to 5 with a half hour lunch, weekends off

> I work 10 to 7 every weekday with an hour lunch

> Monday 3 hours starting at 9, Tuesday 5 hours starting at 10, Wednesday 5 hours starting at 1pm, Thursday off, Friday 8 hours starting at 8am with 30 min lunch

> Tue/Thu 1pm-6pm, and on 08/19 I only worked 9am to 1pm

> 8:30-5 Monday through Friday, 30 minute lunch, but 08/26 is a holiday so skip it

---

## What to do with the output

1. Open Tampermonkey → your Ecotime script.
2. Find the existing `const SCHEDULE = { … };` block near the top and replace it entirely with the agent's version.
3. Do the same for `const DATE_OVERRIDES = { … };`.
4. Save with Ctrl+S.
5. Reload Ecotime.

Check the hours breakdown the agent produced (rule 7) against what you actually worked. The script's confirmation dialog lists every date with its computed hours before writing anything, so you get a second look before it commits.
