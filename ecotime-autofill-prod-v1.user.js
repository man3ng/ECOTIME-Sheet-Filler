// ==UserScript==
// @name         UCSD Ecotime Custom Autofill
// @namespace    http://tampermonkey.net/
// @version      24.0
// @description  Per-weekday schedule autofill and bulk clear for UCSD Ecotime. Mirrors each weekday's hours across both weeks of the pay period.
// @author       AI Assistant
// @match        *://*.ecotimebyhbs.com/*
// @match        *://ecotimecampus.ucsd.edu/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /* ==================================================================== */
    /*                                                                      */
    /*   ####  EDIT YOUR HOURS HERE  ####                                   */
    /*                                                                      */
    /*   One entry per weekday. Whatever you put for Mon is used for BOTH   */
    /*   Mondays in the pay period, Tue for both Tuesdays, and so on.       */
    /*                                                                      */
    /*     in    = clock-in time                                            */
    /*     out   = clock-out time                                           */
    /*     meal  = unpaid meal break in minutes (0 if none)                 */
    /*                                                                      */
    /*   Time formats all work:  '8:30 AM'  '10 AM'  '7:00 PM'  '19:00'     */
    /*   Set a day to  null  to skip it entirely.                           */
    /*                                                                      */
    /* ==================================================================== */

    const SCHEDULE = {
        Mon: { in: '8:30 AM', out: '5:00 PM', meal: 30 },
        Tue: { in: '8:30 AM', out: '5:00 PM', meal: 30 },
        Wed: { in: '8:30 AM', out: '5:00 PM', meal: 30 },
        Thu: { in: '8:30 AM', out: '5:00 PM', meal: 30 },
        Fri: { in: '8:30 AM', out: '5:00 PM', meal: 30 },
        Sat: null,   // null = never filled
        Sun: null    // null = never filled
    };

    /*   Example of a varied week (each repeats on the matching day of week 2):

         Mon: { in: '9:00 AM',  out: '12:00 PM', meal: 0  },   // 3 hours
         Tue: { in: '10:00 AM', out: '4:00 PM',  meal: 60 },   // 5 hours
         Wed: { in: '1:00 PM',  out: '6:00 PM',  meal: 0  },   // 5 hours
         Thu: null,                                            // day off
         Fri: { in: '8:00 AM',  out: '4:30 PM',  meal: 30 },   // 8 hours
    */

    /* ---- One-off exceptions for a SINGLE date (optional) ---------------- */
    /*   Overrides SCHEDULE for that date only. Use MM/DD as shown on the
         timesheet. Set to null to skip that one date (holiday, sick day).   */

    const DATE_OVERRIDES = {
        // '08/19': { in: '9:00 AM', out: '1:00 PM', meal: 0 },
        // '08/26': null
    };

    /* ---- Other options -------------------------------------------------- */

    const OPTIONS = {
        devMode: false,               // true = always show the Debug button
        skipFutureDates: false,       // true = don't fill days that haven't happened yet
        clearWeekends: true,          // when clearing, also visit Sat/Sun
        clearOnlyDaysWithHours: true, // SPEED: skip days the summary shows as 0.00
        skipDaysAlreadyMatching: false, // SPEED: skip fill when summary hours already match
        saveAfterDelete: false        // true = also click Save after a delete posts back
    };

    /* ==================================================================== */
    /*   Nothing below here needs editing.                                  */
    /* ==================================================================== */

    const C = {
        payCode: 'Hours Worked',
        tickMs: 50,
        pollMs: 20,
        stableTicks: 2,
        maxFillMs: 5000,
        settleMs: 1100,
        maxBlindTicks: 180,
        maxLabelLen: 24,
        memoMs: 200,
        summaryMemoMs: 600
    };

    const K = {
        active: 'eco_active', queue: 'eco_queue', pos: 'eco_pos',
        mode: 'eco_mode', t0: 'eco_t0', dev: 'eco_dev'
    };
    const LOG = '[Ecotime]';
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    let uiInjected = false;
    let acted = false;
    let watchdog = null;
    let blindTicks = 0;
    let stepStart = 0;

    function devOn() {
        try { return OPTIONS.devMode || localStorage.getItem(K.dev) === '1'; } catch (e) { return OPTIONS.devMode; }
    }
    function dlog() {
        if (devOn()) console.log.apply(console, [LOG].concat(Array.prototype.slice.call(arguments)));
    }

    /* ------------------------------------------------------------------ */
    /*  TIME PARSING                                                       */
    /* ------------------------------------------------------------------ */
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function normOpt(s) { return String(s == null ? '' : s).replace(/[\s.]/g, '').toUpperCase(); }

    function parseTime(str) {
        const s = String(str).trim().toUpperCase().replace(/\./g, '');
        const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
        if (!m) throw new Error('Unreadable time in SCHEDULE: "' + str + '"');
        let h = parseInt(m[1], 10);
        const min = m[2] || '00';
        let mer = m[3];
        if (!mer) {
            mer = h >= 12 ? 'P.M.' : 'A.M.';
            if (h === 0) h = 12; else if (h > 12) h -= 12;
        } else {
            mer = mer === 'AM' ? 'A.M.' : 'P.M.';
            if (h === 0) h = 12;
        }
        return { hour: String(h), min: min, mer: mer, mins: ((h % 12) + (mer === 'P.M.' ? 12 : 0)) * 60 + parseInt(min, 10) };
    }

    function compileSpec(raw) {
        if (!raw) return null;
        const i = parseTime(raw.in), o = parseTime(raw.out);
        const meal = parseInt(raw.meal, 10) || 0;
        let span = o.mins - i.mins;
        if (span < 0) span += 24 * 60;               // overnight shift
        const hours = Math.round((span - meal) / 0.6) / 100;
        return {
            inHour: [i.hour, pad(+i.hour)],
            inMin: [i.min, String(+i.min)],
            inMer: [i.mer],
            outHour: [o.hour, pad(+o.hour)],
            outMin: [o.min, String(+o.min)],
            outMer: [o.mer],
            meal: [String(meal), pad(meal)],
            hours: hours,
            label: raw.in + '-' + raw.out + ' /' + meal + 'm = ' + hours.toFixed(2) + 'h'
        };
    }

    function specForDate(date, dow) {
        if (Object.prototype.hasOwnProperty.call(DATE_OVERRIDES, date)) return compileSpec(DATE_OVERRIDES[date]);
        return compileSpec(SCHEDULE[DOW[dow]]);
    }

    /* ------------------------------------------------------------------ */
    /*  STORAGE                                                            */
    /* ------------------------------------------------------------------ */
    function store() {
        try { return window.top.sessionStorage; } catch (e) { return window.sessionStorage; }
    }
    function isActive() { return store().getItem(K.active) === 'true'; }
    function getMode() { return store().getItem(K.mode) || 'fill'; }
    function getQueue() { try { return JSON.parse(store().getItem(K.queue) || '[]'); } catch (e) { return []; } }
    function getPos() { return parseInt(store().getItem(K.pos) || '0', 10); }
    function setPos(n) { store().setItem(K.pos, String(n)); }

    function startRun(mode, dates) {
        store().setItem(K.mode, mode);
        store().setItem(K.queue, JSON.stringify(dates));
        store().setItem(K.t0, String(Date.now()));
        setPos(0);
        store().setItem(K.active, 'true');
        acted = false; blindTicks = 0; stepStart = Date.now();
        refreshUI();
        runMachine();
    }

    function stopAutomation(msg) {
        store().setItem(K.active, 'false');
        [K.queue, K.pos, K.mode, K.t0].forEach(k => store().removeItem(k));
        clearTimeout(watchdog);
        acted = false;
        blindTicks = 0;
        refreshUI();
        setStatus(msg || '');
    }

    /* ------------------------------------------------------------------ */
    /*  FRAMES (memoized — this is the hot path)                           */
    /* ------------------------------------------------------------------ */
    function memo(fn, ms) {
        let at = 0, val;
        return function () {
            const now = Date.now();
            if (now - at > ms) { val = fn(); at = now; }
            return val;
        };
    }

    const allDocs = memo(function () {
        const docs = [document];
        const push = d => { if (d && docs.indexOf(d) === -1) docs.push(d); };
        try { push(window.top.document); } catch (e) { }
        function walk(win, depth) {
            if (depth > 4) return;
            let n = 0;
            try { n = win.frames.length; } catch (e) { return; }
            for (let i = 0; i < n; i++) {
                try { push(win.frames[i].document); walk(win.frames[i], depth + 1); } catch (e) { }
            }
        }
        try { walk(window.top, 0); } catch (e) { }
        walk(window, 0);
        return docs;
    }, C.memoMs);

    const allText = memo(function () {
        const local = document.body ? document.body.textContent : '';
        if (local.indexOf('Worked Hours on') !== -1) return local;
        return allDocs().map(d => {
            try { return d.body ? d.body.textContent : ''; } catch (e) { return ''; }
        }).join('\n');
    }, C.memoMs);

    function isTimesheetDoc() {
        const t = document.body ? document.body.textContent : '';
        return t.indexOf('Timesheet Summary') !== -1 || t.indexOf('Meal Break') !== -1;
    }

    /* ------------------------------------------------------------------ */
    /*  DATE / WEEKDAY LOGIC                                               */
    /* ------------------------------------------------------------------ */
    function normYear(y) { y = parseInt(y, 10); return y < 100 ? 2000 + y : y; }
    function clean(el) { return ((el && el.textContent) || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }

    function yearHint() {
        const m = allText().match(/(?:Worked Hours on|Exception Time)\s+(\w+)\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (m) return { name: m[1], month: +m[2], day: +m[3], year: normYear(m[4]) };
        const m2 = allText().match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (m2) return { name: null, month: +m2[1], day: +m2[2], year: normYear(m2[3]) };
        return null;
    }

    function yearFor(mm, hint) {
        if (!hint) return new Date().getFullYear();
        let y = hint.year;
        if (hint.month === 12 && mm === 1) y += 1;
        else if (hint.month === 1 && mm === 12) y -= 1;
        return y;
    }

    function extractDate(txt) {
        if (!txt || txt.length > C.maxLabelLen) return null;
        const all = txt.match(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/g);
        if (!all || all.length !== 1) return null;
        const p = all[0].split('/');
        const mm = +p[0], dd = +p[1];
        if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
        return { mm, dd, yy: p[2] ? normYear(p[2]) : null };
    }

    const dateLinks = memo(function () {
        const hint = yearHint();
        const best = {};
        allDocs().forEach(doc => {
            let nodes;
            try { nodes = doc.querySelectorAll('a, [onclick], [href]'); } catch (e) { return; }
            Array.prototype.forEach.call(nodes, n => {
                const txt = clean(n);
                const d = extractDate(txt);
                if (!d) return;
                const key = pad(d.mm) + '/' + pad(d.dd);
                if (best[key] && best[key].label.length <= txt.length) return;
                const y = d.yy || yearFor(d.mm, hint);
                const jsDate = new Date(y, d.mm - 1, d.dd);
                best[key] = { date: key, dow: jsDate.getDay(), when: jsDate, el: n, label: txt };
            });
        });
        return Object.keys(best).map(k => best[k]).sort((a, b) => a.when - b.when);
    }, C.memoMs);

    /* ------------------------------------------------------------------ */
    /*  SUMMARY TOTALS — lets us skip page loads entirely                  */
    /* ------------------------------------------------------------------ */
    // Reads the "Totals:" row of the Timesheet Summary into { '08/17': 8, ... }
    // Returns null if the table can't be parsed, in which case nothing is skipped.
    const summaryDayTotals = memo(function () {
        const docs = allDocs();
        for (let d = 0; d < docs.length; d++) {
            let tables;
            try { tables = docs[d].querySelectorAll('table'); } catch (e) { continue; }
            for (let t = 0; t < tables.length; t++) {
                const table = tables[t];
                if ((table.textContent || '').indexOf('Timesheet Summary') === -1) continue;
                const rows = table.rows;
                if (!rows || !rows.length) continue;

                // Locate the header row that carries the dates, mapping date -> column.
                let colMap = null;
                for (let i = 0; i < rows.length && !colMap; i++) {
                    const cells = rows[i].cells || [];
                    const map = {};
                    let count = 0;
                    for (let j = 0; j < cells.length; j++) {
                        const dt = extractDate(clean(cells[j]));
                        if (dt) { map[pad(dt.mm) + '/' + pad(dt.dd)] = j; count++; }
                    }
                    if (count >= 5) colMap = map;
                }
                if (!colMap) continue;

                for (let i = 0; i < rows.length; i++) {
                    const first = clean(rows[i].cells && rows[i].cells[0]).toLowerCase();
                    if (first.indexOf('total') !== 0) continue;
                    const out = {};
                    Object.keys(colMap).forEach(key => {
                        const cell = rows[i].cells[colMap[key]];
                        const v = parseFloat(clean(cell));
                        out[key] = isNaN(v) ? 0 : v;
                    });
                    return out;
                }
            }
        }
        return null;
    }, C.summaryMemoMs);

    function fillTargets() {
        const today = new Date(); today.setHours(23, 59, 59, 999);
        const totals = OPTIONS.skipDaysAlreadyMatching ? summaryDayTotals() : null;
        return dateLinks().filter(d => {
            const spec = specForDate(d.date, d.dow);
            if (!spec) return false;
            if (OPTIONS.skipFutureDates && d.when > today) return false;
            if (totals && Math.abs((totals[d.date] || 0) - spec.hours) < 0.005) return false;
            return true;
        });
    }

    function clearTargets() {
        const totals = OPTIONS.clearOnlyDaysWithHours ? summaryDayTotals() : null;
        return dateLinks().filter(d => {
            if (!OPTIONS.clearWeekends && (d.dow === 0 || d.dow === 6)) return false;
            if (totals && Object.prototype.hasOwnProperty.call(totals, d.date) && !(totals[d.date] > 0)) return false;
            return true;
        });
    }

    function currentDay() {
        const m = allText().match(/Worked Hours on\s+\w+\s+(\d{1,2})\/(\d{1,2})/);
        return m ? pad(+m[1]) + '/' + pad(+m[2]) : null;
    }

    /* ------------------------------------------------------------------ */
    /*  SELECT HELPERS                                                     */
    /* ------------------------------------------------------------------ */
    function fire(el) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function pick(sel, test) {
        if (!sel) return { found: false, changed: false };
        const cur = sel.options[sel.selectedIndex];
        if (cur && test(cur)) return { found: true, changed: false };
        for (let i = 0; i < sel.options.length; i++) {
            if (test(sel.options[i])) { sel.selectedIndex = i; fire(sel); return { found: true, changed: true }; }
        }
        return { found: false, changed: false };
    }

    function anyOf(list) {
        const set = list.map(normOpt);
        return o => set.indexOf(normOpt(o.text)) !== -1 || set.indexOf(normOpt(o.value)) !== -1;
    }

    function classify(sel) {
        const txt = Array.from(sel.options).map(o => o.text || '').join('|');
        if (/POS#|Position ID/i.test(txt)) return 'position';
        if (/Pay Code|Hours Worked/i.test(txt)) return 'paycode';
        return 'other';
    }

    /* ------------------------------------------------------------------ */
    /*  ROW DISCOVERY                                                      */
    /* ------------------------------------------------------------------ */
    function findRow() {
        const docs = allDocs();
        for (let d = 0; d < docs.length; d++) {
            let rows;
            try { rows = docs[d].querySelectorAll('tr'); } catch (e) { continue; }
            for (let i = 0; i < rows.length; i++) {
                if (rows[i].querySelectorAll('select').length >= 7) return rows[i];
            }
        }
        return null;
    }

    function entryTable() {
        const r = findRow();
        return r && r.closest ? r.closest('table') : null;
    }

    function entryRows(table) {
        if (!table) return [];
        return Array.prototype.filter.call(table.querySelectorAll('tr'),
            r => r.querySelectorAll('select').length >= 7);
    }

    function rowHasData(row) {
        const s = row.querySelectorAll('select');
        for (let i = 0; i < 6 && i < s.length; i++) {
            if (s[i].selectedIndex > 0) {
                const o = s[i].options[s[i].selectedIndex];
                if (o && (o.text || '').trim() !== '') return true;
            }
        }
        const inputs = row.querySelectorAll('input[type="text"], input:not([type])');
        for (let i = 0; i < inputs.length; i++) {
            if (parseFloat(inputs[i].value) > 0) return true;
        }
        for (let i = 0; i < s.length; i++) {
            if (classify(s[i]) === 'position') {
                const o = s[i].options[s[i].selectedIndex];
                if (o && /POS#/i.test(o.text || '')) return true;
            }
        }
        return false;
    }

    /* ------------------------------------------------------------------ */
    /*  DELETE / CLEAR                                                     */
    /* ------------------------------------------------------------------ */
    function deleteColIndex(table) {
        const rows = table.rows || [];
        for (let i = 0; i < Math.min(4, rows.length); i++) {
            const cells = rows[i].cells || [];
            for (let j = 0; j < cells.length; j++) {
                if (clean(cells[j]).toLowerCase() === 'delete') return j;
            }
        }
        return -1;
    }

    function deleteCheckbox(row, colIdx) {
        if (colIdx >= 0 && row.cells && row.cells[colIdx]) {
            const cb = row.cells[colIdx].querySelector('input[type="checkbox"]');
            if (cb) return cb;
        }
        const boxes = row.querySelectorAll('input[type="checkbox"]');
        return boxes.length ? boxes[boxes.length - 1] : null;
    }

    function deleteButton(table) {
        const cands = table.querySelectorAll('input[type="button"], input[type="submit"], button, a');
        for (let i = 0; i < cands.length; i++) {
            const el = cands[i];
            const label = (el.value || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (label === 'delete') return el;
        }
        return null;
    }

    function clearDay() {
        const table = entryTable();
        if (!table) return 0;

        const colIdx = deleteColIndex(table);
        const rows = entryRows(table).filter(rowHasData);
        let n = 0;

        rows.forEach(row => {
            const cb = deleteCheckbox(row, colIdx);
            if (!cb || cb.disabled) return;
            if (!cb.checked) {
                cb.checked = true;
                cb.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                cb.checked = true;
                cb.dispatchEvent(new Event('change', { bubbles: true }));
            }
            n++;
        });

        if (!n) return 0;

        const btn = deleteButton(table);
        if (!btn) { console.warn(LOG, 'Delete button not found'); return 0; }
        dlog('deleting', n, 'row(s)');
        btn.click();
        if (OPTIONS.saveAfterDelete) setTimeout(clickSave, 400);
        return n;
    }

    /* ------------------------------------------------------------------ */
    /*  FILL                                                               */
    /* ------------------------------------------------------------------ */
    function applyRow(row, spec) {
        const s = Array.from(row.querySelectorAll('select'));
        if (s.length < 7) return { complete: false, changed: false };

        let complete = true, changed = false;
        const wanted = [spec.inHour, spec.inMin, spec.inMer, spec.outHour, spec.outMin, spec.outMer, spec.meal];

        for (let i = 0; i < 7; i++) {
            const r = pick(s[i], anyOf(wanted[i]));
            if (!r.found) complete = false;
            if (r.changed) changed = true;
        }

        for (let j = 7; j < s.length; j++) {
            const kind = classify(s[j]);
            if (kind === 'position') {
                let r = pick(s[j], o => /POS#/i.test(o.text || ''));
                if (!r.found && s[j].options.length > 1 && s[j].selectedIndex < 1) {
                    s[j].selectedIndex = 1; fire(s[j]); r = { found: true, changed: true };
                }
                if (!r.found) complete = false;
                if (r.changed) changed = true;
            } else if (kind === 'paycode') {
                const r = pick(s[j], o => (o.text || '').indexOf(C.payCode) !== -1);
                if (!r.found) complete = false;
                if (r.changed) changed = true;
            }
        }
        return { complete, changed };
    }

    // done(ok, alreadyCorrect)
    function fillAndSave(spec, done) {
        if (!findRow()) { done(false, false); return; }
        const t0 = Date.now();
        let stable = 0, elapsed = 0, first = true;

        (function tick() {
            const row = findRow();
            if (!row) { done(false, false); return; }
            const r = applyRow(row, spec);

            if (first && r.complete && !r.changed) {
                dlog('row already correct, skipping save');
                done(true, true);
                return;
            }
            first = false;

            stable = (r.complete && !r.changed) ? stable + 1 : 0;
            if (stable >= C.stableTicks || elapsed >= C.maxFillMs) {
                dlog('fill settled in', Date.now() - t0, 'ms');
                clickSave();
                done(true, false);
                return;
            }
            elapsed += C.pollMs;
            setTimeout(tick, C.pollMs);
        })();
    }

    function findSave() {
        const sel = '[title="Save" i], img[alt="Save" i], img[src*="save" i], a[title="Save" i], ' +
            'input[value="Save" i], input[type="image"][src*="save" i]';
        const docs = allDocs();
        for (let i = 0; i < docs.length; i++) {
            let btn;
            try { btn = docs[i].querySelector(sel); } catch (e) { continue; }
            if (btn) return btn;
        }
        return null;
    }

    function clickSave() {
        const btn = findSave();
        if (!btn) { console.warn(LOG, 'Save button not found'); return false; }
        const anchor = btn.closest ? btn.closest('a') : null;
        (anchor || btn).click();
        return true;
    }

    /* ------------------------------------------------------------------ */
    /*  STATE MACHINE                                                      */
    /* ------------------------------------------------------------------ */
    function armWatchdog() {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => { acted = false; }, C.settleMs);
    }
    window.addEventListener('beforeunload', () => clearTimeout(watchdog));
    window.addEventListener('pagehide', () => clearTimeout(watchdog));

    function finishRun(mode, count) {
        const t0 = parseInt(store().getItem(K.t0) || '0', 10);
        const secs = t0 ? ((Date.now() - t0) / 1000).toFixed(1) : '?';
        stopAutomation('');
        alert((mode === 'clear' ? '🧹 Cleared ' : '🎉 Filled and saved ') + count +
            ' day(s) in ' + secs + 's.');
    }

    function runMachine() {
        if (!isActive() || acted) return;
        if (!uiInjected) { checkFrame(); if (!uiInjected) return; }

        const mode = getMode();
        const queue = getQueue();
        const pos = getPos();

        if (pos >= queue.length) { finishRun(mode, queue.length); return; }

        const target = queue[pos];
        setStatus((mode === 'clear' ? 'Clearing ' : '') + target + '  (' + (pos + 1) + '/' + queue.length + ')');

        if (currentDay() === target) {
            if (stepStart) dlog('day', target, 'ready after', Date.now() - stepStart, 'ms');
            blindTicks = 0;
            acted = true;
            setPos(pos + 1);
            stepStart = Date.now();

            if (mode === 'clear') {
                const n = clearDay();
                if (n === 0) acted = false;      // nothing here: advance with no page load
                else armWatchdog();
                return;
            }

            const link = dateLinks().find(x => x.date === target);
            const spec = specForDate(target, link ? link.dow : new Date().getDay());
            if (!spec) { acted = false; return; }

            fillAndSave(spec, (ok, already) => {
                if (!ok) { stopAutomation(''); alert('Stopped: no entry row on ' + target + '.\n\n' + diagnostics()); return; }
                if (already) acted = false;      // no save fired, so no reload is coming
                else armWatchdog();
            });
            return;
        }

        const t = dateLinks().find(x => x.date === target);
        if (!t) {
            if (++blindTicks > C.maxBlindTicks) {
                stopAutomation('');
                alert('Stopped: no link for ' + target + '.\n\n' + diagnostics());
            }
            return;
        }
        blindTicks = 0;
        acted = true;
        stepStart = Date.now();
        t.el.click();
        armWatchdog();
    }

    /* ------------------------------------------------------------------ */
    /*  DIAGNOSTICS                                                        */
    /* ------------------------------------------------------------------ */
    function diagnostics() {
        const links = dateLinks();
        const hint = yearHint();
        const table = entryTable();
        const totals = summaryDayTotals();
        const lines = [
            'Frames reachable: ' + allDocs().length,
            'Year hint: ' + (hint ? (hint.name || '?') + ' ' + hint.month + '/' + hint.day + '/' + hint.year : 'none'),
            'Current day open: ' + (currentDay() || 'none'),
            'Summary totals parsed: ' + (totals ? 'yes' : 'no'),
            'Date links found: ' + links.length,
            links.map(l => {
                const sp = specForDate(l.date, l.dow);
                const tot = totals && totals[l.date] != null ? totals[l.date].toFixed(2) + 'h now' : '';
                return '  ' + l.date + ' ' + DOW[l.dow] + '  ' + (sp ? sp.label : '(skipped)') + '  ' + tot;
            }).join('\n'),
            'Fill queue: ' + fillTargets().map(t => t.date).join(', '),
            'Clear queue: ' + clearTargets().map(t => t.date).join(', '),
            'Entry row found: ' + (findRow() ? 'yes' : 'no'),
            'Save button found: ' + (findSave() ? 'yes' : 'no'),
            'Delete column index: ' + (table ? deleteColIndex(table) : 'n/a'),
            'Delete button found: ' + (table && deleteButton(table) ? 'yes' : 'no'),
            'Populated rows here: ' + (table ? entryRows(table).filter(rowHasData).length : 'n/a')
        ];
        return lines.filter(Boolean).join('\n');
    }

    /* ------------------------------------------------------------------ */
    /*  UI                                                                 */
    /* ------------------------------------------------------------------ */
    function styleBtn(b, bg) {
        b.style.cssText = 'background:' + bg + ';color:#fff;border:none;padding:10px 18px;cursor:pointer;' +
            'font-weight:bold;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.5);font-family:sans-serif;';
    }
    function setStatus(txt) {
        const el = document.getElementById('eco-status');
        if (el) { el.textContent = txt; el.style.display = txt ? 'block' : 'none'; }
    }
    function refreshUI() {
        const stop = document.getElementById('eco-stop-btn');
        if (stop) stop.style.display = isActive() ? 'block' : 'none';
        const dbg = document.getElementById('eco-debug-btn');
        if (dbg) dbg.style.display = devOn() ? 'block' : 'none';
    }

    function createUI() {
        const box = document.createElement('div');
        box.id = 'eco-btn-container';
        box.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:999999;display:flex;' +
            'flex-direction:column;gap:8px;align-items:stretch;';

        const status = document.createElement('div');
        status.id = 'eco-status';
        status.style.cssText = 'background:#222;color:#0f0;padding:6px 10px;border-radius:6px;' +
            'font:12px monospace;display:none;text-align:center;';

        const btnDay = document.createElement('button');
        btnDay.innerText = '✨ Autofill DAY (Ctrl+Shift+Z)';
        styleBtn(btnDay, '#0066cc');
        btnDay.addEventListener('click', e => { e.preventDefault(); singleDay(); });

        const btnWeek = document.createElement('button');
        btnWeek.innerText = '🚀 Autofill FULL PAY PERIOD';
        styleBtn(btnWeek, '#28a745');
        btnWeek.addEventListener('click', e => {
            e.preventDefault();
            const targets = fillTargets();
            dlog('\n' + diagnostics());
            if (!targets.length) {
                alert('Nothing to fill. Check your SCHEDULE at the top of the script.\n\n' + diagnostics());
                return;
            }
            const list = targets.map(t => '  ' + t.date + ' ' + DOW[t.dow] + '   ' + specForDate(t.date, t.dow).label).join('\n');
            if (!confirm('Fill and save these ' + targets.length + ' days?\n\n' + list +
                '\n\nExisting entries on these days will be overwritten.')) return;
            startRun('fill', targets.map(t => t.date));
        });

        const btnClearDay = document.createElement('button');
        btnClearDay.innerText = '🗑 Clear DAY (Ctrl+Shift+X)';
        styleBtn(btnClearDay, '#fd7e14');
        btnClearDay.addEventListener('click', e => { e.preventDefault(); clearSingleDay(); });

        const btnClearAll = document.createElement('button');
        btnClearAll.innerText = '🗑 Clear FULL PAY PERIOD';
        styleBtn(btnClearAll, '#a71d2a');
        btnClearAll.addEventListener('click', e => {
            e.preventDefault();
            const targets = clearTargets();
            if (!targets.length) {
                alert('Nothing to clear — every day already reads 0.00.\n\n' + diagnostics());
                return;
            }
            if (!confirm('DELETE every worked-hours entry on these ' + targets.length + ' days?\n\n' +
                targets.map(t => t.date + ' ' + DOW[t.dow]).join(', ') +
                '\n\nThis cannot be undone.')) return;
            startRun('clear', targets.map(t => t.date));
        });

        const btnStop = document.createElement('button');
        btnStop.id = 'eco-stop-btn';
        btnStop.innerText = '🛑 STOP Automation';
        styleBtn(btnStop, '#dc3545');
        btnStop.style.display = 'none';
        btnStop.addEventListener('click', e => {
            e.preventDefault();
            stopAutomation('Aborted.');
            setTimeout(() => setStatus(''), 2000);
        });

        const btnDebug = document.createElement('button');
        btnDebug.id = 'eco-debug-btn';
        btnDebug.innerText = '🔍 Debug';
        styleBtn(btnDebug, '#6c757d');
        btnDebug.style.padding = '6px 12px';
        btnDebug.style.display = 'none';
        btnDebug.addEventListener('click', e => {
            e.preventDefault();
            const d = diagnostics();
            console.log(LOG + '\n' + d);
            alert(d);
        });

        [status, btnDay, btnWeek, btnClearDay, btnClearAll, btnStop, btnDebug].forEach(el => box.appendChild(el));
        document.body.appendChild(box);
        refreshUI();
    }

    function singleDay() {
        const date = currentDay();
        const link = date ? dateLinks().find(x => x.date === date) : null;
        const dow = link ? link.dow : new Date().getDay();
        const spec = specForDate(date, dow) || compileSpec(SCHEDULE.Mon) ||
            compileSpec({ in: '8:30 AM', out: '5:00 PM', meal: 30 });

        setStatus('Filling ' + spec.label);
        fillAndSave(spec, ok => {
            if (!ok) { setStatus(''); alert('Could not map the dropdowns.\n\n' + diagnostics()); }
            else setStatus('Saved.');
            setTimeout(() => setStatus(''), 1500);
        });
    }

    function clearSingleDay() {
        const table = entryTable();
        if (!table) { alert('No entry table found. Open a specific day first.'); return; }
        const n = entryRows(table).filter(rowHasData).length;
        if (!n) { setStatus('Nothing to clear.'); setTimeout(() => setStatus(''), 1500); return; }
        if (!confirm('Delete ' + n + ' entry row(s) on ' + (currentDay() || 'this day') + '?')) return;
        setStatus('Deleting ' + n + ' row(s)…');
        clearDay();
    }

    function checkFrame() {
        if (isTimesheetDoc()) {
            if (!uiInjected && document.body) { createUI(); uiInjected = true; }
            refreshUI();
        } else if (uiInjected) {
            const c = document.getElementById('eco-btn-container');
            if (c) c.remove();
            uiInjected = false;
        }
    }

    /* ------------------------------------------------------------------ */
    /*  BOOT — engage as early as the DOM allows                           */
    /* ------------------------------------------------------------------ */
    function fastTick() {
        if (!uiInjected) checkFrame();
        runMachine();
    }

    setInterval(fastTick, C.tickMs);
    setInterval(checkFrame, 1500);
    document.addEventListener('readystatechange', fastTick);   // fires at 'interactive'
    document.addEventListener('DOMContentLoaded', fastTick);
    window.addEventListener('load', fastTick);
    fastTick();

    window.ecoDev = function (on) {
        try { localStorage.setItem(K.dev, on ? '1' : '0'); } catch (e) { }
        refreshUI();
        return 'Ecotime dev mode ' + (on ? 'ON' : 'OFF');
    };

    window.addEventListener('keydown', e => {
        if (!e.ctrlKey || !e.shiftKey) return;
        const k = String(e.key).toLowerCase();
        if (k === 'z') { e.preventDefault(); singleDay(); }
        if (k === 'x') { e.preventDefault(); clearSingleDay(); }
        if (k === 'd') { e.preventDefault(); console.log(window.ecoDev(!devOn())); }
    });
})();
