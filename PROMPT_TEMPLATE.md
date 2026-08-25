# Schedule → Config Prompt Template

Copy the block below into any AI assistant (ChatGPT, Claude, Gemini, Copilot, or anything else), replace the bracketed section at the bottom with your hours in plain English, and send it.

You do **not** need to attach a screenshot of your timesheet, and you do **not** need to give the agent the script. Everything it needs is in the prompt.

---

````
I use a Tampermonkey userscript that autofills my UCSD Ecotime timesheet. I need you
to convert my work schedule into its JavaScript config format. Output ONLY the code,
in one block, with no explanation.

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
2. A day I do not work must be exactly `null` (no quotes, no empty object).
3. `in` and `out` are single-quoted strings. Accepted: '8:30 AM', '10 AM', '7:00 PM',
   '19:00'. Prefer 12-hour with AM/PM.
4. `meal` is an unquoted whole number of MINUTES. No break is 0. "Half hour lunch"
   is 30, "one hour lunch" is 60.
5. A pay period is two weeks and each weekday entry automatically applies to BOTH
   weeks. Do not duplicate anything for week two.
6. DATE_OVERRIDES is only for a specific calendar date that differs from my normal
   weekly pattern. Keys are 'MM/DD' strings. Use null to skip that date entirely.
   If I mention no exceptions, leave it empty with a commented-out example.
7. After the code block, on one line each, list every weekday with its computed paid
   hours: (out - in) - meal, in decimal. Flag any day over 8 hours or any week over 40.
8. Do not invent hours I did not state. If something is ambiguous, ask me before
   producing the code.

MY SCHEDULE
<<< Describe your hours here in plain English. >>>
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
