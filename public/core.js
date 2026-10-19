/* Time Tracker core: schema, durations, rounding, money, weekly totals, CSV and invoice lines.
   No DOM, no dependencies. Works in the browser (window.TTCore) and in Node (require) for the tests.

   Times are stored as epoch milliseconds. Days ("YYYY-MM-DD") are the user's local calendar days; an entry
   belongs to the day it started on. Money is computed exactly the way the HMSK Invoice tool does it:
   hours are rounded to 2 decimals per invoice line, then hours × rate is rounded to cents. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TTCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA = 1;
  const MIN = 60000;
  const DAY_MS = 86400000;
  const ROUNDING = [0, 1, 5, 6, 10, 15, 30, 60]; // minutes; 0 = exact
  const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'PLN', 'PKR', 'AED']; // the ones the Invoice tool offers

  // ---------- dates (local calendar) ----------
  const pad = n => String(n).padStart(2, '0');
  function keyOf(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function dayKey(ms) { const d = new Date(ms); return keyOf(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  function isKey(k) {
    if (typeof k !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(k)) return false;
    const [y, m, d] = parts(k);
    return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function parts(k) { return [Number(k.slice(0, 4)), Number(k.slice(5, 7)), Number(k.slice(8, 10))]; }
  function dayNum(k) { const [y, m, d] = parts(k); return Math.round(Date.UTC(y, m - 1, d) / DAY_MS); }
  function addDays(k, n) { const d = new Date((dayNum(k) + n) * DAY_MS); return keyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  /** ISO weekday, Monday = 1 ... Sunday = 7. */
  function weekday(k) { const w = new Date(dayNum(k) * DAY_MS).getUTCDay(); return w === 0 ? 7 : w; }
  function weekStart(k) { return addDays(k, 1 - weekday(k)); }
  /** ISO 8601 week number. */
  function isoWeek(k) {
    const thu = addDays(k, 4 - weekday(k));
    return Math.floor((dayNum(thu) - dayNum(thu.slice(0, 4) + '-01-01')) / 7) + 1;
  }
  /** Local time "HH:MM" on day k → epoch ms (DST-safe: built from local parts). */
  function at(k, hhmm) {
    const [y, m, d] = parts(k);
    const [h, mi] = String(hhmm || '00:00').split(':').map(Number);
    return new Date(y, m - 1, d, h || 0, mi || 0, 0, 0).getTime();
  }
  function hhmm(ms) { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  // ---------- durations ----------
  /** Whole minutes of an entry (a running entry counts up to `now`). Seconds are dropped. */
  function minutesOf(e, now) {
    const end = e.end == null ? (now == null ? Date.now() : now) : e.end;
    return Math.max(0, Math.floor((end - e.start) / MIN));
  }
  /** Round minutes up to the next step (billing convention: started blocks count). step 0 = exact. */
  function roundUp(min, step) {
    if (!step || step <= 1) return min;
    return Math.ceil(min / step) * step;
  }
  function billedMinutes(e, step, now) { return roundUp(minutesOf(e, now), step); }
  /** Parse a typed duration: "1:30", "1.5", "1,5", "90m", "2h", "1h 15m". A plain number is hours. */
  function parseDuration(s) {
    s = String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s) return null;
    let m;
    if ((m = s.match(/^(\d+):([0-5]\d)$/))) return Number(m[1]) * 60 + Number(m[2]);
    if ((m = s.match(/^(?:(\d+(?:[.,]\d+)?) ?h)? ?(?:(\d+) ?(?:m|min))?$/)) && (m[1] || m[2])) {
      return Math.round(Number((m[1] || '0').replace(',', '.')) * 60) + Number(m[2] || 0);
    }
    if ((m = s.match(/^\d+(?:[.,]\d+)?$/))) return Math.round(Number(s.replace(',', '.')) * 60); // plain number = hours
    return null;
  }
  /** 95 → "1:35" */
  function fmtMin(min) { return Math.floor(min / 60) + ':' + pad(min % 60); }
  /** Seconds-precise running clock "1:02:03". */
  function fmtClock(ms) { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 3600) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); }

  // ---------- money (same rounding as Invoice) ----------
  const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
  /** Minutes → invoice quantity in hours, 2 decimals (what Invoice shows and multiplies). */
  function hoursQty(min) { return round2(min / 60); }
  /** Net amount of one invoice line: round2(qty × price). */
  function lineAmount(qty, rate) { return round2(qty * (Number(rate) || 0)); }

  // ---------- state ----------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function emptyState() {
    return { v: SCHEMA, settings: { lang: null, currency: 'EUR', rounding: 0, groupBy: 'project' }, projects: [], entries: [], meta: { useDays: [], exports: 0, emailOfferHidden: false } };
  }
  function num(x, d) { const n = Number(x); return Number.isFinite(n) ? n : d; }
  /** Validate and normalise stored or imported data. Throws on data that is not a time tracker backup. */
  function migrate(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries) || !Array.isArray(raw.projects)) throw new Error('not a time tracker backup');
    if (num(raw.v, 0) > SCHEMA) throw new Error('backup is from a newer version');
    const s = emptyState();
    Object.assign(s.settings, raw.settings || {});
    if (!CURRENCIES.includes(s.settings.currency)) s.settings.currency = 'EUR';
    if (!ROUNDING.includes(Number(s.settings.rounding))) s.settings.rounding = 0;
    s.settings.rounding = Number(s.settings.rounding);
    if (!['project', 'day', 'entry'].includes(s.settings.groupBy)) s.settings.groupBy = 'project';
    s.projects = raw.projects.filter(p => p && p.id).map(p => ({
      id: String(p.id), name: String(p.name || '').slice(0, 120), client: String(p.client || '').slice(0, 120),
      rate: Math.max(0, num(p.rate, 0)), archived: !!p.archived,
    }));
    const ids = new Set(s.projects.map(p => p.id));
    s.entries = raw.entries.filter(e => e && e.id && Number.isFinite(Number(e.start))).map(e => ({
      id: String(e.id), projectId: ids.has(String(e.projectId)) ? String(e.projectId) : '',
      desc: String(e.desc || '').slice(0, 500), start: Number(e.start),
      end: e.end == null ? null : Math.max(Number(e.start), num(e.end, Number(e.start))), billed: !!e.billed,
    }));
    // at most one running entry
    let running = false;
    for (const e of s.entries.sort((a, b) => b.start - a.start)) { if (e.end == null) { if (running) e.end = e.start; running = true; } }
    Object.assign(s.meta, raw.meta || {});
    if (!Array.isArray(s.meta.useDays)) s.meta.useDays = [];
    return s;
  }

  const project = (s, id) => s.projects.find(p => p.id === id) || null;
  const running = s => s.entries.find(e => e.end == null) || null;
  function addProject(s, p) {
    const np = { id: uid(), name: String(p.name || '').trim(), client: String(p.client || '').trim(), rate: Math.max(0, num(p.rate, 0)), archived: false };
    s.projects.push(np); return np;
  }
  /** Start a timer; a running one is stopped at the same moment. */
  function start(s, projectId, desc, now) {
    stop(s, now);
    const e = { id: uid(), projectId: projectId || '', desc: String(desc || ''), start: now, end: null, billed: false };
    s.entries.push(e); return e;
  }
  function stop(s, now) {
    const r = running(s);
    if (!r) return null;
    r.end = Math.max(r.start, now);
    return r;
  }
  /** Manual entry from a day, a start time and either an end time or a duration in minutes.
      An end time earlier than the start means the next day (night work). */
  function manualTimes(day, from, to, durMin) {
    const s = at(day, from || '09:00');
    if (durMin != null) return { start: s, end: s + durMin * MIN };
    let e = at(day, to);
    if (e < s) e = at(addDays(day, 1), to);
    return { start: s, end: e };
  }
  function markUse(s, today) {
    if (!s.meta.useDays.includes(today)) s.meta.useDays.push(today);
    if (s.meta.useDays.length > 60) s.meta.useDays = s.meta.useDays.slice(-60);
  }

  // ---------- queries ----------
  function filter(s, f, now) {
    f = f || {};
    return s.entries.filter(e => {
      const d = dayKey(e.start);
      if (f.from && d < f.from) return false;
      if (f.to && d > f.to) return false;
      if (f.projectId && e.projectId !== f.projectId) return false;
      if (f.client != null && f.client !== '' && (project(s, e.projectId) || {}).client !== f.client) return false;
      if (f.unbilled && e.billed) return false;
      if (f.done && e.end == null) return false;
      return true;
    }).sort((a, b) => b.start - a.start);
  }
  /** Week grid: rows per project, minutes per day (Mon..Sun), row and column totals (rounded minutes). */
  function week(s, mondayKey, step, now) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(mondayKey, i));
    const rows = new Map();
    const col = days.map(() => 0);
    for (const e of s.entries) {
      const i = days.indexOf(dayKey(e.start));
      if (i < 0) continue;
      const m = billedMinutes(e, step, now);
      if (!rows.has(e.projectId)) rows.set(e.projectId, days.map(() => 0));
      rows.get(e.projectId)[i] += m;
      col[i] += m;
    }
    const out = [...rows.entries()].map(([pid, mins]) => {
      const p = project(s, pid);
      return { projectId: pid, name: p ? p.name : '', client: p ? p.client : '', rate: p ? p.rate : 0, mins, total: mins.reduce((a, b) => a + b, 0) };
    }).sort((a, b) => b.total - a.total);
    return { days, rows: out, col, total: col.reduce((a, b) => a + b, 0) };
  }

  // ---------- invoice lines ----------
  function dateRange(keys, lang) {
    const f = k => { const [y, m, d] = parts(k); return lang === 'de' ? `${pad(d)}.${pad(m)}.${y}` : k; };
    const sorted = [...new Set(keys)].sort();
    if (!sorted.length) return '';
    return sorted.length === 1 ? f(sorted[0]) : f(sorted[0]) + (lang === 'de' ? ' bis ' : ' to ') + f(sorted[sorted.length - 1]);
  }
  /** Turn entries into invoice line items {desc, details, qty (h, 2 dp), unit 'h', price, amount}.
      groupBy 'project': one line per project (rate) · 'day': one per project and day · 'entry': one per entry.
      Rounding is applied per entry before summing, so the totals match the entries list. */
  function invoiceLines(s, entries, opts) {
    const o = Object.assign({ groupBy: 'project', step: 0, lang: 'en', now: Date.now() }, opts || {});
    const groups = new Map();
    for (const e of [...entries].filter(x => x.end != null).sort((a, b) => a.start - b.start)) {
      const day = dayKey(e.start);
      const key = o.groupBy === 'entry' ? e.id : o.groupBy === 'day' ? e.projectId + '|' + day : e.projectId;
      if (!groups.has(key)) groups.set(key, { projectId: e.projectId, mins: 0, days: [], descs: [] });
      const g = groups.get(key);
      g.mins += billedMinutes(e, o.step, o.now);
      g.days.push(day);
      if (e.desc && !g.descs.includes(e.desc)) g.descs.push(e.desc);
    }
    const noProject = o.lang === 'de' ? 'Arbeitszeit' : 'Work';
    return [...groups.values()].filter(g => g.mins > 0).map(g => {
      const p = project(s, g.projectId);
      const qty = hoursQty(g.mins);
      const rate = p ? p.rate : 0;
      const range = dateRange(g.days, o.lang);
      const title = p && p.name ? p.name : noProject;
      const desc = o.groupBy === 'entry' && g.descs[0] ? `${title}: ${g.descs[0]}` : title;
      const details = [range, o.groupBy === 'entry' ? '' : g.descs.join('; ')].filter(Boolean).join(' · ').slice(0, 1000);
      return { desc, details, qty, unit: 'h', price: rate, amount: lineAmount(qty, rate), minutes: g.mins, client: p ? p.client : '' };
    });
  }
  /** The payload the Invoice tool reads from localStorage['invoice-import'] (see its README). */
  function invoicePayload(s, lines) {
    const clients = [...new Set(lines.map(l => l.client).filter(Boolean))];
    return {
      source: 'time tracker', currency: s.settings.currency,
      recipientName: clients.length === 1 ? clients[0] : '',
      lines: lines.map(l => ({ desc: l.desc, details: l.details, qty: l.qty, unit: 'h', price: l.price })),
    };
  }
  const sum = (arr, k) => round2(arr.reduce((a, x) => a + x[k], 0));

  // ---------- CSV ----------
  /** One cell: quoted when needed, and leading = + - @ neutralised so spreadsheets do not run it as a formula. */
  function csvCell(v, sep) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
    return (s.includes(sep) || /["\n\r]/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(s, entries, opts) {
    const o = Object.assign({ lang: 'en', step: 0, now: Date.now() }, opts || {});
    const de = o.lang === 'de', sep = de ? ';' : ',';
    const n = x => de ? String(x).replace('.', ',') : String(x);
    const head = de
      ? ['Datum', 'Beginn', 'Ende', 'Minuten', 'Stunden', 'Projekt', 'Kunde', 'Beschreibung', 'Stundensatz', 'Betrag', 'Währung', 'Abgerechnet']
      : ['Date', 'Start', 'End', 'Minutes', 'Hours', 'Project', 'Client', 'Description', 'Rate', 'Amount', 'Currency', 'Billed'];
    const rows = [...entries].sort((a, b) => a.start - b.start).map(e => {
      const p = project(s, e.projectId) || { name: '', client: '', rate: 0 };
      const m = billedMinutes(e, o.step, o.now), q = hoursQty(m);
      return [dayKey(e.start), hhmm(e.start), e.end == null ? '' : hhmm(e.end), m, n(q.toFixed(2)), p.name, p.client, e.desc,
        n(Number(p.rate).toFixed(2)), n(lineAmount(q, p.rate).toFixed(2)), s.settings.currency, e.billed ? (de ? 'ja' : 'yes') : (de ? 'nein' : 'no')];
    });
    return '﻿' + [head, ...rows].map(r => r.map(c => csvCell(c, sep)).join(sep)).join('\r\n') + '\r\n';
  }

  // ---------- demo ----------
  function demoState(today, lang, nowMs) {
    const s = emptyState();
    const de = lang === 'de';
    const a = addProject(s, { name: de ? 'Website-Relaunch' : 'Website relaunch', client: 'Nordlicht GmbH', rate: 85 });
    const b = addProject(s, { name: de ? 'SEO-Beratung' : 'SEO consulting', client: 'Café Mira', rate: 70 });
    const c = addProject(s, { name: de ? 'Wartung' : 'Maintenance', client: 'Nordlicht GmbH', rate: 60 });
    const tasks = {
      [a.id]: de ? ['Startseite umsetzen', 'Abstimmung mit Kunde', 'Kontaktformular'] : ['Build home page', 'Client call', 'Contact form'],
      [b.id]: de ? ['Keyword-Analyse', 'Audit-Bericht'] : ['Keyword research', 'Audit report'],
      [c.id]: de ? ['Updates und Backups'] : ['Updates and backups'],
    };
    const mon = weekStart(today);
    let i = 0;
    for (let d = -7; d < 7; d++) {
      const k = addDays(mon, d);
      if (k > today || weekday(k) > 5) continue;
      for (const [pid, from, mins] of [[a.id, '09:00', 150 + (i % 3) * 25], [i % 2 ? b.id : c.id, '13:30', 75 + (i % 4) * 20]]) {
        const run = k === today && from === '13:30';
        const st = run && nowMs ? nowMs - 47 * MIN : at(k, from); // the running timer started 47 minutes ago
        s.entries.push({ id: uid(), projectId: pid, desc: tasks[pid][i % tasks[pid].length], start: st, end: run ? null : st + mins * MIN, billed: d < 0 && pid === c.id });
        i++;
      }
    }
    return s;
  }

  // ---------- self-test (runs in the page; tests/ run the same cases in Node) ----------
  function selfTest() {
    const fails = [];
    let n = 0;
    const eq = (name, a, b) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) fails.push(`${name}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
    eq('roundUp 6', roundUp(7, 6), 12); eq('roundUp 15', roundUp(15, 15), 15); eq('roundUp exact', roundUp(7, 0), 7);
    eq('hoursQty 20min', hoursQty(20), 0.33); eq('hoursQty 90min', hoursQty(90), 1.5);
    eq('lineAmount', lineAmount(0.33, 100), 33); eq('lineAmount cents', lineAmount(1.17, 85), 99.45);
    eq('parse 1:30', parseDuration('1:30'), 90); eq('parse 1,5', parseDuration('1,5'), 90); eq('parse 1h 15m', parseDuration('1h 15m'), 75); eq('parse 45m', parseDuration('45m'), 45);
    eq('minutes', minutesOf({ start: 0, end: 125 * 1000 * 60 + 59000 }), 125);
    eq('csv formula', csvCell('=SUM(A1)', ','), "'=SUM(A1)"); eq('csv quote', csvCell('a,"b"', ','), '"a,""b"""');
    const s = emptyState(); const p = addProject(s, { name: 'P', client: 'C', rate: 90 });
    const e1 = { id: 'a', projectId: p.id, desc: 'x', start: at('2026-10-19', '09:00'), end: at('2026-10-19', '09:20'), billed: false };
    const e2 = { id: 'b', projectId: p.id, desc: 'y', start: at('2026-10-20', '10:00'), end: at('2026-10-20', '11:07'), billed: false };
    s.entries.push(e1, e2);
    const L = invoiceLines(s, [e1, e2], { step: 15 });
    eq('lines grouped', L.length, 1); eq('lines qty', L[0].qty, 1.75); eq('lines amount', L[0].amount, 157.5);
    eq('week total', week(s, '2026-10-19', 0).total, 87);
    return { n, fails };
  }

  return {
    SCHEMA, ROUNDING, CURRENCIES, keyOf, dayKey, isKey, parts, addDays, weekday, weekStart, isoWeek, at, hhmm,
    minutesOf, roundUp, billedMinutes, parseDuration, fmtMin, fmtClock, round2, hoursQty, lineAmount,
    uid, emptyState, migrate, project, running, addProject, start, stop, manualTimes, markUse,
    filter, week, dateRange, invoiceLines, invoicePayload, sum, csvCell, toCsv, demoState, selfTest,
  };
});
