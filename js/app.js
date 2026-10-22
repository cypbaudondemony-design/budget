/* =========================================================
   Notre Budget — application (PWA)
   Données : Google Sheet via l'API Apps Script.
   Hors-ligne : les modifications sont mises en file d'attente
   et envoyées dès que le réseau revient.
   ========================================================= */
'use strict';

const APP_VERSION = '1.1.0';

/* ---------------- Utilitaires ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayStr = () => ymd(new Date());
const curMonth = () => todayStr().slice(0, 7);
const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
const monthDiff = (a, b) => { const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number); return (by - ay) * 12 + (bm - am); };
const daysInMonth = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };
const uid = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const round2 = (n) => Math.round(n * 100) / 100;
const vibrate = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

const EUR0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const EUR2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = (n) => (Math.abs(n - Math.round(n)) < 0.005 ? EUR0 : EUR2).format(n);
const eurR = (n) => EUR0.format(Math.round(n)); // arrondi, pour les vues d'ensemble

const capit = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const monthLabel = (m, short) => { const [y, mo] = m.split('-').map(Number); return capit(new Intl.DateTimeFormat('fr-FR', short ? { month: 'short' } : { month: 'long', year: 'numeric' }).format(new Date(y, mo - 1, 1))).replace('.', ''); };
const dayLabel = (s) => {
  if (s === todayStr()) return "Aujourd'hui";
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (s === ymd(y)) return 'Hier';
  const [a, b, c] = s.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(a, b - 1, c));
};
const shortDate = (s) => { const [, b, c] = s.split('-'); return `${c}/${b}`; };
const parseAmount = (s) => { const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
const tint = (hex, a = 0.16) => `color-mix(in srgb, ${hex} ${Math.round(a * 100)}%, var(--surface))`;

/* ---------------- Stockage local (tolérant) ---------------- */
const mem = {};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); if (v != null) return JSON.parse(v); } catch (e) {} return k in mem ? mem[k] : d; },
  set(k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { delete mem[k]; try { localStorage.removeItem(k); } catch (e) {} },
};
const K = { cfg: 'nb.cfg', state: 'nb.state', outbox: 'nb.outbox', demo: 'nb.demo' };

/* ---------------- Constantes UI ---------------- */
const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#8a6d3b', '#5f6b7a'];
const EMOJIS = ['🏠', '🛒', '⛽', '🛡️', '⚡', '📱', '💊', '🍽️', '🎉', '🛋️', '👕', '🎁', '⛪', '📦', '🚗', '🚆', '✈️', '🏖️', '🎬', '📚', '🎓', '👶', '🐶', '🐱', '💇', '🏋️', '⚽', '🎮', '🎵', '☕', '🍷', '🍕', '🥖', '🧺', '🧹', '🔧', '💡', '💧', '🔥', '📺', '💻', '🎂', '💍', '🏥', '🦷', '👓', '🚲', '🅿️', '🧾', '💶', '🏦', '🎄', '🙏', '🧸', '🌱', '📮'];
const DEFAULT_CATS = [
  ['Loyer', '🏠', '#6250d6'], ['Courses', '🛒', '#1baf7a'], ['Carburant', '⛽', '#eb6834'], ['Assurances', '🛡️', '#2a78d6'],
  ['Énergie', '⚡', '#eda100'], ['Internet & mobile', '📱', '#5f6b7a'], ['Santé', '💊', '#e34948'], ['Restaurants', '🍽️', '#e87ba4'],
  ['Loisirs', '🎉', '#008300'], ['Maison', '🛋️', '#2a78d6'], ['Vêtements', '👕', '#e87ba4'], ['Cadeaux', '🎁', '#e34948'],
  ['Dons & paroisse', '⛪', '#8a6d3b'], ['Frais bancaires', '🏦', '#5f6b7a'], ['Divers', '📦', '#5f6b7a'],
];
const FREQS = [[1, 'Tous les mois'], [3, 'Tous les 3 mois'], [12, 'Tous les ans']];
const freqLabel = (f) => (FREQS.find((x) => x[0] === Number(f)) || [0, `Tous les ${f} mois`])[1];

/* ---------------- État ---------------- */
let cfg = store.get(K.cfg, null);           // { u: url API, t: code } | { demo: true }
let data = store.get(K.state, null);        // { user, categories, budgets, depenses, config }
let outbox = store.get(K.outbox, []);       // [{ action, data }]
const ui = { tab: 'home', mois: curMonth(), filterCat: '', search: '', statCat: '', reorder: false };
let net = { online: true, busy: false };
let charts = [];

/* ---------------- Prélèvements automatiques ---------------- */
const recDue = (r, m) => m >= r.debut && monthDiff(r.debut, m) % (Number(r.freq) || 1) === 0;
const recDay = (r, m) => Math.min(Number(r.jour) || 1, daysInMonth(m));

/** Crée les dépenses des prélèvements arrivés à échéance (même règle que le serveur : id « rec-<id>-<mois> »). */
function genRecurring(db, today = todayStr()) {
  const curM = today.slice(0, 7), d0 = Number(today.slice(8, 10));
  for (const r of db.recurrentes || []) {
    if (!r.actif) continue;
    let m = r.dernier ? addMonths(r.dernier, 1) : r.debut;
    if (m < r.debut) m = r.debut;
    while (m <= curM) {
      if (recDue(r, m)) {
        const day = recDay(r, m);
        if (m === curM && day > d0) break;
        const id = `rec-${r.id}-${m}`;
        if (!db.depenses.some((x) => x.id === id)) db.depenses.push({ id, date: `${m}-${pad2(day)}`, montant: r.montant, categorieId: r.categorieId, note: r.nom, saisiPar: 'Automatique', recurrenteId: r.id });
      }
      r.dernier = m;
      m = addMonths(m, 1);
    }
  }
}

/** Prélèvements encore à venir dans le mois en cours. */
function recUpcoming() {
  const m = curMonth(), d0 = new Date().getDate();
  return (data.recurrentes || []).filter((r) => r.actif && recDue(r, m) && (!r.dernier || r.dernier < m) && recDay(r, m) > d0)
    .sort((a, b) => recDay(a, m) - recDay(b, m));
}

/* ---------------- Mode démo (aperçu sans serveur) ---------------- */
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function buildDemo() {
  const r = rng(42);
  const categories = DEFAULT_CATS.map((c, i) => ({ id: 'c' + (i + 1), nom: c[0], emoji: c[1], couleur: c[2], ordre: i + 1, actif: true }));
  const id = (n) => categories.find((c) => c.nom === n).id;
  const start = addMonths(curMonth(), -5);
  const base = { Loyer: 750, Courses: 450, Carburant: 150, Assurances: 120, 'Énergie': 90, 'Internet & mobile': 45, 'Santé': 40, Restaurants: 80, Loisirs: 100, Maison: 60, 'Vêtements': 60, Cadeaux: 40, 'Dons & paroisse': 50, Divers: 40 };
  const budgets = Object.entries(base).map(([n, v]) => ({ categorieId: id(n), mois: start, montant: v }));
  budgets.push({ categorieId: id('Courses'), mois: addMonths(curMonth(), -2), montant: 480 });
  const depenses = [];
  const today = todayStr();
  const add = (date, n, montant, note, who) => { if (date <= today) depenses.push({ id: uid(), date, montant: round2(montant), categorieId: id(n), note, saisiPar: who || (r() < 0.5 ? 'Cyp' : 'Bérénice') }); };
  for (let k = 0; k < 6; k++) {
    const m = addMonths(start, k);
    const day = (d) => `${m}-${pad2(Math.min(d, daysInMonth(m)))}`;
    add(day(8), 'Énergie', 78 + r() * 20, 'EDF');
    const shops = ['Intermarché', 'Leclerc', 'Lidl', 'Marché', 'Boulangerie', 'Carrefour Market'];
    for (let i = 0; i < 9; i++) add(day(1 + Math.floor(r() * 28)), 'Courses', 18 + r() * 75, shops[Math.floor(r() * shops.length)]);
    for (let i = 0; i < 3; i++) add(day(2 + Math.floor(r() * 26)), 'Carburant', 45 + r() * 22, r() < 0.6 ? 'Intermarché (essence)' : 'Total');
    for (let i = 0; i < 2; i++) add(day(1 + Math.floor(r() * 28)), 'Restaurants', 22 + r() * 40, r() < 0.5 ? 'Pizzeria' : 'Resto avec amis');
    if (r() < 0.8) add(day(4 + Math.floor(r() * 20)), 'Loisirs', 15 + r() * 70, r() < 0.5 ? 'Cinéma' : 'Sortie');
    if (r() < 0.6) add(day(4 + Math.floor(r() * 20)), 'Maison', 12 + r() * 55, 'Leroy Merlin');
    if (r() < 0.5) add(day(4 + Math.floor(r() * 20)), 'Santé', 8 + r() * 30, 'Pharmacie');
    if (r() < 0.4) add(day(4 + Math.floor(r() * 20)), 'Vêtements', 25 + r() * 60, 'Décathlon');
    if (r() < 0.4) add(day(4 + Math.floor(r() * 20)), 'Cadeaux', 15 + r() * 50, 'Anniversaire');
    if (r() < 0.5) add(day(4 + Math.floor(r() * 20)), 'Divers', 5 + r() * 25, 'Poste');
  }
  const recurrentes = [
    ['Loyer', 750, 'Loyer', 5, 1], ['Assurance habitation + auto', 118.4, 'Assurances', 10, 1], ['Box + forfaits mobiles', 44.98, 'Internet & mobile', 3, 1],
    ['Denier / quête', 40, 'Dons & paroisse', 1, 1], ['Frais de tenue de compte', 2.5, 'Frais bancaires', 2, 1], ['Abonnement streaming', 13.99, 'Loisirs', 26, 1],
  ].map(([nom, montant, cat, jour, freq], i) => ({ id: 'r' + (i + 1), nom, montant, categorieId: id(cat), jour, freq, debut: start, dernier: '', actif: true }));
  const db = { user: 'Cyp', categories, budgets, depenses, recurrentes, config: { recapEmails: 'cyp@example.com, berenice@example.com', sheetUrl: '' } };
  genRecurring(db);
  return db;
}

const demoApi = {
  db: null,
  load() { this.db = this.db || store.get(K.demo, null) || buildDemo(); },
  save() { store.set(K.demo, this.db); },
  async call(action, d) {
    this.load();
    await new Promise((r) => setTimeout(r, 120));
    const db = this.db;
    const result = applyOp(db, action, d, true);
    if (action === 'bootstrap' || action === 'saveRecurrente') genRecurring(db);
    this.save();
    return action === 'bootstrap' ? JSON.parse(JSON.stringify(db)) : result;
  },
};

/* ---------------- API ---------------- */
async function api(action, d) {
  if (cfg && cfg.demo) return demoApi.call(action, d);
  let res;
  try {
    res = await fetch(cfg.u, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: cfg.t, action, data: d || {} }), redirect: 'follow' });
  } catch (e) { const err = new Error('Hors-ligne'); err.offline = true; throw err; }
  let j;
  try { j = await res.json(); } catch (e) { const err = new Error('Réponse illisible du serveur (déploiement Apps Script ?)'); err.server = true; throw err; }
  if (!j.ok) { const err = new Error(j.error || 'Erreur serveur'); err.server = true; err.code = j.code; throw err; }
  return j.data;
}

/** Applique une opération sur un jeu de données (utilisé localement ET par le mode démo). */
function applyOp(db, action, d, isServer) {
  switch (action) {
    case 'bootstrap': return db;
    case 'addDepense': {
      if (db.depenses.some((x) => x.id === d.id)) return { id: d.id, duplicate: true };
      db.depenses.push({ id: d.id, date: d.date, montant: round2(d.montant), categorieId: d.categorieId, note: d.note || '', saisiPar: d.saisiPar || db.user });
      return { id: d.id };
    }
    case 'updateDepense': {
      const x = db.depenses.find((e) => e.id === d.id);
      if (x) Object.assign(x, { date: d.date, montant: round2(d.montant), categorieId: d.categorieId, note: d.note || '' });
      else if (isServer) throw serverErr('Dépense introuvable');
      return { id: d.id };
    }
    case 'deleteDepense': db.depenses = db.depenses.filter((e) => e.id !== d.id); return { id: d.id };
    case 'saveCategorie': {
      const c = db.categories.find((x) => x.id === d.id);
      if (c) Object.assign(c, { nom: d.nom, emoji: d.emoji, couleur: d.couleur });
      else db.categories.push({ id: d.id, nom: d.nom, emoji: d.emoji, couleur: d.couleur, ordre: Math.max(0, ...db.categories.map((x) => x.ordre)) + 1, actif: true });
      return { id: d.id };
    }
    case 'deleteCategorie': {
      const used = db.depenses.some((e) => e.categorieId === d.id);
      if (used) { const c = db.categories.find((x) => x.id === d.id); if (c) c.actif = false; }
      else { db.categories = db.categories.filter((x) => x.id !== d.id); db.budgets = db.budgets.filter((b) => b.categorieId !== d.id); }
      return { id: d.id, archived: used };
    }
    case 'reorderCategories': d.ids.forEach((id, i) => { const c = db.categories.find((x) => x.id === id); if (c) c.ordre = i + 1; }); return { ok: true };
    case 'setBudget': {
      const b = db.budgets.find((x) => x.categorieId === d.categorieId && x.mois === d.mois);
      if (b) b.montant = round2(d.montant); else db.budgets.push({ categorieId: d.categorieId, mois: d.mois, montant: round2(d.montant) });
      return { ok: true };
    }
    case 'saveConfig': db.config.recapEmails = d.recapEmails; return { recapEmails: d.recapEmails };
    case 'saveRecurrente': {
      db.recurrentes = db.recurrentes || [];
      const r = db.recurrentes.find((x) => x.id === d.id);
      const fields = { nom: d.nom, montant: round2(d.montant), categorieId: d.categorieId, jour: Number(d.jour), freq: Number(d.freq) };
      if (r) Object.assign(r, fields);
      else db.recurrentes.push({ id: d.id, ...fields, debut: d.debut, dernier: '', actif: true });
      if (!isServer) genRecurring(db);
      return { id: d.id };
    }
    case 'deleteRecurrente': { const r = (db.recurrentes || []).find((x) => x.id === d.id); if (r) r.actif = false; return { id: d.id }; }
    default: throw serverErr('Action inconnue');
  }
}
function serverErr(m) { const e = new Error(m); e.server = true; return e; }

/* ---------------- File d'attente & synchro ---------------- */
function commit(action, d) {
  applyOp(data, action, d, false);
  store.set(K.state, data);
  outbox.push({ action, data: d });
  store.set(K.outbox, outbox);
  render();
  flush();
}

let flushing = null;
function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    net.busy = true; paintSync();
    let hadServerError = false;
    while (outbox.length) {
      const op = outbox[0];
      try {
        await api(op.action, op.data);
        outbox.shift(); store.set(K.outbox, outbox); net.online = true;
      } catch (e) {
        if (e.offline) { net.online = false; break; }
        if (e.code === 'AUTH') { net.busy = false; showSetup('Ton code d\'accès n\'est plus valide. Reconnecte-toi avec un nouveau lien.'); break; }
        outbox.shift(); store.set(K.outbox, outbox); hadServerError = true;
        toast('⚠️ ' + e.message);
      }
    }
    net.busy = false; paintSync();
    if (hadServerError) await pull();
    else renderIfChanged();
  })().finally(() => { flushing = null; });
  return flushing;
}

async function pull() {
  net.busy = true; paintSync();
  try {
    const d = await api('bootstrap');
    if (outbox.length === 0) { data = normalize(d); store.set(K.state, data); }
    net.online = true;
  } catch (e) {
    if (e.code === 'AUTH') { showSetup('Code d\'accès invalide. Utilise le lien d\'installation.'); return; }
    if (e.offline) net.online = false; else toast('⚠️ ' + e.message);
  } finally { net.busy = false; paintSync(); }
  renderIfChanged();
}

async function refresh() { await flush(); if (!outbox.length) await pull(); }

function paintSync() {
  const el = $('#sync'); if (!el) return;
  el.className = 'sync' + (net.busy ? ' busy' : '') + (outbox.length ? ' pending' : '') + (!net.online ? ' offline' : '');
  $('.lbl', el).textContent = !net.online ? (outbox.length ? `${outbox.length} en attente` : 'Hors-ligne') : outbox.length ? `${outbox.length} en attente` : net.busy ? 'Synchro…' : (cfg && cfg.demo ? 'Démo' : 'À jour');
}
const pendingIds = () => new Set(outbox.filter((o) => /Depense$/.test(o.action)).map((o) => o.data.id));

/** Nettoie les données reçues (couleurs, types) pour un rendu sûr. */
function normalize(d) {
  const hex = /^#[0-9a-f]{6}$/i;
  d.categories = (d.categories || []).map((c) => ({ ...c, couleur: hex.test(c.couleur) ? c.couleur : '#5f6b7a', ordre: Number(c.ordre) || 0, actif: c.actif !== false }));
  d.budgets = (d.budgets || []).map((b) => ({ ...b, montant: Number(b.montant) || 0 }));
  d.depenses = (d.depenses || []).map((x) => ({ ...x, montant: Number(x.montant) || 0, note: x.note || '' }));
  d.recurrentes = (d.recurrentes || []).map((r) => ({ ...r, montant: Number(r.montant) || 0, jour: Number(r.jour) || 1, freq: Number(r.freq) || 1, actif: r.actif !== false }));
  d.config = d.config || {};
  return d;
}

/* ---------------- Calculs ---------------- */
const catById = (id) => data.categories.find((c) => c.id === id) || { id, nom: 'Sans catégorie', emoji: '📦', couleur: '#5f6b7a', actif: false };
const sortedCats = () => data.categories.slice().sort((a, b) => a.ordre - b.ordre);
const activeCats = () => sortedCats().filter((c) => c.actif);
const depMois = (m) => data.depenses.filter((d) => d.date.slice(0, 7) === m);
const sum = (arr) => round2(arr.reduce((s, d) => s + d.montant, 0));
function budgetPour(catId, m) {
  let best = null;
  for (const b of data.budgets) if (b.categorieId === catId && b.mois <= m && (!best || b.mois > best.mois)) best = b;
  return best ? best.montant : 0;
}
function lignesMois(m) {
  const deps = depMois(m);
  return sortedCats().map((c) => {
    const spent = sum(deps.filter((d) => d.categorieId === c.id));
    return { c, spent, budget: budgetPour(c.id, m) };
  }).filter((l) => l.c.actif || l.spent > 0);
}

/* ---------------- Rendu ---------------- */
let lastViewKey = '', lastSig = '';
const dataSig = () => JSON.stringify(data) + '|' + [...pendingIds()].join(',');

/** Redessine l'écran. L'animation d'entrée ne joue qu'au changement d'onglet ou de mois. */
function render() {
  if (!data) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === ui.tab));
  $('#monthbar').hidden = ui.tab === 'settings';
  const ml = $('#monthLabel');
  ml.textContent = monthLabel(ui.mois);
  ml.classList.toggle('today', ui.mois === curMonth());
  const key = ui.tab + '|' + ui.mois;
  const animate = key !== lastViewKey;
  lastViewKey = key;
  lastSig = dataSig();
  charts.forEach((c) => c.destroy()); charts = [];
  const v = $('#view');
  v.innerHTML = ({ home: viewHome, history: viewHistory, stats: viewStats, settings: viewSettings })[ui.tab]();
  if (animate && v.firstElementChild) v.firstElementChild.classList.add('view-enter');
  if (ui.tab === 'stats') drawCharts(animate);
  paintSync();
}

/** Après une synchro : ne redessine que si quelque chose a réellement changé (évite le « clignotement »). */
function renderIfChanged() {
  if (!data) return;
  if (dataSig() !== lastSig) render(); else paintSync();
}

function barRow(l) {
  const { c, spent, budget } = l;
  const pct = budget > 0 ? Math.round((spent / budget) * 100) : null;
  const over = budget > 0 && spent > budget + 0.004;
  return `<button class="cat-row" data-act="filter-cat" data-id="${c.id}">
    <span class="cat-ico" style="background:${tint(c.couleur)}">${esc(c.emoji)}</span>
    <span class="cat-name">${esc(c.nom)}</span>
    <span class="cat-amt num"><b>${eur(spent)}</b>${budget > 0 ? ` / ${eur(budget)}` : ''}</span>
    ${budget > 0
      ? `<span class="cat-bar"><span class="track"><i style="width:${Math.min(100, pct)}%;background:${over ? 'var(--critical)' : c.couleur}"></i></span><span class="pct num${over ? ' over' : ''}">${over ? '⚠️ ' : ''}${pct} %</span></span>`
      : `<span class="nolimit">Pas de budget fixé</span>`}
  </button>`;
}

function expRow(d, pend) {
  const c = catById(d.categorieId);
  return `<button class="exp" data-act="edit" data-id="${d.id}">
    <span class="ico" style="background:${tint(c.couleur)}">${esc(c.emoji)}</span>
    <span style="min-width:0"><span class="t">${esc(d.note || c.nom)}</span><span class="s">${esc(c.nom)}${d.recurrenteId ? ' · 🔁 Prélèvement auto' : d.saisiPar ? ' · ' + esc(d.saisiPar) : ''}</span></span>
    <span class="a num">${eur(d.montant)}${pend.has(d.id) ? '<small>⏳ en attente</small>' : ''}</span>
  </button>`;
}

function viewHome() {
  const m = ui.mois;
  const lignes = lignesMois(m);
  const deps = depMois(m);
  const total = sum(deps);
  const totalBudget = round2(lignes.reduce((s, l) => s + l.budget, 0));
  const pct = totalBudget > 0 ? Math.round((total / totalBudget) * 100) : null;
  const over = totalBudget > 0 && total > totalBudget;
  const isCur = m === curMonth();
  const joursRest = isCur ? daysInMonth(m) - new Date().getDate() + 1 : 0;
  const reste = round2(totalBudget - total);

  let html = `<section class="hero">
    <div class="k">Dépensé ${isCur ? 'ce mois-ci' : 'en ' + monthLabel(m).toLowerCase()}</div>
    <div class="big num">${eur(total)}</div>
    <div class="sub">${totalBudget > 0 ? `sur ${eurR(totalBudget)} de budget` : 'Aucun budget fixé pour ce mois'}</div>`;
  if (totalBudget > 0) {
    html += `<div class="bar${over ? ' over' : ''}"><i style="width:${Math.min(100, pct)}%"></i></div>
    <div class="row"><span>${over ? '⚠️ Dépassement' : 'Reste'} <b class="num">${eur(Math.abs(reste))}</b></span><span><b class="num">${pct} %</b> utilisé</span></div>`;
    const upTot = isCur ? round2(recUpcoming().reduce((s, r) => s + r.montant, 0)) : 0;
    const libre = round2(reste - upTot);
    if (isCur && !over && joursRest > 0) html += `<span class="pill">📅 ${joursRest} jour${joursRest > 1 ? 's' : ''} restant${joursRest > 1 ? 's' : ''} · ≈ ${eurR(Math.max(0, libre) / joursRest)} / jour</span>`;
    if (upTot > 0) html += `<span class="pill">🔁 ${eur(upTot)} de prélèvements à venir</span>`;
  }
  html += `</section>`;

  const up = isCur ? recUpcoming() : [];
  if (up.length) {
    html += `<div class="section-title">🔁 Prélèvements à venir <span class="right" style="color:var(--muted)">${eur(round2(up.reduce((s, r) => s + r.montant, 0)))}</span></div>
    <div class="card list-card">${up.map((r) => { const c = catById(r.categorieId); return `<div class="exp" style="cursor:default">
      <span class="ico" style="background:${tint(c.couleur)}">${esc(c.emoji)}</span>
      <span style="min-width:0"><span class="t">${esc(r.nom)}</span><span class="s">le ${recDay(r, m)} · ${esc(c.nom)}</span></span>
      <span class="a num" style="color:var(--ink-2)">${eur(r.montant)}</span></div>`; }).join('')}</div>`;
  }

  if (!data.budgets.some((b) => b.montant > 0)) {
    html += `<button class="card" data-act="tab" data-tab="settings" style="display:flex;gap:12px;align-items:center;width:100%;text-align:left">
      <span style="font-size:30px">🎯</span><span><b>Fixez vos budgets</b><br><span style="color:var(--muted);font-size:14px">Réglages › une limite mensuelle par catégorie</span></span></button>`;
  }

  const withBudget = lignes.filter((l) => l.budget > 0 || l.spent > 0);
  html += `<div class="section-title">Par catégorie</div><div class="card"><div class="cat-list">`;
  html += withBudget.length ? withBudget.map(barRow).join('') : `<div class="empty"><div class="e">🧾</div><b>Rien pour l'instant</b>Ajoutez une dépense avec le bouton +</div>`;
  html += `</div></div>`;

  const last = deps.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 5);
  if (last.length) {
    const pend = pendingIds();
    html += `<div class="section-title">Dernières dépenses <button class="right" data-act="tab" data-tab="history">Tout voir ›</button></div>
    <div class="card list-card">${last.map((d) => expRow(d, pend)).join('')}</div>`;
  }
  return html;
}

function historyList() {
  const m = ui.mois;
  const q = ui.search.trim().toLowerCase();
  let deps = depMois(m);
  if (ui.filterCat) deps = deps.filter((d) => d.categorieId === ui.filterCat);
  if (q) deps = deps.filter((d) => (d.note + ' ' + catById(d.categorieId).nom + ' ' + String(d.montant).replace('.', ',')).toLowerCase().includes(q));
  deps.sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
  const pend = pendingIds();
  let html = `<div class="total-line"><span>${deps.length} dépense${deps.length > 1 ? 's' : ''}</span><b class="num">${eur(sum(deps))}</b></div>`;
  if (!deps.length) return html + `<div class="card empty"><div class="e">🔍</div><b>Aucune dépense</b>${q || ui.filterCat ? 'Essayez un autre filtre.' : 'Rien de saisi ce mois-ci.'}</div>`;
  const byDay = {};
  deps.forEach((d) => (byDay[d.date] = byDay[d.date] || []).push(d));
  Object.keys(byDay).sort().reverse().forEach((day) => {
    html += `<div class="day-head"><span>${esc(dayLabel(day))}</span><span class="num">${eur(sum(byDay[day]))}</span></div>
    <div class="card list-card">${byDay[day].map((d) => expRow(d, pend)).join('')}</div>`;
  });
  return html;
}

function viewHistory() {
  const used = new Set(depMois(ui.mois).map((d) => d.categorieId));
  const cats = sortedCats().filter((c) => c.actif || used.has(c.id));
  return `<div><input class="search" type="search" placeholder="Rechercher (note, catégorie, montant)" value="${esc(ui.search)}" data-input="search" enterkeyhint="search">
  <div class="chips"><button class="chip${!ui.filterCat ? ' on' : ''}" data-act="filter" data-id="">Toutes</button>
  ${cats.map((c) => `<button class="chip${ui.filterCat === c.id ? ' on' : ''}" data-act="filter" data-id="${c.id}">${esc(c.emoji)} ${esc(c.nom)}</button>`).join('')}</div>
  <div id="histList">${historyList()}</div></div>`;
}

function viewStats() {
  const m = ui.mois;
  const deps = depMois(m);
  const total = sum(deps);
  const prevTotal = sum(depMois(addMonths(m, -1)));
  const isCur = m === curMonth();
  const days = isCur ? new Date().getDate() : daysInMonth(m);
  const biggest = deps.slice().sort((a, b) => b.montant - a.montant)[0];
  const delta = total - prevTotal;
  const cats = activeCats();
  if (!ui.statCat || !data.categories.some((c) => c.id === ui.statCat)) ui.statCat = (cats[0] || {}).id || '';

  return `<div>
  <div class="tiles">
    <div class="tile-stat"><div class="k">Moyenne / jour</div><div class="v num">${eur(round2(total / Math.max(1, days)))}</div><div class="d">sur ${days} jour${days > 1 ? 's' : ''}</div></div>
    <div class="tile-stat"><div class="k">vs mois précédent</div><div class="v num">${prevTotal ? (delta >= 0 ? '+' : '−') + eurR(Math.abs(delta)) : '—'}</div>
      <div class="d">${prevTotal ? `<span class="${delta > 0 ? 'delta-up' : 'delta-down'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(Math.round((delta / prevTotal) * 100))} %</span> ${isCur ? '(mois en cours)' : ''}` : 'pas de données'}</div></div>
    <div class="tile-stat"><div class="k">Plus grosse dépense</div><div class="v num">${biggest ? eur(biggest.montant) : '—'}</div><div class="d">${biggest ? esc(catById(biggest.categorieId).emoji + ' ' + (biggest.note || catById(biggest.categorieId).nom)) : ''}</div></div>
    <div class="tile-stat"><div class="k">Nombre de dépenses</div><div class="v num">${deps.length}</div><div class="d">ce mois-ci</div></div>
  </div>

  <div class="card"><h2>🍩 Répartition<span class="right">${monthLabel(m)}</span></h2>
    ${total > 0 ? `<div class="donut-wrap"><canvas id="chDonut" role="img" aria-label="Répartition des dépenses par catégorie"></canvas><div class="donut-center"><span><b class="num">${eurR(total)}</b><span>dépensés</span></span></div></div><div class="legend" id="legend"></div>`
      : `<div class="empty"><div class="e">🍩</div>Pas encore de dépenses ce mois-ci.</div>`}
  </div>

  <div class="card"><h2>📊 Dépenses vs budget<span class="right">6 derniers mois</span></h2>
    <div class="chart-box"><canvas id="chMonths" role="img" aria-label="Dépenses des 6 derniers mois comparées au budget"></canvas></div>
  </div>

  <div class="card"><h2>🔎 Par catégorie</h2>
    <div class="chips" style="margin-bottom:4px">${cats.map((c) => `<button class="chip${ui.statCat === c.id ? ' on' : ''}" data-act="stat-cat" data-id="${c.id}">${esc(c.emoji)} ${esc(c.nom)}</button>`).join('')}</div>
    <div class="chart-box"><canvas id="chCat" role="img" aria-label="Évolution de la catégorie sur 6 mois"></canvas></div>
  </div></div>`;
}

function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

function drawCharts(animate) {
  if (!window.Chart) { setTimeout(() => drawCharts(animate), 150); return; }
  const C = window.Chart;
  C.defaults.animation = animate ? { duration: 600 } : false;
  const ink2 = cssVar('--ink-2'), muted = cssVar('--muted'), line = cssVar('--line'), surface = cssVar('--surface'), primary = cssVar('--primary');
  C.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  C.defaults.color = muted;
  const tooltip = { backgroundColor: '#1f1d33', padding: 10, cornerRadius: 10, titleFont: { weight: '700' }, displayColors: true, boxPadding: 4,
    callbacks: { label: (ctx) => ` ${ctx.dataset.label ? ctx.dataset.label + ' : ' : ''}${eur(ctx.parsed.y ?? ctx.parsed)}` } };
  const m = ui.mois;

  // 1) Donut : 7 premières catégories + « Autres »
  const elD = $('#chDonut');
  if (elD) {
    const lignes = lignesMois(m).filter((l) => l.spent > 0).sort((a, b) => b.spent - a.spent);
    const total = lignes.reduce((s, l) => s + l.spent, 0);
    let parts = lignes.slice(0, 7).map((l) => ({ label: l.c.nom, emoji: l.c.emoji, color: l.c.couleur, v: l.spent }));
    const rest = lignes.slice(7);
    if (rest.length) parts.push({ label: 'Autres', emoji: '➕', color: '#a9a7b8', v: rest.reduce((s, l) => s + l.spent, 0) });
    charts.push(new C(elD, {
      type: 'doughnut',
      data: { labels: parts.map((p) => p.label), datasets: [{ data: parts.map((p) => round2(p.v)), backgroundColor: parts.map((p) => p.color), borderColor: surface, borderWidth: 2, borderRadius: 4, hoverOffset: 6 }] },
      options: { cutout: '68%', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { ...tooltip, callbacks: { label: (ctx) => ` ${eur(ctx.parsed)} · ${Math.round((ctx.parsed / total) * 100)} %` } } } },
    }));
    $('#legend').innerHTML = parts.map((p) => `<div class="li"><span class="sw" style="background:${p.color}"></span><span>${esc(p.emoji)}</span><span>${esc(p.label)}</span><b class="num">${eur(round2(p.v))}</b><span class="p num">${Math.round((p.v / total) * 100)} %</span></div>`).join('');
  }

  const months = Array.from({ length: 6 }, (_, i) => addMonths(m, i - 5));
  const labels = months.map((x) => monthLabel(x, true));
  const scales = {
    x: { grid: { display: false }, border: { color: line }, ticks: { color: muted } },
    y: { beginAtZero: true, grid: { color: line }, border: { display: false }, ticks: { color: muted, callback: (v) => eurR(v), maxTicksLimit: 5 } },
  };
  const budgetLine = (vals) => ({ type: 'line', label: 'Budget', data: vals, borderColor: ink2, borderWidth: 2, borderDash: [5, 4], pointRadius: 0, pointHitRadius: 12, stepped: 'middle', fill: false, order: 0 });

  // 2) 6 mois : dépenses vs budget total
  const elM = $('#chMonths');
  if (elM) {
    const spent = months.map((x) => sum(depMois(x)));
    const bud = months.map((x) => round2(lignesMois(x).reduce((s, l) => s + l.budget, 0)));
    charts.push(new C(elM, {
      data: { labels, datasets: [
        { type: 'bar', label: 'Dépensé', data: spent, backgroundColor: spent.map((v, i) => (bud[i] > 0 && v > bud[i] ? cssVar('--critical') : primary)), borderRadius: 6, maxBarThickness: 34, order: 1 },
        budgetLine(bud.map((v) => v || null)),
      ] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales, plugins: { legend: { display: true, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, color: ink2 } }, tooltip } },
    }));
  }

  // 3) Par catégorie
  const elC = $('#chCat');
  if (elC && ui.statCat) {
    const c = catById(ui.statCat);
    const spent = months.map((x) => sum(depMois(x).filter((d) => d.categorieId === c.id)));
    const bud = months.map((x) => budgetPour(c.id, x));
    charts.push(new C(elC, {
      data: { labels, datasets: [
        { type: 'bar', label: c.nom, data: spent, backgroundColor: spent.map((v, i) => (bud[i] > 0 && v > bud[i] ? cssVar('--critical') : c.couleur)), borderRadius: 6, maxBarThickness: 34, order: 1 },
        budgetLine(bud.map((v) => v || null)),
      ] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales, plugins: { legend: { display: true, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, color: ink2 } }, tooltip } },
    }));
  }
}

function viewSettings() {
  const m = curMonth();
  const all = sortedCats().filter((c) => c.actif);
  const totalBudget = round2(all.reduce((s, c) => s + budgetPour(c.id, m), 0));
  const archived = sortedCats().filter((c) => !c.actif);
  const recs = (data.recurrentes || []).filter((r) => r.actif).sort((a, b) => a.jour - b.jour);
  return `<div>
  <div class="section-title">Catégories & budgets
    <button class="right" data-act="reorder">${ui.reorder ? '✓ Terminé' : '↕ Réorganiser'}</button></div>
  <div class="card">
    <div class="set-row" style="padding-top:0"><span class="ico" style="background:var(--primary-soft)">🎯</span>
      <span class="t">Budget mensuel total<small>${monthLabel(m)}</small></span><span class="v num" style="font-weight:800;color:var(--ink);font-size:17px">${eur(totalBudget)}</span></div>
    ${all.map((c, i) => `<div class="set-row">
      <span class="ico" style="background:${tint(c.couleur)}">${esc(c.emoji)}</span>
      <span class="t">${esc(c.nom)}<small>${budgetPour(c.id, m) > 0 ? eur(budgetPour(c.id, m)) + ' / mois' : 'Pas de budget'}</small></span>
      ${ui.reorder
        ? `<button class="mv" data-act="move" data-id="${c.id}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Monter">▲</button><button class="mv" data-act="move" data-id="${c.id}" data-d="1" ${i === all.length - 1 ? 'disabled' : ''} aria-label="Descendre">▼</button>`
        : `<button class="btn small ghost" data-act="edit-cat" data-id="${c.id}">Modifier</button>`}
    </div>`).join('')}
    <button class="btn ghost" style="margin-top:10px" data-act="new-cat">＋ Nouvelle catégorie</button>
    ${archived.length ? `<p class="hint">Archivées (gardées pour l'historique) : ${archived.map((c) => esc(c.emoji + ' ' + c.nom)).join(', ')}</p>` : ''}
  </div>

  <div class="section-title">🔁 Prélèvements automatiques</div>
  <div class="card">
    <p class="hint" style="margin:0 2px 8px">Ajoutés tout seuls à la bonne date : loyer, forfaits, assurances, frais bancaires…</p>
    ${recs.length ? recs.map((r) => { const c = catById(r.categorieId); return `<div class="set-row">
      <span class="ico" style="background:${tint(c.couleur)}">${esc(c.emoji)}</span>
      <span class="t">${esc(r.nom)}<small>${eur(r.montant)} · le ${r.jour} · ${esc(freqLabel(r.freq).toLowerCase())}</small></span>
      <button class="btn small ghost" data-act="edit-rec" data-id="${r.id}">Modifier</button></div>`; }).join('')
      : `<div class="empty" style="padding:14px"><div class="e">🔁</div>Aucun prélèvement pour l'instant</div>`}
    ${recs.length ? `<div class="set-row"><span class="ico" style="background:var(--primary-soft)">Σ</span><span class="t">Total par mois<small>équivalent mensuel</small></span><span class="v num" style="font-weight:800;color:var(--ink)">${eur(round2(recs.reduce((s, r) => s + r.montant / (r.freq || 1), 0)))}</span></div>` : ''}
    <button class="btn ghost" style="margin-top:10px" data-act="new-rec">＋ Nouveau prélèvement</button>
  </div>

  <div class="section-title">📧 Récap mensuel</div>
  <div class="card">
    <label class="field"><span>Envoyé le 1er de chaque mois à</span>
      <input type="text" inputmode="email" id="recapEmails" value="${esc(data.config.recapEmails || '')}" placeholder="moi@gmail.com, elle@gmail.com" autocomplete="off"></label>
    <p class="hint" style="margin-top:-4px;margin-bottom:10px">Plusieurs adresses séparées par une virgule.</p>
    <button class="btn primary" data-act="save-recap">Enregistrer</button>
  </div>

  <div class="section-title">Appareil</div>
  <div class="card">
    <div class="set-row" style="padding-top:0"><span class="ico" style="background:var(--primary-soft)">👤</span><span class="t">Connecté en tant que<small>${esc(data.user)}${cfg && cfg.demo ? ' (mode démo)' : ''}</small></span></div>
    ${data.config.sheetUrl ? `<a class="set-row" href="${esc(data.config.sheetUrl)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none"><span class="ico" style="background:var(--good-soft)">📗</span><span class="t">Ouvrir le Google Sheet<small>Toutes les données, modifiables</small></span><span class="chev">›</span></a>` : ''}
    <button class="set-row" data-act="refresh"><span class="ico" style="background:var(--surface-2)">🔄</span><span class="t">Synchroniser maintenant<small>${outbox.length ? outbox.length + ' modification(s) en attente' : 'Tout est à jour'}</small></span><span class="chev">›</span></button>
    <button class="set-row" data-act="logout"><span class="ico" style="background:var(--critical-soft)">🚪</span><span class="t">Déconnecter cet appareil<small>Les données restent dans le Google Sheet</small></span><span class="chev">›</span></button>
  </div>
  <p class="hint" style="text-align:center">Notre Budget v${APP_VERSION}</p></div>`;
}

/* ---------------- Feuille : saisie d'une dépense ---------------- */
const sheet = $('#sheet');
let entry = null;

function openEntry(dep) {
  entry = dep
    ? { id: dep.id, edit: true, montant: String(dep.montant).replace('.', ','), categorieId: dep.categorieId, date: dep.date, note: dep.note }
    : { id: uid(), edit: false, montant: '', categorieId: '', date: todayStr(), note: '' };
  paintEntry();
  if (!sheet.open) sheet.showModal();
}

function paintEntry() {
  const cats = activeCats();
  if (entry.edit && !cats.some((c) => c.id === entry.categorieId)) cats.push(catById(entry.categorieId));
  const amt = parseAmount(entry.montant);
  const t = todayStr();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yest = ymd(y);
  const isOther = entry.date !== t && entry.date !== yest;
  sheet.innerHTML = `<div class="sheet-in entry"><div class="grab"></div>
    <div class="sheet-head"><h3 id="sheetTitle">${entry.edit ? 'Modifier la dépense' : 'Nouvelle dépense'}</h3><button class="x" data-act="close" aria-label="Fermer">✕</button></div>
    <div class="amount num${amt ? '' : ' zero'}" aria-live="polite">${entry.montant ? esc(entry.montant) : '0'}<span class="cur">€</span></div>
    <div class="cat-grid">${cats.map((c) => `<button class="tile${entry.categorieId === c.id ? ' on' : ''}" style="--c:${c.couleur}" data-act="pick-cat" data-id="${c.id}"><span class="em">${esc(c.emoji)}</span>${esc(c.nom)}</button>`).join('')}</div>
    <div class="meta-row">
      <button class="chip${entry.date === t ? ' on' : ''}" data-act="pick-date" data-v="${t}">Aujourd'hui</button>
      <button class="chip${entry.date === yest ? ' on' : ''}" data-act="pick-date" data-v="${yest}">Hier</button>
      <label class="chip date-chip${isOther ? ' on' : ''}">📅 ${isOther ? shortDate(entry.date) : 'Autre date'}<input type="date" value="${entry.date}" data-input="date" aria-label="Choisir la date"></label>
    </div>
    <input class="note" type="text" placeholder="Note (ex. Intermarché, essence)" maxlength="80" value="${esc(entry.note)}" data-input="note" enterkeyhint="done">
    <div class="pad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'].map((k) => `<button data-act="key" data-k="${k}" aria-label="${k === '⌫' ? 'Effacer' : k}">${k}</button>`).join('')}</div>
    <div class="sheet-actions">${entry.edit ? `<button class="btn danger icon" data-act="delete-entry" aria-label="Supprimer cette dépense">🗑️</button>` : ''}
    <button class="btn primary" data-act="save-entry" ${amt > 0 && entry.categorieId ? '' : 'disabled'}>${entry.edit ? 'Enregistrer' : amt > 0 ? 'Ajouter ' + eur(amt) : 'Ajouter'}</button></div>
  </div>`;
}

function pressKey(k) {
  let s = entry.montant;
  if (k === '⌫') s = s.slice(0, -1);
  else if (k === ',') { if (!s.includes(',')) s = (s || '0') + ','; }
  else {
    const [i, dec] = s.split(',');
    if (dec !== undefined && dec.length >= 2) return;
    if (dec === undefined && (i || '').replace(/^0/, '').length >= 6) return;
    s = s === '0' ? k : s + k;
  }
  entry.montant = s;
  vibrate(5);
  const am = $('.amount', sheet);
  am.innerHTML = `${s ? esc(s) : '0'}<span class="cur">€</span>`;
  am.classList.toggle('zero', !parseAmount(s));
  updateSaveBtn();
}
function updateSaveBtn() {
  const amt = parseAmount(entry.montant);
  const b = $('[data-act="save-entry"]', sheet);
  b.disabled = !(amt > 0 && entry.categorieId);
  if (!entry.edit) b.textContent = amt > 0 ? 'Ajouter ' + eur(amt) : 'Ajouter';
}

function saveEntry() {
  const montant = round2(parseAmount(entry.montant));
  if (!(montant > 0) || !entry.categorieId) return;
  const d = { id: entry.id, date: entry.date, montant, categorieId: entry.categorieId, note: entry.note.trim(), saisiPar: data.user };
  const wasEdit = entry.edit;
  sheet.close();
  commit(wasEdit ? 'updateDepense' : 'addDepense', d);
  vibrate(15);
  const c = catById(d.categorieId);
  if (wasEdit) toast('✓ Dépense modifiée');
  else toast(`✓ ${eur(montant)} · ${c.emoji} ${c.nom}`, 'Annuler', () => commit('deleteDepense', { id: d.id }));
}

/* ---------------- Feuille : catégorie ---------------- */
let catEdit = null;
function openCat(c) {
  const m = curMonth();
  catEdit = c
    ? { id: c.id, isNew: false, nom: c.nom, emoji: c.emoji, couleur: c.couleur, budget: budgetPour(c.id, m) ? String(budgetPour(c.id, m)).replace('.', ',') : '', from: m }
    : { id: uid(), isNew: true, nom: '', emoji: '📦', couleur: COLORS[data.categories.length % COLORS.length], budget: '', from: m };
  paintCat();
  if (!sheet.open) sheet.showModal();
}
function paintCat() {
  const m = curMonth(), next = addMonths(m, 1);
  const hist = data.budgets.filter((b) => b.categorieId === catEdit.id).sort((a, b) => b.mois.localeCompare(a.mois));
  sheet.innerHTML = `<div class="sheet-in entry"><div class="grab"></div>
    <div class="sheet-head"><h3 id="sheetTitle">${catEdit.isNew ? 'Nouvelle catégorie' : 'Modifier la catégorie'}</h3><button class="x" data-act="close" aria-label="Fermer">✕</button></div>
    <div class="preview-tile"><span class="cat-ico" id="pvIco" style="background:${tint(catEdit.couleur)}">${esc(catEdit.emoji)}</span><b id="pvName">${esc(catEdit.nom || 'Nom de la catégorie')}</b></div>
    <label class="field"><span>Nom</span><input type="text" maxlength="30" value="${esc(catEdit.nom)}" data-input="cat-nom" placeholder="ex. Courses" autocomplete="off"></label>
    <label class="field"><span>Budget mensuel</span>
      <span class="money-input"><input type="text" inputmode="decimal" value="${esc(catEdit.budget)}" data-input="cat-budget" placeholder="0" autocomplete="off"><span>€ / mois</span></span>
      <span class="hint">Laisser vide ou 0 = pas de limite.</span></label>
    <div class="field"><span>Nouveau budget appliqué à partir de</span>
      <div class="seg"><button class="${catEdit.from === m ? 'on' : ''}" data-act="cat-from" data-v="${m}">${monthLabel(m)}</button><button class="${catEdit.from === next ? 'on' : ''}" data-act="cat-from" data-v="${next}">${monthLabel(next)}</button></div>
      <span class="hint">Les mois précédents gardent leur ancien budget.</span>
      ${hist.length ? `<div class="hist">Historique : ${hist.map((b) => `${monthLabel(b.mois, true)} ${b.mois.slice(0, 4)} → ${b.montant ? eur(b.montant) : 'aucun'}`).join(' · ')}</div>` : ''}
    </div>
    <div class="field"><span>Couleur</span><div class="swatches">${COLORS.map((col) => `<button class="${catEdit.couleur === col ? 'on' : ''}" style="--c:${col}" data-act="cat-color" data-v="${col}" aria-label="Couleur ${col}"></button>`).join('')}</div></div>
    <div class="field"><span>Icône</span><div class="emoji-grid">${EMOJIS.map((e) => `<button class="${catEdit.emoji === e ? 'on' : ''}" data-act="cat-emoji" data-v="${e}">${e}</button>`).join('')}</div></div>
    <div class="sheet-actions">${catEdit.isNew ? '' : `<button class="btn danger icon" data-act="delete-cat" aria-label="Supprimer la catégorie">🗑️</button>`}
    <button class="btn primary" data-act="save-cat">${catEdit.isNew ? 'Créer la catégorie' : 'Enregistrer'}</button></div>
  </div>`;
}
function saveCat() {
  const nom = catEdit.nom.trim();
  if (!nom) { toast('Donne un nom à la catégorie'); return; }
  const c = { id: catEdit.id, nom, emoji: catEdit.emoji, couleur: catEdit.couleur };
  const budget = Math.max(0, round2(parseAmount(catEdit.budget)));
  const prevBudget = budgetPour(catEdit.id, catEdit.from);
  sheet.close();
  commit('saveCategorie', c);
  if (budget !== prevBudget || (catEdit.isNew && budget > 0)) commit('setBudget', { categorieId: c.id, mois: catEdit.from, montant: budget });
  toast(catEdit.isNew ? `✓ ${c.emoji} ${nom} créée` : '✓ Catégorie enregistrée');
}

/* ---------------- Feuille : prélèvement automatique ---------------- */
let recEdit = null;
function openRec(r) {
  const m = curMonth();
  recEdit = r
    ? { id: r.id, isNew: false, nom: r.nom, montant: String(r.montant).replace('.', ','), categorieId: r.categorieId, jour: String(r.jour), freq: r.freq, debut: r.debut }
    : { id: uid(), isNew: true, nom: '', montant: '', categorieId: '', jour: String(new Date().getDate()), freq: 1, debut: m };
  paintRec();
  if (!sheet.open) sheet.showModal();
}
function paintRec() {
  const m = curMonth(), next = addMonths(m, 1);
  const cats = activeCats();
  if (!recEdit.isNew && !cats.some((c) => c.id === recEdit.categorieId)) cats.push(catById(recEdit.categorieId));
  const d0 = new Date().getDate(), jour = Number(recEdit.jour) || 0;
  sheet.innerHTML = `<div class="sheet-in entry"><div class="grab"></div>
    <div class="sheet-head"><h3 id="sheetTitle">${recEdit.isNew ? 'Nouveau prélèvement' : 'Modifier le prélèvement'}</h3><button class="x" data-act="close" aria-label="Fermer">✕</button></div>
    <label class="field"><span>Nom</span><input type="text" maxlength="40" value="${esc(recEdit.nom)}" data-input="rec-nom" placeholder="ex. Forfait mobile, Frais bancaires" autocomplete="off"></label>
    <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:10px">
      <label class="field"><span>Montant</span><span class="money-input"><input type="text" inputmode="decimal" value="${esc(recEdit.montant)}" data-input="rec-montant" placeholder="0" autocomplete="off"><span>€</span></span></label>
      <label class="field"><span>Jour du mois</span><span class="money-input"><input type="text" inputmode="numeric" maxlength="2" value="${esc(recEdit.jour)}" data-input="rec-jour" autocomplete="off"><span>du mois</span></span></label>
    </div>
    <div class="field"><span>Fréquence</span><div class="seg">${FREQS.map(([f, l]) => `<button class="${Number(recEdit.freq) === f ? 'on' : ''}" data-act="rec-freq" data-v="${f}">${l}</button>`).join('')}</div></div>
    ${recEdit.isNew ? `<div class="field"><span>Premier prélèvement</span>
      <div class="seg"><button class="${recEdit.debut === m ? 'on' : ''}" data-act="rec-from" data-v="${m}">${monthLabel(m)}</button><button class="${recEdit.debut === next ? 'on' : ''}" data-act="rec-from" data-v="${next}">${monthLabel(next)}</button></div>
      <span class="hint">${recEdit.debut === m && jour && jour <= d0 ? `Le ${jour} est passé : la dépense de ce mois-ci sera ajoutée tout de suite.` : 'La dépense sera ajoutée automatiquement le jour venu.'}</span></div>` : `<p class="hint" style="margin:-4px 2px 12px">Les changements s'appliquent aux prochains prélèvements ; les dépenses déjà créées ne bougent pas.</p>`}
    <div class="field"><span>Catégorie</span>
      <div class="cat-grid">${cats.map((c) => `<button class="tile${recEdit.categorieId === c.id ? ' on' : ''}" style="--c:${c.couleur}" data-act="rec-cat" data-id="${c.id}"><span class="em">${esc(c.emoji)}</span>${esc(c.nom)}</button>`).join('')}</div></div>
    <div class="sheet-actions">${recEdit.isNew ? '' : `<button class="btn danger icon" data-act="delete-rec" aria-label="Arrêter ce prélèvement">🗑️</button>`}
    <button class="btn primary" data-act="save-rec">${recEdit.isNew ? 'Créer le prélèvement' : 'Enregistrer'}</button></div>
  </div>`;
}
function paintRecKeep() { const y = sheet.scrollTop; paintRec(); sheet.scrollTop = y; }
function saveRec() {
  const nom = recEdit.nom.trim(), montant = round2(parseAmount(recEdit.montant)), jour = parseInt(recEdit.jour, 10);
  if (!nom) return toast('Donne un nom au prélèvement');
  if (!(montant > 0)) return toast('Indique le montant');
  if (!(jour >= 1 && jour <= 31)) return toast('Jour du mois entre 1 et 31');
  if (!recEdit.categorieId) return toast('Choisis une catégorie');
  const isNew = recEdit.isNew;
  sheet.close();
  commit('saveRecurrente', { id: recEdit.id, nom, montant, categorieId: recEdit.categorieId, jour, freq: Number(recEdit.freq), debut: recEdit.debut });
  toast(isNew ? `✓ 🔁 ${nom} : ${eur(montant)} le ${jour}` : '✓ Prélèvement modifié');
}

/* ---------------- Toast ---------------- */
let toastTimer;
function toast(msg, actionLabel, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button>${esc(actionLabel)}</button>` : ''}`;
  if (actionLabel) $('button', t).onclick = () => { t.classList.remove('show'); action(); };
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), actionLabel ? 5000 : 2600);
}

/* ---------------- Événements ---------------- */
document.addEventListener('click', (e) => {
  if (e.target.matches && e.target.matches('input[type=date]')) { try { e.target.showPicker(); } catch (err) {} return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  switch (act) {
    case 'tab': ui.tab = el.dataset.tab; if (ui.tab !== 'history') ui.filterCat = ''; render(); window.scrollTo({ top: 0 }); break;
    case 'month': ui.mois = addMonths(ui.mois, Number(el.dataset.d)); render(); break;
    case 'month-today': ui.mois = curMonth(); render(); break;
    case 'refresh': refresh(); break;
    case 'new': openEntry(null); break;
    case 'edit': { const d = data.depenses.find((x) => x.id === id); if (d) openEntry(d); break; }
    case 'filter-cat': ui.tab = 'history'; ui.filterCat = id; ui.search = ''; render(); window.scrollTo({ top: 0 }); break;
    case 'filter': ui.filterCat = id; render(); break;
    case 'stat-cat': ui.statCat = id; render(); break;
    case 'close': sheet.close(); break;
    case 'key': pressKey(el.dataset.k); break;
    case 'pick-cat': entry.categorieId = id; vibrate(5); sheet.querySelectorAll('.tile').forEach((t) => t.classList.toggle('on', t.dataset.id === id)); updateSaveBtn(); break;
    case 'pick-date': entry.date = el.dataset.v; paintEntry(); break;
    case 'save-entry': saveEntry(); break;
    case 'delete-entry':
      if (confirm('Supprimer cette dépense ?')) { const id2 = entry.id; sheet.close(); commit('deleteDepense', { id: id2 }); toast('🗑️ Dépense supprimée'); }
      break;
    case 'reorder': ui.reorder = !ui.reorder; render(); break;
    case 'move': {
      const list = activeCats().map((c) => c.id);
      const i = list.indexOf(id), j = i + Number(el.dataset.d);
      if (j < 0 || j >= list.length) break;
      [list[i], list[j]] = [list[j], list[i]];
      const archivedIds = sortedCats().filter((c) => !c.actif).map((c) => c.id);
      commit('reorderCategories', { ids: list.concat(archivedIds) });
      break;
    }
    case 'new-cat': openCat(null); break;
    case 'edit-cat': openCat(catById(id)); break;
    case 'cat-from': catEdit.from = el.dataset.v; paintCatKeep(); break;
    case 'cat-color': catEdit.couleur = el.dataset.v; paintCatKeep(); break;
    case 'cat-emoji': catEdit.emoji = el.dataset.v; paintCatKeep(); break;
    case 'save-cat': saveCat(); break;
    case 'new-rec': openRec(null); break;
    case 'edit-rec': openRec((data.recurrentes || []).find((r) => r.id === id)); break;
    case 'rec-cat': recEdit.categorieId = id; sheet.querySelectorAll('.tile').forEach((t) => t.classList.toggle('on', t.dataset.id === id)); break;
    case 'rec-freq': recEdit.freq = Number(el.dataset.v); paintRecKeep(); break;
    case 'rec-from': recEdit.debut = el.dataset.v; paintRecKeep(); break;
    case 'save-rec': saveRec(); break;
    case 'delete-rec':
      if (confirm(`Arrêter le prélèvement « ${recEdit.nom} » ?\n\nLes dépenses déjà créées restent dans l'historique.`)) { const rid = recEdit.id; sheet.close(); commit('deleteRecurrente', { id: rid }); toast('🔁 Prélèvement arrêté'); }
      break;
    case 'delete-cat': {
      const used = data.depenses.some((d) => d.categorieId === catEdit.id);
      const msg = used ? `Supprimer « ${catEdit.nom} » ?\n\nElle a déjà des dépenses : elle sera archivée (plus proposée à la saisie) et l'historique sera conservé.` : `Supprimer « ${catEdit.nom} » ?`;
      if (confirm(msg)) { const cid = catEdit.id; sheet.close(); commit('deleteCategorie', { id: cid }); toast(used ? '📦 Catégorie archivée' : '🗑️ Catégorie supprimée'); }
      break;
    }
    case 'save-recap': {
      const v = $('#recapEmails').value.trim();
      const bad = v.split(/[,;\s]+/).filter(Boolean).find((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
      if (bad) { toast('Adresse invalide : ' + bad); break; }
      commit('saveConfig', { recapEmails: v.split(/[,;\s]+/).filter(Boolean).join(', ') });
      toast('✓ Destinataires du récap enregistrés');
      break;
    }
    case 'logout':
      if (confirm('Déconnecter cet appareil ? Les données restent dans le Google Sheet.')) {
        [K.cfg, K.state, K.outbox, K.demo].forEach(store.del);
        cfg = null; data = null; outbox = [];
        showSetup();
      }
      break;
    case 'connect': connectManual(); break;
    case 'demo': cfg = { demo: true }; store.set(K.cfg, cfg); start(); break;
  }
});

function paintCatKeep() { const y = sheet.scrollTop; paintCat(); sheet.scrollTop = y; }

document.addEventListener('input', (e) => {
  const k = e.target.dataset.input;
  if (!k) return;
  if (k === 'search') { ui.search = e.target.value; const hl = $('#histList'); if (hl) hl.innerHTML = historyList(); }
  else if (k === 'note') entry.note = e.target.value;
  else if (k === 'date') { if (e.target.value) { entry.date = e.target.value; paintEntry(); } }
  else if (k === 'cat-nom') { catEdit.nom = e.target.value; $('#pvName').textContent = catEdit.nom || 'Nom de la catégorie'; }
  else if (k === 'cat-budget') catEdit.budget = e.target.value;
  else if (k === 'rec-nom') recEdit.nom = e.target.value;
  else if (k === 'rec-montant') recEdit.montant = e.target.value;
  else if (k === 'rec-jour') { recEdit.jour = e.target.value.replace(/\D/g, ''); }
});

// Clic sur le fond : fermeture (repli pour Safari, qui ne gère pas closedby)
if (!('closedBy' in HTMLDialogElement.prototype)) {
  sheet.addEventListener('click', (e) => {
    if (e.target !== sheet) return;
    const r = sheet.getBoundingClientRect();
    if (e.clientY >= r.top && e.clientY <= r.bottom && e.clientX >= r.left && e.clientX <= r.right) return;
    sheet.close();
  });
}
sheet.addEventListener('keydown', (e) => {
  if (!entry || !sheet.querySelector('.pad') || e.target.tagName === 'INPUT') return;
  if (/^[0-9]$/.test(e.key)) pressKey(e.key);
  else if (e.key === ',' || e.key === '.') pressKey(',');
  else if (e.key === 'Backspace') pressKey('⌫');
  else if (e.key === 'Enter') saveEntry();
});

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && data) refresh(); });
window.addEventListener('online', () => { net.online = true; if (data) refresh(); });
window.addEventListener('offline', () => { net.online = false; paintSync(); });

/* ---------------- Connexion ---------------- */
function readHashConfig() {
  const m = location.hash.match(/cfg=([^&]+)/);
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const o = JSON.parse(new TextDecoder().decode(bytes));
    history.replaceState(null, '', location.pathname + location.search);
    if (o.u && o.t) return { u: o.u, t: o.t };
  } catch (e) {}
  return null;
}

function showSetup(err) {
  $('#app').hidden = true;
  const s = $('#setup');
  s.hidden = false;
  s.innerHTML = `<div class="logo">€</div>
    <h1>Notre Budget</h1>
    <p>Pour connecter ce téléphone, ouvre le <b>lien d'installation</b> généré depuis le Google Sheet (menu 💰 Budget › Liens d'installation).</p>
    ${err ? `<div class="err">${esc(err)}</div>` : ''}
    <details ${err ? 'open' : ''}><summary>Saisir l'adresse et le code à la main</summary>
      <label class="field"><span>Adresse de l'API (Apps Script)</span><input type="url" id="setU" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
      <label class="field"><span>Code d'accès</span><input type="text" id="setT" autocomplete="off" spellcheck="false"></label>
      <button class="btn primary" data-act="connect">Se connecter</button>
    </details>
    <button class="btn ghost" style="margin-top:22px" data-act="demo">👀 Découvrir avec des données de démo</button>`;
}

async function connectManual() {
  const u = $('#setU').value.trim(), t = $('#setT').value.trim();
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(u) || !t) { showSetup('Adresse ou code invalide.'); return; }
  cfg = { u, t };
  store.set(K.cfg, cfg);
  start();
}

async function start() {
  if (!cfg) { showSetup(); return; }
  $('#setup').hidden = true;
  let fresh = false;
  if (!data) {
    fresh = true;
    $('#app').hidden = false;
    $('#view').innerHTML = `<div class="empty" style="padding-top:80px"><div class="e">⏳</div><b>Connexion…</b>Chargement de vos données</div>`;
    try {
      data = normalize(await api('bootstrap'));
      store.set(K.state, data);
    } catch (e) {
      cfg = null; store.del(K.cfg);
      showSetup(e.code === 'AUTH' ? 'Code d\'accès invalide.' : e.offline ? 'Impossible de joindre le serveur. Vérifie ta connexion et que l\'application Web est bien déployée (accès « Tout le monde »).' : e.message);
      return;
    }
  }
  $('#app').hidden = false;
  render();
  if (/[?&]add=1/.test(location.search)) { history.replaceState(null, '', location.pathname); openEntry(null); }
  if (fresh) flush(); else refresh();
}

/* ---------------- Démarrage ---------------- */
(function init() {
  const fromHash = readHashConfig();
  if (fromHash) { cfg = fromHash; store.set(K.cfg, cfg); data = null; store.del(K.state); outbox = []; store.set(K.outbox, outbox); }
  if ((/[?&]demo=1/.test(location.search) || window.__DEMO__) && !fromHash) { cfg = { demo: true }; store.set(K.cfg, cfg); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  start();
})();
