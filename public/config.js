/* Where the links point. On hmsk.life itself `site` is '' (same site).
   `invoice`: the HMSK Invoice app. Line items are handed over through localStorage, so Invoice must run on the
   same origin (scheme + host + port) as this app; otherwise the tool offers to copy the lines instead. */
window.TTCONFIG = {
  site: 'https://hmsk.life',
  invoice: 'https://hmsk.life/apps/invoice/'
};
