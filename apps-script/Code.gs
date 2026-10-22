/**
 * ============================================================
 *  NOTRE BUDGET — Backend Google Apps Script
 *  Rattaché au Google Sheet « Notre Budget ».
 *
 *  Rôle :
 *   - Base de données : onglets Dépenses, Catégories, Budgets, Config
 *   - API JSON appelée par l'app (PWA) hébergée sur GitHub Pages
 *   - Récap mensuel par e-mail (1er du mois, 8 h)
 *
 *  Mise en route (une seule fois) :
 *   1. Menu 💰 Budget › 1. Initialiser le classeur
 *   2. Déployer › Nouveau déploiement › Application Web
 *        Exécuter en tant que : Moi
 *        Qui a accès : Tout le monde
 *   3. Menu 💰 Budget › 2. Liens d'installation
 * ============================================================
 */

// ---- Réglages -------------------------------------------------
const APP_URL = 'https://cypbaudondemony-design.github.io/budget/';
const PERSONNES = ['Cyp', 'Bérénice'];
const TZ = 'Europe/Paris';

const SH = {
  DEPENSES: 'Dépenses',
  CATEGORIES: 'Catégories',
  BUDGETS: 'Budgets',
  CONFIG: 'Config',
};

const HEADERS = {
  [SH.DEPENSES]: ['ID', 'Date', 'Montant (€)', 'Catégorie ID', 'Catégorie', 'Note', 'Saisi par', 'Créé le', 'Modifié le'],
  [SH.CATEGORIES]: ['ID', 'Nom', 'Emoji', 'Couleur', 'Ordre', 'Active'],
  [SH.BUDGETS]: ['Catégorie ID', 'Catégorie', 'À partir de (AAAA-MM)', 'Budget mensuel (€)'],
  [SH.CONFIG]: ['Clé', 'Valeur'],
};

const CATEGORIES_DEFAUT = [
  ['Loyer', '🏠', '#6250d6'],
  ['Courses', '🛒', '#1baf7a'],
  ['Carburant', '⛽', '#eb6834'],
  ['Assurances', '🛡️', '#2a78d6'],
  ['Énergie', '⚡', '#eda100'],
  ['Internet & mobile', '📱', '#5f6b7a'],
  ['Santé', '💊', '#e34948'],
  ['Restaurants', '🍽️', '#e87ba4'],
  ['Loisirs', '🎉', '#008300'],
  ['Maison', '🛋️', '#2a78d6'],
  ['Vêtements', '👕', '#e87ba4'],
  ['Cadeaux', '🎁', '#e34948'],
  ['Dons & paroisse', '⛪', '#8a6d3b'],
  ['Divers', '📦', '#5f6b7a'],
];

// ---- Menu -----------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('💰 Budget')
    .addItem('1. Initialiser le classeur', 'initialiser')
    .addItem('2. Liens d\'installation', 'afficherLiens')
    .addSeparator()
    .addItem('Envoyer le récap du mois dernier (test)', 'envoyerRecapTest')
    .addItem('Régénérer les codes d\'accès', 'regenererCodes')
    .addToUi();
}

/** Crée les onglets, les catégories par défaut, les codes et le déclencheur du récap. */
function initialiser() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);

  Object.keys(HEADERS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const h = HEADERS[name];
    sh.getRange(1, 1, 1, h.length).setValues([h])
      .setFontWeight('bold').setBackground('#5b4bdb').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  });

  // Formats
  const dep = ss.getSheetByName(SH.DEPENSES);
  dep.getRange('B:B').setNumberFormat('dd/mm/yyyy');
  dep.getRange('C:C').setNumberFormat('#,##0.00 €');
  dep.getRange('H:I').setNumberFormat('dd/mm/yyyy hh:mm');
  ss.getSheetByName(SH.BUDGETS).getRange('C:C').setNumberFormat('@');
  ss.getSheetByName(SH.BUDGETS).getRange('D:D').setNumberFormat('#,##0.00 €');

  // Catégories par défaut (seulement si vide)
  const cat = ss.getSheetByName(SH.CATEGORIES);
  if (cat.getLastRow() < 2) {
    const rows = CATEGORIES_DEFAUT.map(function (c, i) {
      return [uid_(), c[0], c[1], c[2], i + 1, true];
    });
    cat.getRange(2, 1, rows.length, 6).setValues(rows);
  }

  // Config par défaut
  if (!getConfig_('recapEmails')) {
    setConfig_('recapEmails', Session.getEffectiveUser().getEmail());
  }

  // Codes d'accès
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('USERS')) regenererCodes_(false);

  // Déclencheur mensuel
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'envoyerRecapMensuel') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('envoyerRecapMensuel').timeBased().onMonthDay(1).atHour(8).inTimezone(TZ).create();

  const defaut = ss.getSheetByName('Feuille 1') || ss.getSheetByName('Sheet1');
  if (defaut && defaut.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(defaut);

  SpreadsheetApp.getUi().alert(
    '✅ Classeur prêt !\n\nÉtape suivante : Déployer › Nouveau déploiement › Application Web\n' +
    '• Exécuter en tant que : Moi\n• Qui a accès : Tout le monde\n\n' +
    'Puis menu 💰 Budget › 2. Liens d\'installation.'
  );
}

function regenererCodes() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.alert('Régénérer les codes ?', 'Les téléphones déjà connectés devront être reconnectés avec les nouveaux liens.', ui.ButtonSet.YES_NO);
  if (r === ui.Button.YES) { regenererCodes_(true); afficherLiens(); }
}

function regenererCodes_() {
  const users = {};
  PERSONNES.forEach(function (p) {
    users[Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8)] = p;
  });
  PropertiesService.getScriptProperties().setProperty('USERS', JSON.stringify(users));
}

/** Affiche un lien par personne : l'ouvrir sur le téléphone connecte l'app automatiquement. */
function afficherLiens() {
  const users = JSON.parse(PropertiesService.getScriptProperties().getProperty('USERS') || '{}');
  const ui = SpreadsheetApp.getUi();
  let apiUrl = getConfig_('apiUrl');
  if (!/\/exec$/.test(apiUrl)) {
    try { apiUrl = ScriptApp.getService().getUrl() || ''; } catch (e) { apiUrl = ''; }
  }
  if (!/\/exec$/.test(apiUrl)) {
    const r = ui.prompt('Adresse de l\'application Web',
      'Déployer › Gérer les déploiements › copie l\'« URL de l\'application Web » (elle se termine par /exec) et colle-la ici :',
      ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    apiUrl = r.getResponseText().trim();
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(apiUrl)) { ui.alert('Adresse invalide : elle doit commencer par https://script.google.com/ et finir par /exec'); return; }
  }
  setConfig_('apiUrl', apiUrl);
  let html = '<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">';
  html += '<p>Envoie à chacun <b>son</b> lien et ouvre-le sur le téléphone (Chrome sur Android, Safari sur iPhone). Ne les partage avec personne d\'autre.</p>';
  Object.keys(users).forEach(function (token) {
    const cfg = Utilities.base64EncodeWebSafe(JSON.stringify({ u: apiUrl, t: token }), Utilities.Charset.UTF_8);
    const link = APP_URL + '#cfg=' + cfg;
    html += '<div style="margin:12px 0;padding:10px;border-radius:10px;background:#f3f1ff">' +
      '<b>' + users[token] + '</b><br>' +
      '<a href="' + link + '" target="_blank">Ouvrir l\'app</a>' +
      '<textarea readonly style="width:100%;height:54px;margin-top:6px;font-size:11px" onclick="this.select()">' + link + '</textarea>' +
      '<div style="font-size:12px;color:#555">Saisie manuelle — code : <code>' + token + '</code></div></div>';
  });
  html += '<p style="font-size:12px;color:#555">Adresse de l\'API : <code style="word-break:break-all">' + apiUrl + '</code></p></div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(520).setHeight(520), '📲 Liens d\'installation');
}

// ---- API ------------------------------------------------------
function doGet() {
  return json_({ ok: true, app: 'notre-budget' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Requête invalide' }); }

  const users = JSON.parse(PropertiesService.getScriptProperties().getProperty('USERS') || '{}');
  const user = users[req.token];
  if (!user) return json_({ ok: false, error: 'Code d\'accès invalide', code: 'AUTH' });

  const actions = {
    bootstrap: function () { return bootstrap_(user); },
    addDepense: function (d) { return addDepense_(d, user); },
    updateDepense: function (d) { return updateDepense_(d); },
    deleteDepense: function (d) { return deleteRowById_(SH.DEPENSES, d.id); },
    saveCategorie: function (d) { return saveCategorie_(d); },
    deleteCategorie: function (d) { return deleteCategorie_(d.id); },
    reorderCategories: function (d) { return reorderCategories_(d.ids); },
    setBudget: function (d) { return setBudget_(d); },
    saveConfig: function (d) { return saveConfig_(d); },
  };
  const fn = actions[req.action];
  if (!fn) return json_({ ok: false, error: 'Action inconnue : ' + req.action });

  const lock = LockService.getScriptLock();
  try {
    if (req.action !== 'bootstrap') lock.waitLock(15000);
    return json_({ ok: true, data: fn(req.data || {}) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---- Lecture ---------------------------------------------------
function bootstrap_(user) {
  return {
    user: user,
    categories: readCategories_(),
    budgets: readBudgets_(),
    depenses: readDepenses_(),
    config: { recapEmails: getConfig_('recapEmails') || '', sheetUrl: SpreadsheetApp.getActive().getUrl() },
    serverTime: new Date().toISOString(),
  };
}

function rows_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Onglet manquant : ' + name + ' (lance « Initialiser le classeur »)');
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, HEADERS[name].length).getValues();
}

function readCategories_() {
  return rows_(SH.CATEGORIES).filter(function (r) { return r[0]; }).map(function (r) {
    return { id: String(r[0]), nom: String(r[1]), emoji: String(r[2] || '📦'), couleur: String(r[3] || '#5f6b7a'), ordre: Number(r[4]) || 0, actif: r[5] !== false && String(r[5]).toUpperCase() !== 'FALSE' };
  }).sort(function (a, b) { return a.ordre - b.ordre; });
}

function readBudgets_() {
  return rows_(SH.BUDGETS).filter(function (r) { return r[0]; }).map(function (r) {
    return { categorieId: String(r[0]), mois: moisStr_(r[2]), montant: Number(r[3]) || 0 };
  });
}

function readDepenses_() {
  return rows_(SH.DEPENSES).filter(function (r) { return r[0]; }).map(function (r) {
    return { id: String(r[0]), date: dateStr_(r[1]), montant: Number(r[2]) || 0, categorieId: String(r[3]), note: String(r[5] || ''), saisiPar: String(r[6] || '') };
  });
}

// ---- Écriture --------------------------------------------------
function addDepense_(d, user) {
  validerDepense_(d);
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.DEPENSES);
  const id = d.id || uid_();
  if (findRow_(sh, id)) return { id: id, duplicate: true }; // idempotent (file d'attente hors-ligne)
  const now = new Date();
  sh.appendRow([id, parseDate_(d.date), round2_(d.montant), d.categorieId, nomCategorie_(d.categorieId), d.note || '', user, now, now]);
  return { id: id, saisiPar: user };
}

function updateDepense_(d) {
  validerDepense_(d);
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.DEPENSES);
  const row = findRow_(sh, d.id);
  if (!row) throw new Error('Dépense introuvable');
  sh.getRange(row, 2, 1, 5).setValues([[parseDate_(d.date), round2_(d.montant), d.categorieId, nomCategorie_(d.categorieId), d.note || '']]);
  sh.getRange(row, 9).setValue(new Date());
  return { id: d.id };
}

function validerDepense_(d) {
  if (!(Number(d.montant) > 0)) throw new Error('Montant invalide');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) throw new Error('Date invalide');
  if (!d.categorieId) throw new Error('Catégorie manquante');
}

function saveCategorie_(c) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.CATEGORIES);
  const nom = String(c.nom || '').trim();
  if (!nom) throw new Error('Nom de catégorie vide');
  if (c.id) {
    const row = findRow_(sh, c.id);
    if (row) {
      sh.getRange(row, 2, 1, 3).setValues([[nom, c.emoji || '📦', c.couleur || '#5f6b7a']]);
      return { id: c.id };
    }
  }
  const id = c.id || uid_();
  const ordre = readCategories_().reduce(function (m, x) { return Math.max(m, x.ordre); }, 0) + 1;
  sh.appendRow([id, nom, c.emoji || '📦', c.couleur || '#5f6b7a', ordre, true]);
  return { id: id, ordre: ordre };
}

/** Supprime la catégorie. Si des dépenses l'utilisent, elle est archivée pour garder l'historique. */
function deleteCategorie_(id) {
  const used = readDepenses_().some(function (d) { return d.categorieId === id; });
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.CATEGORIES);
  const row = findRow_(sh, id);
  if (!row) return { id: id };
  if (used) { sh.getRange(row, 6).setValue(false); return { id: id, archived: true }; }
  sh.deleteRow(row);
  const b = SpreadsheetApp.getActive().getSheetByName(SH.BUDGETS);
  const vals = b.getLastRow() > 1 ? b.getRange(2, 1, b.getLastRow() - 1, 1).getValues() : [];
  for (let i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]) === id) b.deleteRow(i + 2);
  return { id: id, archived: false };
}

function reorderCategories_(ids) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.CATEGORIES);
  (ids || []).forEach(function (id, i) {
    const row = findRow_(sh, id);
    if (row) sh.getRange(row, 5).setValue(i + 1);
  });
  return { ok: true };
}

/** Budget d'une catégorie valable à partir d'un mois (les mois passés gardent leur ancien budget). */
function setBudget_(d) {
  if (!/^\d{4}-\d{2}$/.test(d.mois || '')) throw new Error('Mois invalide');
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.BUDGETS);
  const montant = Math.max(0, round2_(d.montant || 0));
  const last = sh.getLastRow();
  if (last > 1) {
    const vals = sh.getRange(2, 1, last - 1, 3).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (String(vals[i][0]) === d.categorieId && moisStr_(vals[i][2]) === d.mois) {
        sh.getRange(i + 2, 2, 1, 3).setValues([[nomCategorie_(d.categorieId), d.mois, montant]]);
        return { ok: true };
      }
    }
  }
  sh.appendRow([d.categorieId, nomCategorie_(d.categorieId), d.mois, montant]);
  sh.getRange(sh.getLastRow(), 3).setNumberFormat('@').setValue(d.mois);
  return { ok: true };
}

function saveConfig_(d) {
  if (typeof d.recapEmails === 'string') {
    const list = d.recapEmails.split(/[,;\s]+/).filter(Boolean);
    list.forEach(function (m) { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)) throw new Error('Adresse invalide : ' + m); });
    setConfig_('recapEmails', list.join(', '));
  }
  return { recapEmails: getConfig_('recapEmails') };
}

// ---- Récap mensuel --------------------------------------------
function envoyerRecapTest() {
  envoyerRecapMensuel();
  SpreadsheetApp.getUi().alert('📧 Récap envoyé à : ' + getConfig_('recapEmails'));
}

/** Déclenché le 1er de chaque mois : récap du mois écoulé. */
function envoyerRecapMensuel() {
  // Mois écoulé, calculé à l'heure de Paris
  const cur = Utilities.formatDate(new Date(), TZ, 'yyyy-MM').split('-').map(Number);
  const ref = new Date(cur[0], cur[1] - 2, 1, 12);
  const mois = ref.getFullYear() + '-' + ('0' + (ref.getMonth() + 1)).slice(-2);
  const refPrev = new Date(cur[0], cur[1] - 3, 1, 12);
  const prev = refPrev.getFullYear() + '-' + ('0' + (refPrev.getMonth() + 1)).slice(-2);
  const dest = getConfig_('recapEmails');
  if (!dest) return;

  const cats = readCategories_();
  const budgets = readBudgets_();
  const deps = readDepenses_();
  const depMois = deps.filter(function (d) { return d.date.slice(0, 7) === mois; });
  const totalPrev = deps.filter(function (d) { return d.date.slice(0, 7) === prev; }).reduce(function (s, d) { return s + d.montant; }, 0);

  const lignes = cats.map(function (c) {
    const spent = depMois.filter(function (d) { return d.categorieId === c.id; }).reduce(function (s, d) { return s + d.montant; }, 0);
    return { c: c, spent: spent, budget: budgetPour_(budgets, c.id, mois) };
  }).filter(function (l) { return l.c.actif || l.spent > 0; })
    .filter(function (l) { return l.spent > 0 || l.budget > 0; });

  const total = depMois.reduce(function (s, d) { return s + d.montant; }, 0);
  const totalBudget = lignes.reduce(function (s, l) { return s + l.budget; }, 0);
  const pct = totalBudget > 0 ? Math.round(total / totalBudget * 100) : null;
  const moisFr = moisFr_(ref);
  const h = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  const eur = function (n) { return n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €'; };
  const bar = function (p, color) {
    const w = Math.min(100, Math.max(0, p));
    return '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>' +
      '<td style="height:8px;width:' + w + '%;background:' + color + ';border-radius:4px"></td>' +
      '<td style="height:8px;background:#ece9f6;border-radius:4px"></td></tr></table>';
  };

  let html = '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:auto;color:#17162a">' +
    '<div style="background:linear-gradient(135deg,#5b4bdb,#9a5cf0 60%,#e0609a);background-color:#5b4bdb;color:#fff;border-radius:18px;padding:22px">' +
    '<div style="font-size:14px;opacity:.85">Récap de ' + moisFr + '</div>' +
    '<div style="font-size:32px;font-weight:800;margin:6px 0">' + eur(total) + '</div>' +
    '<div style="font-size:14px">' + (totalBudget > 0 ? 'sur ' + eur(totalBudget) + ' de budget · <b>' + pct + ' %</b>' : 'dépensés') + '</div>';
  if (totalBudget > 0) {
    html += '<div style="margin-top:12px">' + bar(pct, total > totalBudget ? '#ffb4b4' : '#ffffff') + '</div>' +
      '<div style="font-size:14px;margin-top:8px">' + (total > totalBudget ? '⚠️ Dépassement de ' + eur(total - totalBudget) : '✅ Reste ' + eur(totalBudget - total)) + '</div>';
  }
  if (totalPrev > 0) {
    const diff = total - totalPrev;
    html += '<div style="font-size:13px;opacity:.85;margin-top:6px">' + (diff >= 0 ? '▲ ' : '▼ ') + eur(Math.abs(diff)) + ' par rapport au mois précédent</div>';
  }
  html += '</div><h3 style="margin:22px 4px 8px">Par catégorie</h3>';

  lignes.sort(function (a, b) { return b.spent - a.spent; }).forEach(function (l) {
    const p = l.budget > 0 ? Math.round(l.spent / l.budget * 100) : null;
    const over = l.budget > 0 && l.spent > l.budget;
    html += '<div style="padding:10px 4px;border-bottom:1px solid #eee">' +
      '<table width="100%" style="border-collapse:collapse"><tr>' +
      '<td style="font-size:15px">' + h(l.c.emoji + ' ' + l.c.nom) + '</td>' +
      '<td align="right" style="font-size:14px;white-space:nowrap"><b>' + eur(l.spent) + '</b>' +
      (l.budget > 0 ? ' <span style="color:#6b6880">/ ' + eur(l.budget) + '</span>' : '') + '</td></tr></table>' +
      (l.budget > 0 ? '<div style="margin-top:6px">' + bar(p, over ? '#d03b3b' : (/^#[0-9a-f]{6}$/i.test(l.c.couleur) ? l.c.couleur : '#5b4bdb')) + '</div>' +
        '<div style="font-size:12px;color:' + (over ? '#d03b3b' : '#6b6880') + ';margin-top:3px">' + p + ' %' + (over ? ' · dépassé de ' + eur(l.spent - l.budget) : '') + '</div>' : '') +
      '</div>';
  });

  const top = depMois.slice().sort(function (a, b) { return b.montant - a.montant; }).slice(0, 5);
  if (top.length) {
    html += '<h3 style="margin:22px 4px 8px">Plus grosses dépenses</h3>';
    top.forEach(function (d) {
      const c = cats.filter(function (x) { return x.id === d.categorieId; })[0] || { emoji: '📦', nom: '?' };
      html += '<div style="padding:6px 4px;font-size:14px">' + h(c.emoji + ' ' + (d.note || c.nom)) +
        ' <span style="color:#6b6880">· ' + d.date.split('-').reverse().slice(0, 2).join('/') + '</span>' +
        '<span style="float:right"><b>' + eur(d.montant) + '</b></span></div>';
    });
  }
  html += '<p style="text-align:center;margin:26px 0 8px"><a href="' + APP_URL + '" style="background:#5b4bdb;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:600">Ouvrir Notre Budget</a></p>' +
    '<p style="font-size:12px;color:#999;text-align:center">' + depMois.length + ' dépenses saisies en ' + moisFr + '</p></div>';

  MailApp.sendEmail({ to: dest, subject: '💰 Budget ' + moisFr + ' : ' + eur(total) + (pct !== null ? ' (' + pct + ' %)' : ''), htmlBody: html, name: 'Notre Budget' });
  return mois;
}

function budgetPour_(budgets, catId, mois) {
  let best = null;
  budgets.forEach(function (b) {
    if (b.categorieId === catId && b.mois <= mois && (!best || b.mois > best.mois)) best = b;
  });
  return best ? best.montant : 0;
}

// ---- Utilitaires ------------------------------------------------
function uid_() { return Utilities.getUuid(); }
function round2_(n) { return Math.round(Number(n) * 100) / 100; }

function findRow_(sh, id) {
  if (!id || sh.getLastRow() < 2) return 0;
  const cell = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return cell ? cell.getRow() : 0;
}

function deleteRowById_(name, id) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  const row = findRow_(sh, id);
  if (row) sh.deleteRow(row);
  return { id: id, deleted: !!row };
}

function nomCategorie_(id) {
  const c = readCategories_().filter(function (x) { return x.id === id; })[0];
  return c ? c.nom : '';
}

function parseDate_(s) {
  const p = String(s).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], 12, 0, 0);
}

function dateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const s = String(v);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : s.slice(0, 10);
}

function moisStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM');
  return String(v).slice(0, 7);
}

function moisFr_(d) {
  const m = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return m[d.getMonth()] + ' ' + d.getFullYear();
}

function getConfig_(key) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.CONFIG);
  if (!sh || sh.getLastRow() < 2) return '';
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (let i = 0; i < vals.length; i++) if (vals[i][0] === key) return String(vals[i][1]);
  return '';
}

function setConfig_(key, value) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SH.CONFIG);
  const last = sh.getLastRow();
  if (last > 1) {
    const vals = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < vals.length; i++) if (vals[i][0] === key) { sh.getRange(i + 2, 2).setValue(value); return; }
  }
  sh.appendRow([key, value]);
}
