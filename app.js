// =====================================================================
// Tréning – osobná appka. Bez frameworku, všetko v tomto jednom súbore.
// Plán sa číta zo súboru PLAN_SUBOR. Pre Blok 2 stačí nahradiť ten súbor.
// =====================================================================
const PLAN_SUBOR = 'blok1_plan.json';
const KLUC = 'trening_data';     // localStorage: zápisy
const KLUC_CAS = 'trening_timer'; // localStorage: časovač

let plan = null;
// data.log["2026-11-23|bench"] = { sets:[{w,r,rir,v,d}], note }
// data.body["2026-11-23"] = { kg, waist }  (kľúč = pondelok daného týždňa)
let data = JSON.parse(localStorage.getItem(KLUC) || 'null') || { log: {}, body: {}, seen: false };
const ulozit = () => localStorage.setItem(KLUC, JSON.stringify(data));

const stav = { view: 'home', week: 0, day: 0, open: new Set() };
const $ = s => document.querySelector(s);
// ochrana pred vložením HTML z textov
const h = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
const fmt = n => n == null ? '' : String(Math.round(n * 100) / 100).replace('.', ',');
const dnes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const datSk = iso => iso.split('-').reverse().slice(0, 2).join('. ') + '.';
const DNI = ['Po', 'Ut', 'St', 'Št', 'Pi', 'So', 'Ne'];

// ---------- Polia zápisu podľa logMode ----------
const POLIA = {
  weight_reps_rir: [['w', 'kg'], ['r', 'opak.'], ['rir', 'RIR']],
  reps_rir: [['r', 'opak.'], ['rir', 'RIR']],
  time: [['v', 'sekundy']],
  box_height: [['v', 'cm']],
  distance_cm: [['v', 'cm']],
  weight_distance: [['w', 'kg'], ['v', 'm']],
  duration_hr: [['v', 'min'], ['r', 'tep/min']],
  sets_only: [], check: []
};
function polia(ex) {
  const p = [...(POLIA[ex.logMode] || [])];
  if (ex.logMode === 'time' && ex.weightKg > 0) p.unshift(['w', 'kg']); // čas + voliteľne váha
  return p;
}

// ---------- Plánované hodnoty ako predvyplnenie ----------
function predvyplnenie(ex) {
  const prvy = s => { const m = String(s ?? '').match(/^\d+([.,]\d+)?/); return m ? m[0].replace(',', '.') : ''; };
  const s = { d: false };
  if (ex.weightKg != null) s.w = fmt(ex.weightKg);
  if (ex.logMode === 'weight_reps_rir' || ex.logMode === 'reps_rir') { s.r = prvy(ex.reps); s.rir = prvy(ex.targetRIR); }
  if (ex.logMode === 'time' || ex.logMode === 'duration_hr' || ex.logMode === 'weight_distance') s.v = prvy(ex.reps);
  return s;
}

// ---------- Zobrazenie plánovanej váhy s jednotkou ----------
function planVaha(ex) {
  const w = ex.weightKg, k = fmt(w);
  switch (ex.weightType) {
    case 'barbell_total': return w != null ? `${k} kg celkom (s tyčou)` : '';
    case 'added_to_bodyweight': return w ? `+${k} kg na opasku` : 'vlastná váha';
    case 'per_dumbbell': return `${k} kg / 1 jednoručka`;
    case 'per_cable': return `${k} kg / 1 kladka`;
    case 'stack': return `${k} na stacku`;
    case 'landmine_plates': return `${k} kg kotúče na tyči`;
    case 'plates': return `${k} kg kotúče`;
    case 'plate': return `${k} kg kotúč`;
    case 'bodyweight': return w ? `vlastná váha +${k} kg` : 'vlastná váha';
    case 'none': return '';
    default: return plan.meta.weightTypes?.[ex.weightType] || ''; // medicinbal, box, guma
  }
}

// ---------- Zápisy ----------
const kl = (date, id) => `${date}|${id}`;
function zaznam(date, ex) {
  const k = kl(date, ex.id);
  if (!data.log[k]) data.log[k] = { sets: [], note: '' };
  const z = data.log[k];
  while (z.sets.length < ex.sets) z.sets.push(predvyplnenie(ex));
  return z;
}
const maZapis = (date, id) => data.log[kl(date, id)]?.sets.some(s => s.d);

// Posledný predošlý zápis rovnakého cviku (id) – z akéhokoľvek skoršieho dátumu
function minule(ex, date) {
  let best = null;
  for (const k in data.log) {
    const [d, id] = k.split('|');
    if (id === ex.id && d < date && data.log[k].sets.some(s => s.d) && (!best || d > best.d)) best = { d, z: data.log[k] };
  }
  return best;
}
function popisSerie(ex, s) {
  const f = polia(ex);
  if (ex.logMode === 'weight_reps_rir') return `${s.w ?? ''}×${s.r ?? ''}${s.rir ? ' @' + s.rir : ''}`;
  const t = f.map(([k, u]) => s[k] ? `${s[k]} ${u}` : '').filter(Boolean).join(', ');
  return t || '✓';
}

// ---------- Stav dňa: hotovo / rozpracované / nezačaté ----------
function stavDna(day) {
  let hotove = 0, spolu = 0;
  for (const ex of day.exercises) {
    const z = data.log[kl(day.date, ex.id)];
    spolu += Math.max(ex.sets, z ? z.sets.length : 0);
    hotove += z ? z.sets.filter(s => s.d).length : 0;
  }
  return hotove === 0 ? '○' : hotove >= spolu ? '✓' : '◐';
}

// =====================================================================
//  ČASOVAČ – počíta podľa reálneho času (uložený čas konca / štartu)
// =====================================================================
// t = { mode:'down'|'up', end:ms (down), start:ms (up), fired:bool, base:sekundy (na reštart) }
let t = JSON.parse(localStorage.getItem(KLUC_CAS) || 'null');
const ulozT = () => t ? localStorage.setItem(KLUC_CAS, JSON.stringify(t)) : localStorage.removeItem(KLUC_CAS);
let audio = null;

function pripravZvuk() { // musí sa zavolať z ťuknutia, inak mobil zvuk zablokuje
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch (e) { }
}
function pip() {
  if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 500]);
  if (!audio) return;
  [0, 0.35, 0.7].forEach(o => {
    const osc = audio.createOscillator(), g = audio.createGain();
    osc.frequency.value = 880; g.gain.value = 0.3;
    osc.connect(g); g.connect(audio.destination);
    osc.start(audio.currentTime + o); osc.stop(audio.currentTime + o + 0.25);
  });
}
function spustPauzu(sec) { t = { mode: 'down', end: Date.now() + sec * 1000, base: sec, fired: false }; ulozT(); kresliT(); }
function pripocitaj(d) { if (t?.mode === 'down') { t.end += d * 1000; t.fired = false; ulozT(); kresliT(); } }
function stopT() { t = null; ulozT(); kresliT(); }
function restartT() {
  if (!t) return;
  if (t.mode === 'down') spustPauzu(t.base); else { t.start = Date.now(); ulozT(); kresliT(); }
}
function stopky() { pripravZvuk(); t = { mode: 'up', start: Date.now() }; ulozT(); kresliT(); }

const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
function kresliT() {
  const el = $('#timer');
  if (!t) { el.innerHTML = `<button id="tst">⏱ Stopky</button><span class="dim" style="flex:1;text-align:center">Pauza sa spustí po uložení série</span>`; $('#tst').onclick = stopky; return; }
  el.innerHTML = `<button data-a="m">−15</button><div class="t" id="tv"></div><button data-a="p">+15</button><button data-a="r">↻</button><button data-a="s">■</button>`;
  el.onclick = e => { const a = e.target.dataset.a; if (a === 'm') pripocitaj(-15); if (a === 'p') pripocitaj(15); if (a === 'r') restartT(); if (a === 's') stopT(); };
  tikT();
}
function tikT() {
  const tv = $('#tv'); if (!t || !tv) return;
  if (t.mode === 'up') { tv.textContent = mmss(Math.floor((Date.now() - t.start) / 1000)); return; }
  const zost = Math.ceil((t.end - Date.now()) / 1000);
  if (zost <= 0) {
    tv.textContent = '0:00 ✓'; tv.className = 't end';
    if (!t.fired) { t.fired = true; ulozT(); pip(); }
  } else { tv.textContent = mmss(zost); tv.className = 't'; }
}
setInterval(tikT, 250);
document.addEventListener('visibilitychange', tikT); // po návrate do appky hneď prepočíta

function toast(msg) { const e = $('#toast'); e.textContent = msg; e.hidden = false; setTimeout(() => e.hidden = true, 3500); }

// =====================================================================
//  DOMOV / DEŇ
// =====================================================================
function dnesnyIndex() {
  const d = dnes();
  for (const [wi, w] of plan.weeks.entries()) for (const [di, dy] of w.days.entries()) if (dy.date === d) return [wi, di];
  return d < plan.weeks[0].days[0].date ? [0, 0] : [plan.weeks.length - 1, 6]; // mimo plánu
}

function kresliHome() {
  const w = plan.weeks[stav.week], day = w.days[stav.day];
  let html = '';
  if (!data.seen) html += `<div class="warn">⚠️ Tvoje zápisy sú uložené <b>len v tomto mobile</b> (v prehliadači). Pravidelne rob zálohu: Dáta → Export.<br><button id="rozumiem" class="big on">Rozumiem</button></div>`;
  html += `<div class="row">${plan.weeks.map((x, i) => `<button data-w="${i}" class="${i === stav.week ? 'on' : ''}">T${x.week}</button>`).join('')}</div>`;
  html += `<div class="row">${w.days.map((x, i) => `<button data-d="${i}" class="${i === stav.day ? 'on' : ''}">${DNI[i]}<br>${stavDna(x)}</button>`).join('')}</div>`;
  html += `<div class="dim">${h(w.phase)} · ${h(w.note)}</div>`;
  html += `<h2>${h(day.weekday)} ${datSk(day.date)} – ${h(day.title)}</h2><div class="dim">${h(day.timeHint)}</div>`;
  let prev = null;
  for (const ex of day.exercises) {
    const ss = ex.supersetGroup;
    if (ss && ss !== prev) html += `<div class="sstag">Superséria ${h(ss)} – striedaj</div>`;
    prev = ss;
    html += kartaHtml(ex, day);
  }
  $('#main').innerHTML = html;
  const r = $('#rozumiem'); if (r) r.onclick = () => { data.seen = true; ulozit(); kresliHome(); };
}

function kartaHtml(ex, day) {
  const open = stav.open.has(ex.id);
  const z = data.log[kl(day.date, ex.id)];
  const hotove = z ? z.sets.filter(s => s.d).length : 0;
  const chips = [
    `<span>${ex.sets} × ${h(ex.reps)}</span>`,
    planVaha(ex) && `<span class="plan">${h(planVaha(ex))}</span>`,
    ex.targetRIR && `<span>RIR ${h(ex.targetRIR)}</span>`,
    ex.tempo && `<span>tempo ${h(ex.tempo)}</span>`,
    ex.restText && ex.restText !== '—' && `<span>pauza ${h(ex.restText)}</span>`
  ].filter(Boolean).join('');
  let b = `<div class="card${ex.supersetGroup ? ' ss' : ''}${open ? ' open' : ''}" data-id="${h(ex.id)}">
    <div class="hd"><div><span class="lab">${h(ex.label)}</span><span class="name">${h(ex.name)}</span></div>
    <div>${hotove ? `${hotove}/${ex.sets} ✓` : ''}</div></div>
    <div class="chips">${chips}</div>`;
  if (ex.note) b += `<div class="dim">ℹ️ ${h(ex.note)}</div>`;
  if (open) {
    const zz = zaznam(day.date, ex), f = polia(ex), m = minule(ex, day.date);
    if (m) b += `<div class="past">Minule (${datSk(m.d)}): ${m.z.sets.filter(s => s.d).map(s => popisSerie(ex, s)).join(' · ')}${m.z.note ? '<br>📝 ' + h(m.z.note) : ''}</div>`;
    b += zz.sets.map((s, i) => `<div class="set" data-i="${i}"><span class="n">${i + 1}.</span>${f.map(([k, u]) =>
      `<div><small>${u}</small><input inputmode="decimal" data-k="${k}" value="${h(s[k] ?? '')}"></div>`).join('')}
      ${!f.length ? '<div class="dim" style="text-align:center;padding-bottom:14px">hotovo?</div>' : ''}
      <button data-ok class="${s.d ? 'on' : ''}">✓</button></div>`).join('');
    b += `<div class="row"><button data-plus>+ séria navyše</button></div>
      <textarea data-note placeholder="Poznámka (napr. rameno OK)">${h(zz.note)}</textarea>`;
  }
  if (ex.warmupSets) b += `<details><summary>Rozcvičkové série</summary>${h(ex.warmupSets)}</details>`;
  if (ex.cues) b += `<details><summary>Pokyny k technike</summary>${h(ex.cues)}</details>`;
  return b + '</div>';
}

// ---------- Udalosti na domovskej obrazovke (jeden poslucháč pre všetko) ----------
document.addEventListener('click', e => {
  if (stav.view !== 'home') return;
  const w = e.target.closest('[data-w]'), d = e.target.closest('[data-d]');
  if (w) { stav.week = +w.dataset.w; return kresliHome(); }
  if (d) { stav.day = +d.dataset.d; return kresliHome(); }
  const card = e.target.closest('.card'); if (!card) return;
  const day = plan.weeks[stav.week].days[stav.day];
  const ex = day.exercises.find(x => x.id === card.dataset.id);
  const obnov = () => { card.outerHTML = kartaHtml(ex, day); };
  if (e.target.closest('details')) return;
  if (e.target.closest('.hd')) { stav.open.has(ex.id) ? stav.open.delete(ex.id) : stav.open.add(ex.id); return obnov(); }
  const z = zaznam(day.date, ex);
  if (e.target.matches('[data-ok]')) {
    pripravZvuk();
    const s = z.sets[+e.target.closest('.set').dataset.i];
    s.d = !s.d; ulozit();
    if (s.d && ex.restSec > 0) spustPauzu(ex.restSec); // po uložení série sa spustí pauza
    obnov(); kresliStavDna();
  }
  if (e.target.matches('[data-plus]')) { z.sets.push({ ...(z.sets.at(-1) || predvyplnenie(ex)), d: false }); ulozit(); obnov(); }
});
document.addEventListener('input', e => {
  if (stav.view !== 'home') return;
  const card = e.target.closest('.card'); if (!card) return;
  const day = plan.weeks[stav.week].days[stav.day];
  const ex = day.exercises.find(x => x.id === card.dataset.id);
  const z = zaznam(day.date, ex);
  if (e.target.matches('[data-note]')) z.note = e.target.value;
  else if (e.target.dataset.k) z.sets[+e.target.closest('.set').dataset.i][e.target.dataset.k] = e.target.value;
  ulozit();
});
function kresliStavDna() { // len prepíše ikony dní, aby sa nestratil rozpísaný text
  document.querySelectorAll('[data-d]').forEach(b => { const i = +b.dataset.d; b.innerHTML = `${DNI[i]}<br>${stavDna(plan.weeks[stav.week].days[i])}`; });
}

// =====================================================================
//  PREHĽAD – hlavné cviky, plán vs. realita, e1RM, telesné miery
// =====================================================================
function telHmotnost(date) { // posledná zapísaná hmotnosť do daného dňa, inak z plánu
  const k = Object.keys(data.body).filter(d => d <= date && data.body[d].kg).sort().pop();
  return k ? num(data.body[k].kg) : plan.meta.bodyweightKg;
}
const e1rm = (kg, r, rir) => kg * (1 + (r + rir) / 30); // Epley

function kresliPrehlad() {
  // zozbierať hlavné cviky; test_bench sa zlúči s bench
  const cviky = new Map();
  plan.weeks.forEach(w => w.days.forEach(dy => dy.exercises.forEach(ex => {
    if (ex.category !== 'main' && ex.category !== 'test') return;
    const g = ex.id.replace(/^test_/, '');
    if (!cviky.has(g)) cviky.set(g, { ex, tyz: plan.weeks.map(() => ({ plan: [], real: null })) });
    const c = cviky.get(g), wi = plan.weeks.indexOf(w);
    c.tyz[wi].plan.push(`${fmt(ex.weightKg)}×${ex.reps}`);
    const z = data.log[kl(dy.date, ex.id)];
    (z?.sets || []).filter(s => s.d).forEach(s => {
      const kg = num(s.w) ?? 0, r = num(s.r), rir = num(s.rir) ?? 0;
      if (r == null) return;
      const tel = ex.weightType === 'added_to_bodyweight' ? telHmotnost(dy.date) : 0;
      const e = e1rm(kg + tel, r, rir);
      const cur = c.tyz[wi].real;
      if (!cur || kg > cur.kg || (kg === cur.kg && r > cur.r)) c.tyz[wi].real = { kg, r, rir, e: Math.max(e, cur?.e || 0) };
      else cur.e = Math.max(cur.e, e);
    });
  })));
  let html = '<h2>Prehľad hlavných cvikov</h2><div class="dim">Plán → najťažšia séria · e1RM (Epley). Pri cvikoch s opaskom je v e1RM aj telesná hmotnosť.</div><table><tr><th>Cvik</th>' +
    plan.weeks.map(w => `<th>T${w.week}</th>`).join('') + '</tr>';
  for (const [, c] of cviky) {
    html += `<tr><td><b>${h(c.ex.name.replace(/^TEST – /, ''))}</b></td>` + c.tyz.map(t => {
      const p = [...new Set(t.plan)].join(' / ');
      return `<td class="dim">${h(p) || '–'}<br>${t.real ? `<b style="color:var(--text)">${fmt(t.real.kg)}×${t.real.r}${t.real.rir !== '' ? '@' + t.real.rir : ''}</b><br>e1RM ${Math.round(t.real.e)}` : ''}</td>`;
    }).join('') + '</tr>';
  }
  html += '</table><h2>Telo (raz týždenne)</h2>';
  html += plan.weeks.map(w => {
    const b = data.body[w.startDate] || {};
    return `<div class="card"><b>T${w.week}</b> <span class="dim">od ${datSk(w.startDate)}</span><div class="row" data-bw="${w.startDate}">
      <div style="flex:1"><small class="dim">ranná hmotnosť (kg)</small><input inputmode="decimal" data-b="kg" value="${h(b.kg ?? '')}"></div>
      <div style="flex:1"><small class="dim">obvod pása (cm)</small><input inputmode="decimal" data-b="waist" value="${h(b.waist ?? '')}"></div></div></div>`;
  }).join('');
  $('#main').innerHTML = html;
}
document.addEventListener('input', e => {
  const r = e.target.closest('[data-bw]'); if (!r) return;
  const k = r.dataset.bw; data.body[k] = data.body[k] || {};
  data.body[k][e.target.dataset.b] = e.target.value; ulozit();
});

// =====================================================================
//  DÁTA – export / import
// =====================================================================
function kresliData() {
  const n = Object.values(data.log).reduce((a, z) => a + z.sets.filter(s => s.d).length, 0);
  $('#main').innerHTML = `<h2>Dáta</h2><div class="card">Zapísaných sérií: <b>${n}</b><br>
    <span class="dim">Všetko je uložené len v tomto mobile. Po každom týždni urob Export a pošli ho trénerovi.</span></div>
    <button class="big" id="exJ">⬇ Export JSON (záloha)</button>
    <button class="big" id="exC">⬇ Export CSV (pre trénera)</button>
    <button class="big" id="imp">⬆ Import zo zálohy (JSON)</button>
    <input type="file" id="file" accept=".json,application/json" hidden>
    <div class="dim" style="margin-top:12px">Plán: ${h(plan.meta.title)} (${h(plan.meta.version)})</div>`;
  $('#exJ').onclick = () => stiahni(`trening_zaloha_${dnes()}.json`, JSON.stringify({ app: 'trening', plan: plan.meta.title, exportovane: new Date().toISOString(), ...data }, null, 1), 'application/json');
  $('#exC').onclick = () => stiahni(`trening_${dnes()}.csv`, '﻿' + csv(), 'text/csv');
  $('#imp').onclick = () => $('#file').click();
  $('#file').onchange = async e => {
    try {
      const j = JSON.parse(await e.target.files[0].text());
      if (!j.log || !j.body) throw 0;
      if (!confirm('Import nahradí všetky zápisy v tomto mobile. Pokračovať?')) return;
      data = { log: j.log, body: j.body, seen: true }; ulozit(); toast('Import hotový'); kresliData();
    } catch { toast('Súbor nie je platná záloha'); }
  };
}
function csv() {
  const riadky = [['datum', 'tyzden', 'den', 'cvik_id', 'label', 'cvik', 'seria', 'vaha_kg', 'opakovania', 'rir', 'hodnota', 'poznamka']];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  plan.weeks.forEach(w => w.days.forEach(dy => dy.exercises.forEach(ex => {
    const z = data.log[kl(dy.date, ex.id)]; if (!z) return;
    z.sets.forEach((s, i) => { if (s.d) riadky.push([dy.date, w.week, dy.weekday, ex.id, ex.label, ex.name, i + 1, s.w, s.r, s.rir, s.v, z.note]); });
  })));
  Object.entries(data.body).sort().forEach(([d, b]) => riadky.push([d, '', '', 'telo', '', 'Hmotnosť / pás', '', b.kg, '', '', b.waist, '']));
  return riadky.map(r => r.map(q).join(';')).join('\n');
}
async function stiahni(meno, obsah, typ) {
  const f = new File([obsah], meno, { type: typ });
  // na iPhone najlepšie funguje zdieľanie (uložiť do Súborov / poslať)
  if (navigator.canShare?.({ files: [f] })) { try { await navigator.share({ files: [f] }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = meno; a.click();
}

// =====================================================================
//  Štart
// =====================================================================
function kresli() {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === stav.view));
  ({ home: kresliHome, prehlad: kresliPrehlad, data: kresliData })[stav.view]();
}
$('#nav').onclick = e => { if (e.target.dataset.v) { stav.view = e.target.dataset.v; kresli(); scrollTo(0, 0); } };

fetch(PLAN_SUBOR).then(r => r.json()).then(p => {
  plan = p;
  [stav.week, stav.day] = dnesnyIndex();
  kresli(); kresliT();
}).catch(() => $('#main').innerHTML = '<div class="warn">Nepodarilo sa načítať plán.</div>');

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
