# Time Tracker

Track your hours per project, see your week, and turn the hours you pick into invoice line items, without an account
and without your data leaving your device.

**Use it free:** https://hmsk.life/tools/time-tracker/ (or straight to the app: https://hmsk.life/apps/time-tracker/)

![Time Tracker](https://hmsk.life/assets/images/tools/time-tracker.png)

## What it does

- Timer per project and task. It keeps running across reloads and closed tabs; Space starts or stops it.
- Projects with a client and an hourly rate. Every entry shows hours and amount.
- Manual entries with start and end, or a duration (`1:30`, `1.5`, `1,5`, `90m`, `1h 15m`). An end before the start
  counts as the next morning. Edit or delete any entry; a timer stopped under one minute is dropped.
- Week view (ISO weeks, Monday first): hours per project and day, totals and amounts.
- Optional rounding up per entry (1, 5, 6, 10, 15, 30 or 60 minutes). Stored times never change.
- Select entries and send them to the [HMSK Invoice](https://github.com/Shazi1212/hmsk-invoice) tool as line items:
  one per project, per project and day, or per entry. Entries can be marked as billed.
- CSV export (English: `,` and `1.25`; German: `;` and `1,25`, opens directly in German Excel) with a guard against
  spreadsheet formula injection. JSON backup and restore.
- English and German (`?lang=de`), works on phones, add it to your home screen.

## How hours become money

Rounding (if set) is applied per entry. For an invoice line the minutes are summed, converted to hours with
2 decimals, and the net amount is `round(hours × rate, 2)`. That is the same calculation the Invoice tool does, so
the totals you see here match the invoice. Amounts are net; Invoice adds the VAT treatment for your case.

## Sending hours to Invoice

The handover uses `localStorage`, so Invoice has to run on the same origin (scheme, host and port) as the time
tracker, for example `/apps/time-tracker/` and `/apps/invoice/` on one domain. Set the Invoice URL in
`public/config.js`. The time tracker writes

```js
localStorage['invoice-import'] = JSON.stringify({ source, recipientName, currency, lines: [{ desc, details, qty, unit: 'h', price }] })
```

and opens Invoice with `?import=1`; Invoice reads the lines once and deletes the key. If Invoice runs on another
origin, the tool offers to copy the lines to the clipboard instead.

## Quick start

Plain static files, no build step and no dependencies.

```sh
python3 -m http.server 8080 --directory public   # or: npm start
# open http://localhost:8080
```

`public/config.js` sets where the links back to hmsk.life and the Invoice button point. Fonts
(Newsreader, Public Sans; SIL Open Font License) are in `public/fonts/`; the shared hmsk.life look is in `public/letterpress.css`.

Demo data: open `/?demo=1`. It is generated in memory and never touches what you stored.

## Tests

```sh
node --test tests/     # or: npm test
```

Covers local days and ISO weeks, the 25-hour DST day, night work, duration parsing, rounding, money (same rounding as
Invoice), invoice lines in all three groupings, the Invoice payload, week totals, filters, CSV, and backup migration.
The app runs the same core checks on the data tab ("Self-test: 18 calculation checks passed").

## Data and privacy

Everything is stored in `localStorage` under the key `hmsk-time-tracker`, as versioned JSON (`v: 1`). Nothing is sent
anywhere: no analytics, no cookies, no third-party requests.

## License

MIT, see [LICENSE](LICENSE). Made by Hafiz Muhammad Sharoz Khalid, https://hmsk.life
