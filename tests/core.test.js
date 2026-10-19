// Run: node --test tests/
process.env.TZ = 'Europe/Berlin'; // DST ends 2026-10-25 (25 h day)
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/core.js');

const MIN = 60000;
function setup() {
  const s = C.emptyState();
  const a = C.addProject(s, { name: 'Site', client: 'ACME', rate: 85 });
  const b = C.addProject(s, { name: 'SEO', client: 'Mira', rate: 70 });
  return { s, a, b };
}
const entry = (s, pid, day, from, to, desc = '') => {
  const t = C.manualTimes(day, from, to);
  const e = { id: C.uid(), projectId: pid, desc, start: t.start, end: t.end, billed: false };
  s.entries.push(e); return e;
};

test('in-page self-test passes', () => {
  const r = C.selfTest();
  assert.deepEqual(r.fails, []);
  assert.equal(r.n, 18);
});

test('dates: local day keys, ISO weeks, Monday start', () => {
  assert.equal(C.dayKey(new Date(2026, 9, 25, 0, 30).getTime()), '2026-10-25');
  assert.equal(C.weekStart('2026-10-25'), '2026-10-19'); // Sunday → Monday
  assert.equal(C.weekStart('2026-10-19'), '2026-10-19');
  assert.equal(C.isoWeek('2026-10-19'), 43);
  assert.equal(C.isoWeek('2027-01-01'), 53); // Friday 1 Jan 2027 belongs to week 53 of 2026
  assert.equal(C.isoWeek('2026-01-01'), 1);
  assert.ok(C.isKey('2028-02-29')); assert.ok(!C.isKey('2026-02-29'));
});

test('durations: whole minutes, DST day, night work', () => {
  assert.equal(C.minutesOf({ start: 0, end: 59999 }), 0);
  assert.equal(C.minutesOf({ start: 0, end: null }, 30 * MIN), 30); // running entry counts to now
  // 25 h day: 00:00 to 23:59 on 2026-10-25 is 24 h 59 min of real time
  const t = C.manualTimes('2026-10-25', '00:00', '23:59');
  assert.equal(C.minutesOf(t), 24 * 60 + 59);
  // 22:00 to 02:00 is the next morning
  const n = C.manualTimes('2026-10-20', '22:00', '02:00');
  assert.equal(C.minutesOf(n), 240);
  assert.equal(C.dayKey(n.end), '2026-10-21');
  // duration instead of end time
  assert.equal(C.minutesOf(C.manualTimes('2026-10-20', '09:00', null, 95)), 95);
});

test('parseDuration', () => {
  const cases = { '1:30': 90, '0:05': 5, '1.5': 90, '1,25': 75, '2h': 120, '1.5h': 90, '90m': 90, '45 min': 45, '1h 15m': 75, '1h15m': 75, '8': 480 };
  for (const [k, v] of Object.entries(cases)) assert.equal(C.parseDuration(k), v, k);
  for (const bad of ['', 'abc', '1:75', '-1', 'h']) assert.equal(C.parseDuration(bad), null, bad);
});

test('rounding up to blocks', () => {
  assert.equal(C.roundUp(0, 15), 0);
  assert.equal(C.roundUp(1, 15), 15);
  assert.equal(C.roundUp(15, 15), 15);
  assert.equal(C.roundUp(16, 15), 30);
  assert.equal(C.roundUp(61, 6), 66);
  assert.equal(C.roundUp(61, 0), 61);
  assert.equal(C.roundUp(61, 1), 61);
});

test('money: qty to 2 decimals, amount to cents (same as Invoice)', () => {
  assert.equal(C.hoursQty(20), 0.33);
  assert.equal(C.hoursQty(40), 0.67);
  assert.equal(C.hoursQty(70), 1.17);
  assert.equal(C.lineAmount(1.17, 85), 99.45);
  assert.equal(C.lineAmount(0.67, 70), 46.9);
  assert.equal(C.lineAmount(1.005, 100), 100.5);
  assert.equal(C.lineAmount(2, ''), 0);
});

test('invoice lines: grouped by project, per day, per entry', () => {
  const { s, a, b } = setup();
  entry(s, a.id, '2026-10-19', '09:00', '10:10', 'Home page');
  entry(s, a.id, '2026-10-20', '09:00', '09:20', 'Call');
  entry(s, b.id, '2026-10-20', '13:00', '14:00', 'Audit');
  const all = s.entries;

  const byProject = C.invoiceLines(s, all, { groupBy: 'project' });
  assert.equal(byProject.length, 2);
  const site = byProject.find(l => l.desc === 'Site');
  assert.equal(site.minutes, 90);
  assert.equal(site.qty, 1.5);
  assert.equal(site.price, 85);
  assert.equal(site.amount, 127.5);
  assert.equal(site.unit, 'h');
  assert.equal(site.details, '2026-10-19 to 2026-10-20 · Home page; Call');

  const de = C.invoiceLines(s, all, { groupBy: 'project', lang: 'de' });
  assert.equal(de[0].details.split(' · ')[0], '19.10.2026 bis 20.10.2026');

  const byDay = C.invoiceLines(s, all, { groupBy: 'day' });
  assert.equal(byDay.length, 3);
  const byEntry = C.invoiceLines(s, all, { groupBy: 'entry' });
  assert.equal(byEntry.length, 3);
  assert.equal(byEntry[0].desc, 'Site: Home page');

  // rounding is per entry: 70 → 75 and 20 → 30 with 15 min blocks = 105 min = 1.75 h
  const r = C.invoiceLines(s, all, { groupBy: 'project', step: 15 }).find(l => l.desc === 'Site');
  assert.equal(r.minutes, 105);
  assert.equal(r.qty, 1.75);
  assert.equal(r.amount, 148.75);

  // running entries and zero-minute entries never become lines
  s.entries.push({ id: 'run', projectId: a.id, desc: '', start: Date.now(), end: null, billed: false });
  assert.equal(C.invoiceLines(s, s.entries, { groupBy: 'entry' }).length, 3);
});

test('invoice payload: recipient only when all lines share one client', () => {
  const { s, a, b } = setup();
  entry(s, a.id, '2026-10-19', '09:00', '10:00');
  entry(s, b.id, '2026-10-19', '11:00', '12:00');
  const one = C.invoicePayload(s, C.invoiceLines(s, [s.entries[0]]));
  assert.equal(one.recipientName, 'ACME');
  assert.equal(one.currency, 'EUR');
  assert.deepEqual(one.lines, [{ desc: 'Site', details: '2026-10-19', qty: 1, unit: 'h', price: 85 }]);
  const two = C.invoicePayload(s, C.invoiceLines(s, s.entries));
  assert.equal(two.recipientName, '');
  assert.equal(two.lines.length, 2);
});

test('week grid: totals per project and day', () => {
  const { s, a, b } = setup();
  entry(s, a.id, '2026-10-19', '09:00', '11:00');
  entry(s, a.id, '2026-10-25', '09:00', '09:30'); // Sunday, same week
  entry(s, b.id, '2026-10-21', '09:00', '09:45');
  entry(s, b.id, '2026-10-26', '09:00', '10:00'); // next week
  const w = C.week(s, '2026-10-19', 0);
  assert.deepEqual(w.days, ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  assert.equal(w.total, 120 + 30 + 45);
  assert.deepEqual(w.col, [120, 0, 45, 0, 0, 0, 30]);
  assert.equal(w.rows[0].name, 'Site');
  assert.equal(w.rows[0].total, 150);
  assert.equal(C.week(s, '2026-10-19', 60).total, 120 + 60 + 60);
});

test('timer: start stops the running one', () => {
  const { s, a, b } = setup();
  const e1 = C.start(s, a.id, 'one', 1000 * MIN);
  assert.equal(C.running(s), e1);
  const e2 = C.start(s, b.id, 'two', 1030 * MIN);
  assert.equal(e1.end, 1030 * MIN);
  assert.equal(C.running(s), e2);
  C.stop(s, 1045 * MIN);
  assert.equal(C.running(s), null);
  assert.equal(C.minutesOf(e2), 15);
  assert.equal(C.stop(s, 2000 * MIN), null);
});

test('filter: date range, project, client, unbilled', () => {
  const { s, a, b } = setup();
  entry(s, a.id, '2026-10-19', '09:00', '10:00');
  const e = entry(s, b.id, '2026-10-20', '09:00', '10:00'); e.billed = true;
  entry(s, a.id, '2026-11-02', '09:00', '10:00');
  assert.equal(C.filter(s, { from: '2026-10-01', to: '2026-10-31' }).length, 2);
  assert.equal(C.filter(s, { projectId: a.id }).length, 2);
  assert.equal(C.filter(s, { client: 'Mira' }).length, 1);
  assert.equal(C.filter(s, { unbilled: true }).length, 2);
  assert.equal(C.filter(s, {})[0].start > C.filter(s, {})[1].start, true); // newest first
});

test('CSV: separators, BOM, formula guard, quoting', () => {
  const { s, a } = setup();
  s.projects[0].name = '=HYPERLINK("x")';
  entry(s, a.id, '2026-10-19', '09:00', '10:10', 'Home page, hero; "final"');
  const en = C.toCsv(s, s.entries, { lang: 'en' });
  assert.ok(en.startsWith('﻿Date,Start,End,Minutes,Hours'));
  const row = en.split('\r\n')[1];
  assert.ok(row.startsWith('2026-10-19,09:00,10:10,70,1.17,'));
  assert.ok(row.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(row.includes('"Home page, hero; ""final"""'));
  assert.ok(row.includes(',85.00,99.45,EUR,no'));
  const de = C.toCsv(s, s.entries, { lang: 'de', step: 15 });
  const r2 = de.split('\r\n')[1];
  assert.ok(r2.startsWith('2026-10-19;09:00;10:10;75;1,25;'));
  assert.ok(r2.includes(';85,00;106,25;EUR;nein'));
  assert.equal(C.csvCell('-12.5', ','), '-12.5'); // negative numbers stay numbers
});

test('migrate: validates backups, keeps one running entry, drops unknown project ids', () => {
  assert.throws(() => C.migrate({}), /not a time tracker backup/);
  assert.throws(() => C.migrate({ v: 99, projects: [], entries: [] }), /newer version/);
  const s = C.migrate({
    v: 1, settings: { currency: 'XXX', rounding: 7, groupBy: 'nope' },
    projects: [{ id: 'p', name: 'P', rate: '80' }],
    entries: [
      { id: '1', projectId: 'p', start: 1000, end: null },
      { id: '2', projectId: 'gone', start: 2000, end: null },
      { id: '3', projectId: 'p', start: 3000, end: 1000 },
      { id: 'bad', start: 'x' },
    ],
  });
  assert.equal(s.settings.currency, 'EUR');
  assert.equal(s.settings.rounding, 0);
  assert.equal(s.settings.groupBy, 'project');
  assert.equal(s.projects[0].rate, 80);
  assert.equal(s.entries.length, 3);
  assert.equal(s.entries.filter(e => e.end == null).length, 1);
  assert.equal(s.entries.find(e => e.id === '2').projectId, '');
  assert.equal(s.entries.find(e => e.id === '3').end, 3000); // end before start is clamped
  // round trip
  const again = C.migrate(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(again, s);
});

test('demo data is valid and has one running timer today', () => {
  const s = C.demoState('2026-10-21', 'en');
  assert.deepEqual(C.migrate(JSON.parse(JSON.stringify(s))).entries.length, s.entries.length);
  assert.equal(s.entries.filter(e => e.end == null).length, 1);
  assert.ok(s.entries.some(e => e.billed));
});
