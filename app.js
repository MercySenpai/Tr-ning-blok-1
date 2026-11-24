// =====================================================================
// Tréning – osobná appka. Bez frameworku, všetko v tomto jednom súbore.
//
// PLÁN: appka číta súbor plan.json. Pre nový blok (Blok 2) stačí plan.json
// nahradiť novým – zápisy ostanú, lebo sú uložené podľa dátumu a id cviku.
// Každý načítaný plán si appka odloží (archív), takže export a Pokrok
// vidia aj staršie bloky.
// =====================================================================
const PLAN_SUBOR = 'plan.json';
const KLUC = 'trening_data';        // localStorage: zápisy
const KLUC_CAS = 'trening_timer';   // localStorage: bežiaca pauza
const KLUC_PLANY = 'trening_plany'; // localStorage: archív plánov (blokov)

let plan = null;                    // aktívny plán
// data.log["2026-11-23|squat"] = { sets:[{w,r,rir,v,d}], note }
// data.body["2026-11-23"] = { kg, waist }   (kľúč = pondelok týždňa)
// data.cas["2026-11-23"] = { start, end }    (čas prvej a poslednej série dňa)
let data = JSON.parse(localStorage.getItem(KLUC) || 'null') || {};
data = { log: {}, body: {}, cas: {}, seen: false, lastExport: null, backTap: false, ...data };
// data.backTap = true → po sérii sa dĺžka pauzy skopíruje do schránky pre skratku „Pauza“ (ťuk na zadnú stranu iPhonu)
const ulozit = () => localStorage.setItem(KLUC, JSON.stringify(data));
let plany = JSON.parse(localStorage.getItem(KLUC_PLANY) || '{}');

const stav = { view: 'trening', week: 0, day: 0, exId: null, pokrok: 'sila', pokrokBlok: null, restOpen: true };
const $ = s => document.querySelector(s);
// ochrana pred vložením HTML z textov
const h = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? null : n; };
const fmt = n => n == null ? '' : String(Math.round(n * 100) / 100).replace('.', ',');
const isoDat = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dnes = () => isoDat(new Date());
const datSk = iso => iso.split('-').reverse().slice(0, 2).map(x => +x).join('. ') + '.';
const DNI = ['Po', 'Ut', 'St', 'Št', 'Pi', 'So', 'Ne'];
const KAT = { main: 'Hlavný cvik', test: 'Test', power: 'Výbušnosť', accessory: 'Doplnkový', core: 'Stred tela', neck: 'Krk',
  grip: 'Úchop', warmup: 'Rozcvička', cooldown: 'Strečing', mobility: 'Mobilita', conditioning: 'Kondícia', rest: 'Voľno' };

// ---------- Polia zápisu podľa logMode ----------
const POLIA = {
  weight_reps_rir: [['w', 'kg'], ['r', 'opak.'], ['rir', 'RIR']],
  reps_rir: [['r', 'opak.'], ['rir', 'RIR']],
  time: [['v', 'sek.']],
  box_height: [['v', 'cm']],
  distance_cm: [['v', 'cm']],
  weight_distance: [['w', 'kg'], ['v', 'm']],
  duration_hr: [['v', 'min'], ['r', 'tep']],
  sets_only: [], check: []
};
function polia(ex) {
  const p = [...(POLIA[ex.logMode] || [])];
  if (ex.logMode === 'time' && ex.weightKg > 0) p.unshift(['w', 'kg']); // čas + voliteľne váha
  return p;
}

// ---------- Plánované hodnoty ako predvyplnenie ----------
const prvy = s => { const m = String(s ?? '').match(/^\d+([.,]\d+)?/); return m ? m[0].replace(',', '.') : ''; };
function predvyplnenie(ex) {
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
    case 'barbell_total': return w != null ? `${k} kg s tyčou` : '';
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
const pocetSerii = (day, ex) => Math.max(ex.sets, data.log[kl(day.date, ex.id)]?.sets.length || 0);
const hotoveSerie = (day, ex) => data.log[kl(day.date, ex.id)]?.sets.filter(s => s.d).length || 0;
const hotovyCvik = (day, ex) => hotoveSerie(day, ex) >= pocetSerii(day, ex);

// Posledný predošlý zápis rovnakého cviku (id) – aj z minulého bloku
function minule(ex, date) {
  let best = null;
  for (const k in data.log) {
    const i = k.indexOf('|'), d = k.slice(0, i), id = k.slice(i + 1);
    if (id === ex.id && d < date && data.log[k].sets.some(s => s.d) && (!best || d > best.d)) best = { d, z: data.log[k] };
  }
  return best;
}
function popisSerie(ex, s) {
  if (!s) return '';
  if (ex.logMode === 'weight_reps_rir') return `${s.w ?? ''}×${s.r ?? ''}${s.rir !== '' && s.rir != null ? ' @' + s.rir : ''}`;
  const t = polia(ex).map(([k, u]) => s[k] ? `${s[k]} ${u}` : '').filter(Boolean).join(', ');
  return t || '✓';
}

// ---------- Stav dňa: none / half / full ----------
function stavDna(day) {
  let hot = 0, spolu = 0;
  for (const ex of day.exercises) { spolu += pocetSerii(day, ex); hot += hotoveSerie(day, ex); }
  return hot === 0 ? 'none' : hot >= spolu ? 'full' : 'half';
}

// Ktorá séria ide ďalej? Supersérie sa striedajú (C1 → C2 → C1 …).
function dalsia(day, ex) {
  const exs = day.exercises;
  const prvaNehotova = e => { const z = data.log[kl(day.date, e.id)]; const n = pocetSerii(day, e);
    for (let i = 0; i < n; i++) if (!z?.sets[i]?.d) return i; return -1; };
  if (ex.supersetGroup) {
    const sk = exs.filter(e => e.supersetGroup === ex.supersetGroup), i = sk.indexOf(ex);
    for (let j = 1; j <= sk.length; j++) { const e = sk[(i + j) % sk.length], s = prvaNehotova(e); if (s >= 0) return { ex: e, i: s }; }
  } else { const s = prvaNehotova(ex); if (s >= 0) return { ex, i: s }; }
  for (const e of exs.slice(exs.indexOf(ex) + 1).concat(exs)) { const s = prvaNehotova(e); if (s >= 0) return { ex: e, i: s }; }
  return null;
}

// =====================================================================
//  ČASOVAČ – počíta podľa reálneho času (uložený čas konca / štartu),
//  takže sedí aj po zamknutí obrazovky alebo prepnutí appky.
// =====================================================================
// t = { mode:'down'|'up', end, start, base, fired, nazov, zapis, dalej:{nazov,popis} }
let t = JSON.parse(localStorage.getItem(KLUC_CAS) || 'null');
const ulozT = () => t ? localStorage.setItem(KLUC_CAS, JSON.stringify(t)) : localStorage.removeItem(KLUC_CAS);
let audio = null;

function pripravZvuk() { // musí sa zavolať z ťuknutia, inak mobil zvuk zablokuje
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch (e) { }
}
function pip() {
  if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 500]); // iPhone vibráciu z webu nepodporuje
  if (!audio) return;
  [0, 0.35, 0.7].forEach(o => {
    const osc = audio.createOscillator(), g = audio.createGain();
    osc.frequency.value = 880; g.gain.value = 0.3;
    osc.connect(g); g.connect(audio.destination);
    osc.start(audio.currentTime + o); osc.stop(audio.currentTime + o + 0.25);
  });
}

// Obrazovka počas tréningu nezhasne (aby pípol koniec pauzy). Funguje na novších iPhonoch aj Androide.
let zamok = null;
async function drzObrazovku() {
  try { if ('wakeLock' in navigator && !zamok && document.visibilityState === 'visible') {
    zamok = await navigator.wakeLock.request('screen'); zamok.addEventListener('release', () => zamok = null); } } catch (e) { }
}

function spustPauzu(sec, info) {
  t = { mode: 'down', end: Date.now() + sec * 1000, base: sec, fired: false, ...info };
  stav.restOpen = true; ulozT(); kresliT(); drzObrazovku();
}
function pripocitaj(d) { if (t?.mode === 'down') { t.end += d * 1000; t.base = Math.max(t.base, Math.ceil((t.end - Date.now()) / 1000)); t.fired = false; ulozT(); tikT(); } }
function stopT() { t = null; ulozT(); kresliT(); }
function restartT() { if (!t) return; if (t.mode === 'down') { t.end = Date.now() + t.base * 1000; t.fired = false; } else t.start = Date.now(); ulozT(); tikT(); }
function stopky() { pripravZvuk(); t = { mode: 'up', start: Date.now(), nazov: 'Stopky' }; stav.restOpen = true; ulozT(); kresliT(); drzObrazovku(); }

const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const OBVOD = 289; // 2·π·46 – obvod krúžku v SVG

function kresliT() {
  const el = $('#rest'), pill = $('#pill');
  const otvorene = !!t && stav.restOpen;
  el.hidden = !otvorene; pill.hidden = !t || stav.restOpen;
  document.body.classList.toggle('resting', otvorene);
  if (!t) return;
  const up = t.mode === 'up';
  el.innerHTML = `<div class="lab">${up ? 'Stopky' : 'Pauza · ' + h(t.nazov)}</div>
    <div class="ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="5"/>
      <circle id="rr" cx="50" cy="50" r="46" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-dasharray="${OBVOD}" stroke-dashoffset="0"/></svg>
      <div class="tn" id="tv"></div></div>
    ${up ? '' : '<div class="adj"><button data-a="m">−15 s</button><button data-a="p">+15 s</button><button data-a="r">↻</button></div>'}
    ${t.zapis ? `<div class="logged tn">Zapísané: ${h(t.zapis)} ✓</div>` : ''}
    ${!up && data.backTap ? '<div class="logged">📋 Pauza skopírovaná – ťukni 2× na zadnú stranu mobilu</div>' : ''}
    ${t.dalej ? `<div class="next"><small>Ďalej</small><b>${h(t.dalej.nazov)}</b><span class="tn">${h(t.dalej.popis)}</span></div>` : ''}
    <div class="acts"><button data-a="h">Skryť</button><button data-a="s" class="main" id="tmain">${up ? 'Zastaviť' : 'Preskočiť pauzu ›'}</button></div>`;
  tikT();
}
function tikT() {
  if (!t) return;
  const tv = $('#tv'), rr = $('#rr'), pill = $('#pill');
  let txt, podiel = 0, koniec = false;
  if (t.mode === 'up') txt = mmss(Math.floor((Date.now() - t.start) / 1000));
  else {
    const zost = Math.ceil((t.end - Date.now()) / 1000);
    podiel = Math.max(0, Math.min(1, 1 - zost / t.base));
    koniec = zost <= 0;
    txt = koniec ? 'Ideš!' : mmss(zost);
    if (koniec && !t.fired) { t.fired = true; ulozT(); pip(); }
  }
  if (tv) { tv.textContent = txt; rr.setAttribute('stroke-dashoffset', OBVOD * podiel); }
  $('#rest').classList.toggle('end', koniec);
  const m = $('#tmain'); if (m && t.mode === 'down') m.textContent = koniec ? 'Pokračovať ›' : 'Preskočiť pauzu ›';
  pill.textContent = '⏱ ' + txt; pill.classList.toggle('end', koniec);
}
setInterval(tikT, 250);
document.addEventListener('visibilitychange', () => { tikT(); if (t) drzObrazovku(); }); // po návrate hneď prepočíta

$('#rest').addEventListener('click', e => {
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (a === 'm') pripocitaj(-15); if (a === 'p') pripocitaj(15); if (a === 'r') restartT();
  if (a === 'h') { stav.restOpen = false; kresliT(); }
  if (a === 's') { stopT(); if (stav.view === 'trening') kresliTrening(); }
});
$('#pill').onclick = () => { stav.restOpen = true; kresliT(); };

function toast(msg) { const e = $('#toast'); e.textContent = msg; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, 3000); }

// =====================================================================
//  TRÉNING – jeden cvik naraz, pásik cvikov hore
// =====================================================================
function dnesnyIndex() {
  const d = dnes();
  for (const [wi, w] of plan.weeks.entries()) for (const [di, dy] of w.days.entries()) if (dy.date === d) return [wi, di];
  return d < plan.weeks[0].days[0].date ? [0, 0] : [plan.weeks.length - 1, plan.weeks.at(-1).days.length - 1]; // mimo plánu
}
const aktDen = () => plan.weeks[stav.week].days[stav.day];
function aktCvik(day) {
  let ex = day.exercises.find(e => e.id === stav.exId);
  if (!ex) { ex = day.exercises.find(e => !hotovyCvik(day, e)) || day.exercises[0]; stav.exId = ex?.id; }
  return ex;
}

function kresliTrening() {
  const w = plan.weeks[stav.week], day = aktDen(), ex = aktCvik(day);
  const hot = day.exercises.filter(e => hotovyCvik(day, e)).length, n = day.exercises.length;
  const cas = data.cas[day.date];
  let html = '';
  if (!data.seen) html += `<div class="warn">⚠️ Zápisy sú uložené <b>len v tomto mobile</b>. Raz týždenne si sprav zálohu (záložka Záloha).<button id="rozumiem">Rozumiem</button></div>`;
  html += `<div class="hd"><div><small>${day.date === dnes() ? 'Dnes · ' : ''}${h(day.weekday)} ${datSk(day.date)} · T${w.week}</small><h1>${h(day.title)}</h1></div>
    <button class="ib" data-krok="-1" aria-label="Predošlý deň">‹</button><button class="ib" data-krok="1" aria-label="Ďalší deň">›</button>
    <button class="ib" id="tst" aria-label="Stopky"><svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg></button></div>
    <div class="daybar tn"><span>${hot}/${n} cvikov</span><div class="bar"><i style="width:${n ? hot / n * 100 : 0}%"></i></div>
    <span>${cas ? `${new Date(cas.start).toTimeString().slice(0, 5)}${cas.end > cas.start ? ' · ' + Math.round((cas.end - cas.start) / 60000) + ' min' : ''}` : h(day.timeHint && day.timeHint !== '—' ? day.timeHint : '')}</span></div>`;
  if (!ex) { $("#main").innerHTML = html + '<div class="card">Dnes je voľno. 💤</div>'; $('#cta')?.remove(); return bindTrening(); }
  // pásik cvikov
  html += '<div class="rail">' + day.exercises.map(e => {
    const p = hotoveSerie(day, e) / pocetSerii(day, e), d = hotovyCvik(day, e);
    return `<button data-ex="${h(e.id)}" class="${e === ex ? 'sel' : d ? 'd' : ''}${e.supersetGroup ? ' ss' : ''}">${h(e.label)}<i><b style="width:${Math.min(1, p) * 100}%"></b></i></button>`;
  }).join('') + '</div>';
  html += kartaCviku(ex, day);
  $('#main').innerHTML = html;
  // veľké tlačidlo dole
  let cta = $('#cta'); if (!cta) { cta = document.createElement('button'); cta.id = 'cta'; document.body.appendChild(cta); }
  const z = data.log[kl(day.date, ex.id)], idx = Array.from({ length: pocetSerii(day, ex) }, (_, i) => i).find(i => !z?.sets[i]?.d);
  if (idx != null) { cta.className = ''; cta.dataset.a = 'hotovo'; cta.dataset.i = idx;
    cta.textContent = `✓ ${pocetSerii(day, ex) > 1 ? `Séria ${idx + 1} hotová` : 'Hotovo'}${ex.restSec > 0 ? ' · pauza ' + mmss(ex.restSec) : ''}`; }
  else { const d = dalsia(day, ex); cta.className = 'alt'; cta.dataset.a = d ? 'dalsi' : 'koniec';
    cta.textContent = d ? `Ďalší cvik: ${d.ex.label} ${d.ex.name} ›` : '🎉 Tréning hotový'; }
  bindTrening();
}
function bindTrening() {
  $('#tst').onclick = stopky;
  const r = $('#rozumiem'); if (r) r.onclick = () => { data.seen = true; ulozit(); kresliTrening(); };
  $('.rail .sel')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function kartaCviku(ex, day) {
  const zz = zaznam(day.date, ex), f = polia(ex), m = minule(ex, day.date);
  const z = data.log[kl(day.date, ex.id)];
  const cur = zz.sets.findIndex(s => !s.d);
  const tg = [['Plán', `${ex.sets} × ${ex.reps}`], ['Váha', planVaha(ex)], ['RIR', ex.targetRIR], ['Tempo', ex.tempo],
    ['Pauza', ex.restText && ex.restText !== '—' ? ex.restText : '']].filter(([, v]) => v != null && v !== '');
  let b = `<div class="card ex"><div class="k">${h(ex.label)} · ${h(KAT[ex.category] || ex.category)}${ex.supersetGroup ? ' · superséria ' + h(ex.supersetGroup) : ''}</div>
    <h2>${h(ex.name)}</h2><div class="tg tn">${tg.map(([k, v]) => `<div>${k}<b>${h(v)}</b></div>`).join('')}</div>`;
  if (ex.note) b += `<div class="note">ℹ️ ${h(ex.note)}</div>`;
  if (m) b += `<div class="past">↺ Minule (${datSk(m.d)}): <b class="tn">${m.z.sets.filter(s => s.d).map(s => popisSerie(ex, s)).join(' · ')}</b>${m.z.note ? '<br>📝 ' + h(m.z.note) : ''}</div>`;
  // tabuľka sérií: ťuk na číslo = hotovo / späť
  b += `<table class="sets"><tr><th></th>${f.map(([, u]) => `<th>${u}</th>`).join('')}${f.length ? '' : '<th></th>'}${m && f.length ? '<th>minule</th>' : ''}</tr>`;
  b += zz.sets.map((s, i) => `<tr data-i="${i}" class="${s.d ? 'd' : i === cur ? 'c' : ''}"><td class="n"><button data-ok>${s.d ? '✓' : i + 1}</button></td>${f.map(([k]) =>
      `<td><input inputmode="decimal" data-k="${k}" placeholder="–" value="${h(s[k] ?? '')}"></td>`).join('')}
      ${f.length ? '' : `<td class="only">${s.d ? 'hotovo' : zz.sets.length > 1 ? `séria ${i + 1}` : 'ťukni, keď je hotové'}</td>`}
      ${m && f.length ? `<td class="was tn">${h(popisSerie(ex, m.z.sets.filter(x => x.d)[i]))}</td>` : ''}</tr>`).join('') + '</table>';
  b += `<div class="row"><button data-plus class="plus">+ séria navyše</button>${z && z.sets.length > ex.sets && !z.sets.at(-1).d ? '<button data-minus class="plus">− odobrať</button>' : ''}</div>
    <textarea data-note placeholder="📝 Poznámka (napr. rameno OK)" style="margin-top:8px">${h(zz.note)}</textarea>`;
  if (ex.warmupSets) b += `<details><summary>Rozcvičkové série</summary><div class="tn">${h(ex.warmupSets)}</div></details>`;
  if (ex.cues) b += `<details><summary>💡 Technika</summary><div>${h(ex.cues)}</div></details>`;
  return b + '</div>';
}

// Odškrtnutie série (z tlačidla dole alebo ťuknutím na číslo série)
function prepniSeriu(day, ex, i) {
  pripravZvuk();
  const z = zaznam(day.date, ex), s = z.sets[i];
  s.d = !s.d;
  if (s.d) {
    const c = data.cas[day.date] || (data.cas[day.date] = { start: Date.now(), end: Date.now() });
    c.end = Date.now();
    if (navigator.vibrate) navigator.vibrate(30);
    const d = dalsia(day, ex);
    if (d) stav.exId = d.ex.id; // po sérii sa appka presunie na to, čo ide ďalej
    if (ex.restSec > 0) {
      // Back Tap: skopíruj sekundy pauzy – skratka v iPhone si ich vezme a spustí časovač v Hodinách
      if (data.backTap) navigator.clipboard?.writeText(String(ex.restSec)).catch(() => { });
      const dz = d && zaznam(day.date, d.ex).sets[d.i];
      spustPauzu(ex.restSec, {
        nazov: ex.name, zapis: `séria ${i + 1}${popisSerie(ex, s) !== '✓' ? ' · ' + popisSerie(ex, s) : ''}`,
        dalej: d ? { nazov: `${d.ex === ex ? '' : d.ex.label + ' ' + d.ex.name + ' · '}Séria ${d.i + 1} z ${pocetSerii(day, d.ex)}`,
          popis: (polia(d.ex).length && popisSerie(d.ex, dz) !== '✓' ? popisSerie(d.ex, dz) + ' · ' : '') + `plán ${d.ex.sets} × ${d.ex.reps}` } : { nazov: 'Posledná séria dňa 🎉', popis: 'Dobrá práca.' }
      });
    }
  }
  ulozit(); kresliTrening();
}

// ---------- Udalosti (jeden poslucháč pre všetko) ----------
document.addEventListener('click', e => {
  if (!plan) return;
  const el = sel => e.target.closest(sel);
  if (stav.view === 'plan') {
    if (el('[data-w]')) { stav.week = +el('[data-w]').dataset.w; return kresliPlan(); }
    if (el('[data-d]')) { stav.day = +el('[data-d]').dataset.d; stav.exId = null; return prepni('trening'); }
  }
  if (stav.view === 'pokrok') {
    if (el('[data-pk]')) { stav.pokrok = el('[data-pk]').dataset.pk; return kresliPokrok(); }
    if (el('[data-blok]')) { stav.pokrokBlok = el('[data-blok]').dataset.blok; return kresliPokrok(); }
  }
  if (stav.view !== 'trening') return;
  const day = aktDen();
  if (el('[data-krok]')) { // ‹ › = predošlý / ďalší deň (cez hranice týždňov)
    const vsetky = plan.weeks.flatMap((w, wi) => w.days.map((_, di) => [wi, di]));
    let i = vsetky.findIndex(([a, b]) => a === stav.week && b === stav.day) + +el('[data-krok]').dataset.krok;
    [stav.week, stav.day] = vsetky[Math.max(0, Math.min(vsetky.length - 1, i))]; stav.exId = null;
    kresliTrening(); return scrollTo(0, 0);
  }
  if (el('[data-ex]')) { stav.exId = el('[data-ex]').dataset.ex; kresliTrening(); return scrollTo(0, 0); }
  const cta = el('#cta');
  const ex = aktCvik(day); if (!ex) return;
  if (cta) {
    if (cta.dataset.a === 'hotovo') return prepniSeriu(day, ex, +cta.dataset.i);
    if (cta.dataset.a === 'dalsi') { stav.exId = dalsia(day, ex).ex.id; kresliTrening(); return scrollTo(0, 0); }
    return toast('Tréning hotový – dobrá práca! 💪');
  }
  if (el('[data-ok]')) return prepniSeriu(day, ex, +el('tr[data-i]').dataset.i);
  const z = zaznam(day.date, ex);
  if (el('[data-plus]')) { z.sets.push({ ...(z.sets.at(-1) || predvyplnenie(ex)), d: false }); ulozit(); kresliTrening(); }
  if (el('[data-minus]')) { z.sets.pop(); ulozit(); kresliTrening(); }
});
document.addEventListener('input', e => {
  if (!plan) return;
  if (stav.view === 'trening') {
    const day = aktDen(), ex = aktCvik(day), z = zaznam(day.date, ex);
    if (e.target.matches('[data-note]')) z.note = e.target.value;
    else if (e.target.dataset.k) z.sets[+e.target.closest('tr').dataset.i][e.target.dataset.k] = e.target.value;
    ulozit();
  }
  const r = e.target.closest('[data-bw]'); if (r) { // telesná hmotnosť / pás
    const k = r.dataset.bw; data.body[k] = data.body[k] || {};
    data.body[k][e.target.dataset.b] = e.target.value; ulozit();
  }
});
document.addEventListener('focusin', e => { if (e.target.matches('.sets input')) e.target.select(); }); // ťuk = prepísať hodnotu

// =====================================================================
//  PLÁN – týždne, dni, pravidlá bloku
// =====================================================================
function kresliPlan() {
  const w = plan.weeks[stav.week], d0 = dnes();
  let html = `<small class="dim">${h(plan.meta.title)}</small><h1>Plán</h1>
    <div class="seg">${plan.weeks.map((x, i) => `<button data-w="${i}" class="${i === stav.week ? 'on' : ''}">T${x.week}</button>`).join('')}</div>
    <div class="dim"><b style="color:var(--text)">${h(w.phase)}</b> · ${datSk(w.startDate)}–${datSk(w.endDate)}<br>${h(w.note)}</div>`;
  html += w.days.map((x, i) => {
    const s = stavDna(x);
    return `<button class="day${x.date === d0 ? ' today' : ''}" data-d="${i}"><span class="wd t-${h(x.type)}">${DNI[i]}</span>
      <span>${h(x.title)}<span class="dim">${datSk(x.date)}${x.timeHint && x.timeHint !== '—' ? ' · ' + h(x.timeHint) : ''}</span></span>
      <span class="badge ${s}">${{ none: '–', half: 'rozpracované', full: 'hotovo' }[s]}</span></button>`;
  }).join('');
  if (plan.meta.rules?.length) html += `<details open><summary>📋 Pravidlá bloku</summary><div><ul class="rules">${plan.meta.rules.map(r => `<li>${h(r)}</li>`).join('')}</ul></div></details>`;
  if (plan.meta.heartRate) html += `<details><summary>❤️ Tepové zóny</summary><div>${Object.entries(plan.meta.heartRate).map(([k, v]) => `${k === 'zone2' ? 'Zóna 2' : k === 'intervals' ? 'Intervaly' : h(k)}: <b>${h(v)}</b>`).join('<br>')}</div></details>`;
  $('#main').innerHTML = html;
}

// =====================================================================
//  POKROK – sila (e1RM), telo, objem
// =====================================================================
function telHmotnost(date) { // posledná zapísaná hmotnosť do daného dňa, inak z plánu
  const k = Object.keys(data.body).filter(d => d <= date && num(data.body[d].kg)).sort().pop();
  return k ? num(data.body[k].kg) : (plan.meta.bodyweightKg || 0);
}
const e1rm = (kg, r, rir) => kg * (1 + (r + rir) / 30); // Epley s RIR

// Jednoduchý čiarový graf v SVG: real = fialová čiara, plan = sivá prerušovaná
function graf(real, planH) {
  const vsetky = [...real, ...planH].filter(v => v != null);
  if (!vsetky.length) return '';
  const min = Math.min(...vsetky) * 0.97, max = Math.max(...vsetky) * 1.03 || 1, n = Math.max(real.length, planH.length);
  const X = i => 14 + i * (292 / Math.max(1, n - 1)), Y = v => 86 - (v - min) / (max - min || 1) * 72;
  const ciara = (arr, st) => { const p = arr.map((v, i) => v == null ? null : `${X(i)},${Y(v)}`).filter(Boolean);
    return p.length > 1 ? `<polyline points="${p.join(' ')}" fill="none" ${st}/>` : ''; };
  return `<svg class="chart" viewBox="0 0 320 96" preserveAspectRatio="none">
    <line x1="0" y1="90" x2="320" y2="90" stroke="#f1f1f3"/>
    ${ciara(planH, 'stroke="#d4d4d8" stroke-width="2" stroke-dasharray="5 5"')}
    ${ciara(real, 'stroke="#5b2a86" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"')}
    ${real.map((v, i) => v == null ? '' : `<circle cx="${X(i)}" cy="${Y(v)}" r="5" fill="#5b2a86"/>`).join('')}</svg>`;
}

function kresliPokrok() {
  const bloky = Object.values(plany).sort((a, b) => a.meta.startDate < b.meta.startDate ? -1 : 1);
  const p = plany[stav.pokrokBlok] || plan;
  let html = `<h1>Pokrok</h1>`;
  if (bloky.length > 1) html += `<div class="seg">${bloky.map(b => `<button data-blok="${h(b.meta.version)}" class="${b === p || b.meta.version === p.meta.version ? 'on' : ''}">${h(b.meta.title.split('–')[0].trim())}</button>`).join('')}</div>`;
  html += `<div class="seg">${[['sila', 'Sila'], ['telo', 'Telo'], ['objem', 'Objem']].map(([k, v]) => `<button data-pk="${k}" class="${stav.pokrok === k ? 'on' : ''}">${v}</button>`).join('')}</div>`;
  if (stav.pokrok === 'sila') html += pokrokSila(p);
  if (stav.pokrok === 'telo') html += pokrokTelo(p);
  if (stav.pokrok === 'objem') html += pokrokObjem(p);
  $('#main').innerHTML = html;
}

function pokrokSila(p) {
  // hlavné cviky; test_bench sa zlúči s bench
  const cviky = new Map();
  p.weeks.forEach((w, wi) => w.days.forEach(dy => dy.exercises.forEach(ex => {
    if (ex.category !== 'main' && ex.category !== 'test') return;
    const g = ex.id.replace(/^test_/, '');
    if (!cviky.has(g)) cviky.set(g, { ex, tyz: p.weeks.map(() => ({ plan: [], planE: null, real: null })) });
    const c = cviky.get(g), ty = c.tyz[wi];
    const tel = ex.weightType === 'added_to_bodyweight' ? telHmotnost(dy.date) : 0;
    ty.plan.push(`${fmt(ex.weightKg)}×${ex.reps}`);
    const pr = num(prvy(ex.reps)), pk = num(ex.weightKg);
    if (pr != null && pk != null) ty.planE = Math.max(ty.planE || 0, e1rm(pk + tel, pr, num(prvy(ex.targetRIR)) ?? 0));
    (data.log[kl(dy.date, ex.id)]?.sets || []).filter(s => s.d).forEach(s => {
      const kg = num(s.w) ?? 0, r = num(s.r), rir = num(s.rir) ?? 0;
      if (r == null) return;
      const e = e1rm(kg + tel, r, rir), cur = ty.real;
      if (!cur || kg > cur.kg || (kg === cur.kg && r > cur.r)) ty.real = { kg, r, e: Math.max(e, cur?.e || 0) };
      else cur.e = Math.max(cur.e, e);
    });
  })));
  let html = '<div class="dim" style="margin-bottom:4px">e1RM = odhad maxima na 1 opakovanie (Epley s RIR). Pri cvikoch s opaskom je v ňom aj telesná hmotnosť.</div>';
  for (const [, c] of cviky) {
    const sR = c.tyz.filter(t => t.real), posl = sR.at(-1), prv = sR[0];
    const delta = posl && prv && posl !== prv ? posl.real.e - prv.real.e : null;
    html += `<div class="card lift"><div class="r"><div><small>${h(c.ex.name.replace(/^TEST – /, ''))} · e1RM</small><div class="big tn">${posl ? Math.round(posl.real.e) + ' kg' : '–'}</div></div>
      ${delta != null ? `<span class="up ${delta > 0 ? 'plus' : delta < 0 ? 'minus' : ''}">${delta > 0 ? '▲ +' : delta < 0 ? '▼ ' : ''}${fmt(Math.round(delta * 10) / 10)} kg</span>` : posl ? '' : '<span class="up">zatiaľ bez zápisu</span>'}</div>
      ${graf(c.tyz.map(t => t.real?.e ?? null), c.tyz.map(t => t.planE))}
      <div class="wkt tn" style="--n:${c.tyz.length}">${c.tyz.map((t, i) => `<div class="${t.real ? 'on' : ''}">T${i + 1}<b>${t.real ? `${fmt(t.real.kg)}×${t.real.r}` : '–'}</b>${h([...new Set(t.plan)].join(' / '))}</div>`).join('')}</div></div>`;
  }
  return html;
}

function pokrokTelo(p) {
  const kg = p.weeks.map(w => num(data.body[w.startDate]?.kg)), pas = p.weeks.map(w => num(data.body[w.startDate]?.waist));
  const zmena = arr => { const v = arr.filter(x => x != null); return v.length > 1 ? v.at(-1) - v[0] : null; };
  const zk = zmena(kg), zp = zmena(pas);
  let html = `<div class="mini"><div class="card"><small class="dim">Ranná hmotnosť</small><b class="tn">${kg.filter(x => x != null).at(-1) != null ? fmt(kg.filter(x => x != null).at(-1)) + ' kg' : '–'}</b>
    <small class="dim tn">${zk != null ? (zk > 0 ? '+' : '') + fmt(Math.round(zk * 10) / 10) + ' kg za blok' : 'zapíš aspoň 2 týždne'}</small></div>
    <div class="card"><small class="dim">Obvod pása</small><b class="tn">${pas.filter(x => x != null).at(-1) != null ? fmt(pas.filter(x => x != null).at(-1)) + ' cm' : '–'}</b>
    <small class="dim tn">${zp != null ? (zp > 0 ? '+' : '') + fmt(Math.round(zp * 10) / 10) + ' cm za blok' : 'zapíš aspoň 2 týždne'}</small></div></div>`;
  if (kg.filter(x => x != null).length > 1) html += `<div class="card"><small class="dim">Hmotnosť po týždňoch</small>${graf(kg, [])}</div>`;
  html += '<h3>Zápis raz týždenne (ráno, nalačno)</h3>' + p.weeks.map(w => {
    const b = data.body[w.startDate] || {};
    return `<div class="card"><b>T${w.week}</b> <span class="dim">od ${datSk(w.startDate)}</span><div class="row" data-bw="${w.startDate}">
      <div class="fld"><label>hmotnosť (kg)</label><input inputmode="decimal" data-b="kg" value="${h(b.kg ?? '')}"></div>
      <div class="fld"><label>pás (cm)</label><input inputmode="decimal" data-b="waist" value="${h(b.waist ?? '')}"></div></div></div>`;
  }).join('');
  return html;
}

function pokrokObjem(p) {
  return p.weeks.map(w => {
    let ser = 0, plSer = 0, dni = 0, plDni = 0, ton = 0;
    w.days.forEach(dy => {
      if (dy.type !== 'rest') { plDni++; if (stavDna(dy) === 'full') dni++; }
      dy.exercises.forEach(ex => {
        plSer += ex.sets;
        (data.log[kl(dy.date, ex.id)]?.sets || []).filter(s => s.d).forEach(s => {
          ser++; if (ex.logMode === 'weight_reps_rir' && ex.weightType === 'barbell_total') ton += (num(s.w) || 0) * (num(s.r) || 0);
        });
      });
    });
    return `<div class="card"><div class="r" style="display:flex;justify-content:space-between"><b>T${w.week} · ${h(w.phase)}</b><span class="dim">${datSk(w.startDate)}</span></div>
      <div class="wkt tn" style="--n:3"><div class="${dni ? 'on' : ''}">dni<b>${dni} / ${plDni}</b></div><div class="${ser ? 'on' : ''}">série<b>${ser} / ${plSer}</b></div>
      <div class="${ton ? 'on' : ''}">tyč (kg×op.)<b>${ton ? fmt(Math.round(ton)) : '–'}</b></div></div></div>`;
  }).join('');
}

// =====================================================================
//  ZÁLOHA – export / import, info o uložení
// =====================================================================
async function kresliZaloha() {
  const n = Object.values(data.log).reduce((a, z) => a + z.sets.filter(s => s.d).length, 0);
  const dniOdZal = data.lastExport ? Math.floor((Date.now() - data.lastExport) / 864e5) : null;
  let trvale = null; try { trvale = await navigator.storage?.persisted?.(); } catch (e) { }
  $('#main').innerHTML = `<h1>Záloha</h1>
    <div class="card"><div class="mini" style="gap:6px"><div><small class="dim">Zapísané série</small><b class="tn">${n}</b></div>
      <div><small class="dim">Posledná záloha</small><b class="tn">${data.lastExport ? (dniOdZal === 0 ? 'dnes' : `pred ${dniOdZal} d`) : 'nikdy'}</b></div></div></div>
    ${dniOdZal == null || dniOdZal >= 7 ? '<div class="warn">💾 Sprav si zálohu – dáta sú len v tomto mobile. Ak appku zmažeš alebo vymažeš dáta Safari, zápisy sa stratia.</div>' : ''}
    <button class="big-btn" id="exJ">⬇️<span>Záloha (JSON)<small>kompletná záloha na obnovu, ulož do Súborov / iCloudu</small></span></button>
    <button class="big-btn" id="exC">📊<span>Export pre trénera (CSV)<small>všetky série zo všetkých blokov, otvorí sa v Exceli</small></span></button>
    <button class="big-btn" id="imp">⬆️<span>Obnoviť zo zálohy<small>zlúči zálohu so zápismi v mobile</small></span></button>
    <input type="file" id="file" accept=".json,application/json" hidden>
    <h3>Časovač na zamknutej obrazovke</h3>
    <button class="big-btn" id="bt">${data.backTap ? '✅' : '⬜️'}<span>Pauza cez iPhone (ťuk na zadnú stranu)<small>${data.backTap ? 'zapnuté – po sérii sa pauza skopíruje do schránky' : 'vypnuté'}</small></span></button>
    <h3>Plán</h3><div class="card"><b>${h(plan.meta.title)}</b><div class="dim">verzia ${h(plan.meta.version)} · ${datSk(plan.meta.startDate)}–${datSk(plan.meta.endDate)}</div>
      <div class="dim" style="margin-top:6px">Uložené bloky v archíve: ${Object.keys(plany).length}</div></div>
    <div class="dim">Úložisko: ${trvale ? 'trvalé ✓ (prehliadač ho sám nezmaže)' : 'bežné – appku si pridaj na plochu, aby ho systém nemazal'}</div>`;
  $('#exJ').onclick = async () => {
    await stiahni(`trening_zaloha_${dnes()}.json`, JSON.stringify({ app: 'trening', format: 2, exportovane: new Date().toISOString(),
      log: data.log, body: data.body, cas: data.cas, plany }, null, 1), 'application/json');
    data.lastExport = Date.now(); ulozit(); kresliZaloha();
  };
  $('#bt').onclick = () => { data.backTap = !data.backTap; ulozit(); kresliZaloha(); };
  $('#exC').onclick = () => stiahni(`trening_${dnes()}.csv`, '﻿' + csv(), 'text/csv');
  $('#imp').onclick = () => $('#file').click();
  $('#file').onchange = async e => {
    try {
      const j = JSON.parse(await e.target.files[0].text());
      if (!j.log || !j.body) throw 0;
      if (!confirm('Zlúčiť zálohu so zápismi v tomto mobile? Pri rovnakom dni a cviku vyhrá záloha.')) return;
      Object.assign(data.log, j.log); Object.assign(data.body, j.body); Object.assign(data.cas, j.cas || {});
      Object.assign(plany, j.plany || {}); localStorage.setItem(KLUC_PLANY, JSON.stringify(plany));
      data.seen = true; ulozit(); toast('Obnova hotová'); kresliZaloha();
    } catch { toast('Súbor nie je platná záloha'); }
    e.target.value = '';
  };
}

// CSV zo všetkých zápisov (aj zo starších blokov – informácie o cviku z archívu plánov)
function csv() {
  const info = {};
  for (const p of [...Object.values(plany), plan]) p.weeks.forEach(w => w.days.forEach(dy => dy.exercises.forEach(ex => {
    info[kl(dy.date, ex.id)] = { blok: p.meta.title, tyz: w.week, den: dy.weekday, ex };
  })));
  const riadky = [['blok', 'datum', 'tyzden', 'den', 'cvik_id', 'label', 'cvik', 'seria', 'plan', 'vaha_kg', 'opakovania', 'rir', 'hodnota', 'poznamka']];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  Object.keys(data.log).sort().forEach(k => {
    const z = data.log[k], [d, id] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)], i = info[k] || {}, ex = i.ex || {};
    const pl = ex.sets ? `${ex.sets}×${ex.reps}${ex.weightKg != null ? ' @ ' + fmt(ex.weightKg) + ' kg' : ''}${ex.targetRIR ? ' RIR ' + ex.targetRIR : ''}` : '';
    z.sets.forEach((s, n) => { if (s.d) riadky.push([i.blok, d, i.tyz, i.den, id, ex.label, ex.name || id, n + 1, pl, s.w, s.r, s.rir, s.v, z.note]); });
  });
  Object.entries(data.body).sort().forEach(([d, b]) => riadky.push(['', d, '', '', 'telo', '', 'Hmotnosť / pás', '', '', b.kg, '', '', b.waist, '']));
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
function prepni(v) {
  stav.view = v;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v !== 'trening') $('#cta')?.remove();
  ({ trening: kresliTrening, plan: kresliPlan, pokrok: kresliPokrok, zaloha: kresliZaloha })[v]();
  scrollTo(0, 0);
}
$('#nav').onclick = e => {
  const v = e.target.closest('[data-v]')?.dataset.v; if (!v) return;
  if (t && stav.restOpen) { stav.restOpen = false; kresliT(); } // počas pauzy: prepnutie skryje pauzu do kapsuly
  prepni(v);
};

function start(p) {
  plan = p;
  // archív plánov – každý blok sa uloží raz (podľa verzie)
  if (!plany[p.meta.version]) { plany[p.meta.version] = p; try { localStorage.setItem(KLUC_PLANY, JSON.stringify(plany)); } catch (e) { } }
  stav.pokrokBlok = p.meta.version;
  [stav.week, stav.day] = dnesnyIndex();
  prepni('trening'); kresliT();
  navigator.storage?.persist?.(); // požiadaj o trvalé úložisko
}
fetch(PLAN_SUBOR, { cache: 'no-cache' }).then(r => r.json()).then(start).catch(() => {
  // bez internetu a bez cache: použi posledný uložený plán
  const posl = Object.values(plany).sort((a, b) => a.meta.startDate < b.meta.startDate ? 1 : -1)[0];
  if (posl) start(posl); else $('#main').innerHTML = '<div class="warn">Nepodarilo sa načítať plán (plan.json).</div>';
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
