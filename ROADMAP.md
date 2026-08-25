# Project Roadmap: UCSD Ecotime Autofill

A forward-looking technical roadmap based on the v1.0 prod state machine, dynamic date parser, and multi-frame architecture.

---

## Phase 1: Engine Optimizations & Config UX (Current Milestone)
* **Pre-flight Confirmation Modal:** Replace native browser `confirm()` with a styled in-page modal displaying an interactive schedule summary before running `startRun('fill')` or `startRun('clear')`.
* **Config Preset Switcher:** Support switching between multiple schedule profiles directly from the UI (e.g., *Academic Quarter* vs. *Summer Break* vs. *Finals Week*) without manually editing `SCHEDULE` in code.
* **Granular Failure Recovery:** Improve `blindTicks` error handling by capturing and logging specific AJAX dropouts or frame-detachment errors instead of relying solely on timeouts.

---

## Phase 2: Shift Flexibility & Advanced Timesheet Rules
* **Multi-Row & Split Shift Handling:** Extend `applyRow()` to populate multiple entry rows per day for split shifts (e.g., 9:00 AM–12:00 PM, then 2:00 PM–5:00 PM on the same date).
* **Automated Campus Holiday Ingestion:** Pre-populate `DATE_OVERRIDES` with UC San Diego's official academic calendar and administrative holidays so non-working dates default to `null` automatically.
* **Dynamic Meal-Break Compliance:** Automatically adjust `meal` to 30 or 60 minutes based on total elapsed shift time if shifts exceed California non-exempt thresholds (5+ continuous hours).

---

## Phase 3: External Integrations & Data Ingestion
* **Calendar File Sync (.ics / Google Calendar / Outlook):** Add an import parser allowing users to load shift schedules directly from `.ics` files or calendar exports into `DATE_OVERRIDES`.
* **Shift-Scheduling App Parsers:** Provide lightweight JSON converters or scrapers for common student-employment tools (e.g., WhenToWork, SubItUp, Deputy) to generate compatible `SCHEDULE` constants.
* **Audit & Export Reports:** Add a single-click export feature to download completed timesheet records as CSV/JSON for personal pay-period tracking.

---

## Phase 4: Packaging & Distribution
* **Standalone Browser Extension:** Package the userscript into a native WebExtension (Chrome / Firefox) with an options popup page, removing the dependency on Tampermonkey.
* **Visual Setup Wizard:** Build a local UI form for configuring Position IDs, Pay Codes, and weekly templates without touching source code.

---

## Backlog & Experimental
* [ ] Dark mode theme injection for Ecotime’s legacy iframe layout.
* [ ] Real-time wage estimation based on recorded hours and active job code rate.
* [ ] Payroll submission reminder toast before biweekly approval cutoff windows.
