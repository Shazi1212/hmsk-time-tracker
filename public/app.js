/* Time Tracker UI. State lives in localStorage (key below), versioned via core.migrate.
   ?demo=1 shows generated demo data in memory only and never touches the stored data. ?lang=de|en picks the language. */
(function () {
  'use strict';
  const C = window.TTCore, I18N = window.TTI18N, CFG = window.TTCONFIG || { site: '', invoice: '/apps/invoice/' };
  const KEY = 'hmsk-time-tracker';
  const params = new URLSearchParams(location.search);
  const DEMO = params.get('demo') === '1';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const main = $('#main');

  let state, canSave = true, lang = 'en';
  let view = 'timer';
  let today = C.dayKey(Date.now());
  let weekCursor = C.weekStart(today);
  let filt = { from: C.addDays(C.weekStart(today), -28), to: today, projectId: '', unbilled: false };
  let sel = new Set();
  let editing = null; // entry or project id being edited

  // ---------- storage ----------
  function load() {
    if (DEMO) { canSave = false; return C.demoState(today, pickLang(null), Date.now()); }
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { canSave = false; }
    if (raw) {
      try { return C.migrate(JSON.parse(raw)); }
      catch (e) { try { localStorage.setItem(KEY + '-broken-' + Date.now(), raw); } catch (e2) { /* ignore */ } }
    }
    return C.emptyState();
  }
  function save() {
    if (!canSave) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { canSave = false; toast(t('saved_err', { e: e.message })); showBanner(); }
  }

  // ---------- i18n + formatting ----------
  function pickLang(st) {
    const q = params.get('lang');
    if (q === 'de' || q === 'en') return q;
    if (st && st.settings && st.settings.lang) return st.settings.lang;
    return /^de\b/i.test(navigator.language || '') ? 'de' : 'en';
  }
  function t(k, vars) {
    let s = (I18N[lang] && I18N[lang][k] !== undefined) ? I18N[lang][k] : I18N.en[k];
    if (vars && typeof s === 'string') for (const [a, b] of Object.entries(vars)) s = s.split('{' + a + '}').join(b);
    return s;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = v => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', { style: 'currency', currency: state.settings.currency }).format(v || 0);
  const hrs = min => C.fmtMin(min) + (lang === 'de' ? ' Std.' : ' h');
  const decH = q => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(q);
  function fmtDay(k, withYear) {
    const [y, m, d] = C.parts(k);
    const wd = t('wd')[C.weekday(k) - 1], mon = t('months')[m - 1].slice(0, 3);
    return lang === 'de' ? `${wd} ${d}. ${mon}${withYear ? ' ' + y : ''}` : `${wd} ${d} ${mon}${withYear ? ' ' + y : ''}`;
  }
  const step = () => state.settings.rounding;
  const pname = id => { const p = C.project(state, id); return p ? p.name : t('no_project'); };
  const now = () => Date.now();
  const billed = e => C.billedMinutes(e, step(), now());
  const amountOf = e => { const p = C.project(state, e.projectId); return C.lineAmount(C.hoursQty(billed(e)), p ? p.rate : 0); };
  const totals = list => ({ min: list.reduce((a, e) => a + billed(e), 0), amt: C.round2(list.reduce((a, e) => a + amountOf(e), 0)) });
  const roundLabel = r => r === 0 ? t('r_0') : r === 60 ? t('r_60') : t('r_n', { n: r });

  // ---------- chrome ----------
  function applyChrome() {
    document.documentElement.lang = lang;
    const site = CFG.site || '';
    $('#lnkHome').href = site + (lang === 'de' ? '/de/tools/time-tracker/' : '/tools/time-tracker/');
    $('#lnkHome').textContent = t('back');
    $('#lnkImprint').href = site + (lang === 'de' ? '/impressum/' : '/imprint/');
    $('#lnkImprint').textContent = t('imprint');
    $('#lnkPrivacy').href = site + (lang === 'de' ? '/datenschutz/' : '/privacy/');
    $('#lnkPrivacy').textContent = t('privacy');
    const lb = $('#langBtn');
    lb.textContent = t('lang_switch'); lb.setAttribute('aria-label', t('lang_switch_label')); lb.lang = lang === 'de' ? 'en' : 'de';
    $('#skipLink').textContent = lang === 'de' ? 'Zum Inhalt' : 'Skip to content';
    $$('#tabs button').forEach(b => {
      b.textContent = t('tab_' + b.dataset.view);
      if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    showBanner(); tick();
  }
  function showBanner() {
    const b = $('#banner');
    if (DEMO && params.get('shot') === '1') b.hidden = true;
    else if (DEMO) {
      const u = new URL(location.href); u.searchParams.delete('demo');
      b.innerHTML = `<span>${esc(t('demo_note'))}</span> <a href="${esc(u.pathname + u.search)}">${esc(t('demo_exit'))}</a>`;
      b.hidden = false;
    } else if (!canSave) { b.textContent = t('storage_off'); b.hidden = false; }
    else b.hidden = true;
  }
  let toastTimer;
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 3200); }

  // running clock: header, timer view and tab title, once a second
  function tick() {
    const r = C.running(state);
    const lr = $('#logoRun');
    if (!r) { lr.hidden = true; document.title = t('app') + ' · hmsk.life'; }
    else {
      const c = C.fmtClock(now() - r.start);
      lr.hidden = false; lr.textContent = '● ' + c;
      document.title = t('tab_running', { t: c });
      const big = $('#clock'); if (big) big.textContent = c;
    }
  }
  setInterval(tick, 1000);

  function emailOffer(force) {
    if (DEMO && !force) return '';
    if (!force && (state.meta.exports < 1 && state.meta.useDays.length < 5 || state.meta.emailOfferHidden)) return '';
    const href = (CFG.site || '') + (lang === 'de' ? '/de/?topic=time-tracker#contact' : '/?topic=time-tracker#contact');
    return `<aside class="offer"><p><span class="ps">&gt;</span> ${esc(t('email_offer'))} <a href="${esc(href)}">${esc(t('email_link'))}</a></p>
      <p class="dim small">${esc(t('email_honest'))}</p>${force ? '' : `<button type="button" class="linkish small" data-act="hide-offer">${esc(t('email_hide'))}</button>`}</aside>`;
  }
  function projectOptions(selected, withNone, withArchived) {
    const list = state.projects.filter(p => withArchived || !p.archived || p.id === selected);
    return (withNone ? `<option value="">${esc(t('no_project'))}</option>` : '') +
      list.map(p => `<option value="${esc(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(p.name)}${p.client ? ' · ' + esc(p.client) : ''}</option>`).join('');
  }

  // ---------- entry row (timer + entries views) ----------
  function entryRow(e, withCheck) {
    if (editing === e.id) return entryForm(e);
    const p = C.project(state, e.projectId);
    const isRun = e.end == null;
    const time = `${C.hhmm(e.start)}-${isRun ? '…' : C.hhmm(e.end)}`;
    const amt = p && p.rate ? money(amountOf(e)) : '';
    return `<li class="erow${e.billed ? ' is-billed' : ''}${isRun ? ' is-run' : ''}">
      ${withCheck ? `<label class="erow__chk"><input type="checkbox" data-act="sel" data-id="${esc(e.id)}"${sel.has(e.id) ? ' checked' : ''}${isRun ? ' disabled' : ''}><span class="sr">${esc(e.desc || pname(e.projectId))}</span></label>` : ''}
      <div class="erow__main">
        <span class="erow__desc">${esc(e.desc) || '<span class="dim">-</span>'}</span>
        <span class="erow__meta">${withCheck ? esc(fmtDay(C.dayKey(e.start))) + ' · ' : ''}${esc(time)} · <span class="pj">${esc(pname(e.projectId))}</span>${p && p.client ? ' · ' + esc(p.client) : ''}${e.billed ? ` · <span class="tag">${esc(t('billed'))}</span>` : ''}${isRun ? ` · <span class="tag tag--ok">${esc(t('running'))}</span>` : ''}</span>
      </div>
      <div class="erow__num"><b>${esc(C.fmtMin(billed(e)))}</b><span class="dim small">${esc(amt)}</span></div>
      <div class="erow__btns">${isRun ? '' : `<button type="button" class="ibtn" data-act="cont" data-id="${esc(e.id)}" aria-label="${esc(t('start'))}: ${esc(e.desc)}" title="${esc(t('start'))}">▶</button>`}
        <button type="button" class="btn btn--ghost btn--sm" data-act="edit" data-id="${esc(e.id)}">${esc(t('edit'))}</button></div>
    </li>`;
  }
  function entryForm(e) {
    const day = C.dayKey(e.start);
    return `<li class="erow erow--edit"><form class="hform" data-form="entry" data-id="${esc(e.id)}">
      <div class="hform__row">
        <label class="field field--grow"><span class="flag">${esc(t('what'))}</span><input name="desc" value="${esc(e.desc)}" maxlength="500"></label>
        <label class="field"><span class="flag">${esc(t('project'))}</span><select name="projectId">${projectOptions(e.projectId, true, true)}</select></label>
      </div>
      <div class="hform__row">
        <label class="field"><span class="flag">${esc(t('date'))}</span><input name="day" type="date" value="${esc(day)}" required></label>
        <label class="field field--t"><span class="flag">${esc(t('from'))}</span><input name="from" type="time" value="${esc(C.hhmm(e.start))}" required></label>
        <label class="field field--t"><span class="flag">${esc(t('to'))}</span><input name="to" type="time" value="${e.end == null ? '' : esc(C.hhmm(e.end))}"${e.end == null ? ' disabled' : ''}></label>
        <label class="field field--chk"><input type="checkbox" name="billed"${e.billed ? ' checked' : ''}> ${esc(t('billed'))}</label>
      </div>
      <p class="form-err" role="alert"></p>
      <div class="hform__btns"><button class="btn btn--ghost btn--sm">${esc(t('save'))}</button>
        <button type="button" class="btn btn--ghost btn--sm" data-act="cancel">${esc(t('cancel'))}</button>
        <button type="button" class="btn btn--ghost btn--sm btn--danger" data-act="del-entry" data-id="${esc(e.id)}">${esc(t('del'))}</button></div>
    </form></li>`;
  }

  // ---------- views ----------
  function renderTimer() {
    const r = C.running(state);
    const last = r || [...state.entries].sort((a, b) => b.start - a.start)[0];
    const todays = C.filter(state, { from: today, to: today });
    const wk = C.filter(state, { from: C.weekStart(today), to: C.addDays(C.weekStart(today), 6) });
    const tt = totals(todays), tw = totals(wk);
    const active = state.projects.filter(p => !p.archived);
    return `<section class="pad">
      <div class="head"><h1 class="h1">${esc(t('timer_title'))}</h1>
        <p class="kpis"><span><b>${esc(C.fmtMin(tt.min))}</b>${esc(lang === 'de' ? 'heute' : 'today')}</span><span><b>${esc(C.fmtMin(tw.min))}</b>${esc(lang === 'de' ? 'diese Woche' : 'this week')}</span>${tw.amt ? `<span><b>${esc(money(tw.amt))}</b>${esc(lang === 'de' ? 'diese Woche' : 'this week')}</span>` : ''}</p></div>
      <form class="timer${r ? ' is-run' : ''}" data-form="timer">
        <label class="field field--grow"><span class="flag">${esc(t('what'))}</span><input name="desc" id="tDesc" value="${esc(r ? r.desc : '')}" placeholder="${esc(t('what_ph'))}" maxlength="500" autocomplete="off"></label>
        <label class="field"><span class="flag">${esc(t('project'))}</span><select name="projectId" id="tProj">${projectOptions(r ? r.projectId : (last ? last.projectId : (active[0] || {}).id), true)}</select></label>
        <div class="timer__go">
          <output class="clock" id="clock" aria-live="off">${r ? esc(C.fmtClock(now() - r.start)) : '0:00:00'}</output>
          <button class="btn btn--amber btn--big" id="tBtn" data-act="${r ? 'stop' : 'start'}">${r ? '■ ' + esc(t('stop')) : '▶ ' + esc(t('start'))}</button>
        </div>
      </form>
      ${r ? `<p class="dim small">${esc(t('running_since', { t: C.hhmm(r.start) }))}</p>` : ''}
      <p class="dim small hint-keys"><kbd>Space</kbd>${esc(t('keys_hint'))}</p>
      ${!state.projects.length ? `<p class="tipline"><span class="ps">#</span> ${esc(t('first_project'))} <button type="button" class="linkish" data-goto="projects">${esc(t('tab_projects'))}</button></p>` : ''}
      <h2 class="h2">${esc(t('today'))} · ${esc(fmtDay(today))}</h2>
      ${todays.length ? `<ul class="elist">${todays.map(e => entryRow(e, false)).join('')}</ul>` : `<p class="dim">${esc(t('no_entries_today'))}</p>`}
      <h2 class="h2">${esc(t('manual_title'))}</h2>
      <form class="hform" data-form="manual">
        <div class="hform__row">
          <label class="field field--grow"><span class="flag">${esc(t('what'))}</span><input name="desc" maxlength="500" placeholder="${esc(t('what_ph'))}"></label>
          <label class="field"><span class="flag">${esc(t('project'))}</span><select name="projectId">${projectOptions(last ? last.projectId : (active[0] || {}).id, true)}</select></label>
        </div>
        <div class="hform__row">
          <label class="field"><span class="flag">${esc(t('date'))}</span><input name="day" type="date" value="${esc(today)}" required></label>
          <label class="field field--t"><span class="flag">${esc(t('from'))}</span><input name="from" type="time" value="09:00" required></label>
          <label class="field field--t"><span class="flag">${esc(t('to'))}</span><input name="to" type="time"></label>
          <label class="field field--t"><span class="flag">${esc(t('or_duration'))}</span><input name="dur" inputmode="decimal" placeholder="${esc(t('duration_ph'))}"></label>
        </div>
        <p class="dim small">${esc(t('manual_hint'))}</p>
        <p class="form-err" role="alert"></p>
        <div class="hform__btns"><button class="btn btn--ghost">${esc(t('add_entry'))}</button></div>
      </form>
      <p class="dim small">${esc(t('privacy_note'))}</p>
    </section>`;
  }

  function renderWeek() {
    const w = C.week(state, weekCursor, step(), now());
    const head = w.days.map(k => `<th scope="col"${k === today ? ' class="now"' : ''}><span>${esc(t('wd')[C.weekday(k) - 1])}</span>${C.parts(k)[2]}</th>`).join('');
    const cell = m => m ? esc(C.fmtMin(m)) : '<span class="dim">·</span>';
    let amt = 0;
    const rows = w.rows.map(r => {
      const a = C.lineAmount(C.hoursQty(r.total), r.rate); amt += a;
      return `<tr><th scope="row" class="rh"><span class="rh__in">${esc(r.name || t('no_project'))}</span>${r.client ? `<span class="rh__sub">${esc(r.client)}</span>` : ''}</th>${r.mins.map(m => `<td>${cell(m)}</td>`).join('')}<td class="tot">${esc(C.fmtMin(r.total))}</td><td class="tot">${r.rate ? esc(money(a)) : '<span class="dim">-</span>'}</td></tr>`;
    }).join('');
    const label = t('week_label', { w: C.isoWeek(weekCursor), from: fmtDay(weekCursor), to: fmtDay(C.addDays(weekCursor, 6), true) });
    return `<section class="pad">
      <div class="nav-row"><h1 class="h1">${esc(t('week_title'))}</h1>
        <div class="nav-btns"><button type="button" class="ibtn" data-act="wk" data-d="-7" aria-label="${esc(t('prev'))}">‹</button>
          <button type="button" class="btn btn--ghost btn--sm" data-act="wk" data-d="0">${esc(t('this_week'))}</button>
          <button type="button" class="ibtn" data-act="wk" data-d="7" aria-label="${esc(t('next'))}">›</button></div></div>
      <p class="cmd">${esc(label)}</p>
      ${w.rows.length ? `<div class="grid-wrap"><table class="grid">
        <thead><tr><th scope="col" class="rh"></th>${head}<th scope="col">${esc(t('total'))}</th><th scope="col">${esc(t('amount'))}</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><th scope="row" class="rh">${esc(t('total'))}</th>${w.col.map(m => `<td class="tot">${cell(m)}</td>`).join('')}<td class="tot"><b>${esc(C.fmtMin(w.total))}</b></td><td class="tot"><b>${esc(money(C.round2(amt)))}</b></td></tr></tfoot>
      </table></div>
      <button type="button" class="btn btn--ghost btn--sm" data-act="wk-entries">${esc(t('week_entries'))}</button>` : `<p class="dim">${esc(t('week_empty'))}</p>`}
      ${step() ? `<p class="dim small">${esc(t('inv_rounding', { r: roundLabel(step()) }))}</p>` : ''}
    </section>`;
  }

  function renderEntries() {
    const list = C.filter(state, filt);
    for (const id of [...sel]) if (!list.some(e => e.id === id)) sel.delete(id);
    const chosen = list.filter(e => sel.has(e.id));
    const ts = totals(chosen), tl = totals(list);
    const done = list.filter(e => e.end != null);
    // group by day
    let html = '', lastDay = '';
    for (const e of list) {
      const d = C.dayKey(e.start);
      if (d !== lastDay) { if (lastDay) html += '</ul>'; html += `<h3 class="dayh">${esc(fmtDay(d, true))}</h3><ul class="elist">`; lastDay = d; }
      html += entryRow(e, true);
    }
    if (lastDay) html += '</ul>';
    return `<section class="pad">
      <div class="head"><h1 class="h1">${esc(t('entries_title'))}</h1></div>
      <form class="filters" data-form="filter">
        <label class="field"><span class="flag">${esc(t('f_from'))}</span><input type="date" name="from" value="${esc(filt.from)}"></label>
        <label class="field"><span class="flag">${esc(t('f_to'))}</span><input type="date" name="to" value="${esc(filt.to)}"></label>
        <label class="field"><span class="flag">${esc(t('f_project'))}</span><select name="projectId"><option value="">${esc(t('all_projects'))}</option>${projectOptions(filt.projectId, false, true)}</select></label>
        <label class="field field--chk"><input type="checkbox" name="unbilled"${filt.unbilled ? ' checked' : ''}> ${esc(t('f_unbilled'))}</label>
      </form>
      <div class="selbar" role="region" aria-label="${esc(t('selected', { n: chosen.length, h: '', a: '' }))}">
        <label class="field--chk"><input type="checkbox" data-act="sel-all"${done.length && done.every(e => sel.has(e.id)) ? ' checked' : ''}${done.length ? '' : ' disabled'}> ${esc(t('select_all'))}</label>
        <p class="selbar__sum">${chosen.length ? esc(t('selected', { n: chosen.length, h: hrs(ts.min), a: money(ts.amt) })) : esc(t('shown', { n: list.length, h: hrs(tl.min), a: money(tl.amt) }))}</p>
        <div class="selbar__btns">
          <button type="button" class="btn btn--amber btn--sm" data-act="invoice">${esc(t('to_invoice'))} →</button>
          <button type="button" class="btn btn--ghost btn--sm" data-act="csv-sel">${esc(t('csv'))}</button>
          <button type="button" class="btn btn--ghost btn--sm" data-act="bill" data-v="1">${esc(t('mark_billed'))}</button>
          <button type="button" class="btn btn--ghost btn--sm" data-act="bill" data-v="0">${esc(t('mark_unbilled'))}</button>
          <button type="button" class="btn btn--ghost btn--sm btn--danger" data-act="del-sel">${esc(t('del_sel'))}</button>
        </div>
      </div>
      ${list.length ? html : `<p class="dim">${esc(t('entries_empty'))}</p>`}
      ${emailOffer(false)}
    </section>`;
  }

  function projectForm(p) {
    p = p || { id: '', name: '', client: '', rate: '' };
    return `<form class="hform" data-form="project" data-id="${esc(p.id)}">
      <div class="hform__row">
        <label class="field field--grow"><span class="flag">${esc(t('p_name'))}</span><input name="name" value="${esc(p.name)}" maxlength="120" placeholder="${esc(t('p_name_ph'))}"></label>
        <label class="field field--grow"><span class="flag">${esc(t('p_client'))}</span><input name="client" value="${esc(p.client)}" maxlength="120" placeholder="${esc(t('p_client_ph'))}" list="clientList"></label>
        <label class="field field--rate"><span class="flag">${esc(t('p_rate'))} <span class="dim">${esc(state.settings.currency)} ${esc(t('per_hour'))}</span></span><input name="rate" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(p.rate)}" placeholder="${esc(t('p_rate_ph'))}"></label>
      </div>
      <p class="form-err" role="alert"></p>
      <div class="hform__btns"><button class="btn ${p.id ? 'btn--amber' : 'btn--ghost'} btn--sm">${esc(p.id ? t('save') : t('add_project'))}</button>
        ${p.id ? `<button type="button" class="btn btn--ghost btn--sm" data-act="cancel">${esc(t('cancel'))}</button>` : ''}</div>
    </form>`;
  }
  function renderProjects() {
    const clients = [...new Set(state.projects.map(p => p.client).filter(Boolean))];
    const row = p => {
      if (editing === p.id) return `<li class="hrow hrow--edit">${projectForm(p)}</li>`;
      const n = state.entries.filter(e => e.projectId === p.id).length;
      return `<li class="hrow"><span class="hrow__name"><b>${esc(p.name)}</b>${p.client ? ` <span class="dim">· ${esc(p.client)}</span>` : ''}<br><span class="dim small">${p.rate ? esc(money(p.rate)) + ' ' + esc(t('per_hour')) : '-'} · ${n} ${lang === 'de' ? 'Einträge' : 'entries'}</span></span>
        <span class="hrow__btns"><button type="button" class="btn btn--ghost btn--sm" data-act="edit-p" data-id="${esc(p.id)}">${esc(t('edit'))}</button>
        <button type="button" class="btn btn--ghost btn--sm" data-act="arch-p" data-id="${esc(p.id)}">${esc(p.archived ? t('unarchive') : t('archive'))}</button>
        <button type="button" class="btn btn--ghost btn--sm btn--danger" data-act="del-p" data-id="${esc(p.id)}">${esc(t('del'))}</button></span></li>`;
    };
    const act = state.projects.filter(p => !p.archived), arch = state.projects.filter(p => p.archived);
    return `<section class="pad">
      <div class="head"><h1 class="h1">${esc(t('projects_title'))}</h1></div>
      ${editing ? '' : projectForm(null)}
      <datalist id="clientList">${clients.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      ${act.length ? `<ul class="hlist">${act.map(row).join('')}</ul>` : `<p class="dim">${esc(t('projects_empty'))}</p>`}
      ${arch.length ? `<h2 class="h2">${esc(t('archived_head'))}</h2><ul class="hlist">${arch.map(row).join('')}</ul>` : ''}
    </section>`;
  }

  function renderData() {
    const st = C.selfTest();
    const lastB = (() => { try { return localStorage.getItem(KEY + '-last-backup'); } catch (e) { return null; } })();
    return `<section class="pad">
      <div class="head"><h1 class="h1">${esc(t('data_title'))}</h1></div>
      <h2 class="h2">${esc(t('settings'))}</h2>
      <form class="hform" data-form="settings"><div class="hform__row">
        <label class="field"><span class="flag">${esc(t('currency'))}</span><select name="currency">${C.CURRENCIES.map(c => `<option${c === state.settings.currency ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
        <label class="field"><span class="flag">${esc(t('rounding'))}</span><select name="rounding">${C.ROUNDING.map(r => `<option value="${r}"${r === step() ? ' selected' : ''}>${esc(roundLabel(r))}</option>`).join('')}</select></label>
      </div><p class="dim small">${esc(t('rounding_hint'))}</p></form>
      <h2 class="h2">${esc(t('backup'))}</h2>
      <p class="lead">${esc(t('backup_text'))}</p>
      <p class="dim small">${esc(t('last_backup', { d: lastB || t('never') }))}</p>
      <div class="btn-col">
        <button type="button" class="btn btn--amber" data-act="backup">${esc(t('backup_dl'))}</button>
        <label class="btn btn--ghost file-btn">${esc(t('backup_restore'))}<input type="file" accept=".json,application/json" data-act="restore" class="sr"></label>
        <button type="button" class="btn btn--ghost" data-act="csv-all">${esc(t('csv_all'))}</button>
        <button type="button" class="btn btn--ghost btn--danger" data-act="clear">${esc(t('clear'))}</button>
      </div>
      <p class="small ${st.fails.length ? 'form-err' : 'dim'}">${esc(st.fails.length ? t('selftest_fail', { f: st.fails.join('; ') }) : t('selftest_ok', { n: st.n }))}</p>
      ${emailOffer(true)}
    </section>`;
  }

  function render(focusSel) {
    applyChrome();
    main.innerHTML = view === 'week' ? renderWeek() : view === 'entries' ? renderEntries() : view === 'projects' ? renderProjects() : view === 'data' ? renderData() : renderTimer();
    if (focusSel) { const el = $(focusSel, main); if (el) el.focus(); }
  }

  // ---------- downloads ----------
  function download(name, data, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function csv(list) {
    download(`time-${today}.csv`, C.toCsv(state, list, { lang, step: step(), now: now() }), 'text/csv;charset=utf-8');
    countExport();
  }
  function countExport() { if (!DEMO) { state.meta.exports = (state.meta.exports || 0) + 1; save(); } }

  // ---------- invoice dialog ----------
  const invoiceUrl = () => new URL(CFG.invoice || '/apps/invoice/', location.href);
  function openInvoice() {
    const chosen = state.entries.filter(e => sel.has(e.id));
    if (!chosen.length) { toast(t('nothing_selected')); return; }
    const dlg = $('#dlg');
    const draw = () => {
      const lines = C.invoiceLines(state, chosen, { groupBy: state.settings.groupBy, step: step(), lang, now: now() });
      const clients = new Set(chosen.map(e => (C.project(state, e.projectId) || {}).client || ''));
      const noRate = lines.some(l => !l.price);
      const same = invoiceUrl().origin === location.origin;
      dlg.innerHTML = `<form method="dialog" class="dlg__in" data-form="invoice">
        <h2 class="h1 h1--sm" id="dlgTitle">${esc(t('inv_title'))}</h2>
        <p class="dim">${esc(t('inv_lead'))}</p>
        <label class="field"><span class="flag">${esc(t('group'))}</span><select name="groupBy">${['project', 'day', 'entry'].map(g => `<option value="${g}"${g === state.settings.groupBy ? ' selected' : ''}>${esc(t('g_' + g))}</option>`).join('')}</select></label>
        <div class="grid-wrap"><table class="itab"><thead><tr><th>${esc(t('inv_desc'))}</th><th class="n">${esc(t('inv_qty'))}</th><th class="n">${esc(t('inv_rate'))}</th><th class="n">${esc(t('inv_amount'))}</th></tr></thead>
          <tbody>${lines.map(l => `<tr><td><b>${esc(l.desc)}</b><br><span class="dim small">${esc(l.details)}</span></td><td class="n">${esc(decH(l.qty))}</td><td class="n">${esc(money(l.price))}</td><td class="n">${esc(money(l.amount))}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3">${esc(t('inv_net'))}</td><td class="n"><b>${esc(money(C.sum(lines, 'amount')))}</b></td></tr></tfoot></table></div>
        ${step() ? `<p class="dim small">${esc(t('inv_rounding', { r: roundLabel(step()) }))}</p>` : ''}
        ${noRate ? `<p class="warn small">${esc(t('inv_no_rate'))}</p>` : ''}
        ${clients.size > 1 ? `<p class="dim small">${esc(t('inv_client_many'))}</p>` : ''}
        <label class="field--chk"><input type="checkbox" name="mark" checked> ${esc(t('inv_mark'))}</label>
        <div class="hform__btns">
          ${same ? `<button type="button" class="btn btn--amber" data-act="inv-go">${esc(t('inv_go'))} →</button>`
                 : `<button type="button" class="btn btn--amber" data-act="inv-copy">${lang === 'de' ? 'Positionen kopieren' : 'Copy lines'}</button><a class="btn btn--ghost" href="${esc(invoiceUrl().href)}" target="_blank" rel="noopener">Invoice ↗</a>`}
          <button type="button" class="btn btn--ghost" data-act="dlg-close">${esc(t('cancel'))}</button>
        </div></form>`;
      dlg._lines = lines;
    };
    dlg._draw = draw; dlg._chosen = chosen;
    draw();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function closeDlg() { const d = $('#dlg'); if (d.open) { if (d.close) d.close(); else d.removeAttribute('open'); } }
  function finishInvoice(mark) {
    const d = $('#dlg');
    if (mark && !DEMO) { d._chosen.forEach(e => { e.billed = true; }); }
    countExport(); save();
  }

  // ---------- events ----------
  function changed() { if (!DEMO) C.markUse(state, today); save(); render(); }

  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-act],[data-goto],#tabs button');
    if (!el) return;
    if (el.matches('#tabs button')) { view = el.dataset.view; editing = null; render(); main.focus({ preventScroll: true }); return; }
    if (el.dataset.goto) { view = el.dataset.goto; editing = null; render(); return; }
    const act = el.dataset.act, id = el.dataset.id;
    const entry = id && state.entries.find(e => e.id === id);
    switch (act) {
      case 'start': case 'stop': ev.preventDefault(); toggleTimer(); break;
      case 'cont': C.start(state, entry.projectId, entry.desc, now()); view = 'timer'; changed(); break;
      case 'edit': editing = id; render(`[data-form="entry"] input`); break;
      case 'cancel': editing = null; render(); break;
      case 'del-entry': if (confirm(t('confirm_del'))) { state.entries = state.entries.filter(e => e.id !== id); sel.delete(id); editing = null; changed(); } break;
      case 'wk': weekCursor = Number(el.dataset.d) ? C.addDays(weekCursor, Number(el.dataset.d)) : C.weekStart(today); render(); break;
      case 'wk-entries': filt = { from: weekCursor, to: C.addDays(weekCursor, 6), projectId: '', unbilled: false }; view = 'entries'; render(); break;
      case 'bill': {
        if (!sel.size) { toast(t('nothing_selected')); break; }
        state.entries.forEach(e => { if (sel.has(e.id)) e.billed = el.dataset.v === '1'; }); changed(); break;
      }
      case 'del-sel': if (!sel.size) { toast(t('nothing_selected')); break; }
        if (confirm(t('confirm_del_n', { n: sel.size }))) { state.entries = state.entries.filter(e => !sel.has(e.id)); sel.clear(); changed(); } break;
      case 'csv-sel': { const list = sel.size ? state.entries.filter(e => sel.has(e.id)) : C.filter(state, filt); csv(list); break; }
      case 'csv-all': csv(state.entries); break;
      case 'invoice': openInvoice(); break;
      case 'dlg-close': closeDlg(); break;
      case 'inv-go': {
        const d = $('#dlg');
        try { localStorage.setItem('invoice-import', JSON.stringify(C.invoicePayload(state, d._lines))); }
        catch (e) { toast(t('saved_err', { e: e.message })); break; }
        finishInvoice($('[name="mark"]', d).checked);
        const u = invoiceUrl(); u.searchParams.set('import', '1');
        location.href = u.href;
        break;
      }
      case 'inv-copy': {
        const d = $('#dlg');
        const txt = d._lines.map(l => [l.desc, l.details, decH(l.qty), 'h', l.price].join('\t')).join('\n');
        (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('✓'), () => toast(txt));
        finishInvoice($('[name="mark"]', d).checked); closeDlg(); render();
        break;
      }
      case 'edit-p': editing = id; render('[data-form="project"] input'); break;
      case 'arch-p': { const p = C.project(state, id); p.archived = !p.archived; changed(); break; }
      case 'del-p': {
        const p = C.project(state, id); const n = state.entries.filter(e => e.projectId === id).length;
        if (confirm(t('confirm_del_p', { name: p.name, n }))) { state.projects = state.projects.filter(x => x.id !== id); state.entries.forEach(e => { if (e.projectId === id) e.projectId = ''; }); changed(); }
        break;
      }
      case 'backup': {
        download(`time-tracker-backup-${today}.json`, JSON.stringify(state, null, 1), 'application/json');
        try { localStorage.setItem(KEY + '-last-backup', today); } catch (e) { /* ignore */ }
        render(); break;
      }
      case 'clear': if (confirm(t('confirm_clear'))) { state = C.emptyState(); state.settings.lang = lang; sel.clear(); save(); view = 'timer'; render(); } break;
      case 'hide-offer': state.meta.emailOfferHidden = true; save(); render(); break;
    }
  });

  document.addEventListener('change', ev => {
    const el = ev.target;
    if (el.dataset.act === 'sel') { if (el.checked) sel.add(el.dataset.id); else sel.delete(el.dataset.id); render(`[data-act="sel"][data-id="${CSS.escape(el.dataset.id)}"]`); return; }
    if (el.dataset.act === 'sel-all') { C.filter(state, filt).filter(e => e.end != null).forEach(e => { if (el.checked) sel.add(e.id); else sel.delete(e.id); }); render('[data-act="sel-all"]'); return; }
    if (el.dataset.act === 'restore') { restore(el.files[0]); el.value = ''; return; }
    const form = el.closest('form');
    if (!form) return;
    if (form.dataset.form === 'filter') {
      const f = new FormData(form);
      filt = { from: f.get('from') || '', to: f.get('to') || '', projectId: f.get('projectId') || '', unbilled: !!f.get('unbilled') };
      render(); return;
    }
    if (form.dataset.form === 'settings') {
      const f = new FormData(form);
      state.settings.currency = f.get('currency'); state.settings.rounding = Number(f.get('rounding')); save(); render(); return;
    }
    if (form.dataset.form === 'invoice' && el.name === 'groupBy') { state.settings.groupBy = el.value; save(); $('#dlg')._draw(); return; }
    if (form.dataset.form === 'timer') {
      // editing the running entry's description or project updates it in place
      const r = C.running(state);
      if (r) { r.desc = $('#tDesc').value; r.projectId = $('#tProj').value; save(); }
    }
  });

  document.addEventListener('submit', ev => {
    const form = ev.target;
    if (form.method === 'dialog') return;
    ev.preventDefault();
    const f = new FormData(form);
    const err = msg => { $('.form-err', form).textContent = msg; };
    switch (form.dataset.form) {
      case 'timer': toggleTimer(); break;
      case 'manual': case 'entry': {
        const day = f.get('day'), from = f.get('from');
        const e = form.dataset.form === 'entry' ? state.entries.find(x => x.id === form.dataset.id) : null;
        if (!C.isKey(day) || !from) { err(t('err_time')); return; }
        let times;
        if (e && e.end == null) times = { start: C.at(day, from), end: null };
        else {
          const dur = form.dataset.form === 'manual' && String(f.get('dur') || '').trim() ? C.parseDuration(f.get('dur')) : null;
          if (form.dataset.form === 'manual' && String(f.get('dur') || '').trim() && dur == null) { err(t('err_time')); return; }
          if (dur == null && !f.get('to')) { err(t('err_time')); return; }
          times = C.manualTimes(day, from, f.get('to'), dur);
          if (times.end - times.start < 60000) { err(t('err_zero')); return; }
        }
        if (e) Object.assign(e, { desc: String(f.get('desc') || '').trim(), projectId: f.get('projectId') || '', start: times.start, end: times.end, billed: !!f.get('billed') });
        else state.entries.push({ id: C.uid(), projectId: f.get('projectId') || '', desc: String(f.get('desc') || '').trim(), start: times.start, end: times.end, billed: false });
        editing = null; changed();
        if (!e) toast('✓ ' + C.fmtMin(C.minutesOf(times)));
        break;
      }
      case 'project': {
        const name = String(f.get('name') || '').trim();
        if (!name) { err(t('name_required')); return; }
        const data = { name, client: String(f.get('client') || '').trim(), rate: Math.max(0, Number(f.get('rate')) || 0) };
        const p = form.dataset.id && C.project(state, form.dataset.id);
        if (p) Object.assign(p, data); else C.addProject(state, data);
        editing = null; changed(); render(form.dataset.id ? null : '[data-form="project"] input');
        break;
      }
    }
  });

  function toggleTimer() {
    const r = C.running(state);
    if (r) {
      C.stop(state, now());
      // an accidental start/stop leaves no 0-minute entry behind
      if (C.minutesOf(r) < 1) { state.entries = state.entries.filter(e => e !== r); toast(t('too_short')); }
    } else C.start(state, $('#tProj') ? $('#tProj').value : '', $('#tDesc') ? $('#tDesc').value.trim() : '', now());
    changed();
    const b = $('#tBtn'); if (b) b.focus();
  }

  document.addEventListener('keydown', ev => {
    if (ev.code !== 'Space' || ev.repeat || view !== 'timer' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.target.closest('input, select, textarea, button, a, dialog')) return;
    ev.preventDefault(); toggleTimer();
  });

  async function restore(file) {
    if (!file) return;
    try {
      const next = C.migrate(JSON.parse(await file.text()));
      if (!confirm(t('confirm_restore'))) return;
      state = next; sel.clear(); save(); lang = pickLang(state); toast(t('restored', { n: next.entries.length })); view = 'timer'; render();
    } catch (e) { toast(t('restore_err', { e: e.message })); }
  }

  $('#langBtn').addEventListener('click', () => {
    lang = lang === 'de' ? 'en' : 'de';
    if (!DEMO) { state.settings.lang = lang; save(); }
    const u = new URL(location.href); if (u.searchParams.has('lang')) { u.searchParams.set('lang', lang); history.replaceState(null, '', u); }
    render();
  });

  // another tab changed the data (e.g. timer stopped there)
  window.addEventListener('storage', ev => { if (ev.key === KEY && !DEMO) { state = load(); render(); } });
  // the day rolls over while the page is open
  setInterval(() => { const k = C.dayKey(now()); if (k !== today) { today = k; if (!editing) render(); } }, 60000);

  // ---------- boot ----------
  state = load();
  lang = pickLang(DEMO ? null : state);
  if (!DEMO) { C.markUse(state, today); save(); }
  if (params.get('view') && ['timer', 'week', 'entries', 'projects', 'data'].includes(params.get('view'))) view = params.get('view');
  if (DEMO && view === 'entries') { C.filter(state, filt).filter(e => e.end != null && !e.billed).slice(0, 4).forEach(e => sel.add(e.id)); }
  render();
})();
