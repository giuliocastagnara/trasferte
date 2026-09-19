/* Trasferte — app condivisa caddie/giocatrice. Vanilla JS, nessuna dipendenza. */
"use strict";

// ---------------------------------------------------------------- stato
const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const cfg = LS.get("cfg", { api: "", token: "", who: "" });
let D = LS.get("data", null);                 // dati (boot)
let queue = LS.get("queue", []);              // azioni in attesa (offline)
let view = "oggi", viewArg = null, syncing = false, lastError = "";
const PERSONE = ["Giulio", "Alessandra"];
// Stati della checklist (T10 giro 4, Q3): a video sono tre — da fare / fatto /
// non serve — ma la tabella tiene anche "prenotato" e "pagato", i valori gia'
// scritti sul foglio: tutti e due si leggono come FATTO, e "pagato" e' quello
// che la spunta scrive. check.save non cambia.
const STATI = { da_fare: { ico: "", lab: "Da fare" }, prenotato: { ico: "✓", lab: "Fatto" }, pagato: { ico: "✓", lab: "Fatto" }, na: { ico: "–", lab: "Non serve" } };
const fattoCheck = c => c.stato === "pagato" || c.stato === "prenotato";
const TIPI = { condivisa: "Condivisa", ciascuno: "Ognuno la sua parte", personale: "Personale", caddie: "Compenso caddie", regolamento: "Pagamento" };
const CATS_COLORS = ["--s1","--s2","--s3","--s4","--s5","--s6","--s7","--s8"];

// ---------------------------------------------------------------- util
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// useGrouping:"always" perche' l'italiano, da solo, NON separa le migliaia a
// quattro cifre: veniva "4918,82 €" accanto a "24.564,11 €". I browser che non
// conoscono il valore lo leggono come "vero", cioe' si comportano come prima.
const eur = n => (Number(n) || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR", useGrouping: "always" });
const num = (n, d = 2) => (Number(n) || 0).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: "always" });
const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const fmtD = s => { if (!s) return ""; const [y, m, d] = String(s).slice(0, 10).split("-"); return `${d}/${m}`; };
const fmtDY = s => { if (!s) return ""; const [y, m, d] = String(s).slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
const monthName = s => new Date(s + "T00:00:00").toLocaleDateString("it-IT", { month: "long", year: "numeric" });
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const kfmt = n => { n = Number(n) || 0; return n >= 1000 ? (n / 1000).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "k" : Math.round(n).toString(); };
const pct = f => ((Number(f) || 0) * 100).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
const other = p => p === "Giulio" ? "Alessandra" : "Giulio";
const baseName = n => String(n || "").replace(/\b20\d\d\b/g, "").replace(/\s+/g, " ").trim();
function toast(m, ms = 2200) { const t = $("#toast"); t.textContent = m; t.classList.remove("hidden"); clearTimeout(t._t); t._t = setTimeout(() => t.classList.add("hidden"), ms); }
function openModal(html) { $("#modalBody").innerHTML = html; $("#modal").classList.remove("hidden"); $("#modal .sheet").scrollTop = 0; }
function closeModal() { $("#modal").classList.add("hidden"); }
// Il foglietto per chiedere una riga di testo, al posto di prompt() (§6 del
// ticket). Sta su un secondo strato perche' chi lo chiama e' quasi sempre gia'
// dentro il modulo: aprirlo in #modal spazzerebbe via il modulo a meta'.
// Chi sta aspettando una risposta dal secondo strato. Serve perche' il foglietto
// si chiude anche toccando fuori: senza questo, la promessa resterebbe appesa.
let _m2fine = null;
function chiudiModal2(v) {
  const f = _m2fine; _m2fine = null;
  $("#modal2").classList.add("hidden"); $("#modal2Body").innerHTML = "";
  if (f) f(v);
}
function chiediTesto(titolo, valore, esempio) {
  return new Promise(res => {
    $("#modal2Body").innerHTML = `<h2 style="margin-top:0">${esc(titolo)}</h2>
      <div class="field"><input id="m2in" value="${esc(valore || "")}" placeholder="${esc(esempio || "")}"></div>
      <div class="row" style="gap:8px"><button class="btn primary grow" id="m2ok">Fatto</button><button class="btn" id="m2no">Annulla</button></div>`;
    $("#modal2").classList.remove("hidden");
    _m2fine = res;
    $("#m2ok").addEventListener("click", () => chiudiModal2(String($("#m2in").value || "").trim()));
    $("#m2no").addEventListener("click", () => chiudiModal2(null));
    setTimeout(() => { const i = $("#m2in"); if (i) i.focus(); }, 60);
  });
}
// La stessa domanda di prima, ma nel foglietto che usa tutto il resto della app
// (T10 giro 5): confirm() era l'ultima finestra di sistema rimasta, e dentro una
// PWA su iPhone si presenta col nome del sito. Sta sul secondo strato come
// chiediTesto, perche' chi chiede una conferma e' quasi sempre gia' dentro un
// modulo. Ritorna una promessa: true = ha detto di si'. `testo` e' HTML gia'
// messo al sicuro da chi chiama.
function chiediConferma(titolo, testo, opt) {
  const o = opt || {};
  return new Promise(res => {
    $("#modal2Body").innerHTML = `<h2 style="margin-top:0">${esc(titolo)}</h2>
      ${testo ? `<p class="small">${testo}</p>` : ""}
      <div class="row" style="gap:8px"><button class="btn ${o.rosso ? "danger" : "primary"} grow" id="m2si">${esc(o.si || "Sì")}</button><button class="btn" id="m2no">${esc(o.no || "Annulla")}</button></div>`;
    $("#modal2").classList.remove("hidden");
    _m2fine = res;
    $("#m2si").addEventListener("click", () => chiudiModal2(true));
    $("#m2no").addEventListener("click", () => chiudiModal2(false));
  });
}
// ADR-4: le regole stanno dietro un "?" — e da questo giro il "?" e' UNO SOLO in
// tutta la app. Posta, Soldi, la trasferta e il modulo spesa passano tutti di
// qui: stessa faccia, stesso modo di chiuderlo. Se il primo foglietto e' gia'
// aperto (si sta guardando il modulo) l'aiuto va sul secondo strato, cosi' il
// modulo a meta' resta dietro.
function aiutoFoglietto(titolo, pars) {
  const html = `<h2 style="margin-top:0">${esc(titolo)}</h2>${(pars || []).map(x => `<p class="small">${x}</p>`).join("")}`;
  if ($("#modal").classList.contains("hidden")) return openModal(html + `<button class="btn block" onclick="closeModal()">Chiudi</button>`);
  $("#modal2Body").innerHTML = html + `<button class="btn block" id="m2close">Chiudi</button>`;
  $("#modal2").classList.remove("hidden");
  _m2fine = null;
  $("#m2close").addEventListener("click", () => chiudiModal2());
}
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
// toccare fuori dal foglietto vale "annulla", e chi aspettava riceve la risposta
$("#modal2").addEventListener("click", e => { if (e.target.id === "modal2") chiudiModal2(null); });

// ---------------------------------------------------------------- API + offline
async function api(action, payload, { silent } = {}) {
  if (!cfg.api || !cfg.token) throw new Error("App non configurata");
  const r = await fetch(cfg.api, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ k: cfg.token, a: action, p: payload || {} }) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || "Errore server");
  return j.data;
}
function setNet() { const d = $("#netdot"); d.className = "dot " + (queue.length ? "pending" : (navigator.onLine ? "on" : "")); d.title = queue.length ? queue.length + " modifiche da inviare" : (navigator.onLine ? "online" : "offline"); }
async function write(action, payload, applyLocal) {
  // applica subito in locale, poi invia; se fallisce → coda
  if (applyLocal) applyLocal(D);
  LS.set("data", D); render();
  try {
    const res = await api(action, payload);
    return res;
  } catch (e) {
    if (!navigator.onLine || /fetch|network|Failed/i.test(String(e))) {
      queue.push({ action, payload, ts: Date.now() }); LS.set("queue", queue); setNet();
      toast("Offline: salvato, lo invio appena c'è rete");
      return null;
    }
    toast("Errore: " + e.message, 4000); throw e;
  }
}
async function flushQueue() {
  if (!queue.length || syncing || !navigator.onLine) return;
  syncing = true;
  while (queue.length) {
    const q = queue[0];
    try { await api(q.action, q.payload); queue.shift(); LS.set("queue", queue); }
    catch (e) { if (!/fetch|network|Failed/i.test(String(e))) { queue.shift(); LS.set("queue", queue); toast("Modifica scartata: " + e.message, 4000); } else break; }
  }
  syncing = false; setNet();
  if (!queue.length) await reload(true);
}
async function reload(silent) {
  if (!cfg.api || !cfg.token) return;
  try {
    const d = await api("boot");
    D = d; lastError = ""; if (d.who) { cfg.who = d.who; LS.set("cfg", cfg); } LS.set("data", D); if (!silent) toast("Dati aggiornati"); render();
  } catch (e) { lastError = e.message || String(e); if (!silent) toast("Impossibile aggiornare: " + lastError, 4000); if (!D) render(); }
}
window.addEventListener("online", () => { setNet(); flushQueue(); });
window.addEventListener("offline", setNet);

// ---------------------------------------------------------------- calcoli
function computeSpesa(s) {
  const T = Math.round((Number(s.importo_eur) || 0) * 100) / 100, N = Math.max(1, parseInt(s.n_persone, 10) || 2), q = Math.round(T / N * 100) / 100;
  let ale = 0, giu = 0, saldo = 0;
  if (s.tipo === "personale") { if (s.conto === "Giulio") giu = T; else ale = T; }
  else if (s.tipo === "condivisa") { ale = T; giu = q; saldo = s.pagato_da === "Giulio" ? q : -q; }
  else if (s.tipo === "ciascuno") { ale = T; giu = q; }
  else if (s.tipo === "caddie") { ale = T; saldo = T; }
  else if (s.tipo === "regolamento") { saldo = s.pagato_da === "Giulio" ? T : -T; }
  s.n_persone = N; s.libri_ale = ale; s.libri_giulio = giu; s.saldo = Math.round(saldo * 100) / 100; return s;
}
const visibleSpese = () => (D.spese || []).filter(s => !(s.tipo === "personale" && s.conto && s.conto !== cfg.who));
// T4 — la posta e' di chi l'ha ricevuta: prenotazioni e proposte dell'altro non
// si vedono e non si confermano. Il filtro vero e' sul server (boot_ e la
// risposta dello scan non le mandano nemmeno, e confermaProposta_ le rifiuta);
// questo serve ai dati gia' in cache sul telefono, salvati da una versione
// precedente della app. `persona` vuota vale Giulio: le righe scritte prima di
// T3 sono state lette dalla sua casella (vedi personaRiga_ nel backend).
const miaMail = r => String((r && r.persona) || "Giulio") === cfg.who;
const visiblePren = () => (D.prenotazioni || []).filter(miaMail);
const visibleProp = () => (D.proposte || []).filter(miaMail);
// Quanto della spesa e' a carico di chi sta guardando: Giulio vede la SUA quota (le condivise
// vanno sui libri di Alessandra per intero, a lui resta la parte sua), Alessandra vede il totale.
const mioImporto = s => Math.round((cfg.who === "Giulio" ? (+s.libri_giulio || 0) : (+s.importo_eur || 0)) * 100) / 100;
const saldoTot = () => Math.round((D.spese || []).reduce((a, s) => a + (Number(s.saldo) || 0), 0) * 100) / 100;
// Saldo delle spese di UNA trasferta: quello che ci dobbiamo per quella trasferta.
// Fuori il tipo caddie (e' il compenso stesso: sommarlo qui lo conterebbe due volte)
// e fuori il tipo regolamento (pagamenti gia' fatti, stessa ragione).
// Non serve leggerlo dal foglio: si calcola qui, sempre aggiornato. Le spese personali
// dell'altro non arrivano dal server, ma le personali hanno saldo 0 per costruzione,
// quindi la somma e' comunque esatta per tutti e due.
const saldoTrasferta = nome => Math.round((D.spese || []).filter(s => s.trasferta === nome && s.tipo !== "caddie" && s.tipo !== "regolamento").reduce((a, s) => a + (Number(s.saldo) || 0), 0) * 100) / 100;
// Quanto va davvero bonificato: il compenso lordo piu' il saldo della trasferta.
// Il compenso resta lordo (e' quello che Alessandra scarica); il debito resta debito.
const daPagare = c => Math.round(((Number(c.totale) || 0) + saldoTrasferta(c.trasferta)) * 100) / 100;
function saldoLabel(v) { if (Math.abs(v) < 0.005) return "Siete pari"; return v > 0 ? `Alessandra deve a Giulio ${eur(v)}` : `Giulio deve ad Alessandra ${eur(-v)}`; }

// ---- T7: possibile doppione al salvataggio.
// Copia speculare di dupDi_ in Codice.js (stesse soglie, stesse eccezioni): se cambia
// una regola qui va cambiata anche di la'. Si AVVISA, non si rifiuta: al secondo tocco
// su "Salva comunque" la spesa passa. Il controllo e' locale: boot gia' manda tutte le
// spese, il server non serve. Le personali dell'altro non arrivano, quindi la coppia
// "una riga sua, una mia" qui non si vede nemmeno; l'eccezione resta per simmetria.
const DUP_TOLL_EUR = 0.5, DUP_TOLL_PERC = 0.01, DUP_GIORNI = 3;
const DUP_STOP = /^(del|della|delle|dei|degli|con|per|and|the|una|uno|for|from|di|da|la|le|il|lo|gli|un|al|alla|nel|sul)$/;
const dupVicini = (a, b) => Math.abs(a - b) <= Math.max(DUP_TOLL_EUR, DUP_TOLL_PERC * Math.max(Math.abs(a), Math.abs(b)));
const dupNorm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
// "Sushi Las Vegas" ~ "Sushi las vegas", "Hotel Sudafrica" ~ "Hotel Johannesburg";
// numeri diversi ("Toll 2"/"Toll 3", "Pranzo 18Feb"/"Pranzo 19Feb") = voci distinte
function dupSimili(d1, d2) {
  const n1 = dupNorm(d1), n2 = dupNorm(d2);
  if (!n1 || !n2) return false;
  if (n1 === n2) return true;
  const num = s => (s.match(/\d+/g) || []).join(",");
  if (num(n1) !== num(n2)) return false;
  const parole = s => s.split(" ").filter(t => t.length >= 3 && !DUP_STOP.test(t) && !/^\d+$/.test(t));
  const p2 = parole(n2);
  return parole(n1).some(t => p2.indexOf(t) >= 0);
}
function dupGiorni(d1, d2) {
  const a = String(d1 || "").slice(0, 10), b = String(d2 || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return NaN;
  return Math.abs(Math.round((new Date(a + "T00:00:00") - new Date(b + "T00:00:00")) / 864e5));
}
// Restituisce [{spesa, gravita, perche}] con le spese di `pool` che somigliano a `s`.
// Fuori: i compensi caddie (li controlla la pagina Compensi) e, per i pagamenti, tutto
// cio' che non e' un altro pagamento.
function dupDi(s, pool) {
  const out = [];
  if (!s || s.tipo === "caddie") return out;
  const eurS = Number(s.importo_eur) || 0, impS = Number(s.importo) || 0;
  pool.forEach(o => {
    if (!o || o === s || (s.id && o.id === s.id) || o.tipo === "caddie") return;
    if (String(o.trasferta) !== String(s.trasferta)) return;
    if ((s.tipo === "regolamento") !== (o.tipo === "regolamento")) return;
    const stessaValuta = String(o.valuta || "EUR") === String(s.valuta || "EUR");
    const vicino = (stessaValuta && dupVicini(impS, Number(o.importo) || 0)) || dupVicini(eurS, Number(o.importo_eur) || 0);
    if (!vicino) return;
    const g = dupGiorni(s.data, o.data);
    if (isNaN(g) || g > DUP_GIORNI) return;
    let esito = null;
    if (g === 0) esito = { spesa: o, gravita: "alta", perche: "stesso giorno, stesso importo" };
    else if (String(o.categoria) === String(s.categoria) && (Math.abs(eurS - (Number(o.importo_eur) || 0)) < 0.005 || dupSimili(s.descrizione, o.descrizione)))
      esito = { spesa: o, gravita: "bassa", perche: g + (g === 1 ? " giorno" : " giorni") + " di distanza, stessa categoria" };
    if (!esito) return;
    if (s.tipo === "personale" && o.tipo === "personale" && String(s.conto) !== String(o.conto)) return; // ognuno la sua meta' del pasto
    out.push(esito);
  });
  return out;
}
function avvisoDoppioni(dup) {
  const certi = dup.some(d => d.gravita === "alta");
  return `<div class="card" style="border-color:var(--warn);background:#fff8e6;margin:0 0 12px"><b>${certi ? "⚠️ Sembra già registrata" : "🔎 Ce n'è una simile"}</b>
    <div class="muted" style="margin:4px 0 6px">${dup.length === 1 ? "C'è già una spesa" : "Ci sono già " + dup.length + " spese"} su questa trasferta con lo stesso importo. Se è la stessa, annulla; se no, salva pure.</div>
    ${dup.map(d => `<div class="row between" style="padding:6px 0;border-top:1px solid var(--line)"><div class="grow"><div class="ellipsis"><b>${esc(d.spesa.descrizione || d.spesa.categoria)}</b></div><div class="muted">${fmtDY(d.spesa.data)} · ${TIPI[d.spesa.tipo] || esc(d.spesa.tipo)} · ha pagato ${esc(d.spesa.pagato_da)} · ${esc(d.perche)}</div></div><div class="amt">${eur(d.spesa.importo_eur)}</div></div>`).join("")}</div>`;
}

// ---- "Che cosa fa questa spesa": il riquadro che spiega, con i numeri veri, dove
// finisce l'importo e che debito nasce. condivisa / ciascuno / personale si
// dimenticano in fretta, e l'errore si scopre solo mesi dopo guardando i libri.
const TIPO_NOTA = {
  condivisa:   "Spesa di tutti e due pagata da uno solo: Alessandra la scarica per intero, a Giulio resta la sua quota, e nasce un debito.",
  ciascuno:    "Spesa di tutti e due, ma ognuno ha gia' pagato la sua parte: nessun debito fra voi.",
  personale:   "Spesa di una persona sola: entra solo nei suoi libri e l'altro non la vede nemmeno.",
  caddie:      "Compenso caddie: va sui libri di Alessandra e diventa un credito di Giulio.",
  regolamento: "Pagamento vero e proprio: sposta solo il saldo, non entra nei libri di nessuno.",
};
// Il saldo detto dal punto di vista di chi sta guardando (piu' chiaro di "+/-").
function saldoIo(v) {
  if (Math.abs(v) < 0.005) return "nessun debito";
  const creditore = v > 0 ? "Giulio" : "Alessandra";
  const debitore  = v > 0 ? "Alessandra" : "Giulio";
  const q = eur(Math.abs(v));
  const a = /^[AEIOU]/i.test(creditore) ? "ad" : "a";   // eufonia: ad Alessandra, a Giulio
  return cfg.who === creditore ? `${debitore} ti deve ${q}` : `devi ${a} ${creditore} ${q}`;
}
// eurImp = importo GIA' convertito in euro (0 se non si sa ancora il cambio).
// T10 giro 2: il riquadro era quattro righe piu' un paragrafo, adesso e' UNA riga
// ("Alessandra scarica 50 €, tu 25 € · Alessandra ti deve 25 €") e il paragrafo
// (TIPO_NOTA) e' finito dietro il "?" del modulo. I CONTI non si toccano: la riga
// la produce sempre computeSpesa, con la voce di saldoIo.
function boxLibri(s, eurImp) {
  const noto = (Number(eurImp) || 0) > 0;
  const c = computeSpesa({ importo_eur: Number(eurImp) || 0, n_persone: s.n_persone, tipo: s.tipo,
                           pagato_da: s.pagato_da, conto: s.tipo === "personale" ? (s.conto || cfg.who) : "" });
  if (!noto) return `Scrivi l'importo per vedere che cosa fa questa spesa.`;
  // "scarica" = finisce sui suoi libri. Prima Alessandra, poi Giulio, come nel foglio.
  const voce = (p, v, primo) => (cfg.who === p ? (primo ? "tu scarichi " : "tu ") : (primo ? p + " scarica " : p + " ")) + eur(v);
  const parti = [];
  [["Alessandra", c.libri_ale], ["Giulio", c.libri_giulio]].forEach(x => { if (Math.abs(x[1]) > 0.004) parti.push(voce(x[0], x[1], !parti.length)); });
  const libri = parti.length ? parti.join(", ") : "non entra nei libri di nessuno";
  return `${esc(libri.charAt(0).toUpperCase() + libri.slice(1))} \u00b7 <b>${esc(saldoIo(c.saldo))}</b>`;
}
function currentTrip(d = today()) {
  const t = (D.trasferte || []).filter(t => t.inizio && t.fine && t.inizio <= d && d <= t.fine);
  return t.sort((a, b) => a.inizio < b.inizio ? 1 : -1)[0] || null;
}
function nextTrips(d = today()) { return (D.trasferte || []).filter(t => t.inizio > d && !t.archiviata).sort((a, b) => a.inizio < b.inizio ? -1 : 1); }
function tripChecks(id) { return (D.checklist || []).filter(c => c.trasferta_id === id).sort((a, b) => (a.ordine || 0) - (b.ordine || 0)); }
function tripSpese(nome) { return visibleSpese().filter(s => s.trasferta === nome); }
function tripTotals(nome) { const ss = tripSpese(nome); const ale = ss.reduce((a, s) => a + (+s.libri_ale || 0), 0), giu = ss.reduce((a, s) => a + (+s.libri_giulio || 0), 0);
  return { ale, giu, mio: cfg.who === "Giulio" ? giu : ale, n: ss.length }; }
function checkSummary(id) { const cs = tripChecks(id).filter(c => c.stato !== "na"); const done = cs.filter(c => c.stato === "prenotato" || c.stato === "pagato").length; return { done, tot: cs.length, open: cs.filter(c => c.stato === "da_fare") }; }

// ---------------------------------------------------------------- render
function render() {
  if (!cfg.api || !cfg.token) return renderSetup();
  if (!D) {
    $("#view").innerHTML = lastError
      ? `<div class="empty">Non riesco a collegarmi.<br><span class="small">${esc(lastError)}</span></div><button class="btn primary block" onclick="lastError='';render();reload()">Riprova</button><button class="btn block" onclick="cfg.api='';cfg.token='';LS.set('cfg',cfg);render()">Modifica collegamento</button>`
      : `<div class="empty">Carico i dati…</div><button class="btn block" onclick="cfg.api='';cfg.token='';LS.set('cfg',cfg);render()">Modifica collegamento</button>`;
    return;
  }
  $("#whoBtn").textContent = cfg.who;
  // Le sotto-pagine accendono il tab da cui dipendono: prima non ne accendevano
  // nessuno e la app sembrava "uscita" dalla navigazione (§6 del ticket T10).
  // Le pagine dell'ingranaggio (Documenti, Controllo dati, Impostazioni) non hanno
  // un tab loro: resta acceso quello da cui si e' partiti.
  const tab = view in NAV_PADRE ? NAV_PADRE[view] : view;
  if (tab) tabAcceso = tab;
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("active", b.dataset.v === tabAcceso));
  const bdg = $("#navBadge");
  if (bdg) { const n = postaDaFare().length; bdg.textContent = n > 99 ? "99+" : String(n); bdg.classList.toggle("hidden", !n); }
  setNet();
  const map = { posta: vPosta, soldi: vSoldi, audit: vAudit, oggi: vOggi, trasferte: vTrasferte, trip: vTrip, documenti: vDocumenti, impostazioni: vImpostazioni };
  $("#view").innerHTML = (map[view] || vOggi)();
  const mainEl = document.querySelector("main"); if (mainEl) mainEl.scrollTop = 0; window.scrollTo(0, 0);
}
// Quale tab del fondo si accende per ogni pagina (T10 giro 3: cinque tab,
// Oggi · Trasferte · ＋ · Posta · Soldi). "" = nessuno suo, resta l'ultimo acceso.
const NAV_PADRE = { trip: "trasferte", documenti: "", impostazioni: "", audit: "" };
let tabAcceso = "oggi";
// Le rotte di prima di questo giro: chi le chiama ancora finisce nel segmento
// giusto di Soldi (o nel foglietto dell'ingranaggio), non su una pagina vuota.
const ROTTE_VECCHIE = { spese: ["soldi", "spese"], saldo: ["soldi", "conto"], compensi: ["soldi", "compensi"], dashboard: ["soldi", "anno"] };
// Il "‹" delle sotto-pagine tornava sempre ad Altro anche quando ci si era
// arrivati da Oggi. Adesso si ripercorre la strada fatta.
let navBack = [];
function go(v, arg) {
  if (v === "altro") return apriAltro();
  // la bozza delle impostazioni si butta uscendo: rientrando si riparte dal foglio
  if (view === "impostazioni" && v !== "impostazioni") setBozza = null;
  if (ROTTE_VECCHIE[v]) { arg = ROTTE_VECCHIE[v][1]; v = ROTTE_VECCHIE[v][0]; }
  if (v !== view || arg !== viewArg) { navBack.push({ v: view, a: viewArg }); if (navBack.length > 20) navBack.shift(); }
  view = v; viewArg = arg; render();
}
function indietro(def) {
  const b = navBack.pop();
  if (!b) return go(def || "oggi");
  view = b.v; viewArg = b.a; render();
}
document.querySelectorAll("#nav button").forEach(b => b.addEventListener("click", () => { if (b.dataset.v === "add") return formSpesa(); go(b.dataset.v); }));
// L'ingranaggio in alto e il chip col nome (che prima non faceva niente) aprono
// lo stesso foglietto: quello che era il tab "Altro" (§3.1 del ticket).
$("#whoBtn").addEventListener("click", apriAltro);
$("#gearBtn").addEventListener("click", apriAltro);
// L'ingranaggio: le quattro cose che non stanno in un tab. Q7 — Documenti resta,
// e resta qui: zero righe dopo dieci giorni non vuol dire che non servirà. Note
// sede sta nella pagina della trasferta, sotto Info: è di una trasferta, non
// della app. Ogni riga dice a che punto è la cosa che apre, così il foglietto si
// legge invece di doverlo esplorare.
function apriAltro() {
  if (!D) return;
  const riga = (fn, ico, tit, sotto, pill) => `<div class="card tap" style="margin-bottom:8px" onclick="closeModal();${fn}"><div class="row between"><div class="grow"><b>${ico} ${tit}</b><div class="muted">${sotto}</div></div>${pill || ""}<span>›</span></div></div>`;
  const docs = D.documenti || [];
  const scad = docs.filter(d => d.scadenza && (new Date(d.scadenza) - new Date()) / 864e5 < 180).length;
  const seg = auditRes ? (auditRes.trovati || []).length : null;
  const alta = auditRes ? (auditRes.trovati || []).filter(x => x.gravita === "alta").length : 0;
  openModal(`<div class="row between" style="margin-bottom:10px"><h2 style="margin:0">Altro</h2><span class="muted">collegato come <b>${esc(cfg.who)}</b></span></div>
    ${riga("go('documenti')", "🪪", "Documenti",
      docs.length ? `${docs.length} document${docs.length === 1 ? "o" : "i"}${scad ? ` · ${scad} in scadenza` : ""}` : "Passaporti, licenze, visti, assicurazioni: ancora nessuno",
      scad ? `<span class="pill warn">${scad}</span>` : "")}
    ${riga("go('audit')", "🔎", "Controllo dati",
      seg === null ? "Celle rovinate, conti che non tornano, doppioni" : `${seg === 0 ? "Nessuna segnalazione" : seg + " segnalazion" + (seg === 1 ? "e" : "i")} al controllo del ${fmtDY(auditRes.quando)}`,
      alta ? `<span class="pill bad">${alta}</span>` : "")}
    ${riga("go('impostazioni')", "⚙️", "Impostazioni", "Categorie, checklist, valute, report per il commercialista, collegamento")}
    ${riga("reload()", "🔄", "Ricarica dati",
      queue.length ? `${queue.length} modific${queue.length === 1 ? "a" : "he"} in attesa di invio` : (navigator.onLine ? "Rilegge tutto dal foglio" : "Senza rete: si rileggerà appena torna"),
      queue.length ? `<span class="pill warn">${queue.length}</span>` : "")}`);
}

// ---- setup iniziale
function renderSetup() {
  $("#view").innerHTML = `
    <h1>Benvenuto 👋</h1>
    <div class="card">
      <p class="small">Incolla il link personale che hai ricevuto (contiene indirizzo e token: il token dice all'app chi sei).</p>
      <div class="field"><label>URL API (…/exec) — oppure incolla qui il link completo ricevuto</label><input id="inApi" value="${esc(cfg.api)}" placeholder="https://script.google.com/macros/s/…/exec"></div>
      <div class="field"><label>Token</label><input id="inTok" type="password" autocomplete="off" value="" placeholder="${cfg.token ? "già impostato: lascia vuoto per non cambiarlo" : "arriva dal link"}"></div>
      <button class="btn primary block" id="saveCfg">Collega</button>
    </div>`;
  $("#saveCfg").addEventListener("click", async () => {
    let apiIn = $("#inApi").value.trim(), tokIn = $("#inTok").value.trim();
    const m = apiIn.match(/api=([^&\s]+)/); if (m) { apiIn = decodeURIComponent(m[1]); const k = $("#inApi").value.match(/[#&]k=([^&\s]+)/); if (k) tokIn = k[1]; }
    // il campo non riporta mai il token salvato: vuoto vuol dire "tieni quello che c'e'"
    cfg.api = apiIn; cfg.token = tokIn || cfg.token;
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(cfg.api)) return toast("L'URL API deve essere quello di Apps Script che finisce con /exec", 4000);
    if (!cfg.token) return toast("Manca il token");
    LS.set("cfg", cfg); toast("Collego…"); await reload(false); render();
  });
}

// ---- OGGI
// Giorni da oggi a una data (negativi se e' passata).
const giorniA = d => Math.round((new Date(String(d).slice(0, 10) + "T00:00:00") - new Date(today() + "T00:00:00")) / 864e5);
// Il saldo di UNA trasferta detto nella voce di chi guarda ("su questa trasferta
// Alessandra ti deve 45 €"). Stesso conto di saldoTrasferta, solo la frase cambia.
function saldoTripIo(nome) {
  const v = saldoTrasferta(nome);
  return Math.abs(v) < 0.005 ? "Su questa trasferta siete pari" : "Su questa trasferta " + saldoIo(v);
}
// T10 giro 3 (§3.2): l'hero della trasferta in corso porta due azioni, la posta e'
// una carta sola, il conto e' una riga nella voce di chi legge, poi la prossima
// trasferta e le ultime TRE spese (Q5). Il bottone "Aggiungi spesa" in fondo non
// c'e' piu': la stessa cosa la fanno il ＋ della barra e l'hero.
function vOggi() {
  const t = currentTrip(); const nxt = nextTrips()[0]; const s = saldoTot();
  let h = `<h1>Ciao ${cfg.who} 👋</h1>`;
  if (t) {
    const cs = checkSummary(t.id), tot = tripTotals(t.nome), gg = giorniA(t.fine);
    h += `<div class="card hero">
      <div class="muted">In corso${gg > 0 ? ` · ${gg} giorn${gg === 1 ? "o" : "i"} al rientro` : gg === 0 ? " · ultimo giorno" : ""}</div>
      <div class="big tap" onclick="go('trip','${t.id}')">${esc(t.nome)}</div>
      <div class="row between" style="margin-top:4px"><span>${fmtD(t.inizio)} → ${fmtD(t.fine)}${t.citta ? " · " + esc(t.citta) : ""}</span><span class="pill">${esc(t.valuta || "EUR")}</span></div>
      <div class="row between" style="margin-top:10px"><span>Spese tue <b>${eur(tot.mio)}</b></span><span>Checklist <b>${cs.done}/${cs.tot}</b></span></div>
      <div class="muted" style="margin-top:4px">${esc(saldoTripIo(t.nome))}</div>
      <div class="row acts"><button class="btn grow" onclick="spesaPerTrip('${t.id}')">＋ Spesa</button><button class="btn grow" onclick="go('trip','${t.id}')">Checklist${cs.open.length ? ` · ${cs.open.length} da fare` : ""}</button></div>
    </div>`;
  } else {
    h += `<div class="card"><div class="muted">Nessuna trasferta in corso</div>${nxt ? `<div>Prossima: <b>${esc(nxt.nome)}</b> dal ${fmtDY(nxt.inizio)}</div>` : `<div>Aggiungi la prossima trasferta dalla pagina Trasferte</div>`}</div>`;
  }
  // Una carta sola per la posta: prenotazioni e ricevute stanno ormai insieme.
  const posta = postaDaFare();
  if (posta.length) {
    const nP = posta.filter(c => c.pren && c.pren.stato === "nuova").length, nQ = posta.filter(c => c.prop && c.prop.stato === "nuova").length;
    const totP = posta.reduce((a, c) => a + (c.prop && c.prop.stato === "nuova" && (!c.prop.valuta || c.prop.valuta === "EUR") ? Number(c.prop.importo) || 0 : 0), 0);
    h += `<div class="card tap" style="border-color:var(--warn)" onclick="go('posta')"><div class="row between"><div class="grow"><b>📬 ${posta.length} cos${posta.length === 1 ? "a" : "e"} in Posta</b><div class="muted">${nP ? nP + " prenotazion" + (nP === 1 ? "e" : "i") : ""}${nP && nQ ? " · " : ""}${nQ ? nQ + " ricevut" + (nQ === 1 ? "a" : "e") + (totP ? " (" + eur(totP) + ")" : "") : ""}</div></div><span class="pill bad">${posta.length}</span><span>›</span></div></div>`;
  }
  // Promemoria scontrini: solo le MIE spese dell'anno in corso a cui manca la foto
  const annoOra = today().slice(0, 4), meseOra = today().slice(0, 7);
  const noSc = mieSpese().filter(x => !x.scontrino && String(x.data).slice(0, 4) === annoOra);
  const noScMese = noSc.filter(x => String(x.data).slice(0, 7) === meseOra).length;
  if (noSc.length) h += `<div class="card tap" onclick="apriSenzaScontrino('${annoOra}')"><div class="row between"><div class="grow"><b>🧾 Scontrini mancanti</b><div class="muted">${noSc.length} spes${noSc.length === 1 ? "a" : "e"} senza foto nel ${annoOra}${noScMese ? ` · ${noScMese} di questo mese` : ""}</div></div><span class="pill ${noScMese ? "bad" : "warn"}">${noSc.length}</span><span>›</span></div></div>`;
  // Il conto nella voce di chi legge (saldoIo), non "+4 918 €" con la legenda.
  h += `<div class="card tap" onclick="go('soldi','conto')"><div class="row between"><div class="grow"><div class="muted">Conto</div><div style="font-weight:700;font-size:17px">${esc(frase(saldoIo(s)))}</div></div><span>›</span></div></div>`;
  if (nxt) {
    const cs = checkSummary(nxt.id), days = giorniA(nxt.inizio);
    h += `<h2>Prossima</h2><div class="card tap" onclick="go('trip','${nxt.id}')"><div class="row between"><div class="grow"><b>${esc(nxt.nome)}</b><div class="muted">${fmtD(nxt.inizio)} → ${fmtD(nxt.fine)} · tra ${days} giorn${days === 1 ? "o" : "i"}${nxt.valuta && nxt.valuta !== "EUR" ? " · " + esc(nxt.valuta) : ""}</div></div>
      <span class="pill ${cs.open.length ? (days < 14 ? "bad" : "warn") : ""}">${cs.open.length ? cs.open.length + " da fare" : "✓ pronta"}</span></div></div>`;
  }
  // Fuori i compensi caddie e i pagamenti fra loro due: non sono "spese" e
  // leggerli qui faceva sembrare i tre bonifici delle uscite (§6 del ticket).
  const recent = visibleSpese().filter(s => s.tipo !== "caddie" && s.tipo !== "regolamento")
    .sort((a, b) => (b.creato || "") < (a.creato || "") ? -1 : 1).slice(0, 3);
  if (recent.length) { h += `<h2>Ultime spese</h2><div class="card list">` + recent.map(s => itemSpesa(s, true)).join("") + `</div>`; }
  return h;
}
// Prima lettera maiuscola: saldoIo parla in mezzo a una frase ("devi a…").
const frase = s => s.charAt(0).toUpperCase() + s.slice(1);

// La riga di una spesa. §3.6: l'icona dello scontrino compare solo quando MANCA
// (prima c'era un quadrato grigio in ogni caso, e non diceva niente).
function itemSpesa(s, mio) {
  const pieno = Math.round((+s.importo_eur || 0) * 100) / 100, val = mio ? mioImporto(s) : pieno, parz = mio && Math.abs(val - pieno) > 0.005;
  const tag = s.tipo === "condivisa" ? `<span class="pill">condivisa${+s.n_persone > 2 ? " ÷" + s.n_persone : ""}</span>` : s.tipo === "ciascuno" ? `<span class="pill blue">ognuno la sua</span>` : s.tipo === "personale" ? `<span class="pill grey">${esc(s.conto)}</span>` : s.tipo === "caddie" ? `<span class="pill warn">compenso caddie</span>` : `<span class="pill warn">pagamento</span>`;
  const orig = !parz && s.valuta && s.valuta !== "EUR" ? `<span class="muted">${num(s.importo)} ${esc(s.valuta)}</span> ` : "";
  const manca = !s.scontrino && s.tipo !== "caddie" ? `<div class="nosc" title="manca lo scontrino">🧾 manca</div>` : "";
  return `<div class="item tap" onclick="formSpesa('${s.id}')">
    <div class="grow"><div class="ellipsis"><b>${esc(s.descrizione || s.categoria)}</b></div><div class="muted ellipsis">${fmtD(s.data)} · ${esc(s.trasferta)} · ${esc(catBreve(s.categoria))} · ${esc(s.pagato_da)}</div><div>${tag}</div></div>
    <div style="text-align:right">${orig}<div class="amt">${eur(val)}</div>${parz ? `<div class="muted">su ${eur(pieno)}</div>` : ""}${manca}</div></div>`;
}

// ---- TRASFERTE
// Indice spese per trasferta: quante in tutto e quante ne vedo io (le personali dell'altro non le vedo).
function spesePerTrasferta() {
  const m = {};
  (D.spese || []).forEach(s => {
    const n = s.trasferta; if (!n) return;
    const x = m[n] || (m[n] = { tot: 0, mie: 0, date: [] });
    x.tot++;
    if (!(s.tipo === "personale" && s.conto && s.conto !== cfg.who)) { x.mie++; if (s.data) x.date.push(String(s.data).slice(0, 10)); }
  });
  return m;
}
// L'elenco che vedo io: ogni trasferta in cui ho almeno una spesa visibile, comprese quelle
// che esistono solo nelle spese (senza riga nel tab Trasferte). Le trasferte ancora senza
// nessuna spesa restano visibili a entrambi (nuove/future).
function trasferteVisibili() {
  const m = spesePerTrasferta();
  const conScheda = new Set((D.trasferte || []).map(t => t.nome));
  const reali = (D.trasferte || []).filter(t => { const x = m[t.nome]; return !x || x.mie > 0; });
  const virtuali = Object.keys(m).filter(n => !conScheda.has(n) && m[n].mie > 0).map(n => {
    const d = m[n].date.slice().sort();
    return { id: "", nome: n, inizio: d[0] || "", fine: d[d.length - 1] || "", anno: (d[0] || "").slice(0, 4), virtuale: true };
  });
  return reali.concat(virtuali);
}
let trVirt = [];
// T10 giro 4 (§3.5): il tipo e' un'etichetta piccola sulla carta, non piu' il
// colore della carta con una legenda a quattro voci. Torneo e' il caso normale.
const TIPI_T = { torneo: "Torneo (settimana pagata)", qualifica: "Qualifica / Q-School (non pagata)", casa: "Casa", altro: "Altro" };
const TAG_TIPO = { torneo: "", qualifica: " blue", casa: " grey", altro: " warn" };
const tagTipo = tp => { const k = String(tp || "torneo").toLowerCase(); return `<span class="pill${k in TAG_TIPO ? TAG_TIPO[k] : " grey"}">${esc(k)}</span>`; };
// Trasferte che esistono solo nelle spese: toccandole si crea la scheda,
// cosi' diventano modificabili come tutte le altre. Il nome NON va cambiato:
// le spese sono collegate alla trasferta per nome.
function creaScheda(i) {
  const t = trVirt[i]; if (!t) return;
  toast("Questa trasferta non ha ancora una scheda. Non cambiare il nome: le spese sono collegate per nome.", 5000);
  formTrip(null, { nome: t.nome, inizio: t.inizio, fine: t.fine, tipo: "altro" });
}
// "tra 12 giorni" · "in corso · 3 giorni al rientro" · "conclusa 5 giorni fa"
const giorni = n => `${n} giorn${n === 1 ? "o" : "i"}`;
function quandoTrip(t) {
  if (!t.inizio || !t.fine) return "";
  const a = giorniA(t.inizio), b = giorniA(t.fine);
  if (a > 0) return `tra ${giorni(a)}`;
  if (b < 0) return `conclusa ${giorni(-b)} fa`;
  return b > 0 ? `in corso · ${giorni(b)} al rientro` : "in corso · ultimo giorno";
}
// In corso · Prossime · Passate. La regola di chi compare non cambia
// (trasferteVisibili): almeno una spesa visibile, oppure nessuna spesa ancora.
// Una trasferta virtuale senza date finisce fra le passate.
function gruppiTrasferte() {
  const all = trasferteVisibili(), oggi = today();
  const corso = all.filter(t => t.inizio && t.inizio <= oggi && oggi <= t.fine).sort((a, b) => a.inizio < b.inizio ? -1 : 1);
  const prossime = all.filter(t => t.inizio > oggi).sort((a, b) => a.inizio < b.inizio ? -1 : 1);
  const passate = all.filter(t => !corso.includes(t) && !prossime.includes(t)).sort((a, b) => a.inizio < b.inizio ? 1 : -1);
  return { all, corso, prossime, passate };
}
const annoTrip = t => String(t.anno || (t.inizio || "").slice(0, 4));
let trAnno = "";
function vTrasferte() {
  const g = gruppiTrasferte(), oggi = today();
  trVirt = g.all.filter(t => t.virtuale);
  // l'anno vale solo per le passate: le altre sono poche e si vedono tutte
  const anni = [...new Set(g.passate.map(annoTrip))].sort().reverse();
  if (!trAnno || !anni.includes(trAnno)) trAnno = anni.includes(oggi.slice(0, 4)) ? oggi.slice(0, 4) : (anni[0] || oggi.slice(0, 4));
  const lista = g.passate.filter(t => annoTrip(t) === trAnno);
  let h = `<div class="row between"><h1>Trasferte</h1><button class="btn sm primary" onclick="formTrip()">＋ Nuova</button></div>`;
  if (g.corso.length) h += `<h2>In corso</h2>` + g.corso.map(t => cardTrasferta(t, "corso")).join("");
  h += `<h2>Prossime${g.prossime.length ? ` <span class="muted">(${g.prossime.length})</span>` : ""}</h2>`;
  h += g.prossime.length ? g.prossime.map(t => cardTrasferta(t, "prossime")).join("") : `<div class="muted" style="margin-bottom:12px">Nessuna trasferta in programma.</div>`;
  h += `<div class="row between"><h2>Passate${lista.length ? ` <span class="muted">(${lista.length})</span>` : ""}</h2>${anni.length ? `<button class="btn sm" onclick="scegliAnnoTrasferte()">${esc(trAnno)} ▾</button>` : ""}</div>`;
  h += lista.length ? lista.map(t => cardTrasferta(t, "passate")).join("") : `<div class="muted">Nessuna trasferta passata nel ${esc(trAnno)}.</div>`;
  return h;
}
function scegliAnnoTrasferte() {
  const n = {}; gruppiTrasferte().passate.forEach(t => { const y = annoTrip(t); n[y] = (n[y] || 0) + 1; });
  const anni = Object.keys(n).sort().reverse();
  sceltaFoglietto("Anno", anni.map(y => ({ v: y, lab: y, n: n[y] })), trAnno, v => { trAnno = v; render(); });
}
// La carta di una trasferta. Quella virtuale (solo nelle spese) e' tratteggiata
// e tiene il suo "crea scheda".
function cardTrasferta(t, gruppo) {
  const tot = tripTotals(t.nome);
  if (t.virtuale) return `<div class="card tap virt" onclick="creaScheda(${trVirt.indexOf(t)})"><div class="row between"><div class="grow"><b>${esc(t.nome)}</b> <span class="pill grey">senza scheda</span><div class="muted">${fmtDY(t.inizio)} → ${fmtDY(t.fine)} · tocca per creare la scheda</div></div>
      <div style="text-align:right"><div class="amt">${eur(tot.mio)}</div><div class="muted">${tot.n} spes${tot.n === 1 ? "a" : "e"}</div></div></div></div>`;
  const cs = checkSummary(t.id), q = gruppo === "passate" ? "" : quandoTrip(t);
  const destra = gruppo === "passate" || !cs.tot ? `${tot.n} spes${tot.n === 1 ? "a" : "e"}` : `checklist ${cs.done}/${cs.tot}`;
  return `<div class="card tap" onclick="go('trip','${t.id}')"><div class="row between"><div class="grow"><b>${esc(t.nome)}</b> ${tagTipo(t.tipo)}<div class="muted">${fmtDY(t.inizio)} → ${fmtDY(t.fine)}${t.citta ? " · " + esc(t.citta) : ""}${q ? " · " + q : ""}</div></div>
    <div style="text-align:right"><div class="amt">${eur(tot.mio)}</div><div class="muted">${destra}</div></div></div></div>`;
}

// ---- la pagina della trasferta (§3.5): una testata e quattro segmenti,
// Checklist · Spese · Posta · Info, al posto di undici blocchi in fila.
// La testata: date, quando, spese tue, checklist, e il conto di QUESTA trasferta
// nella voce di chi legge (saldoTripIo, giro 3). Duplica ed Elimina stanno in Info.
let tripSeg = "checklist", tripSegId = "", naAperte = false;
const TRIP_SEG = { checklist: "Checklist", spese: "Spese", posta: "Posta", info: "Info" };
function setTripSeg(s) { tripSeg = s; render(); }
function vTrip() {
  const t = (D.trasferte || []).find(x => x.id === viewArg); if (!t) return vTrasferte();
  // una trasferta passata si apre sulle spese: la sua checklist ha gia' fatto il suo
  if (tripSegId !== t.id) { tripSegId = t.id; naAperte = false; tripSeg = t.fine && t.fine < today() ? "spese" : "checklist"; }
  const cs = checkSummary(t.id), tot = tripTotals(t.nome);
  const carte = postaCarte().filter(c => c.trip === t.nome);
  // sui segmenti solo i numeri che vogliono dire "da fare"
  const n = { checklist: cs.open.length, posta: carte.filter(c => c.seg === "da_fare").length };
  const q = quandoTrip(t);
  let h = `<div class="row"><button class="btn sm" onclick="indietro('trasferte')">‹</button><h1 class="grow" style="margin:0">${esc(t.nome)}</h1><button class="ask" onclick="tripAiuto()" title="Come funziona">?</button><button class="btn sm" onclick="formTrip('${t.id}')">Modifica</button></div>
    <div class="card head" style="margin-top:12px">
      <div class="row between"><span>${fmtDY(t.inizio)} → ${fmtDY(t.fine)}${t.citta ? " · " + esc(t.citta) : ""} · ${esc(t.valuta || "EUR")}</span>${tagTipo(t.tipo)}</div>
      ${q ? `<div class="muted">${esc(frase(q))}</div>` : ""}
      <div class="kp"><div><b>${eur(tot.mio)}</b><span>Spese tue</span></div><div><b>${cs.tot ? cs.done + "/" + cs.tot : "—"}</b><span>Checklist</span></div></div>
      <div style="font-weight:600;margin-top:10px">${esc(saldoTripIo(t.nome))}</div>
    </div>
    <div class="seg" style="margin:0 0 12px">${Object.keys(TRIP_SEG).map(k => `<button class="${tripSeg === k ? "on" : ""}" onclick="setTripSeg('${k}')">${TRIP_SEG[k]}${n[k] ? " " + n[k] : ""}</button>`).join("")}</div>`;
  return h + ({ checklist: tripChecklistSeg, spese: tripSpeseSeg, posta: tripPostaSeg, info: tripInfoSeg }[tripSeg] || tripChecklistSeg)(t, carte);
}
// Checklist: le voci vive sopra, le "non serve" chiuse sotto (sono 171 su 216,
// §1 del ticket: a video erano solo rumore).
function tripChecklistSeg(t) {
  const cs = tripChecks(t.id), attive = cs.filter(c => c.stato !== "na"), na = cs.filter(c => c.stato === "na");
  let h = `<div class="row between"><h2 style="margin-top:6px">Checklist</h2><button class="btn sm" onclick="formCheck(null,'${t.id}')">＋ voce</button></div>
    <div class="card">${attive.length ? attive.map(rigaCheck).join("") : `<div class="muted">${cs.length ? "Niente da fare: è tutto “non serve”." : "Nessuna voce. Aggiungine una con ＋ voce."}</div>`}</div>`;
  if (na.length) h += `<div class="card" style="padding-top:10px;padding-bottom:10px"><div class="row between tap" onclick="naAperte=!naAperte;render()"><span class="muted">Non serve · ${na.length}</span><span class="muted">${naAperte ? "▴" : "▾"}</span></div>${naAperte ? `<div style="margin-top:4px">${na.map(rigaCheck).join("")}</div>` : ""}</div>`;
  return h;
}
// Una riga: il cerchio e' la spunta (un tocco = una scrittura, fatto ⇄ da fare),
// il resto della riga apre il foglietto della voce. Su una voce "non serve" anche
// il cerchio apre il foglietto: rimetterla in gioco e' una scelta, non un tocco di
// passaggio. ✉️ e 📄 (T2) restano a destra: prima la mail, poi il PDF, che si
// apre anche in aereo.
function rigaCheck(c) {
  const na = c.stato === "na", f = fattoCheck(c);
  const sotto = [c.codice, c.note].filter(Boolean).map(esc).join(" · ");
  return `<div class="check ${na ? "na" : f ? "fatto" : "da_fare"}">
    <div class="st" onclick="${na ? `formCheck('${c.id}')` : `segnaCheck('${c.id}',${f ? "false" : "true"})`}">${STATI[c.stato]?.ico || ""}</div>
    <div class="grow" onclick="formCheck('${c.id}')"><div class="name">${esc(c.voce)}${c.chi ? ` <span class="muted">· ${esc(c.chi)}</span>` : ""}</div>${sotto ? `<div class="muted ellipsis">${sotto}</div>` : ""}</div>
    ${bottoniVoce(c)}</div>`;
}
function tripSpeseSeg(t) {
  const tot = tripTotals(t.nome), ss = tripSpese(t.nome).sort((a, b) => a.data < b.data ? 1 : -1);
  const byCat = {}; ss.forEach(s => { if (s.tipo !== "caddie" && s.tipo !== "regolamento") { const k = catBreve(s.categoria); byCat[k] = (byCat[k] || 0) + mioImporto(s); } });
  return `<div class="kpis"><div class="kpi"><div class="v">${eur(tot.ale)}</div><div class="l">Libri Alessandra</div></div><div class="kpi"><div class="v">${eur(tot.giu)}</div><div class="l">Libri Giulio</div></div>${t.budget ? `<div class="kpi"><div class="v">${eur(t.budget)}</div><div class="l">Budget · ${pct(tot.ale / t.budget)} usato</div></div>` : ""}</div>
    ${Object.keys(byCat).length ? `<div class="card">${bars(byCat)}</div>` : ""}
    <div class="card list">${ss.length ? ss.map(s => itemSpesa(s, true)).join("") : `<div class="muted">Nessuna spesa</div>`}</div>
    <button class="btn block" onclick="spesaPerTrip('${t.id}')">＋ Spesa per questa trasferta</button>`;
}
// Dall'id, non dal nome: un nome con l'apostrofo dentro un onclick si spaccherebbe.
function spesaPerTrip(id) { const t = (D.trasferte || []).find(x => x.id === id); if (t) formSpesa(null, t.nome); }
function notaTrip(id) { const t = (D.trasferte || []).find(x => x.id === id); if (t) formNota(baseName(t.nome)); }
// Posta: le carte di questa trasferta, le stesse di vPosta con gli stessi bottoni.
function tripPostaSeg(t, carte) {
  const aperte = carte.filter(c => c.seg === "da_fare"), fatte = carte.filter(c => c.seg === "fatte");
  if (!aperte.length && !fatte.length) return `<div class="empty">Nessuna mail per questa trasferta.<br><span class="small">Quello che il lettore trova arriva qui e in Posta.</span></div>`;
  let h = "";
  if (aperte.length) h += `<h2 style="margin-top:6px">Da fare <span class="muted">(${aperte.length})</span></h2>` + aperte.map(cardPosta).join("");
  if (fatte.length) h += `<h2>Fatte <span class="muted">(${fatte.length})</span></h2>` + fatte.map(cardPosta).join("");
  return h;
}
function tripInfoSeg(t) {
  const nota = (D.note || []).find(n => n.chiave === baseName(t.nome));
  const righe = [["Tipo", TIPI_T[String(t.tipo || "torneo").toLowerCase()] || t.tipo], ["Città", t.citta], ["Paese", t.paese], ["Valuta", t.valuta || "EUR"], ["Fuso", t.fuso], ["Budget", t.budget ? eur(t.budget) : ""], ["Intercontinentale", t.intercontinentale === "si" ? "sì" : "no"]].filter(r => r[1]);
  return `<h2 style="margin-top:6px">Scheda</h2><div class="card tap" onclick="formTrip('${t.id}')">${righe.map(r => `<div class="row between" style="padding:3px 0"><span class="muted">${r[0]}</span><span>${esc(r[1])}</span></div>`).join("")}</div>
    <h2>Note</h2><div class="card tap" onclick="formTrip('${t.id}')">${t.note ? esc(t.note).replace(/\n/g, "<br>") : `<span class="muted">Indirizzo dell'alloggio, targa dell'auto, contatti… tocca per scrivere</span>`}</div>
    <h2>Note sede <span class="muted">(${esc(baseName(t.nome))}, valide ogni anno)</span></h2>
    <div class="card tap" onclick="notaTrip('${t.id}')">${nota && nota.testo ? esc(nota.testo).replace(/\n/g, "<br>") : `<span class="muted">Hotel che vi è piaciuto, distanza dal campo, dove fare la spesa… tocca per scrivere</span>`}</div>
    <div class="row" style="margin-top:14px;gap:8px"><button class="btn grow" onclick="duplicaTrip('${t.id}')">Duplica per l'anno prossimo</button><button class="btn danger" onclick="delTrip('${t.id}')">Elimina</button></div>`;
}
// Le regole della pagina, dietro il "?" (ADR-4): prima stavano in un paragrafo
// sotto la checklist.
function tripAiuto() {
  aiutoFoglietto("Come funziona la trasferta", [
    `<b>Checklist</b>: il cerchio è la spunta — un tocco segna fatto, un altro rimette da fare, e ogni tocco è una scrittura sola. Il resto della riga apre la voce: link, codice, chi se ne occupa, <i>Non serve</i>, e le frecce per spostarla. Le voci "non serve" stanno chiuse in fondo.`,
    `Su una voce collegata a una mail, <b>✉️</b> apre la mail e <b>📄</b> il PDF salvato in Drive, che si apre anche in aereo. Il link del fornitore è nella carta della mail, sotto <i>Posta</i>.`,
    `<b>Spese</b>: <i>Libri</i> è quanto va sui libri di ciascuno, <i>Spese tue</i> in testa è la tua quota. Il conto in testa è solo di questa trasferta.`,
    `<b>Posta</b>: le mail di questa trasferta, le stesse carte e gli stessi bottoni della pagina Posta.`,
    `Le spese sono legate alla trasferta <b>per nome</b>: se la rinomini dalla scheda si aggiornano da sole.`,
  ]);
}

function bars(obj, total) {
  const keys = Object.keys(obj).sort((a, b) => obj[b] - obj[a]); const max = Math.max(...keys.map(k => obj[k]), 1);
  const tot = total || keys.reduce((a, k) => a + obj[k], 0) || 1;
  return keys.map(k => `<div class="barrow"><div class="row between"><span class="ellipsis">${esc(k)}</span><span class="amt">${eur(obj[k])} <span class="muted">${pct(obj[k] / tot)}</span></span></div><div class="bar"><i style="width:${Math.max(2, obj[k] / max * 100)}%"></i></div></div>`).join("");
}

// Apre la lista Spese già filtrata sulle spese senza scontrino dell'anno indicato.
function apriSenzaScontrino(anno) {
  fSp.q = ""; fSp.trip = ""; fSp.tipo = ""; fSp.cat = "";
  fSp.anno = anno || today().slice(0, 4); fSp.noScont = true;
  go("soldi", "spese");
}

// ---------------------------------------------------------------- SOLDI (T10, giro 3)
// ADR-3: i soldi stanno in un posto solo. Spese, Conto tra voi, Compensi e Dashboard
// erano quattro pagine (due sotto Altro) e il saldo compariva in cinque punti; qui
// e' UNA pagina con una testata sola — il conto nella voce di chi legge, poi le
// spese tue, le entrate e il netto dell'anno — e quattro segmenti:
// Conto · Spese · Compensi · Anno. I CONTI non si toccano: computeSpesa, mioImporto,
// saldoTot, saldoTrasferta, daPagare e saldoIo sono quelli di prima; e' cambiato
// solo dove stanno le cose e come sono dette. Le regole (che cosa fa una condivisa,
// da dove viene il compenso, che cos'e' "da bonificare") sono dietro il "?" (ADR-4).
let soldiSeg = "conto", soldiAnno = "";
const SOLDI_SEG = { conto: "Conto", spese: "Spese", compensi: "Compensi", anno: "Anno" };
function setSoldiSeg(s) { soldiSeg = s; viewArg = s; render(); }
// Gli anni in cui c'e' qualcosa (spese o entrate), dal piu' recente.
function anniSoldi() {
  const ys = new Set(visibleSpese().map(s => String(s.data).slice(0, 4)));
  entrateTutte().forEach(c => ys.add(c.data.slice(0, 4)));
  return [...ys].filter(y => /^\d{4}$/.test(y)).sort().reverse();
}
function vSoldi() {
  if (viewArg && SOLDI_SEG[viewArg]) soldiSeg = viewArg;
  const years = anniSoldi();
  if (!soldiAnno || !years.includes(soldiAnno)) soldiAnno = years.includes(today().slice(0, 4)) ? today().slice(0, 4) : (years[0] || today().slice(0, 4));
  const y = soldiAnno, s = saldoTot();
  // Spese tue = la quota a tuo carico (mioImporto), fuori i compensi e i pagamenti:
  // e' la stessa somma della lista Spese e della vecchia carta "Spese <chi guarda>".
  const out = Math.round(mieSpese().filter(x => String(x.data).startsWith(y)).reduce((a, x) => a + mioImporto(x), 0) * 100) / 100;
  const inc = Math.round(entrateAnno(y).reduce((a, c) => a + c.val, 0) * 100) / 100;
  const labIn = cfg.who === "Giulio" ? "Compensi" : "Vincite";
  let h = `<div class="row"><h1 class="grow" style="margin:0">Soldi</h1><button class="ask" onclick="soldiAiuto()" title="Come funziona">?</button><button class="btn sm" onclick="scegliAnnoSoldi()">${esc(y)} ▾</button></div>
    <div class="card head" style="margin-top:12px"><div class="muted">Conto</div><div style="font-weight:700;font-size:19px">${esc(frase(saldoIo(s)))}</div>
      <div class="kp"><div><b>${eur(out)}</b><span>Spese tue ${esc(y)}</span></div><div><b class="in">${eur(inc)}</b><span>${esc(labIn)} ${esc(y)}</span></div><div><b class="${inc - out < 0 ? "out" : "in"}">${eur(inc - out)}</b><span>Netto ${esc(y)}</span></div></div></div>
    <div class="seg" style="margin:0 0 12px">${Object.keys(SOLDI_SEG).map(k => `<button class="${soldiSeg === k ? "on" : ""}" onclick="setSoldiSeg('${k}')">${SOLDI_SEG[k]}</button>`).join("")}</div>`;
  return h + ({ conto: soldiConto, spese: soldiSpese, compensi: soldiCompensi, anno: soldiAnnoSeg }[soldiSeg] || soldiConto)();
}
function scegliAnnoSoldi() {
  const ys = anniSoldi();
  sceltaFoglietto("Anno", ys.map(y => ({ v: y, lab: y })), soldiAnno, v => { soldiAnno = v; render(); });
}
// Le regole della pagina, dietro il "?": erano quattro paragrafi su quattro pagine.
function soldiAiuto() {
  const st = D.settings || {}, fisso = Number(st.compenso_fisso || 900);
  aiutoFoglietto("Come funziona Soldi", [
    `<b>Conto</b> è quello che vi dovete: una spesa <i>condivisa</i> pagata da uno crea il debito della quota dell'altro, un compenso caddie va a credito di Giulio, un <i>pagamento</i> azzera. Qui è detto dal tuo punto di vista.`,
    `<b>Spese</b> sono solo le tue, come il numero in testa: ${cfg.who === "Giulio" ? "la tua quota delle condivise e le tue personali" : "le condivise per intero e le tue personali"}. Compensi e pagamenti non sono spese: stanno in Conto.`,
    `<b>Compensi</b>: ${eur(fisso)} a settimana di torneo · ${esc(st.perc_taglio || 8)}% del montepremi lordo con taglio superato · ${esc(st.perc_vittoria || 10)}% con vittoria. Il compenso resta lordo, è quello che Alessandra scarica. <b>Da bonificare</b> è il compenso più il conto di quella trasferta: un bonifico solo chiude tutti e due. Il 50% delle tratte intercontinentali arriva dal conto, non dal compenso: quei voli si registrano come spesa condivisa.`,
    `<b>Anno</b>: <i>Spese Team</i> è quanto vi è costata la stagione nelle settimane di torneo e qualifica, ogni spesa contata una volta per l'importo pieno, chiunque abbia pagato. La calcola il server, perché a questa app mancano le personali dell'altra persona.`,
  ]);
}
// Un foglietto con una lista di scelte: e' il "picker" dietro ogni pasticca dei filtri.
// opz = [{v, lab, n}], cur = il valore acceso, cb(v) alla scelta. Le scelte passano
// per indice, non per valore: un nome con l'apostrofo dentro un onclick si spaccherebbe.
let _scelta = null;
function sceltaFoglietto(titolo, opz, cur, cb) {
  _scelta = { opz, cb };
  openModal(`<h2 style="margin-top:0">${esc(titolo)}</h2><div class="card list" style="padding:0 14px">${opz.map((o, i) => { const on = String(o.v) === String(cur); return `<div class="item tap" onclick="closeModal();_scelta.cb(_scelta.opz[${i}].v)"><div class="grow"><b style="${on ? "color:var(--brand)" : ""}">${esc(o.lab)}</b></div>${o.n != null ? `<span class="muted">${esc(o.n)}</span>` : ""}${on ? `<span style="color:var(--brand)">✓</span>` : ""}</div>`; }).join("")}</div>`);
}

// ---- SOLDI › Spese (lista con filtri)
// La lista mostra SOLO le spese che compongono "Spese tue" in testa alla pagina:
// le mie personali + le condivise / ognuno-la-sua (per Giulio la sua quota, per Alessandra
// l'intero, come mioImporto). Restano fuori le personali dell'altro (gia' filtrate dal server),
// i compensi caddie e i pagamenti fra loro due: quelli si vedono nel segmento Conto.
const mieSpese = () => visibleSpese().filter(s => s.tipo !== "caddie" && s.tipo !== "regolamento" && Math.abs(mioImporto(s)) > 0.004);
let fSp = { q: "", trip: "", tipo: "", cat: "", anno: "", noScont: false, cerca: false };
function soldiSpese() {
  const all = mieSpese();
  const years = [...new Set(all.map(s => String(s.data).slice(0, 4)))].filter(y => /^\d{4}$/.test(y)).sort().reverse();
  if (!fSp.anno || !years.includes(fSp.anno)) fSp.anno = years[0] || "";
  const inAnno = all.filter(s => String(s.data).slice(0, 4) === fSp.anno);
  const trips = [...new Set(inAnno.map(s => s.trasferta))].filter(Boolean).sort();
  const tipiIn = new Set(inAnno.map(s => s.tipo));
  const tipi = ["personale", "condivisa", "ciascuno"].filter(k => tipiIn.has(k));
  const catIn = new Set(inAnno.map(s => s.categoria).filter(Boolean));
  const catSet = D.settings.categorie || [];
  const cats = catSet.filter(c => catIn.has(c)).concat([...catIn].filter(c => !catSet.includes(c)).sort());
  // se un filtro punta a un valore che nell'anno scelto non esiste, lo lascio cadere
  if (fSp.trip && !trips.includes(fSp.trip)) fSp.trip = "";
  if (fSp.tipo && !tipi.includes(fSp.tipo)) fSp.tipo = "";
  if (fSp.cat && !cats.includes(fSp.cat)) fSp.cat = "";
  const q = fSp.q.trim().toLowerCase();
  let list = inAnno.filter(s => (!fSp.trip || s.trasferta === fSp.trip) && (!fSp.tipo || s.tipo === fSp.tipo) && (!fSp.cat || s.categoria === fSp.cat) && (!fSp.noScont || !s.scontrino) && (!q || ((s.descrizione || "") + " " + (s.categoria || "") + " " + (s.trasferta || "")).toLowerCase().includes(q)));
  list.sort((a, b) => a.data < b.data ? 1 : a.data > b.data ? -1 : (b.creato || "") > (a.creato || "") ? 1 : -1);
  const tot = Math.round(list.reduce((a, s) => a + mioImporto(s), 0) * 100) / 100;
  const byM = {}; list.forEach(s => { const m = String(s.data).slice(0, 7); byM[m] = Math.round(((byM[m] || 0) + mioImporto(s)) * 100) / 100; });
  const senzaS = list.filter(s => !s.scontrino).length;
  const attivi = (q ? 1 : 0) + (fSp.trip ? 1 : 0) + (fSp.tipo ? 1 : 0) + (fSp.cat ? 1 : 0) + (fSp.noScont ? 1 : 0);
  // §3.6: i filtri sono UNA riga di pasticche, ognuna apre un foglietto di scelta.
  // Quante righe ha ogni scelta lo dice il foglietto, cosi' non si sceglie al buio.
  const conta = f => { const c = {}; inAnno.forEach(s => { const k = f(s); if (k) c[k] = (c[k] || 0) + 1; }); return c; };
  const chip = (on, lab, fn) => `<button type="button" class="${on ? "on" : ""}" onclick="${fn}">${lab}</button>`;
  let h = `<div class="chips scroll">
      ${chip(true, esc(fSp.anno) + " ▾", "filtroSpese('anno')")}
      ${chip(!!fSp.trip, (fSp.trip ? esc(fSp.trip) : "Trasferta") + " ▾", "filtroSpese('trip')")}
      ${chip(!!fSp.cat, (fSp.cat ? esc(catBreve(fSp.cat)) : "Categoria") + " ▾", "filtroSpese('cat')")}
      ${tipi.length > 1 ? chip(!!fSp.tipo, (fSp.tipo ? esc(TIPI[fSp.tipo]) : "Tipo") + " ▾", "filtroSpese('tipo')") : ""}
      ${chip(fSp.noScont, "🧾 Senza scontrino", "fSp.noScont=!fSp.noScont;render()")}
      ${chip(fSp.cerca || !!q, "🔍", "fSp.cerca=!fSp.cerca;if(!fSp.cerca)fSp.q='';render()")}
      ${attivi ? chip(false, "✕ Azzera", "fSp.q='';fSp.trip='';fSp.tipo='';fSp.cat='';fSp.noScont=false;fSp.cerca=false;render()") : ""}
    </div>
    ${fSp.cerca || q ? `<div class="field" style="margin:8px 0 4px"><input class="fq" placeholder="Cerca descrizione, categoria, trasferta…" value="${esc(fSp.q)}" oninput="fSp.q=this.value;render()" autofocus></div>` : ""}
    <div class="row between" style="margin:8px 0 2px"><span class="muted">${list.length} spes${list.length === 1 ? "a" : "e"}${senzaS ? ` · ${senzaS} senza scontrino` : ""}</span><span class="amt">${eur(tot)}</span></div>`;
  // le liste che i foglietti mostrano: si preparano qui, coi conteggi dell'anno scelto
  const nTrip = conta(s => s.trasferta), nCat = conta(s => s.categoria), nTipo = conta(s => s.tipo);
  _filtri = {
    anno: { tit: "Anno", cur: fSp.anno, opz: years.map(y => ({ v: y, lab: y, n: all.filter(s => String(s.data).slice(0, 4) === y).length })), set: v => { fSp.anno = v; } },
    trip: { tit: "Trasferta", cur: fSp.trip, opz: [{ v: "", lab: "Tutte le trasferte", n: inAnno.length }].concat(trips.map(t => ({ v: t, lab: t, n: nTrip[t] }))), set: v => { fSp.trip = v; } },
    cat: { tit: "Categoria", cur: fSp.cat, opz: [{ v: "", lab: "Tutte le categorie", n: inAnno.length }].concat(cats.map(c => ({ v: c, lab: catBreve(c), n: nCat[c] }))), set: v => { fSp.cat = v; } },
    tipo: { tit: "Tipo", cur: fSp.tipo, opz: [{ v: "", lab: "Tutti i tipi", n: inAnno.length }].concat(tipi.map(k => ({ v: k, lab: TIPI[k], n: nTipo[k] }))), set: v => { fSp.tipo = v; } },
  };
  let lastM = ""; let open = false;
  list.forEach(s => { const m = String(s.data).slice(0, 7); if (m !== lastM) { if (open) h += `</div>`; h += `<div class="month row between"><span>${monthName(m + "-01")}</span><span>${eur(byM[m])}</span></div><div class="card list">`; open = true; lastM = m; } h += itemSpesa(s, true); });
  if (open) h += `</div>`;
  if (!list.length) h += `<div class="empty">Nessuna spesa${attivi ? `<br><span class="small">Prova ad azzerare i filtri</span>` : ""}</div>`;
  return h;
}
let _filtri = {};
function filtroSpese(k) { const f = _filtri[k]; if (!f) return; sceltaFoglietto(f.tit, f.opz, f.cur, v => { f.set(v); render(); }); }

// ---- SOLDI › Conto
// Il saldo per trasferta con "Salda" accanto, poi i movimenti. "Salda" apre il
// modulo del pagamento con importo e chi paga gia' scritti (quello che faceva
// kPay dal compenso) e passa il compenso di quella trasferta, se c'e': cosi'
// dopo il salvataggio la app CHIEDE ancora se segnarlo saldato (T9).
function soldiConto() {
  const mov = visibleSpese().filter(x => Math.abs(+x.saldo || 0) > 0.004).sort((a, b) => a.data < b.data ? 1 : -1);
  const byTrip = {}; mov.forEach(x => byTrip[x.trasferta] = Math.round(((byTrip[x.trasferta] || 0) + (+x.saldo)) * 100) / 100);
  const trips = Object.keys(byTrip).filter(k => Math.abs(byTrip[k]) > 0.004).sort((a, b) => Math.abs(byTrip[b]) - Math.abs(byTrip[a]));
  _contoTrip = trips;
  let h = `<button class="btn primary block" style="margin:0 0 12px" onclick="formSpesa(null,null,'regolamento')">＋ Registra pagamento</button>
    <h2 style="margin-top:0">Per trasferta</h2><div class="card list">${trips.length ? trips.map((k, i) => `<div class="item"><div class="grow"><div class="ellipsis"><b>${esc(k)}</b></div><div class="muted">${esc(frase(saldoIo(byTrip[k])))}</div></div><button class="btn sm" onclick="saldaTrip(${i})">Salda</button></div>`).join("") : `<div class="muted">Siete pari su ogni trasferta</div>`}</div>
    <h2>Movimenti</h2><div class="card list">${mov.slice(0, 200).map(x => `<div class="item tap" onclick="formSpesa('${x.id}')"><div class="grow"><div class="ellipsis"><b>${esc(x.descrizione)}</b> <span class="pill ${x.tipo === "caddie" ? "warn" : x.tipo === "regolamento" ? "blue" : ""}">${TIPI[x.tipo]}</span></div><div class="muted">${fmtDY(x.data)} · ${esc(x.trasferta)} · ha pagato ${esc(x.pagato_da)}${x.tipo === "condivisa" ? " · tot " + eur(x.importo_eur) + " ÷" + x.n_persone : ""}</div></div><div class="amt" style="color:${x.saldo > 0 ? "var(--good)" : "var(--bad)"}">${x.saldo > 0 ? "+" : ""}${eur(x.saldo)}</div></div>`).join("") || `<div class="muted">Nessun movimento</div>`}</div>
    <div class="muted" style="margin-top:6px">+ = a credito di Giulio · − = a credito di Alessandra</div>`;
  return h;
}
// Il pagamento che chiude il conto di UNA trasferta: importo = quel saldo, paga chi
// deve. Il saldo qui comprende anche compenso e pagamenti gia' fatti (e' il conto
// vero), quindi e' lo stesso numero di "da bonificare" quando c'e' un compenso.
// Il nome passa per indice (_contoTrip), non dentro l'onclick: un apostrofo lo romperebbe.
let _contoTrip = [];
function saldaTrip(i) {
  const nome = _contoTrip[i]; if (!nome) return;
  const v = Math.round(visibleSpese().filter(x => x.trasferta === nome).reduce((a, x) => a + (Number(x.saldo) || 0), 0) * 100) / 100;
  if (Math.abs(v) < 0.005) return toast("Su questa trasferta siete pari");
  const c = (D.compensi || []).find(k => k.trasferta === nome);
  formSpesa(null, nome, "regolamento", { importo: Math.abs(v), valuta: "EUR", cambio: 1, pagato_da: v < 0 ? "Giulio" : "Alessandra", descrizione: "Saldo " + nome }, c ? c.id : undefined);
}

// ---- SOLDI › Anno (la dashboard)
// Entrate (guadagni) dell'anno per chi sta guardando:
//  - Giulio      -> compenso caddie = fisso + % montepremi + extra                   (campo "totale")
//  - Alessandra  -> montepremi vinto sul LET                                        (campo "montepremi")
// La data usata e' la fine della trasferta collegata (in mancanza, l'inizio).
function entrateTutte() {
  const byId = {}; (D.trasferte || []).forEach(t => byId[t.id] = t);
  return (D.compensi || []).map(c => {
    const t = byId[c.trasferta_id];
    const nome = c.trasferta || (t ? t.nome : "—");
    const data = String((t && (t.fine || t.inizio)) || c.pagato_il || c.creato || "").slice(0, 10);
    const val = Math.round((cfg.who === "Giulio" ? (+c.totale || 0) : (+c.montepremi || 0)) * 100) / 100;
    return { nome, data, val };
  }).filter(c => c.val > 0);
}
const entrateAnno = y => entrateTutte().filter(c => c.data.startsWith(y));

// Solo le settimane di gara: tipo "torneo" o "qualifica". Le trasferte senza riga nel
// tab Trasferte non hanno tipo e restano fuori (creare la scheda dalla pagina Trasferte).
function tipiTrasferta() { const m = {}; (D.trasferte || []).forEach(t => m[t.nome] = String(t.tipo || "").toLowerCase()); return m; }
const isGara = (nome, tipi) => tipi[nome] === "torneo" || tipi[nome] === "qualifica";

// Spese Team = quanto è costata davvero la stagione in giro: ogni spesa delle settimane di
// gara contata UNA volta per il suo importo pieno, chiunque abbia pagato e su qualunque libro
// finisca. Fuori restano le settimane casa/altro, i compensi caddie e i pagamenti (giro interno).
// Il totale esatto arriva dal server (D.team, calcolato sui due ledger insieme); senza di quello
// l'app può sommare solo ciò che vede e mancano le spese personali dell'altra persona.
function speseTeam(y, tipi) {
  const srv = (D.team || {})[y];
  if (srv != null && srv !== "") return { val: Math.round((+srv || 0) * 100) / 100, esatto: true };
  const ss = visibleSpese().filter(s => String(s.data).startsWith(y) && s.tipo !== "regolamento" && s.tipo !== "caddie" && isGara(s.trasferta, tipi));
  return { val: Math.round(ss.reduce((a, s) => a + (+s.importo_eur || 0), 0) * 100) / 100, esatto: false };
}

// La dashboard di prima, senza la testata (anno e "‹") e senza le quattro carte
// KPI: spese tue, entrate e netto stanno gia' in testa alla pagina, resta Spese Team,
// che e' l'unico numero che arriva dal server (teamAnni_) e non si puo' rifare qui.
// La spiegazione di Spese Team e' dietro il "?".
function soldiAnnoSeg() {
  const all = visibleSpese();
  const y = soldiAnno; const ss = all.filter(s => String(s.data).startsWith(y) && s.tipo !== "regolamento");
  const tipi = tipiTrasferta();
  // USCITE: la quota a carico di chi guarda (stessa regola della pagina trasferta)
  const byTrip = {}, byCat = {}, byMonth = {};
  ss.filter(s => s.tipo !== "caddie").forEach(s => { const v = mioImporto(s);
    byTrip[s.trasferta] = (byTrip[s.trasferta] || 0) + v;
    byCat[s.categoria] = (byCat[s.categoria] || 0) + v;
    const m = String(s.data).slice(0, 7); byMonth[m] = (byMonth[m] || 0) + v; });
  // ENTRATE
  const inTrip = {}, inMonth = {}; const ent = entrateAnno(y);
  ent.forEach(c => { inTrip[c.nome] = (inTrip[c.nome] || 0) + c.val; const m = c.data.slice(0, 7); inMonth[m] = (inMonth[m] || 0) + c.val; });
  const team = speseTeam(y, tipi);
  const labIn = cfg.who === "Giulio" ? "Compensi caddie" : "Vincite";
  const months = [...new Set(Object.keys(byMonth).concat(Object.keys(inMonth)))].sort();
  const mmax = Math.max(...months.map(m => Math.max(byMonth[m] || 0, inMonth[m] || 0)), 1);
  const mese = m => new Date(m + "-01T00:00:00").toLocaleDateString("it-IT", { month: "short" });
  const legenda = `<div class="leg"><span><i class="sw-in"></i>Entrate · ${esc(labIn)}</span><span><i class="sw-out"></i>Spese a mio carico</span></div>`;
  // solo tornei e qualifiche, dal profitto più alto alla perdita più grande
  const gare = {}, gareIn = {};
  Object.keys(byTrip).forEach(k => { if (isGara(k, tipi)) gare[k] = byTrip[k]; });
  Object.keys(inTrip).forEach(k => { if (isGara(k, tipi)) gareIn[k] = inTrip[k]; });
  return `<div class="card"><div class="row between"><div><div class="kpi-v">${eur(team.val)}</div><div class="muted">Spese Team ${esc(y)} · tornei e qualifiche, importo pieno${team.esatto ? "" : " · <b>solo le spese visibili da questa app</b>"}</div></div></div></div>
    ${ent.length ? "" : `<div class="empty">Nessuna entrata registrata per il ${esc(y)}. Le entrate si compilano in <b>Compensi</b>: apri la settimana di torneo e inserisci montepremi e risultato.</div>`}
    <h2>Entrate e spese per mese</h2>
    <div class="card">${months.length ? `<div class="mchart">${months.map(m => `<div class="mcol">
        <div class="mbars"><i class="in" style="height:${(inMonth[m] || 0) / mmax * 100}%" title="Entrate ${m}: ${eur(inMonth[m] || 0)}"></i><i class="out" style="height:${(byMonth[m] || 0) / mmax * 100}%" title="Spese ${m}: ${eur(byMonth[m] || 0)}"></i></div>
        <div class="mlab">${mese(m)}<br><b class="in">${kfmt(inMonth[m] || 0)}</b><br><b class="out">${kfmt(byMonth[m] || 0)}</b></div></div>`).join("")}</div>${legenda}` : `<div class="muted">Nessun dato</div>`}</div>
    <h2>Per trasferta <span class="muted">(tornei e qualifiche)</span></h2><div class="card">${bars2(gare, gareIn)}${legenda}</div>
    <h2>Per categoria <span class="muted">(solo spese)</span></h2><div class="card">${bars(byCat)}</div>`;
}

// Barre orizzontali doppie: verde = entrate, rosso = spese.
// Ordine: dal profitto più alto alla perdita più grande (netto decrescente).
function bars2(out, inc) {
  const keys = [...new Set(Object.keys(out).concat(Object.keys(inc)))];
  if (!keys.length) return `<div class="muted">Nessun dato</div>`;
  const net = k => (inc[k] || 0) - (out[k] || 0);
  keys.sort((a, b) => net(b) - net(a));
  const max = Math.max(...keys.map(k => Math.max(out[k] || 0, inc[k] || 0)), 1);
  return keys.map(k => { const o = out[k] || 0, i = inc[k] || 0, n = i - o;
    return `<div class="barrow"><div class="row between"><span class="ellipsis">${esc(k)}</span><span class="amt"><span class="${n < 0 ? "out" : "in"}">${n >= 0 ? "+" : "−"}${eur(Math.abs(n))}</span></span></div>
      <div class="bar2"><span class="trk"><i class="in" style="width:${i / max * 100}%"></i></span><em class="in">${i ? eur(i) : "—"}</em></div>
      <div class="bar2"><span class="trk"><i class="out" style="width:${o / max * 100}%"></i></span><em class="out">${o ? eur(o) : "—"}</em></div></div>`;
  }).join("");
}

// ---- DOCUMENTI
function vDocumenti() {
  const docs = (D.documenti || []).slice().sort((a, b) => (a.persona + a.nome).localeCompare(b.persona + b.nome));
  const soon = d => d.scadenza && (new Date(d.scadenza) - new Date()) / 864e5 < 180;
  return `<div class="row"><button class="btn sm" onclick="indietro('oggi')">‹</button><h1 class="grow" style="margin:0">Documenti</h1><button class="btn sm primary" onclick="formDoc()">＋</button></div>
    <div class="card list" style="margin-top:12px">${docs.length ? docs.map(d => `<div class="item"><div class="thumb">🪪</div><div class="grow" onclick="formDoc('${d.id}')"><b>${esc(d.nome)}</b> <span class="pill grey">${esc(d.persona)}</span><div class="muted">${d.scadenza ? "Scade " + fmtDY(d.scadenza) : ""}${soon(d) ? ' <span class="pill bad">in scadenza</span>' : ""}${d.note ? " · " + esc(d.note) : ""}</div></div>${d.url ? `<a class="btn sm" href="${esc(d.url)}" target="_blank" rel="noopener">Apri</a>` : ""}</div>`).join("") : `<div class="muted">Nessun documento. Carica passaporti, licenza caddie, visti, assicurazione…</div>`}</div>`;
}

// ---- IMPOSTAZIONI
// §3.7: le categorie e le due checklist erano tre riquadri di testo in cui si
// andava a capo a mano — un a capo di troppo creava una voce vuota, e l'ordine
// (che è quello in cui le voci compaiono nella checklist di una trasferta nuova)
// si cambiava solo tagliando e incollando. Adesso sono tre liste con ▲▼ e ✕, e
// le valute sono pasticche. Si lavora su una BOZZA in memoria: il foglio si
// scrive solo con "Salva impostazioni", e il payload di settings.save è quello
// di sempre (categorie, checklist_template_torneo, checklist_template_qualifica,
// valute).
let setBozza = null;
const SET_LISTE = {
  categorie: { tit: "Categorie", sotto: "Nel modulo spesa le sei pasticche sono le più usate, non le prime sei. Il numero a destra dice quante spese hanno quella categoria.", cosa: "Nuova categoria", esempio: "es. Viaggio - Taxi" },
  chkT:      { tit: "Checklist per un torneo", sotto: "Le voci con cui nasce una trasferta di tipo torneo, in quest'ordine.", cosa: "Nuova voce", esempio: "es. Volo andata" },
  chkQ:      { tit: "Checklist per una qualifica", sotto: "Come sopra, per le qualifiche. Casa e Altro nascono senza checklist.", cosa: "Nuova voce", esempio: "es. Iscrizione qualifica" },
};
function bozzaImpostazioni() {
  const s = D.settings || {};
  return { categorie: (s.categorie || []).slice(), chkT: templateChecklist("torneo").slice(), chkQ: templateChecklist("qualifica").slice(), valute: (s.valute || []).slice() };
}
// Ridisegna senza riportare in cima lo scorrimento: spostare l'ultima voce di
// quindici con ▲▼, e ritrovarsi ogni volta in testa alla pagina, è inutilizzabile.
function renderFermo() { const m = document.querySelector("main"), y = m ? m.scrollTop : 0; render(); if (m) m.scrollTop = y; }
function setLista(k) {
  const a = setBozza[k], d = SET_LISTE[k], uso = {};
  if (k === "categorie") (D.spese || []).forEach(x => { const c = String(x.categoria || ""); if (c) uso[c] = (uso[c] || 0) + 1; });
  return `<h2>${esc(d.tit)}</h2><div class="muted" style="margin:-4px 0 8px">${esc(d.sotto)}</div>
    <div class="card list setlist">${a.length ? a.map((x, i) => `<div class="item">
        <div class="grow tap" onclick="setRinomina('${k}',${i})"><b>${esc(x)}</b></div>
        ${k === "categorie" ? `<span class="muted">${uso[x] || 0}</span>` : ""}
        <div class="ord"><button class="obtn" ${i === 0 ? "disabled" : ""} onclick="setSposta('${k}',${i},-1)">▲</button><button class="obtn" ${i === a.length - 1 ? "disabled" : ""} onclick="setSposta('${k}',${i},1)">▼</button><button class="obtn" onclick="setTogli('${k}',${i})">✕</button></div>
      </div>`).join("") : `<div class="muted">Nessuna voce</div>`}</div>
    <button class="btn block" onclick="setAggiungi('${k}')">＋ ${esc(d.cosa)}</button>`;
}
function setSposta(k, i, d) { const a = setBozza[k], j = i + d; if (j < 0 || j >= a.length) return; const t = a[i]; a[i] = a[j]; a[j] = t; renderFermo(); }
function setTogli(k, i) { setBozza[k].splice(i, 1); renderFermo(); }
async function setAggiungi(k) {
  const n = await chiediTesto(SET_LISTE[k].cosa, "", SET_LISTE[k].esempio);
  if (!n) return;
  if (setBozza[k].indexOf(n) < 0) setBozza[k].push(n); else toast("C'è già");
  renderFermo();
}
async function setRinomina(k, i) {
  const vecchia = setBozza[k][i], n = await chiediTesto("Modifica", vecchia, SET_LISTE[k].esempio);
  if (!n || n === vecchia) return;
  setBozza[k][i] = n; renderFermo();
}
async function setAggiungiVal() {
  const n = await chiediTesto("Nuova valuta", "", "es. CHF");
  const v = String(n || "").trim().toUpperCase();
  if (!v) return;
  if (setBozza.valute.indexOf(v) < 0) setBozza.valute.push(v); else toast("C'è già");
  renderFermo();
}
function setTogliVal(i) { setBozza.valute.splice(i, 1); renderFermo(); }
function vImpostazioni() {
  const s = D.settings || {};
  if (!setBozza) setBozza = bozzaImpostazioni();
  return `<div class="row"><button class="btn sm" onclick="indietro('oggi')">‹</button><h1 class="grow" style="margin:0">Impostazioni</h1><button class="ask" onclick="impostazioniAiuto()" title="Come funziona">?</button></div>
    <h2>Report per il commercialista</h2><div class="card"><div class="row" style="gap:8px"><select id="repAnno">${[...new Set((D.spese || []).map(x => String(x.data).slice(0, 4)))].sort().reverse().map(y => `<option>${y}</option>`).join("")}</select><select id="repChi"><option>Alessandra</option><option>Giulio</option></select><button class="btn primary grow" onclick="makeReport()">Genera foglio</button></div><div class="muted" style="margin-top:6px">Crea un Google Sheet con dettaglio + riepilogo per categoria e trasferta.</div></div>
    ${setLista("categorie")}
    ${setLista("chkT")}
    ${setLista("chkQ")}
    <h2>Valute</h2><div class="muted" style="margin:-4px 0 8px">Quelle che si possono scegliere nel modulo spesa, dietro "altre…". Tocca una pasticca per toglierla.</div>
    <div class="card"><div class="chips">${setBozza.valute.map((v, i) => `<button type="button" onclick="setTogliVal(${i})">${esc(v)} ✕</button>`).join("")}<button type="button" onclick="setAggiungiVal()">＋ Aggiungi</button></div></div>
    <button class="btn primary block" onclick="saveSettings()">Salva impostazioni</button>
    <div class="muted" style="margin-top:6px">Finché non salvi, le modifiche restano su questo telefono.</div>
    <h2>Collegamento</h2><div class="card">
      <div class="row between"><div class="grow"><b>Collegato come ${esc(cfg.who || "—")}</b><div class="muted">Il token non si vede più in chiaro: per ricollegare l'app si riapre il link personale.</div></div><button class="btn" onclick="scollegaApp()">Scollega</button></div>
      <div class="muted" style="margin-top:8px">Calendario condiviso: ${s.calendar_id ? "attivo" : "non configurato"} · Modifiche in attesa: ${queue.length}</div></div>`;
}
function impostazioniAiuto() {
  aiutoFoglietto("Come funzionano le impostazioni", [
    `Le tre liste si modificano qui e partono solo con <b>Salva impostazioni</b>: tocca una voce per riscriverla, ▲▼ per spostarla, ✕ per toglierla.`,
    `Togliere una <b>categoria</b> non tocca le spese già registrate: restano con la loro, e il numero a destra dice quante sono.`,
    `Le due <b>checklist</b> valgono per le trasferte nuove, non per quelle già create. Casa e Altro nascono senza.`,
    `<b>Scollega</b> toglie il collegamento da questo telefono soltanto: sul foglio non cambia niente, e per rientrare serve il link personale che hai ricevuto.`,
  ]);
}
// Toglie il collegamento da QUESTO telefono: i dati restano sul foglio, si
// rientra riaprendo il link personale (che porta con se' indirizzo e token).
function scollegaApp() {
  openModal(`<h2 style="margin-top:0">Scollegare l'app?</h2>
    <p class="small">Su questo telefono l'app torna alla schermata iniziale: per rientrare serve il link personale che hai ricevuto. Sul foglio non cambia niente${queue.length ? `, ma <b>${queue.length} modific${queue.length === 1 ? "a" : "he"} non ancora inviat${queue.length === 1 ? "a" : "e"}</b> ${queue.length === 1 ? "andrebbe persa" : "andrebbero perse"}` : ""}.</p>
    <div class="row" style="gap:8px"><button class="btn danger grow" onclick="scollegaOra()">Scollega</button><button class="btn" onclick="closeModal()">Annulla</button></div>`);
}
function scollegaOra() { closeModal(); cfg.api = ""; cfg.token = ""; LS.set("cfg", cfg); render(); }
async function saveSettings() {
  const b = setBozza || bozzaImpostazioni();
  // Stesso payload di sempre. Le due liste hanno la loro chiave (Q4);
  // checklist_template resta sul foglio come ripiego del torneo.
  const p = { categorie: b.categorie.slice(), checklist_template_torneo: b.chkT.slice(), checklist_template_qualifica: b.chkQ.slice(), valute: b.valute.slice() };
  await write("settings.save", p, d => Object.assign(d.settings, p));
  setBozza = null; toast("Impostazioni salvate");
}
async function makeReport() {
  toast("Genero il report…", 6000);
  try { const r = await api("report", { anno: $("#repAnno").value, persona: $("#repChi").value }); openModal(`<h2>Report pronto</h2><p>${r.righe} righe · totale ${eur(r.totale)}</p><a class="btn primary block" href="${esc(r.url)}" target="_blank" rel="noopener">Apri il foglio</a>`); }
  catch (e) { toast("Errore: " + e.message, 4000); }
}

// ---- CONTROLLO DATI (T7)
// Chiede al server l'azione `audit` (sola lettura) e mostra le segnalazioni per gravita'.
// Una cella avvelenata dal formato la app NON puo' ripararla (route_ scrive valori, mai
// formati): il rimedio e' scritto nella segnalazione, e va fatto nel foglio.
let auditRes = LS.get("audit", null);
const GRAV = { alta: ["bad", "Da sistemare"], media: ["warn", "Da guardare"], bassa: ["grey", "Note"] };
function vAudit() {
  const r = auditRes;
  let h = `<div class="row"><button class="btn sm" onclick="indietro('oggi')">‹</button><h1 class="grow" style="margin:0">Controllo dati</h1><button class="btn sm primary" onclick="runAudit()">${r ? "Ripeti" : "Esegui"}</button></div>
    <div class="muted small" style="margin:8px 0 12px">Legge tutto il Team DB e segnala celle rovinate dal formato, conti che non tornano, doppioni e righe fuori regola. Non modifica niente.</div>`;
  if (!r) return h + `<div class="empty">Nessun controllo ancora eseguito</div>`;
  const t = r.totali || {}, tr = r.trovati || [], so = r.soppressi || [], righe = r.righe || {};
  const visibile = id => (D.spese || []).some(s => s.id === id);
  h += `<div class="card"><div class="muted">Controllo del ${fmtDY(r.quando)} alle ${String(r.quando).slice(11, 16)} · ${righe.Spese || 0} spese · ${righe.Compensi || 0} compensi</div>
    <div class="row between" style="margin-top:8px"><span class="small">Saldo</span><b class="small">${saldoLabel(t.saldo)}</b></div>
    <div class="row between"><span class="small">Libri Alessandra · Giulio</span><b class="small">${eur(t.libri_ale)} · ${eur(t.libri_giulio)}</b></div>
    <div class="row between"><span class="small">Caddie in Spese = Compensi</span><b class="small" style="color:${r.invariante_ok ? "var(--good)" : "var(--bad)"}">${eur(t.caddie_spese)} ${r.invariante_ok ? "✓" : "≠ " + eur(t.compensi_totale)}</b></div></div>`;
  if (!tr.length) h += `<div class="card" style="border-color:var(--good)"><b>✓ Nessuna segnalazione</b><div class="muted">Tutto torna con le regole.</div></div>`;
  ["alta", "media", "bassa"].forEach(g => {
    const L = tr.filter(x => x.gravita === g); if (!L.length) return;
    h += `<h2>${GRAV[g][1]} <span class="muted">(${L.length})</span></h2><div class="card list">` + L.map(x => {
      const id = (x.spese || []).find(visibile);
      return `<div class="item${id ? " tap" : ""}" ${id ? `onclick="formSpesa('${id}')"` : ""}><div class="grow"><div><span class="pill ${GRAV[g][0]}">${esc(x.dove)}</span></div><div class="dett" style="margin-top:3px">${esc(x.testo)}</div>${x.rimedio ? `<div class="muted" style="margin-top:3px">→ ${esc(x.rimedio)}</div>` : ""}</div></div>`;
    }).join("") + `</div>`;
  });
  if (so.length) h += `<h2>Ignorati apposta <span class="muted">(${so.length})</span></h2><div class="card">${so.map(x => `<div class="dett" style="padding:4px 0;border-bottom:1px solid var(--line)"><span class="muted">${esc(x.dove)}</span> · ${esc(x.testo)}</div>`).join("")}</div>`;
  return h;
}
async function runAudit() {
  toast("Controllo in corso… (qualche secondo)", 8000);
  try {
    auditRes = await api("audit"); LS.set("audit", auditRes); view = "audit"; render();
    const c = auditRes.conteggio || {};
    toast(auditRes.trovati.length ? `${auditRes.trovati.length} segnalazioni: ${c.alta || 0} da sistemare, ${c.media || 0} da guardare, ${c.bassa || 0} note` : "Tutto in ordine", 5000);
  } catch (e) { toast("Errore: " + e.message, 5000); }
}

// ---------------------------------------------------------------- PRENOTAZIONI DA EMAIL
const TIPO_PREN = { volo: "✈️ Volo", alloggio: "🏨 Alloggio", auto: "🚗 Auto", treno: "🚆 Treno", altro: "📧 Altro" };
// Lo script mette i dettagli letti dalla mail (orari, tratte, check-in/out,
// ritiro/riconsegna) dentro p.note come JSON. Le righe vecchie non ce l'hanno.
function dettPren(p) { try { const d = JSON.parse(p.note || "null"); return d && d.v >= 2 ? d : null; } catch (e) { return null; } }
// Link alla MAIL: si costruisce dal msg_id, che e' gia' su ogni riga di
// Prenotazioni, quindi funziona anche per le prenotazioni collegate mesi fa.
// Il modello arriva dal server (Impostazioni -> gmail_link) cosi' si puo'
// cambiare forma senza ripubblicare la app.
// Forma buona: la RICERCA per Message-Id, con in coda l'id del messaggio.
// Il vecchio #all/<id esadecimale> lo risolve solo Gmail sul computer: su iPhone
// cade sulla posta in arrivo. Cosi' invece, se il telefono non risolve la coda,
// resta la ricerca, che mostra comunque QUEL messaggio e basta. Anche
// ?authuser=<mail> e' da evitare: fa un redirect e il pezzo dopo il # si perde.
// L'account e' il numero in /u/N/ (impostazione gmail_u): se e' quello sbagliato
// la ricerca non trova nulla, non apre il messaggio di un altro.
const GMAIL_LINK_FALLBACK = "https://mail.google.com/mail/u/{u}/#search/rfc822msgid:{mid}/{id}";
const GMAIL_LINK_FALLBACK_ID = "https://mail.google.com/mail/u/{u}/#all/{id}";
function linkMail(p) {
  const msgId = p && typeof p === "object" ? (p.msg_id || "") : String(p || "");
  const mid = p && typeof p === "object" ? midPren(p) : "";
  if (!msgId && !mid) return "";
  const s = D.settings || {};
  const u = (s.gmail_u === undefined || s.gmail_u === null || s.gmail_u === "") ? "0" : String(s.gmail_u);
  const tpl = mid ? (s.gmail_link || GMAIL_LINK_FALLBACK) : (s.gmail_link_id || GMAIL_LINK_FALLBACK_ID);
  return tpl.replace("{u}", encodeURIComponent(u))
            .replace("{mid}", encodeURIComponent(mid))
            .replace("{id}", encodeURIComponent(msgId));
}
// PDF e Message-Id stanno nel JSON della colonna note: nessuna colonna nuova.
function notePren(p) { try { const d = JSON.parse((p && p.note) || "null"); return (d && typeof d === "object") ? d : null; } catch (e) { return null; } }
function pdfPren(p) { const d = notePren(p); return (d && d.pdf) || ""; }
function midPren(p) { const d = notePren(p); return String((d && d.mid) || "").replace(/^</, "").replace(/>$/, ""); }
// ---- T8: dalla prenotazione alla spesa, senza cambiare pagina ----
// La riga di Prenotazioni e quella di Proposte nate dalla STESSA mail si puntano
// a vicenda: prop_id di qua, pren_id di la', scritti dal backend. Qui serve solo
// per ritrovare la proposta gia' pronta e riaprirla.
// Il modulo che si apre e' lo STESSO di "Conferma" nella pagina Proposte: tipo
// (personale/condivisa/ciascuno), chi ha pagato, importo e dettagli si scelgono
// li' come sempre, e niente entra in Spese finche' non premi "Crea la spesa".
// Quella regola non si tocca: questo bottone rende la proposta RAGGIUNGIBILE,
// non automatica.
function propDiPren(p) {
  if (!p) return null;
  const props = visibleProp();
  const id = (notePren(p) || {}).prop_id;
  // prima l'aggancio esplicito; poi il messaggio, perche' le prenotazioni
  // scritte prima di T8 non hanno prop_id ma hanno lo stesso msg_id
  return (id && props.find(x => x.id === id)) ||
         (p.msg_id && props.find(x => x.msg_id === p.msg_id)) || null;
}
// Apre la proposta passando la trasferta della prenotazione: se la proposta non
// ne aveva una (o ne aveva un'altra), quella giusta e' quella appena collegata.
function spesaDaPren(prenId) {
  const p = visiblePren().find(x => x.id === prenId);
  const q = propDiPren(p);
  if (!q) return toast("Da questa mail non e' nata nessuna proposta di spesa", 4000);
  const t = (D.trasferte || []).find(x => x.id === (p || {}).trasferta_id);
  formProposta(q.id, { trasferta: (t && t.nome) || q.trasferta || "" });
}
// Quale prenotazione e' agganciata a una voce di checklist.
function prenDiVoce(voceId) {
  if (!voceId) return null;
  return visiblePren().find(p => p.voce_id === voceId && p.stato === "collegata") || null;
}
// Bottoni della voce di checklist. Ordine voluto: prima la MAIL (al gate il link
// del fornitore chiede login e rete), poi il PDF su Drive, che si apre anche in
// modalita' aereo. Il link del fornitore sta nella pagina Prenotazioni.
// Una voce senza prenotazione tiene il suo "Apri" di sempre.
function bottoniVoce(c) {
  const p = prenDiVoce(c.id), b = [];
  if (p && p.msg_id) b.push('<a class="btn sm" href="' + esc(linkMail(p)) + '" target="_blank" rel="noopener" title="Apri la mail">✉️</a>');
  const pdf = p ? pdfPren(p) : "";
  if (pdf) b.push('<a class="btn sm" href="' + esc(pdf) + '" target="_blank" rel="noopener" title="Apri il PDF (funziona offline)">📄</a>');
  if (!b.length && c.link) b.push('<a class="btn sm" href="' + esc(c.link) + '" target="_blank" rel="noopener">Apri</a>');
  return b.length ? '<div style="display:flex;gap:6px;flex:0 0 auto">' + b.join("") + '</div>' : "";
}
function prenQuando(p) {
  const d = dettPren(p);
  if (d && d.testo) return d.testo;
  if (!p.inizio) return "date?";
  return fmtD(p.inizio) + (p.fine && p.fine !== p.inizio ? " → " + fmtD(p.fine) : "");
}
// Una riga per segmento (volo/treno), altrimenti la sintesi.
function prenRighe(p) {
  const d = dettPren(p); if (!d) return [];
  if (d.seg && d.seg.length) return d.seg.map(s => [
    s.vol || "", s.data ? fmtD(s.data) : "", s.part || "",
    s.da && s.a ? s.da + " → " + s.a : (s.da || s.a || ""),
    s.arr ? "arr " + s.arr : ""
  ].filter(Boolean).join(" · "));
  return d.testo ? [d.testo] : [];
}
// (bookingsSection e itemPren, le due liste di prenotazioni in fondo alla pagina
// della trasferta, non ci sono piu': T10 giro 4 le ha sostituite col segmento
// Posta, che usa le carte di vPosta.)
// La prenotazione resta in memoria come "ignorata" così puoi ripensarci subito;
// il server non la rimanda più al prossimo caricamento.
// write() e non api(): senza rete la modifica si vede subito e parte dalla coda
// appena il telefono torna online (prima dava errore e basta).
async function ignoraPren(id) {
  try {
    await write("pren.stato", { id, stato: "ignorata" }, d => { const x = (d.prenotazioni || []).find(y => y.id === id); if (x) x.stato = "ignorata"; });
    toast("Ignorata. La ritrovi nel segmento \"Ignorate\".", 4000);
  } catch (e) {}
}
async function ripristinaPren(id) {
  try { await write("pren.stato", { id, stato: "nuova" }, d => { const x = (d.prenotazioni || []).find(y => y.id === id); if (x) x.stato = "nuova"; }); }
  catch (e) {}
}
// Annulla un "Collega" sbagliato: la prenotazione torna fra quelle da collegare,
// mantenendo la trasferta. La voce di checklist non viene toccata.
async function scollegaPren(id) {
  const p = visiblePren().find(x => x.id === id); if (!p) return;
  await write("pren.stato", { id, stato: "nuova", voce_id: "" }, d => {
    const x = (d.prenotazioni || []).find(y => y.id === id); if (x) { x.stato = "nuova"; x.voce_id = ""; }
  });
  toast("Rimessa fra quelle da collegare. Ricollegandola, link, codice e dettagli vengono riscritti nella voce.", 5000);
}
function formPren(id) {
  const p = visiblePren().find(x => x.id === id); if (!p) return;
  const trips = (D.trasferte || []).slice().sort((a, b) => a.inizio < b.inizio ? 1 : -1);
  const sugg = SUGG_PREN[p.tipo] || [];
  // la trasferta proposta: quella scritta dal lettore, se no quella indovinata dalle date
  const tid0 = p.trasferta_id || (trasfertaDaData(p.inizio) || trips[0] || {}).id;
  const voci = tid => tripChecks(tid);
  // stessa preferenza del bottone da un tocco in Posta: una regola sola, un posto solo.
  // T11: una voce che ha gia' una prenotazione lo dice nel menu, e se nessuna voce
  // libera combacia la preselezione cade su "Nuova voce" (prima cadeva, in silenzio,
  // sulla prima voce della lista, qualunque fosse).
  const voceOptions = tid => { const cs = voci(tid); const pref = vocePreferita(p, tid); return cs.map(c => `<option value="${c.id}" ${pref && pref.id === c.id ? "selected" : ""}>${esc(c.voce)} (${STATI[c.stato]?.lab || c.stato}${voceLibera(c, p) ? "" : " · ha già una prenotazione"})</option>`).join("") + `<option value="" ${pref ? "" : "selected"}>＋ Nuova voce: ${esc(sugg[0] || p.oggetto.slice(0, 30))}</option>`; };
  openModal(`<h2 style="margin-top:0">Collega prenotazione</h2>
    <div class="card small"><b>${esc(p.oggetto)}</b><div class="muted">${esc(p.mittente)}</div><div>${TIPO_PREN[p.tipo] || ""} ${p.inizio ? fmtDY(p.inizio) + (p.fine && p.fine !== p.inizio ? " → " + fmtDY(p.fine) : "") : ""}${p.luogo ? " · " + esc(p.luogo) : ""}${p.codice ? " · codice <b>" + esc(p.codice) + "</b>" : ""}${p.importo ? " · " + num(p.importo) + " " + esc(p.valuta) : ""}</div>
    ${prenRighe(p).map(r => `<div class="dett">${esc(r)}</div>`).join("")}
    <div class="muted" style="margin-top:6px">Questi dettagli finiscono nella voce della checklist.</div>${p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener">apri la prenotazione</a>` : ""}</div>
    <div class="field"><label>Trasferta</label><select id="pTrip">${trips.map(t => `<option value="${t.id}" ${t.id === tid0 ? "selected" : ""}>${esc(t.nome)} (${fmtD(t.inizio)}–${fmtD(t.fine)})</option>`).join("")}</select></div>
    <div class="field"><label>Voce della checklist</label><select id="pVoce">${voceOptions(tid0)}</select></div>
    <div class="row" style="gap:8px"><button class="btn primary grow" id="pSave">Collega</button><button class="btn" onclick="closeModal()">Annulla</button></div>`);
  $("#pTrip").addEventListener("change", () => { $("#pVoce").innerHTML = voceOptions($("#pTrip").value); });
  $("#pSave").addEventListener("click", async () => {
    const trasferta_id = $("#pTrip").value, voce_id = $("#pVoce").value;
    closeModal(); toast("Collego…");
    toast("Collego e salvo il PDF in Drive…", 15000);
    try { const r = await api("pren.collega", { id: p.id, trasferta_id, voce_id, voce: sugg[0] || p.oggetto.slice(0, 30) }); const i = D.prenotazioni.findIndex(x => x.id === p.id); if (i >= 0) D.prenotazioni[i] = r.prenotazione; const j = D.checklist.findIndex(c => c.id === r.voce.id); if (j >= 0) D.checklist[j] = r.voce; else D.checklist.push(r.voce); LS.set("data", D); render(); const conSpesa = offriSpesaDopoCollega(p.id); toast((pdfPren(r.prenotazione) ? "Collegata: sulla voce trovi ✉️ mail e 📄 PDF" : "Collegata. Il PDF non è riuscito, ma la mail c'è") + (conSpesa ? " · c'è anche la spesa da registrare" : ""), 5000); }
    catch (e) { toast("Errore: " + e.message, 5000); }
  });
}
// Il "colpo solo" del ticket T8: appena la prenotazione è collegata, se dalla
// stessa mail era nata anche una proposta di spesa il modulo si apre da sé, con
// la trasferta già quella giusta. Non salva niente: è il solito modulo, e si
// chiude con Annulla se la spesa la vuoi registrare più tardi.
function offriSpesaDopoCollega(prenId) {
  const p = visiblePren().find(x => x.id === prenId);
  const q = propDiPren(p);
  if (!q || q.stato !== "nuova") return false;
  setTimeout(() => spesaDaPren(prenId), 900);   // dopo il toast, non sopra
  return true;
}

// ------------------------------------------------- PROPOSTE DI SPESA (email)
// Lo script legge dalla posta ricevute e fatture e prepara delle proposte.
// Niente finisce in Spese finché non premi "Crea la spesa" qui sotto: chi ha
// pagato e il tipo (personale / condivisa / ciascuno) la mail non può saperli.
function propNote(p) { try { return JSON.parse(p.note || "null") || {}; } catch (e) { return {}; } }
// Gli avvisi della carta non diventano mai proposte, ma confermano (o correggono)
// l'importo letto dalla ricevuta del fornitore.
function rigaCarta(p) {
  const c = (propNote(p) || {}).carta;
  if (!c) return "";
  if (c.ok) return `<div class="dett">✓ importo confermato dall'addebito sulla carta</div>`;
  if (c.corretto) return `<div class="dett"><b>⟳ importo preso dalla carta</b> (la mail diceva ${num(c.prima)})</div>`;
  return "";
}
// Quando una proposta viene riaperta, la mail viene riletta con il lettore di
// oggi: se l'importo che ne esce non e' quello scritto sulla riga, la riga NON
// viene corretta di nascosto (potrebbe essere il nuovo lettore a sbagliare). Ma
// il modulo di conferma arriva precompilato, e confermare senza guardare vuol
// dire mettere in Spese il numero vecchio: sulla fattura Apple erano 8,19 €
// (l'imponibile, letto per errore) contro i 9,99 € davvero addebitati.
// Quindi qui si vede, con un bottone che lo sostituisce in un tocco.
function rigaRilettura(p) {
  const n = propNote(p) || {};
  if (!n.rilettura) return "";
  const v = Number(n.rilettura) || 0;
  const val = n.rilettura_valuta || p.valuta || "EUR";
  return `<div class="dett"><b>⚠ rileggendo la mail l'importo risulta ${esc(num(v))} ${esc(val)}</b>, non ${esc(num(Number(p.importo) || 0))} ${esc(p.valuta || "EUR")} — controlla prima di confermare
    <button class="btn sm" style="margin-left:6px" onclick="usaRilettura(${v})">usa ${esc(num(v))}</button></div>`;
}
// `$` vuole un SELETTORE, non un id: "#fImp". E dopo aver scritto nel campo va
// lanciato l'evento input, se no l'anteprima in euro e i libri restano al
// numero di prima (ci sono appesi due listener).
function usaRilettura(v) {
  const e = $("#fImp"); if (!e) return;
  e.value = v;
  e.dispatchEvent(new Event("input", { bubbles: true }));
  e.dispatchEvent(new Event("change", { bubbles: true }));
  toast("Importo aggiornato: controlla anche la valuta", 3000);
}
function propImporto(p) {
  const v = Number(p.importo) || 0;
  return (p.valuta && p.valuta !== "EUR") ? num(v) + " " + esc(p.valuta) : eur(v);
}
async function ignoraProposta(id) {
  try {
    await write("proposta.stato", { id, stato: "ignorata" }, d => { const x = (d.proposte || []).find(y => y.id === id); if (x) { x.stato = "ignorata"; x.allegato = ""; x.file_url = ""; } });
    toast("Ignorata. La ritrovi nel segmento \"Ignorate\".", 4000);
  } catch (e) {}
}
async function ripristinaProposta(id) {
  try { await write("proposta.stato", { id, stato: "nuova" }, d => { const x = (d.proposte || []).find(y => y.id === id); if (x) x.stato = "nuova"; }); }
  catch (e) {}
}
// formProposta e' passato nella sezione FORM SPESA (T10 giro 2): conferma di una
// ricevuta e nuova spesa sono lo stesso modulo, costruito da moduloSpesa.

// ---------------------------------------------------------------- POSTA (T10, giro 1)
// Una pagina sola al posto di "Prenotazioni email" e "Proposte di spesa". La stessa
// mail produceva DUE righe su DUE pagine, legate da un bottoncino (T8): qui e' UNA
// carta per mail, con dentro i due esiti che il lettore ne ha tratto — la
// prenotazione da collegare a una voce di checklist e la ricevuta da registrare.
//
// La regola che NON si muove: `confermaProposta_` resta l'unica porta per cui una
// spesa nasce, e ci vuole sempre un tocco DELIBERATO su quella ricevuta. Il bottone
// da un tocco non salta il cancello: manda gli STESSI valori con cui si apre il
// modulo di conferma oggi (condivisa, in due, ha pagato chi sta guardando), scritti
// per esteso sul bottone, cosi' il tocco e' informato. Quando quei valori non si
// possono dare per buoni — la rilettura della mail dice un altro importo, oppure la
// spesa somiglia a una gia' registrata (T7) — il bottone da un tocco SPARISCE e
// resta solo "Modifica…", che apre il modulo di sempre.
//
// vPrenotazioni e vProposte, tenute un giro per sicurezza, sono state tolte nel giro 3.
let postaSeg = "da_fare";
const POSTA_SEG = { da_fare: "Da fare", fatte: "Fatte", ignorate: "Ignorate" };
function setPostaSeg(s) { postaSeg = s; render(); if (s === "ignorate") caricaIgnorate(); }
// T11: il boot non manda le righe ignorate (sono quasi tutte il registro del lettore),
// quindi "Ignorate" le chiede al server solo quando lo apri: `posta.ignorate` risponde con
// le sole righe ignorate da una persona. Si fondono in memoria, cosi' "Ripristina" e' il
// write() di sempre; una scansione le rimette via, riaprire il segmento le richiede.
let ignorateStato = "";   // "" | "carico" | "ok" | "offline" | "errore"
async function caricaIgnorate() {
  if (ignorateStato === "carico") return;
  if (!navigator.onLine) { ignorateStato = "offline"; render(); return; }
  ignorateStato = "carico"; render();
  try {
    const r = await api("posta.ignorate");
    const fondi = (lista, righe) => { (righe || []).forEach(x => { const i = lista.findIndex(y => y.id === x.id); if (i >= 0) lista[i] = x; else lista.push(x); }); return lista; };
    D.prenotazioni = fondi(D.prenotazioni || [], r.prenotazioni);
    D.proposte = fondi(D.proposte || [], r.proposte);
    LS.set("data", D); ignorateStato = "ok";
  } catch (e) { ignorateStato = "errore"; toast("Non riesco a leggere le ignorate: " + e.message, 4000); }
  render();
}
const SUGG_PREN = { volo: ["Volo andata", "Volo ritorno"], alloggio: ["Alloggio"], auto: ["Auto"], treno: ["Treno"], altro: [] };

// Trasferta indovinata dalla data: quella le cui date CONTENGONO quel giorno.
// Nessuna tolleranza, ed e' voluto: o il giorno e' dentro, o non si indovina niente
// e il bottone da un tocco non compare (7 ricevute su 40 al 18 set sono senza).
function trasfertaDaData(d) {
  const g = String(d || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g)) return null;
  return (D.trasferte || []).filter(t => t.inizio && t.fine && t.inizio <= g && g <= t.fine)
    .sort((a, b) => a.inizio < b.inizio ? 1 : -1)[0] || null;
}

// Una carta = una mail. `p` (prenotazione) e `q` (proposta) sono i due esiti: almeno uno c'e'.
function cartaPosta(p, q) {
  const aperta = (p && p.stato === "nuova") || (q && q.stato === "nuova");
  const ignP = !p || p.stato === "ignorata", ignQ = !q || q.stato === "ignorata";
  const tPren = p && p.trasferta_id ? (D.trasferte || []).find(x => x.id === p.trasferta_id) : null;
  let trip = tPren ? tPren.nome : ((q && q.trasferta) || ""), dedotta = false;
  if (!trip) { const g = trasfertaDaData((p && p.inizio) || (q && q.data) || ""); if (g) { trip = g.nome; dedotta = true; } }
  return {
    pren: p || null, prop: q || null, trip: trip, dedotta: dedotta,
    seg: aperta ? "da_fare" : (ignP && ignQ) ? "ignorate" : "fatte",
    quando: (p && p.data_email) || (q && q.data_email) || (q && q.data) || "",
    oggetto: (p && p.oggetto) || (q && q.oggetto) || "",
    mittente: (p && p.mittente) || (q && q.mittente) || "",
  };
}
// L'unione delle due tabelle per msg_id/prop_id: l'aggancio lo fa gia' propDiPren (T8).
function postaCarte() {
  const prese = {}, out = [];
  visiblePren().forEach(p => { const q = propDiPren(p); if (q) prese[q.id] = 1; out.push(cartaPosta(p, q)); });
  visibleProp().forEach(q => { if (!prese[q.id]) out.push(cartaPosta(null, q)); });
  return out.sort((a, b) => a.quando < b.quando ? 1 : -1);
}
const postaDaFare = () => postaCarte().filter(c => c.seg === "da_fare");
// I bottoni passano solo un id: il nome della trasferta dentro un onclick si
// spaccherebbe al primo apostrofo. La carta si ricostruisce, costa niente.
function cartaDiId(id) { return postaCarte().find(c => (c.pren && c.pren.id === id) || (c.prop && c.prop.id === id)) || null; }

// ---- la ricevuta in un tocco
// Gli stessi valori con cui formProposta si apre oggi, piu' la trasferta dedotta
// dalla data quando il lettore non l'ha scritta.
function bozzaProposta(q, trip) {
  return { id: q.id, importo: Number(q.importo) || 0, valuta: q.valuta || "EUR", data: q.data,
           trasferta: trip, categoria: q.categoria || "Altro",
           descrizione: String(q.vendor || q.descrizione || "").trim(),
           tipo: "condivisa", pagato_da: cfg.who, n_persone: 2, conto: cfg.who };
}
// Perche' il bottone da un tocco NON si puo' dare. "" = si puo'.
function perNoUnTocco(q, trip) {
  if (!q || q.stato !== "nuova") return "niente da registrare";
  if (!(Number(q.importo) > 0)) return "l'importo non si è capito";
  if (!trip) return "non si sa la trasferta";
  if ((propNote(q) || {}).rilettura) return "rileggendo la mail l'importo cambia";
  // T7: la ricevuta puo' essere una spesa gia' scritta a mano. Fuori dall'euro
  // l'importo in euro non si sa ancora (lo calcola il server): si confronta solo
  // sulla stessa valuta, ed e' il verso giusto in cui sbagliare.
  const b = bozzaProposta(q, trip);
  const dup = dupDi(Object.assign({}, b, { importo_eur: b.valuta === "EUR" ? b.importo : 0 }), D.spese || []);
  if (dup.length) return dup.some(d => d.gravita === "alta") ? "sembra già registrata" : "ce n'è una simile su questa trasferta";
  return "";
}
// Non passa da write(): proposta.conferma crea una riga nuova col suo id, non si
// puo' applicare in locale ne' mettere in coda. Stessa scelta di formProposta.
async function registraSubito(id) {
  const c = cartaDiId(id), q = c && c.prop; if (!q) return;
  if (perNoUnTocco(q, c.trip)) return apriProposta(id);
  toast("Creo la spesa…", 8000);
  try {
    const r = await api("proposta.conferma", bozzaProposta(q, c.trip));
    const i = (D.proposte || []).findIndex(x => x.id === q.id); if (i >= 0) D.proposte[i] = r.proposta;
    const j = (D.spese || []).findIndex(x => x.id === r.spesa.id); if (j >= 0) D.spese[j] = r.spesa; else (D.spese = D.spese || []).push(r.spesa);
    LS.set("data", D); render();
    toast("Registrata " + eur(r.spesa.importo_eur) + " · " + r.spesa.trasferta + (r.spesa.scontrino ? " · scontrino archiviato" : ""), 4500);
  } catch (e) { toast("Errore: " + e.message, 5000); }
}
function apriProposta(id) { const c = cartaDiId(id); formProposta(id, { trasferta: (c && c.trip) || "" }); }

// ---- la prenotazione in un tocco
// La voce che il modulo preseleziona da sempre: la prima che combacia col tipo e
// non e' ancora fatta, se no la prima che combacia. Qui diventa il bottone.
// T11: una voce che ha GIA' una prenotazione attaccata non si propone piu'. Le due
// Airbnb dello stesso alloggio dicevano tutte e due "Alloggio", e dopo il primo
// Collega la seconda avrebbe riscritto la voce sopra la prima. "Libera" vuol dire
// senza prenotazione collegata (prenDiVoce): una voce segnata Fatto a mano resta
// proponibile, agganciarle la mail e' proprio quello che serve.
// Limite noto: le prenotazioni dell'altro non arrivano (privacy), quindi una voce
// collegata da lui/lei qui sembra libera.
function vociCheCombaciano(p, tid) {
  const sugg = SUGG_PREN[p.tipo] || [];
  return tripChecks(tid).filter(c => sugg.some(s => String(c.voce).toLowerCase().startsWith(s.toLowerCase())));
}
function voceLibera(c, p) { const x = prenDiVoce(c.id); return !x || x.id === p.id; }
function vocePreferita(p, tid) {
  const cs = vociCheCombaciano(p, tid).filter(c => voceLibera(c, p));
  return cs.find(c => c.stato === "da_fare") || cs[0] || null;
}
function vociPrese(p, tid) { return vociCheCombaciano(p, tid).filter(c => !voceLibera(c, p)); }
// La trasferta su cui si ragiona: quella scritta dal lettore, se no quella dedotta dalla data.
function tripDiPren(p) { return p.trasferta_id ? (D.trasferte || []).find(x => x.id === p.trasferta_id) || null : trasfertaDaData(p.inizio); }
// null = niente un tocco (trasferta sconosciuta, tipo "altro" senza voce, oppure le
// voci giuste ci sono ma sono gia' tutte prese).
function unToccoPren(p) {
  if (!p || p.stato !== "nuova") return null;
  const t = tripDiPren(p);
  if (!t) return null;
  const v = vocePreferita(p, t.id);
  if (v) return { trasferta_id: t.id, voce_id: v.id, voce: v.voce, trip: t.nome, nuova: false };
  // T11: se "Alloggio" c'e' ed e' gia' collegato, creare una seconda "Alloggio" con un
  // tocco sarebbe un doppione tanto quanto riscrivere la prima. Decide la persona dal
  // modulo — o con Ignora, se e' la stessa prenotazione arrivata due volte.
  if (vociPrese(p, t.id).length) return null;
  const s = (SUGG_PREN[p.tipo] || [])[0];
  return s ? { trasferta_id: t.id, voce_id: "", voce: s, trip: t.nome, nuova: true } : null;
}
// Perche' il bottone "Collega" non si puo' dare (specchio di perNoUnTocco). "" = si puo'.
function perNoCollega(p) {
  if (unToccoPren(p)) return "";
  const t = tripDiPren(p);
  if (!t) return "non si sa la trasferta";
  const prese = vociPrese(p, t.id);
  if (prese.length) return prese.map(c => "“" + c.voce + "”").join(" e ") + (prese.length === 1 ? " ha" : " hanno") + " già una prenotazione collegata";
  return "nessuna voce che combaci";
}
async function collegaSubito(id) {
  const p = visiblePren().find(x => x.id === id), u = p && unToccoPren(p);
  if (!u) return formPren(id);
  toast("Collego e salvo il PDF in Drive…", 15000);
  try {
    const r = await api("pren.collega", { id: p.id, trasferta_id: u.trasferta_id, voce_id: u.voce_id, voce: u.voce });
    const i = D.prenotazioni.findIndex(x => x.id === p.id); if (i >= 0) D.prenotazioni[i] = r.prenotazione;
    const j = D.checklist.findIndex(c => c.id === r.voce.id); if (j >= 0) D.checklist[j] = r.voce; else D.checklist.push(r.voce);
    LS.set("data", D); render();
    // Q2 del ticket: due bottoni, non uno. Se dalla stessa mail e' nata anche una
    // ricevuta il modulo NON si apre da se' (sarebbe "collega e registra" in un
    // gesto solo): il bottone della ricevuta e' li' sulla carta, gia' pronto.
    const q = propDiPren(r.prenotazione);
    toast("Collegata a “" + u.voce + "”" +
      (pdfPren(r.prenotazione) ? " · sulla voce trovi ✉️ e 📄" : " · il PDF non è riuscito, la mail c'è") +
      (q && q.stato === "nuova" ? " · resta la ricevuta da registrare" : ""), 5000);
  } catch (e) { toast("Errore: " + e.message, 5000); }
}

// ---- la carta
// La rilettura qui NON porta il bottone "usa 9,99": quello scrive in #fImp, che
// esiste solo dentro il modulo. Qui e' un avviso, e toglie l'un tocco.
function rigaRiletturaPosta(q) {
  const n = propNote(q) || {};
  if (!n.rilettura) return "";
  return `<div class="dett"><b>⚠ rileggendo la mail l'importo risulta ${esc(num(Number(n.rilettura) || 0))} ${esc(n.rilettura_valuta || q.valuta || "EUR")}</b>, non ${esc(num(Number(q.importo) || 0))} ${esc(q.valuta || "EUR")} — apri "Modifica…" e decidi tu</div>`;
}
function postaChips(c) {
  const a = [];
  if (c.pren) a.push(`<span class="pill">${esc(TIPO_PREN[c.pren.tipo] || TIPO_PREN.altro)}</span>`);
  if (c.prop) a.push(`<span class="pill blue">🧾 ricevuta ${propImporto(c.prop)}</span>`);
  return a.join(" ");
}
function postaLink(c) {
  const p = c.pren, q = c.prop, a = [];
  const ml = p ? linkMail(p) : (q && q.msg_id ? linkMail(q.msg_id) : "");
  if (ml) a.push(`<a href="${esc(ml)}" target="_blank" rel="noopener">mail</a>`);
  const pdf = (p && pdfPren(p)) || (q && q.file_url) || "";
  if (pdf) a.push(`<a href="${esc(pdf)}" target="_blank" rel="noopener">PDF</a>`);
  if (p && p.link) a.push(`<a href="${esc(p.link)}" target="_blank" rel="noopener">sito del fornitore</a>`);
  return a.length ? `<div class="muted" style="margin-top:3px">${a.join(" · ")}</div>` : "";
}
function postaAzioni(c) {
  const p = c.pren, q = c.prop;
  const dedotta = c.dedotta ? `<div class="muted" style="margin-top:3px">trasferta dedotta dalla data: controlla che sia quella giusta</div>` : "";
  let h = "";
  if (p && p.stato === "nuova") {
    const u = unToccoPren(p);
    h += `<div class="pact">` + (u
      ? `<button class="btn primary pbtn" onclick="collegaSubito('${p.id}')">Collega a “${esc(u.voce)}”${u.nuova ? " (voce nuova)" : ""} · ${esc(u.trip)}</button>` + dedotta
      : `<div class="muted">Prenotazione: ${esc(perNoCollega(p))}, scegli tu.</div>`) +
      `<div class="row" style="gap:8px;margin-top:6px"><button class="btn sm grow${u ? "" : " primary"}" onclick="formPren('${p.id}')">Modifica…</button><button class="btn sm" onclick="ignoraPren('${p.id}')">Ignora</button></div></div>`;
  } else if (p && p.stato === "collegata") {
    const v = (D.checklist || []).find(x => x.id === p.voce_id);
    h += `<div class="pact"><div class="row between"><span class="small">✓ collegata${v ? " a “" + esc(v.voce) + "”" : ""}</span><button class="btn sm" onclick="scollegaPren('${p.id}')">Scollega</button></div></div>`;
  } else if (p && p.stato === "ignorata") {
    h += `<div class="pact"><div class="row between"><span class="small muted">prenotazione ignorata</span><button class="btn sm" onclick="ripristinaPren('${p.id}')">Ripristina</button></div></div>`;
  }
  if (q && q.stato === "nuova") {
    const no = perNoUnTocco(q, c.trip);
    h += `<div class="pact">` + (no
      ? `<div class="muted">Ricevuta: ${esc(no)} — guardala prima di registrarla.</div>`
      : `<button class="btn primary pbtn" onclick="registraSubito('${q.id}')">Registra ${propImporto(q)} · condivisa · ha pagato ${esc(cfg.who)} · ${esc(c.trip)}</button>` + dedotta) +
      `<div class="row" style="gap:8px;margin-top:6px"><button class="btn sm grow${no ? " primary" : ""}" onclick="apriProposta('${q.id}')">Modifica…</button><button class="btn sm" onclick="ignoraProposta('${q.id}')">Ignora</button></div></div>`;
  } else if (q && q.stato === "confermata") {
    h += `<div class="pact"><div class="row between"><span class="small">✓ spesa registrata</span>${q.spesa_id ? `<button class="btn sm" onclick="formSpesa('${q.spesa_id}')">Apri la spesa</button>` : ""}</div></div>`;
  } else if (q && q.stato === "ignorata") {
    h += `<div class="pact"><div class="row between"><span class="small muted">ricevuta ignorata</span><button class="btn sm" onclick="ripristinaProposta('${q.id}')">Ripristina</button></div></div>`;
  }
  return h;
}
function cardPosta(c) {
  const p = c.pren, q = c.prop, righe = p ? prenRighe(p) : [];
  return `<div class="card">
    <div>${postaChips(c)}</div>
    <div class="ellipsis" style="margin-top:5px"><b>${esc(c.oggetto)}</b></div>
    ${righe.length ? righe.map(r => `<div class="dett">${esc(r)}</div>`).join("") : p ? `<div class="dett">${esc(prenQuando(p))}</div>` : ""}
    <div class="muted ellipsis">${esc(c.mittente)}${c.quando ? " · " + fmtDY(c.quando) : ""}${p && p.codice ? " · " + esc(p.codice) : ""}</div>
    ${q ? rigaCarta(q) + rigaRiletturaPosta(q) : ""}
    ${postaLink(c)}
    ${postaAzioni(c)}</div>`;
}
function vPosta() {
  const carte = postaCarte();
  const n = { da_fare: 0, fatte: 0, ignorate: 0 };
  carte.forEach(c => n[c.seg]++);
  const daFare = carte.filter(c => c.seg === "da_fare");
  const tot = daFare.reduce((a, c) => a + (c.prop && c.prop.stato === "nuova" && (!c.prop.valuta || c.prop.valuta === "EUR") ? Number(c.prop.importo) || 0 : 0), 0);
  let h = `<div class="row"><h1 class="grow" style="margin:0">Posta</h1><button class="ask" onclick="postaAiuto()" title="Come funziona">?</button><button class="btn sm primary" onclick="scanPosta()">Scansiona</button></div>
    <div class="seg" style="margin:12px 0">${Object.keys(POSTA_SEG).map(k => `<button class="${postaSeg === k ? "on" : ""}" onclick="setPostaSeg('${k}')">${POSTA_SEG[k]}${n[k] ? " " + n[k] : ""}</button>`).join("")}</div>`;
  if (postaSeg === "da_fare" && daFare.length) h += `<div class="muted" style="margin:-4px 0 10px">${daFare.length} cos${daFare.length === 1 ? "a" : "e"} da sistemare${tot ? " · " + eur(tot) + " di ricevute" : ""}</div>`;
  const lista = carte.filter(c => c.seg === postaSeg);
  if (postaSeg === "ignorate") {
    const riga = { carico: "Chiedo al server le mail ignorate…", offline: "Senza rete: qui vedi solo quelle ignorate in questa sessione.", errore: "Il server non ha risposto: qui vedi solo quelle ignorate in questa sessione." }[ignorateStato] || "";
    if (riga) h += `<div class="muted" style="margin:-4px 0 10px">${riga}</div>`;
  }
  if (!lista.length) return h + `<div class="empty">${postaSeg === "da_fare" ? "Niente da sistemare. Premi “Scansiona” per cercare adesso." : postaSeg === "fatte" ? "Ancora niente di fatto." : ignorateStato === "carico" ? "" : "Niente di ignorato."}</div>`;
  // Gruppi per trasferta: l'ordine e' quello della mail piu' recente del gruppo,
  // cosi' le 40 ricevute si smaltiscono una trasferta alla volta.
  const gruppi = [], idx = {};
  lista.forEach(c => { const k = c.trip || ""; if (!(k in idx)) { idx[k] = gruppi.length; gruppi.push({ k: k, carte: [] }); } gruppi[idx[k]].carte.push(c); });
  gruppi.forEach(g => { h += `<h2>${g.k ? esc(g.k) : "Senza trasferta"} <span class="muted">(${g.carte.length})</span></h2>` + g.carte.map(cardPosta).join(""); });
  if (postaSeg === "ignorate" && ignorateStato === "ok") h += `<div class="muted">Sono le mail ignorate da te. Quelle scartate dal lettore (marketing, promemoria, senza importo) non ci sono: per riportarne una in vita si passa da "Scansiona".</div>`;
  return h;
}
function postaAiuto() {
  aiutoFoglietto("Come funziona la Posta", [
    `Ogni carta è <b>una mail</b> letta dalla tua casella, comprese quelle inoltrate. Dalla stessa mail possono nascere due cose: una <b>prenotazione</b> da collegare a una voce della checklist e una <b>ricevuta</b> da registrare fra le spese. Sono due decisioni diverse, quindi due bottoni.`,
    `Il bottone verde fa la cosa più probabile in un tocco e dice per esteso che cosa farà. Per le ricevute i valori sono quelli con cui si apre il modulo: <b>condivisa</b>, in due, ha pagato ${esc(cfg.who)}. Se non tornano, "Modifica…" apre il modulo di sempre.`,
    `In Spese non entra niente senza un tuo tocco su quella ricevuta: nemmeno il bottone verde salta questo passaggio. Se rileggendo la mail l'importo cambia, o se la spesa somiglia a una già registrata, il bottone verde non compare.`,
    `La posta è di chi la riceve: le mail dell'altra persona non si vedono e non si confermano.`,
  ]);
}
// Una passata sola sulla casella: l'azione `scan` produce entrambi gli sbocchi.
async function scanPosta() {
  toast("Leggo la mail… può volerci un minuto o due", 15000);
  try {
    const r = await api("scan");
    if (r.prenotazioni) D.prenotazioni = r.prenotazioni;
    if (r.proposte) D.proposte = r.proposte;
    LS.set("data", D); render();
    const np = r.nuove_pren || 0, nq = r.nuove_prop || 0;
    toast(np + nq ? `${np} prenotazioni e ${nq} ricevute nuove${r.pdf ? ` · ${r.pdf} PDF salvati` : ""}` : "Niente di nuovo nella posta", 5000);
  } catch (e) { toast("Errore: " + e.message, 5000); }
}

// ---------------------------------------------------------------- COMPENSI
const RIS = { taglio: "Taglio superato", mancato: "Taglio mancato", vittoria: "Vittoria", np: "Non giocato" };
// ---- SOLDI › Compensi
// Una riga per settimana di gara: nome · quanto va bonificato · saldato / da saldare.
// Le quattro righe di aritmetica (fisso + % + extra, piu' il conto della trasferta)
// stanno nel foglietto che si apre toccando la riga (formCompenso), insieme a
// "Registra pagamento" con l'importo gia' scritto e il compenso agganciato (T9).
// "Segna tutti come saldati" non c'e' piu' (Q6): la domanda dopo un pagamento
// copre il caso vero. Le regole (900 €, 8 %, 10 %) sono dietro il "?".
function soldiCompensi() {
  const trips = (D.trasferte || []).filter(t => t.tipo !== "casa" && t.tipo !== "altro" && t.fine <= today()).sort((a, b) => a.inizio < b.inizio ? 1 : -1);
  const comp = D.compensi || []; const byTrip = {}; comp.forEach(c => byTrip[c.trasferta_id] = c);
  const daSaldare = comp.filter(c => c.stato !== "pagato");
  const totDaPagare = Math.round(daSaldare.reduce((a, c) => a + daPagare(c), 0) * 100) / 100;
  let h = `<button class="btn primary block" style="margin:0 0 12px" onclick="formSpesa(null,null,'regolamento')">＋ Registra pagamento</button>
    <div class="row between" style="margin-bottom:4px"><span class="muted">${daSaldare.length ? `${daSaldare.length} da saldare` : "Tutti saldati"} · ${comp.length} compens${comp.length === 1 ? "o" : "i"}</span>${daSaldare.length ? `<span class="amt">${eur(totDaPagare)} da bonificare</span>` : ""}</div>`;
  if (!trips.length) return h + `<div class="empty">Nessuna settimana di torneo conclusa</div>`;
  h += `<div class="card list">` + trips.map(t => { const c = byTrip[t.id];
    const dp = c ? daPagare(c) : 0;
    return `<div class="item tap" onclick="formCompenso('${t.id}')"><div class="grow"><div class="ellipsis"><b>${esc(t.nome)}</b> ${t.tipo === "qualifica" ? '<span class="pill grey">qualifica</span>' : ""}${t.intercontinentale === "si" ? ' <span class="pill blue">intercont.</span>' : ""}</div><div class="muted">${fmtD(t.inizio)} → ${fmtD(t.fine)}${c ? " · " + (RIS[c.risultato] || "").toLowerCase() : ""}</div></div>
      <div style="text-align:right">${c ? `<div class="amt">${eur(Math.abs(dp))}</div>${dp < 0 ? `<div class="muted">${cfg.who === "Giulio" ? "li devi tu" : "li deve Giulio"}</div>` : ""}<span class="pill ${c.stato === "pagato" ? "" : "warn"}">${c.stato === "pagato" ? "saldato" : "da saldare"}</span>` : `<span class="pill grey">da compilare</span>`}</div></div>`; }).join("") + `</div>`;
  return h;
}
function formCompenso(tripId) {
  const t = (D.trasferte || []).find(x => x.id === tripId); if (!t) return;
  const ex = (D.compensi || []).find(c => c.trasferta_id === tripId);
  const st = D.settings || {};
  const c = ex ? Object.assign({}, ex) : { trasferta_id: tripId, fisso: t.tipo === "torneo" ? Number(st.compenso_fisso || 900) : 0, montepremi: "", risultato: "taglio", extra: "", note: "", stato: "da_pagare" };
  openModal(`<h2 style="margin-top:0">Compenso · ${esc(t.nome)}</h2>
    <div class="cols"><div class="field"><label>Fisso settimana €</label><input id="kFisso" inputmode="decimal" value="${esc(c.fisso)}"></div><div class="field"><label>Montepremi Alessandra €</label><input id="kPrize" inputmode="decimal" value="${esc(c.montepremi)}" placeholder="0"></div></div>
    <div class="muted" style="margin:-4px 0 10px">Il montepremi va scritto <b>in euro</b> e <b>al lordo</b>: se il torneo lo pubblica in un'altra valuta, convertilo prima di inserirlo qui — il codice non converte nulla. La percentuale si calcola sempre sul lordo pubblicato.</div>
    <div class="field"><label>Risultato</label><div class="seg" id="segRis">${Object.keys(RIS).map(k => `<button data-v="${k}" class="${c.risultato === k ? "on" : ""}">${RIS[k]}</button>`).join("")}</div></div>
    <div class="cols"><div class="field"><label>Extra € (opz.)</label><input id="kExtra" inputmode="decimal" value="${esc(c.extra)}"></div><div class="field"><label>Stato</label><select id="kStato"><option value="da_pagare" ${c.stato !== "pagato" ? "selected" : ""}>Da saldare</option><option value="pagato" ${c.stato === "pagato" ? "selected" : ""}>Saldato</option></select></div></div>
    <div class="muted" style="margin-bottom:10px">${t.intercontinentale === "si" ? "Trasferta intercontinentale. Il 50% della tratta lunga <b>non</b> si somma qui: quei voli vanno registrati come spesa <i>condivisa</i> e il 50% arriva dal saldo della trasferta (stessa cassa per Giulio, più deduzione per Alessandra). I voli <i>interni</i> alla destinazione se li paga Giulio, come dentro l'Europa." : "Trasferta non intercontinentale: nessun rimborso voli."}</div>
    <div class="field"><label>Note</label><input id="kNote" value="${esc(c.note || "")}"></div>
    <div id="kPrev" class="preview"></div>
    <div class="row" style="gap:8px"><button class="btn primary grow" id="kSave">Salva</button>${ex ? `<button class="btn danger" id="kDel">Elimina</button>` : ""}<button class="btn" onclick="closeModal()">Annulla</button></div>
    ${ex ? `<div class="row" style="gap:8px;margin-top:8px"><button class="btn grow" id="kPay">＋ Registra pagamento</button></div>` : ""}`);
  // saldo delle spese della trasferta: non dipende dai campi qui sopra, si legge una volta
  const saldoT = saldoTrasferta(t.nome);
  let dpOra = 0;
  const prev = () => { const perc = c.risultato === "vittoria" ? +(st.perc_vittoria || 10) : c.risultato === "taglio" ? +(st.perc_taglio || 8) : 0; const f = parseFloat(String($("#kFisso").value).replace(",", ".")) || 0, p = parseFloat(String($("#kPrize").value).replace(",", ".")) || 0, e = parseFloat(String($("#kExtra").value).replace(",", ".")) || 0;
    const tot = Math.round((f + p * perc / 100 + e) * 100) / 100;
    dpOra = Math.round((tot + saldoT) * 100) / 100;
    // il compenso resta lordo (e' quello che Alessandra scarica); il bonifico e' l'altro numero
    $("#kPrev").innerHTML = `Compenso: ${eur(f)} + ${perc}% di ${eur(p)} (${eur(p * perc / 100)}) + extra ${eur(e)} = <b>${eur(tot)}</b><br>Saldo spese della trasferta ${saldoT < 0 ? "−" : "+"} ${eur(Math.abs(saldoT))} → <b>${eur(Math.abs(dpOra))}</b> ${dpOra < 0 ? "che deve Giulio ad Alessandra" : "da bonificare a Giulio"}`; };
  $("#segRis").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; $("#segRis").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); c.risultato = b.dataset.v; prev(); });
  ["#kFisso", "#kPrize", "#kExtra"].forEach(x => $(x).addEventListener("input", prev)); prev();
  // il pagamento vero si registra per l'importo NETTO, non per il compenso lordo:
  // un solo bonifico chiude sia il compenso sia il saldo di quella trasferta
  if (ex) $("#kPay").addEventListener("click", () => { const imp = Math.abs(dpOra); closeModal(); formSpesa(null, t.nome, "regolamento", { importo: imp ? imp : "", valuta: "EUR", cambio: 1, pagato_da: dpOra < 0 ? "Giulio" : "Alessandra", descrizione: "Saldo " + t.nome }, ex.id); });
  $("#kSave").addEventListener("click", async () => {
    c.fisso = String($("#kFisso").value).replace(",", "."); c.montepremi = String($("#kPrize").value).replace(",", ".") || 0; c.extra = String($("#kExtra").value).replace(",", ".") || 0; c.note = $("#kNote").value.trim(); c.stato = $("#kStato").value;
    closeModal(); toast("Salvo…");
    try { const r = await api("compenso.save", c); const i = D.compensi.findIndex(x => x.id === r.compenso.id); if (i >= 0) D.compensi[i] = r.compenso; else D.compensi.push(r.compenso); const j = D.spese.findIndex(x => x.id === r.spesa.id); if (j >= 0) D.spese[j] = r.spesa; else D.spese.push(r.spesa); LS.set("data", D); render(); toast("Compenso salvato: " + eur(r.compenso.totale)); }
    catch (e) { toast("Errore: " + e.message, 4000); }
  });
  if (ex) $("#kDel").addEventListener("click", async () => { if (!await chiediConferma("Eliminare il compenso?", `Sparisce anche la riga <b>${esc(ex.trasferta || "")}</b> nel conto, e con lei il credito di quella settimana.`, { si: "Elimina", rosso: true })) return; closeModal(); try { await api("compenso.del", { id: ex.id }); D.compensi = D.compensi.filter(x => x.id !== ex.id); D.spese = D.spese.filter(x => x.id !== ex.spesa_id); LS.set("data", D); render(); } catch (e) { toast("Errore: " + e.message, 4000); } });
}
// Chiede se il compenso da cui arriva il pagamento va segnato saldato (T9).
// Riusa l'azione compenso.stato: nessuna API nuova.
async function chiediSaldato(compId, data) {
  const c = (D.compensi || []).find(x => x.id === compId);
  if (!c || c.stato === "pagato") return;
  if (!await chiediConferma("Segnare il compenso come saldato?", `Pagamento registrato. Il compenso di <b>${esc(c.trasferta)}</b> risulterebbe saldato. Se era solo un acconto, rispondi No.`, { si: "Sì, saldato", no: "No" })) return;
  try { const r = await api("compenso.stato", { ids: [compId], stato: "pagato", data: data || today() }); r.forEach(x => { const i = D.compensi.findIndex(y => y.id === x.id); if (i >= 0) D.compensi[i] = x; }); LS.set("data", D); render(); toast("Compenso segnato come saldato"); }
  catch (e) { toast("Errore: " + e.message, 4000); }
}

// ---------------------------------------------------------------- FORM SPESA
// T10 giro 2 (ADR-2). "Nuova spesa" e "Conferma spesa" erano due moduli gemelli
// che si erano gia' scostati fra loro (uno indovinava la trasferta dalla data,
// l'altro no; uno aveva il campo file, l'altro no; le regole di privacy sulla
// lista delle trasferte stavano solo in uno dei due). Adesso c'e' UN costruttore
// solo, `moduloSpesa`, e i due chiamanti gli passano soltanto cio' che li
// distingue davvero: che cosa c'e' in testa, se c'e' il campo file, che cosa fa
// il bottone Salva.
//
// Ordine e default sono quelli del §3.4 del ticket: importo grande con le valute
// a pasticca (Q9), il tipo come tre bottoni che dicono che cosa vogliono dire,
// chi ha pagato, la trasferta, sei categorie a pasticca coi nomi corti (Q8), la
// descrizione coi suggerimenti presi dalle spese vecchie della stessa categoria,
// foto e galleria al posto dell'input file di sistema, data e note chiuse sotto
// "Altro", Salva appiccicato in fondo.
//
// Quello che NON si muove: computeSpesa / boxLibri / saldoIo fanno gli stessi
// conti di prima, l'avviso doppioni (T7) sta dov'era — il primo tocco avvisa, il
// secondo salva — e la forma di T9 resta intatta (su `regolamento` l'etichetta
// del file dice "Fattura" e non c'e' categoria; su `caddie` non c'e' il campo
// file; un pagamento nato da un compenso CHIEDE se segnarlo saldato).
// ⚠ tools/audit-offline/test_form_spesa.js ritaglia app.js fra chiediSaldato e
// prepFile e valuta solo quel pezzo: tutto questo blocco deve restare qui in
// mezzo, o il test non lo vede piu'. E le due frasi che il test cerca (il nome
// delle due funzioni preceduto da "async function") non vanno scritte qui
// dentro nemmeno in un commento: sarebbero loro il taglio.
let pendingFile = null;

// Nome corto per la pasticca (Q8): "Viaggio - Vitto (Ristoranti/Spesa)" -> "Vitto".
const catBreve = c => String(c || "").split(" - ").pop().replace(/\s*\(.*\)\s*$/, "").trim() || String(c || "");
// Le categorie davvero usate, in ordine di quante volte compaiono. Fuori i movimenti
// (caddie e regolamento): la loro categoria non la sceglie nessuno.
function catTop(n) {
  const c = {}, tutte = (D.settings && D.settings.categorie) || [];
  (D.spese || []).forEach(x => { if (x.tipo === "caddie" || x.tipo === "regolamento") return; const k = String(x.categoria || ""); if (k) c[k] = (c[k] || 0) + 1; });
  return Object.keys(c).filter(k => tutte.indexOf(k) >= 0).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1)).slice(0, n);
}
// Le valute piu' usate, tolte quelle gia' in pasticca (la trasferta ed EUR).
function valTop(n, fuori) {
  const c = {};
  (D.spese || []).forEach(x => { const v = String(x.valuta || "EUR"); c[v] = (c[v] || 0) + 1; });
  return Object.keys(c).filter(v => (fuori || []).indexOf(v) < 0).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1)).slice(0, n);
}
// Descrizioni gia' usate nella stessa categoria: "Cena", "Pranzo", "Benzina"...
// Sono le stesse parole ogni volta, tanto vale offrirle invece di ribatterle.
function suggDesc(cat) {
  const c = {}, ult = {}, ord = [];
  (D.spese || []).forEach(x => {
    if (String(x.categoria || "") !== String(cat || "")) return;
    const d = String(x.descrizione || "").trim();
    if (!d || d.length > 28) return;
    if (!(d in c)) { c[d] = 0; ult[d] = ""; ord.push(d); }
    c[d]++;
    const g = String(x.data || "").slice(0, 10);
    if (g > ult[d]) ult[d] = g;
  });
  // Quante volte l'hai usata, e a parita' l'ultima volta che l'hai usata. In pari
  // l'ordine alfabetico proponeva "Asian" prima di quello che avevi scritto ieri.
  return ord.sort((a, b) => c[b] - c[a] || (ult[a] < ult[b] ? 1 : ult[a] > ult[b] ? -1 : 0));
}

// o = { titolo, testa, s, ex, conTipo, conCategoria, conNote, conFile, etichettaFile,
//       notaFile, aiuto, salva, salvaComunque, onSalva, onElimina }
function moduloSpesa(o) {
  const s = o.s;
  const cats = (D.settings && D.settings.categorie) || [], vals = (D.settings && D.settings.valute) || ["EUR"];
  const conTipo = !!o.conTipo, conCat = o.conCategoria !== false, conFile = !!o.conFile;
  // Le trasferte fra cui scegliere. Fuori le "casa/altro" in cui ho solo spese
  // dell'altra persona: sono le sue settimane a casa, non mi riguardano.
  const TRIP_PRIV = ["casa", "altro"];
  const miaSpesa = x => !(x.tipo === "personale" && x.conto && x.conto !== cfg.who);
  const hoSpese = n => (D.spese || []).some(x => x.trasferta === n && miaSpesa(x));
  const soloAltro = n => (D.spese || []).some(x => x.trasferta === n && !miaSpesa(x)) && !hoSpese(n);
  const trips = [...new Set([...(D.trasferte || []).filter(t => !TRIP_PRIV.includes(String(t.tipo || "").toLowerCase()) || !soloAltro(t.nome)).map(t => t.nome), ...(D.spese || []).filter(miaSpesa).map(x => x.trasferta), s.trasferta])].filter(Boolean).sort();
  // Q9: la valuta della trasferta, poi EUR, poi le tre piu' usate. Le altre 15
  // restano nel menu dietro "altre...", che e' dove passano una volta ogni tanto.
  const v0 = s.valuta || "EUR";
  const chipVal = [...new Set([v0, "EUR", ...valTop(3, [v0, "EUR"])])];
  // Q8: sei categorie, piu' quella gia' scritta sulla riga se non e' fra quelle.
  const chipCat = [...new Set([...(s.categoria ? [s.categoria] : []), ...catTop(6)])].slice(0, 7);
  // /2 /3 /4 (§3.4). Se una riga vecchia si divide in 5 o 6, quella pasticca resta:
  // non si perde un valore gia' scritto solo perche' il modulo e' cambiato.
  const nSplit = [...new Set([2, 3, 4, Math.max(2, parseInt(s.n_persone, 10) || 2)])].sort((a, b) => a - b);
  // Dietro "altre…": il menu fino a 12, e in fondo "un altro numero…" per scriverlo.
  const nMenu = [...new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, Math.max(2, parseInt(s.n_persone, 10) || 2)])].sort((a, b) => a - b);
  const TIPO_BTN = { condivisa: ["Condivisa", "una la paga, la dividete"], ciascuno: ["Ognuno la sua", "avete già pagato metà ciascuno"], personale: ["Personale", "solo tua"] };
  pendingFile = null;
  openModal(`
    <div class="row between" style="margin-bottom:10px"><h2 style="margin:0">${esc(o.titolo)}</h2><button type="button" class="ask" id="fAsk" title="Come funziona">?</button></div>
    ${o.testa || ""}
    <div class="field"><label>Importo</label>
      <div class="improw"><input id="fImp" class="impbig" inputmode="decimal" placeholder="0,00" value="${esc(s.importo)}"><span class="impval" id="fValLab">${esc(v0)}</span></div>
      <div class="chips" id="fChipVal">${chipVal.map(v => `<button type="button" data-v="${esc(v)}" class="${v === v0 ? "on" : ""}">${esc(v)}</button>`).join("")}<button type="button" data-altre="1">altre…</button></div>
      <select id="fVal" class="altre" hidden>${[...new Set([v0, ...vals])].map(v => `<option ${v === v0 ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>
    <div class="preview" id="fPrev">${o.ex && v0 !== "EUR" && s.importo_eur ? `= ${eur(s.importo_eur)} (cambio ${num(s.cambio, 4)})` : ""}</div>
    ${conTipo ? `<div class="field"><div class="tipi" id="segTipo">${["condivisa", "ciascuno", "personale"].map(k => `<button type="button" data-v="${k}" class="${s.tipo === k ? "on" : ""}"><b>${TIPO_BTN[k][0]}</b><span>${TIPO_BTN[k][1]}</span></button>`).join("")}</div>
      <div id="fN" ${s.tipo === "condivisa" || s.tipo === "ciascuno" ? "" : "hidden"}>
        <div class="row split"><span class="muted">In quante parti</span><div class="chips inline" id="segN">${nSplit.map(n => `<button type="button" data-v="${n}" class="${+s.n_persone === n ? "on" : ""}">÷${n}</button>`).join("")}<button type="button" data-altre="1">altre…</button></div></div>
        <select id="fNP" class="altre" hidden>${nMenu.map(n => `<option value="${n}" ${+s.n_persone === n ? "selected" : ""}>in ${n} parti</option>`).join("")}<option value="__x">un altro numero…</option></select>
        <input id="fNPX" class="altre" type="number" inputmode="numeric" min="2" step="1" placeholder="in quante parti" hidden></div></div>` : ""}
    <div class="books" id="fBooks"></div>
    <div class="field"><label>${s.tipo === "regolamento" ? "Chi paga" : "Chi ha pagato"}</label><div class="seg" id="segChi">${PERSONE.map(p => `<button type="button" data-v="${p}" class="${s.pagato_da === p ? "on" : ""}">${p}${cfg.who === p ? " (tu)" : ""}</button>`).join("")}</div></div>
    <div class="field"><label>Trasferta</label><select id="fTrip">${s.trasferta ? "" : `<option value="" selected>Scegli la trasferta…</option>`}${trips.map(t => `<option ${t === s.trasferta ? "selected" : ""}>${esc(t)}</option>`).join("")}<option value="__new">＋ Nuova…</option></select></div>
    ${conCat ? `<div class="field"><label>Categoria</label>
      <div class="chips" id="fChipCat">${chipCat.map(c => `<button type="button" data-v="${esc(c)}" class="${c === s.categoria ? "on" : ""}">${esc(catBreve(c))}</button>`).join("")}<button type="button" data-altre="1">altre…</button></div>
      <select id="fCat" class="altre" hidden>${cats.map(c => `<option ${c === s.categoria ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>` : ""}
    <div class="field"><label>Descrizione</label><input id="fDesc" value="${esc(s.descrizione)}" placeholder="${s.tipo === "caddie" ? "es. Caddie Aprile/Maggio" : s.tipo === "regolamento" ? "es. Bonifico saldo Australia" : "es. Cena, Benzina, Hotel…"}"><div class="chips" id="fSugg"></div></div>
    ${conFile ? `<div class="field"><label>${esc(o.etichettaFile)} ${s.scontrino ? `· <a href="${esc(s.scontrino)}" target="_blank" rel="noopener">apri quello attuale</a>` : ""}</label>
      <div class="row" style="gap:8px"><button type="button" class="btn grow" id="fCam">📷 Scatta</button><button type="button" class="btn grow" id="fGal">🖼 Galleria o file</button></div>
      <input id="fFoto" type="file" accept="image/*" capture="environment" hidden><input id="fFile" type="file" accept="image/*,application/pdf" hidden>
      <div class="muted" id="fFileInfo">${o.notaFile || ""}</div></div>` : ""}
    <details class="altro"><summary>Altro <span class="muted" id="fAltroLab">· ${esc(fmtDY(s.data))}</span></summary>
      <div class="field"><label>Data</label><input id="fData" type="date" value="${esc(s.data)}"></div>
      ${o.conNote ? `<div class="field"><label>Note</label><input id="fNote" value="${esc(s.note || "")}"></div>` : ""}</details>
    <div id="fDup"></div>
    <div class="formfoot"><div class="row" style="gap:8px"><button class="btn primary grow" id="fSave">${esc(o.salva)}</button>${o.onElimina ? `<button class="btn danger" id="fDel">Elimina</button>` : ""}<button class="btn" onclick="closeModal()">Annulla</button></div></div>`);

  // --- interruttori ---
  // Il "?" e' quello di tutte le altre pagine (T10 giro 5): prima qui dentro era
  // un <details> aperto sul posto, l'unico rimasto diverso dagli altri.
  const bAsk = $("#fAsk");
  if (bAsk) bAsk.addEventListener("click", () => aiutoFoglietto(conTipo ? "Che cosa fa questa spesa" : `Che cos'è un ${String(TIPI[s.tipo] || "").toLowerCase()}`,
    (conTipo ? ["condivisa", "ciascuno", "personale"] : [s.tipo]).map(k => `<b>${esc(TIPI[k] || k)}</b> — ${esc(TIPO_NOTA[k] || "")}`)
      .concat(o.aiuto ? [esc(o.aiuto)] : [])
      .concat([`La riga verde qui sopra dice, con i numeri che hai scritto, dove finisce questa spesa e che debito nasce. Se somiglia a una già registrata, il primo tocco su Salva avvisa e il secondo salva lo stesso.`])));
  const seg = (sel, cb) => { const el = $(sel); if (!el) return; el.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; el.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); cb(b.dataset.v); }); };
  // Le pasticche hanno in fondo "altre...", che non si accende: apre il menu completo.
  const chips = (sel, cb) => { const el = $(sel); if (!el) return; el.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; if (b.dataset.altre) return cb(null); el.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); cb(b.dataset.v); }); };
  const eurOra = () => { const i = parseFloat(String($("#fImp").value).replace(",", ".")) || 0; return $("#fVal").value === "EUR" ? i : i * (Number(s.cambio) || 0); };
  const updBooks = () => { const b = $("#fBooks"); if (b) b.innerHTML = boxLibri(s, eurOra()); };
  // I suggerimenti seguono la categoria scelta e si restringono mentre scrivi.
  let suggOra = [];
  const updSugg = () => {
    const el = $("#fSugg"); if (!el) return;
    const cat = $("#fCat") ? $("#fCat").value : s.categoria;
    const q = String(($("#fDesc") && $("#fDesc").value) || "").trim().toLowerCase();
    suggOra = suggDesc(cat).filter(x => !q || (x.toLowerCase().indexOf(q) >= 0 && x.toLowerCase() !== q)).slice(0, 6);
    el.innerHTML = suggOra.map((x, i) => `<button type="button" data-i="${i}">${esc(x)}</button>`).join("");
  };
  // Il cambio del giorno, chiesto al server: identico a prima.
  const prev = async () => {
    const v = $("#fVal").value, imp = parseFloat(String($("#fImp").value).replace(",", "."));
    if (!imp || v === "EUR") { $("#fPrev").textContent = ""; return; }
    $("#fPrev").textContent = "cambio…";
    try { const r = await api("fx", { valuta: v, data: $("#fData").value }); s.cambio = r.cambio; $("#fPrev").textContent = `≈ ${eur(imp * r.cambio)} (cambio ${num(r.cambio, 4)} del ${fmtD($("#fData").value)})`; }
    catch (e) { $("#fPrev").textContent = "cambio non disponibile (lo calcola il server al salvataggio)"; }
  };
  if (conTipo) seg("#segTipo", v => { s.tipo = v; const n = $("#fN"); if (n) n.hidden = !(v === "condivisa" || v === "ciascuno"); updBooks(); });
  seg("#segChi", v => { s.pagato_da = v; updBooks(); });
  // In quante parti: le tre pasticche per il caso normale, il menu fino a 12 dietro
  // "altre…" e, in fondo a quello, il campo in cui scrivere il numero vero. Da
  // qualunque delle tre strade arrivi, la pasticca accesa resta quella giusta (o
  // nessuna, se il numero non e' fra le tre).
  const accendiN = v => { const el = $("#segN"); if (!el) return; el.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === String(v))); };
  const setN = v => { const n = Math.max(2, parseInt(v, 10) || 2); s.n_persone = n; accendiN(n); updBooks(); };
  chips("#segN", v => {
    const sel = $("#fNP"), x = $("#fNPX");
    if (v === null) { if (sel) sel.hidden = false; return; }   // "altre…": apre il menu
    if (x) x.hidden = true;
    if (sel) sel.value = String(+v);
    s.n_persone = +v; updBooks();
  });
  const selNP = $("#fNP");
  if (selNP) selNP.addEventListener("change", () => {
    const x = $("#fNPX");
    if (selNP.value === "__x") { if (x) { x.hidden = false; x.value = s.n_persone; x.focus(); } return; }
    if (x) x.hidden = true;
    setN(selNP.value);
  });
  const inNP = $("#fNPX"); if (inNP) inNP.addEventListener("input", () => setN(inNP.value));
  // La valuta si leggeva solo all'apertura: cambiando la trasferta dentro al
  // modulo restava quella di prima (dollari su una settimana in euro). Adesso
  // segue la trasferta — ma solo finche' non l'hai scelta tu, e mai su una
  // spesa gia' salvata, dove la valuta e' un dato, non un default.
  let valTocco = !!o.ex;
  const accendiVal = v => { const c = $("#fChipVal"); if (c) c.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === v)); };
  const valutaDaTrip = () => {
    if (valTocco) return;
    const sel = $("#fVal"), t = (D.trasferte || []).find(x => x.nome === s.trasferta), v = t && t.valuta;
    if (!sel || !v || v === sel.value) return;
    if (!Array.prototype.some.call(sel.options, op => op.value === v)) sel.insertAdjacentHTML("afterbegin", `<option>${esc(v)}</option>`);
    sel.value = v; s.valuta = v;
    const l = $("#fValLab"); if (l) l.textContent = v;
    accendiVal(v); toast("Valuta della trasferta: " + v);
    prev().then(updBooks);
  };
  chips("#fChipVal", v => { const sel = $("#fVal"); if (!sel) return; if (v === null) { sel.hidden = false; return; } valTocco = true; sel.value = v; const l = $("#fValLab"); if (l) l.textContent = v; prev().then(updBooks); });
  chips("#fChipCat", v => { const sel = $("#fCat"); if (!sel) return; if (v === null) { sel.hidden = false; return; } sel.value = v; s.categoria = v; updSugg(); });
  const selVal = $("#fVal"); if (selVal) selVal.addEventListener("change", () => { valTocco = true; accendiVal(selVal.value); const l = $("#fValLab"); if (l) l.textContent = selVal.value; prev().then(updBooks); });
  const selCat = $("#fCat"); if (selCat) selCat.addEventListener("change", () => { s.categoria = selCat.value; updSugg(); });
  const inDesc = $("#fDesc"); if (inDesc) inDesc.addEventListener("input", updSugg);
  const elSugg = $("#fSugg"); if (elSugg) elSugg.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; const d = suggOra[+b.dataset.i]; if (d == null) return; $("#fDesc").value = d; updSugg(); });
  $("#fImp").addEventListener("input", updBooks);
  const inData = $("#fData"); if (inData) inData.addEventListener("change", () => { const l = $("#fAltroLab"); if (l) l.textContent = "· " + fmtDY(inData.value); });
  // Niente piu' prompt(): il nome della trasferta nuova si chiede col foglietto
  // che usa tutto il resto della app (§6 del ticket).
  const selTrip = $("#fTrip");
  selTrip.addEventListener("change", async () => {
    if (selTrip.value !== "__new") { s.trasferta = selTrip.value; valutaDaTrip(); return; }
    selTrip.value = s.trasferta || "";
    const n = await chiediTesto("Nuova trasferta", "", "es. Dutch Ladies Open");
    if (!n) return;
    selTrip.insertAdjacentHTML("afterbegin", `<option>${esc(n)}</option>`);
    selTrip.value = n; s.trasferta = n; valutaDaTrip();
  });
  ["#fImp", "#fData"].forEach(x => { const el = $(x); if (el) el.addEventListener("change", () => prev().then(updBooks)); });
  if (v0 !== "EUR") prev().then(updBooks);
  updBooks(); updSugg();
  // Foto: due bottoni invece dell'input di sistema. Sotto restano due input file
  // veri e nascosti - la fotocamera (capture) e la galleria, che su iPhone apre
  // anche "Scegli file" per i PDF.
  const scegli = (bSel, iSel) => {
    const b = $(bSel), i = $(iSel); if (!b || !i) return;
    b.addEventListener("click", () => i.click());
    i.addEventListener("change", async () => { const f = i.files[0]; if (!f) return; $("#fFileInfo").textContent = "Preparo il file…"; pendingFile = await prepFile(f); $("#fFileInfo").textContent = `${pendingFile.name} · ${Math.round(pendingFile.base64.length * 0.75 / 1024)} KB`; });
  };
  scegli("#fCam", "#fFoto"); scegli("#fGal", "#fFile");

  let dupVisto = ""; // T7: la chiave dell'avviso gia' mostrato; se la spesa cambia, si riavvisa
  $("#fSave").addEventListener("click", async () => {
    s.importo = parseFloat(String($("#fImp").value).replace(",", ".")); if (!s.importo) return toast("Inserisci l'importo");
    s.valuta = $("#fVal").value; s.data = $("#fData").value; s.trasferta = $("#fTrip").value;
    s.descrizione = $("#fDesc").value.trim();
    if ($("#fNote")) s.note = $("#fNote").value.trim();
    if ($("#fCat")) s.categoria = $("#fCat").value;
    if (s.tipo === "regolamento") s.categoria = "Altro";
    if (!s.trasferta || s.trasferta === "__new") return toast("Scegli la trasferta");
    if (s.valuta === "EUR") s.cambio = 1;
    if (s.tipo === "personale") s.conto = cfg.who;
    // T7: se somiglia a una spesa gia' registrata si chiede conferma, non si blocca.
    // Fuori dall'euro senza cambio l'importo in euro non si sa: si confronta solo
    // sulla stessa valuta, ed e' il verso giusto in cui sbagliare (come in Posta).
    const eurNoto = s.valuta === "EUR" ? s.importo : Math.round(s.importo * (Number(s.cambio) || 0) * 100) / 100;
    const dup = dupDi(Object.assign({}, s, { importo_eur: eurNoto }), D.spese || []);
    const chiave = dup.map(d => d.spesa.id).join(",") + "|" + s.importo + "|" + s.data + "|" + s.trasferta;
    if (dup.length && chiave !== dupVisto) { dupVisto = chiave; $("#fDup").innerHTML = avvisoDoppioni(dup); $("#fSave").textContent = o.salvaComunque; $("#fDup").scrollIntoView({ block: "nearest" }); return; }
    await o.onSalva(s);
  });
  if (o.onElimina) $("#fDel").addEventListener("click", o.onElimina);
}

// pre = valori gia' compilati (importo, pagato_da, descrizione): serve a "Registra pagamento",
// che arriva dal compenso con l'importo netto gia' calcolato
// compId = il compenso da cui arriva il pagamento: serve solo per chiedere, dopo il
// salvataggio, se segnarlo saldato (T9)
function formSpesa(id, tripName, forceTipo, pre, compId) {
  const ex = id ? (D.spese || []).find(s => s.id === id) : null;
  const cur = currentTrip();
  // §3.4: la trasferta in corso; se non ce n'e' una, quella le cui date contengono
  // il giorno (con la data di oggi sono la stessa cosa, ma non lo saranno piu' il
  // giorno in cui questo modulo si aprira' su una data diversa).
  const gDate = trasfertaDaData(today());
  const tripDef = tripName || (cur ? cur.nome : "") || (gDate ? gDate.nome : "");
  const valDef = ((D.trasferte || []).find(t => t.nome === tripDef) || {}).valuta || (cur && cur.valuta) || "EUR";
  // La categoria di partenza e' la piu' usata (Vitto, 120 righe su 306): prima era
  // "" e il menu sceglieva da se' la PRIMA della lista, cioe' "Viaggio - Voli",
  // senza dirlo a nessuno. Adesso la pasticca accesa dice quale sara'.
  const catDef = forceTipo === "caddie" ? "Golf - Caddie" : (catTop(1)[0] || "");
  const s = ex ? Object.assign({}, ex) : Object.assign({ data: today(), trasferta: tripDef, categoria: catDef, descrizione: "", importo: "", valuta: valDef, pagato_da: forceTipo === "regolamento" ? "Alessandra" : cfg.who, tipo: forceTipo || "condivisa", n_persone: 2, conto: cfg.who, note: "", cambio: "" }, pre || {});
  const isMov = s.tipo === "caddie" || s.tipo === "regolamento";
  moduloSpesa({
    titolo: `${ex ? "Modifica" : s.tipo === "regolamento" ? "Nuovo" : "Nuova"} ${isMov ? TIPI[s.tipo].toLowerCase() : "spesa"}`,
    s: s, ex: !!ex, conTipo: !isMov, conCategoria: s.tipo !== "regolamento", conNote: true,
    conFile: s.tipo !== "caddie", etichettaFile: s.tipo === "regolamento" ? "Fattura" : "Scontrino",
    notaFile: s.tipo === "regolamento" ? "Finisce in tutte e due le cartelle Drive e in quella del commercialista." : "",
    salva: "Salva", salvaComunque: "Salva comunque",
    onElimina: ex ? (async () => { if (!await chiediConferma("Eliminare questa spesa?", "Sparisce la riga dal foglio. Lo scontrino resta su Drive.", { si: "Elimina", rosso: true })) return; closeModal(); await write("spesa.del", { id: ex.id }, d => { d.spese = d.spese.filter(x => x.id !== ex.id); }); }) : null,
    onSalva: async (s) => {
      if (!s.id) { s.id = uid(); s.creato = new Date().toISOString().slice(0, 19); s.inserito_da = cfg.who; }
      s.modificato = new Date().toISOString().slice(0, 19);
      // stima locale (il server ricalcola col cambio del giorno)
      s.importo_eur = Math.round(s.importo * (s.cambio || 1) * 100) / 100; computeSpesa(s);
      const payload = Object.assign({}, s); if (pendingFile) { payload.file = pendingFile; payload.scontrino = ""; }
      closeModal();
      const res = await write("spesa.save", payload, d => { const i = d.spese.findIndex(x => x.id === s.id); if (i >= 0) d.spese[i] = s; else d.spese.push(s); });
      if (res) { const i = D.spese.findIndex(x => x.id === res.id); if (i >= 0) D.spese[i] = res; LS.set("data", D); render(); toast("Salvato" + (res.valuta !== "EUR" ? ` · ${eur(res.importo_eur)}` : "")); }
      // T9: il pagamento arriva da un compenso -> si CHIEDE se segnarlo saldato.
      // Mai automatico: un acconto chiuderebbe per sbaglio l'intero compenso.
      if (res && compId) await chiediSaldato(compId, s.data);
    },
  });
}

// La conferma di una ricevuta letta dalla posta: stesso modulo della spesa nuova,
// con in testa la mail da cui viene e senza campo file (il PDF ce l'ha gia' lei).
// `pre` (facoltativo) preseleziona dei campi: lo usa Posta per proporre la
// trasferta della carta. Niente entra in Spese senza questo tocco.
function formProposta(id, pre) {
  const p = visibleProp().find(x => x.id === id); if (!p) return;
  const n = propNote(p);
  const gDate = trasfertaDaData(p.data);
  const trip0 = (pre && pre.trasferta) || p.trasferta || (gDate ? gDate.nome : "");
  const s = { data: p.data, trasferta: trip0, categoria: p.categoria || "Altro", descrizione: String(p.vendor || p.descrizione || "").trim(),
              importo: p.importo, valuta: p.valuta || "EUR", tipo: "condivisa", pagato_da: cfg.who, n_persone: 2, conto: cfg.who, cambio: "" };
  moduloSpesa({
    titolo: "Conferma spesa", s: s, ex: false, conTipo: true, conCategoria: true, conNote: false, conFile: false,
    aiuto: "Il PDF viene rinominato con la convenzione solita e spostato nella cartella della trasferta.",
    salva: "Crea la spesa", salvaComunque: "Crea comunque",
    testa: `<div class="card small"><b>${esc(p.oggetto)}</b><div class="muted">${esc(p.mittente)} · ${fmtDY(p.data_email)}</div>
      ${n.evidenza ? `<div class="dett">letto da: "${esc(n.evidenza)}"</div>` : ""}
      ${rigaCarta(p)}
      ${rigaRilettura(p)}
      ${p.file_url ? `<a href="${esc(p.file_url)}" target="_blank" rel="noopener">🧾 apri il PDF allegato</a>` : n.pdf ? `<div class="muted">PDF nella mail ma non salvato</div>` : `<div class="muted">Nessun allegato: la spesa resterà senza scontrino</div>`}
      ${n.link ? ` · <a href="${esc(n.link)}" target="_blank" rel="noopener">apri la mail del fornitore</a>` : ""}</div>`,
    onSalva: async (s) => {
      const payload = { id: p.id, importo: s.importo, valuta: s.valuta, data: s.data, trasferta: s.trasferta,
                        categoria: s.categoria, descrizione: s.descrizione, tipo: s.tipo, pagato_da: s.pagato_da,
                        n_persone: s.n_persone, conto: cfg.who };
      closeModal(); toast("Creo la spesa…");
      try {
        const r = await api("proposta.conferma", payload);
        const i = (D.proposte || []).findIndex(x => x.id === p.id); if (i >= 0) D.proposte[i] = r.proposta;
        const j = (D.spese || []).findIndex(x => x.id === r.spesa.id); if (j >= 0) D.spese[j] = r.spesa; else (D.spese = D.spese || []).push(r.spesa);
        LS.set("data", D); render();
        toast("Spesa creata" + (r.spesa.scontrino ? " · scontrino archiviato" : ""), 4000);
      } catch (e) { toast("Errore: " + e.message, 5000); }
    },
  });
}

async function prepFile(f) {
  const isImg = /^image\//.test(f.type);
  if (!isImg) return { name: f.name, mime: f.type, base64: await toB64(f) };
  const bmp = await createImageBitmap(f); const max = 1600; const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL("image/jpeg", 0.82);
  return { name: f.name.replace(/\.[^.]+$/, "") + ".jpg", mime: "image/jpeg", base64: dataUrl.split(",")[1] };
}
const toB64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });

// ---------------------------------------------------------------- FORM TRASFERTA
function formTrip(id, preset) {
  const ex = id ? (D.trasferte || []).find(t => t.id === id) : null;
  const t = ex ? Object.assign({}, ex) : Object.assign({ nome: "", inizio: today(), fine: today(), citta: "", paese: "", valuta: "EUR", fuso: "", note: "", budget: "", tipo: "torneo", intercontinentale: "" }, preset || {});
  const vals = D.settings.valute || ["EUR"];
  openModal(`<h2 style="margin-top:0">${ex ? "Modifica" : "Nuova"} trasferta</h2>
    <div class="field"><label>Nome (es. Irish Open 2027)</label><input id="tNome" value="${esc(t.nome)}"></div>
    <div class="cols"><div class="field"><label>Tipo</label><select id="tTipo">${Object.keys(TIPI_T).map(k => `<option value="${k}" ${(t.tipo || "torneo") === k ? "selected" : ""}>${TIPI_T[k]}</option>`).join("")}</select></div>
      <div class="field"><label>Intercontinentale</label><select id="tInter"><option value="" ${t.intercontinentale !== "si" ? "selected" : ""}>No (Europa, Arabia, Marocco)</option><option value="si" ${t.intercontinentale === "si" ? "selected" : ""}>Sì (fuori Europa, escluse Arabia e Marocco)</option></select></div></div>
    <div class="cols"><div class="field"><label>Arrivo / inizio</label><input id="tIni" type="date" value="${esc(t.inizio)}"></div><div class="field"><label>Partenza / fine</label><input id="tFine" type="date" value="${esc(t.fine)}"></div></div>
    <div class="cols"><div class="field"><label>Città</label><input id="tCitta" value="${esc(t.citta)}"></div><div class="field"><label>Paese</label><input id="tPaese" value="${esc(t.paese)}"></div></div>
    <div class="cols"><div class="field"><label>Valuta locale</label><select id="tVal">${[...new Set([t.valuta, ...vals])].map(v => `<option ${v === t.valuta ? "selected" : ""}>${v}</option>`).join("")}</select></div><div class="field"><label>Budget € (opz.)</label><input id="tBud" inputmode="decimal" value="${esc(t.budget)}"></div></div>
    <div class="field"><label>Fuso orario (opz., es. UTC+3)</label><input id="tFuso" value="${esc(t.fuso)}"></div>
    <div class="field"><label>Note (indirizzo alloggio, targa auto, contatti…)</label><textarea id="tNote">${esc(t.note)}</textarea></div>
    <div class="muted" style="margin-bottom:10px">Salvando viene creato/aggiornato l'evento nel calendario condiviso "Trasferte".</div>
    <div class="row" style="gap:8px"><button class="btn primary grow" id="tSave">Salva</button><button class="btn" onclick="closeModal()">Annulla</button></div>`);
  $("#tSave").addEventListener("click", async () => {
    t.nome = $("#tNome").value.trim(); t.inizio = $("#tIni").value; t.fine = $("#tFine").value; t.citta = $("#tCitta").value.trim(); t.paese = $("#tPaese").value.trim(); t.valuta = $("#tVal").value; t.budget = $("#tBud").value.replace(",", ".") || ""; t.fuso = $("#tFuso").value.trim(); t.note = $("#tNote").value.trim(); t.tipo = $("#tTipo").value; t.intercontinentale = $("#tInter").value;
    if (!t.nome) return toast("Dai un nome alla trasferta"); if (t.fine < t.inizio) return toast("La fine è prima dell'inizio");
    t.anno = t.inizio.slice(0, 4); const isNew = !t.id; if (isNew) t.id = uid();
    closeModal();
    const res = await write("trasferta.save", t, d => { const i = d.trasferte.findIndex(x => x.id === t.id); if (i >= 0) d.trasferte[i] = t; else { d.trasferte.push(t); templateChecklist(t.tipo).forEach((v, k) => d.checklist.push({ id: uid(), trasferta_id: t.id, voce: v, stato: "da_fare", link: "", codice: "", chi: "", note: "", ordine: k + 1, _tmp: true })); } });
    if (isNew) go("trip", t.id);
    if (res) { const i = D.trasferte.findIndex(x => x.id === res.trasferta.id); if (i >= 0) D.trasferte[i] = res.trasferta; if (res.checklist && res.checklist.length) { D.checklist = D.checklist.filter(c => !(c.trasferta_id === t.id && c._tmp)).concat(res.checklist); } LS.set("data", D); render(); }
  });
}
async function delTrip(id) {
  const t = (D.trasferte || []).find(x => x.id === id);
  if (!await chiediConferma("Eliminare la trasferta?", `${t ? "<b>" + esc(t.nome) + "</b> e la sua" : "La scheda e la"} checklist spariscono, e con loro l'evento nel calendario. <b>Le spese restano</b>: sono legate al nome, e la trasferta tornerà nell'elenco come carta tratteggiata, senza scheda.`, { si: "Elimina", rosso: true })) return;
  await write("trasferta.del", { id }, d => { d.trasferte = d.trasferte.filter(t => t.id !== id); d.checklist = d.checklist.filter(c => c.trasferta_id !== id); });
  go("trasferte");
}
function duplicaTrip(id) {
  const t = (D.trasferte || []).find(x => x.id === id); if (!t) return;
  const shift = s => { const d = new Date(s + "T00:00:00"); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); };
  const y = String(Number(t.anno || t.inizio.slice(0, 4)) + 1);
  formTrip(null, { nome: /\b20\d\d\b/.test(t.nome) ? t.nome.replace(/\b20\d\d\b/, y) : t.nome + " " + y, inizio: shift(t.inizio), fine: shift(t.fine), citta: t.citta, paese: t.paese, valuta: t.valuta, fuso: t.fuso, note: t.note, budget: t.budget, tipo: t.tipo, intercontinentale: t.intercontinentale });
}

// La checklist con cui nasce una trasferta, per tipo (Q4). Il server fa lo stesso
// conto (templateChecklist_): qui serve a vederla subito, prima della risposta, e
// alla pagina Impostazioni. Il ripiego su checklist_template copre un boot vecchio.
function templateChecklist(tipo) {
  const s = D.settings || {}, k = String(tipo || "torneo").toLowerCase();
  if (k === "torneo") return s.checklist_template_torneo || s.checklist_template || [];
  if (k === "qualifica") return s.checklist_template_qualifica || [];
  return [];
}

// ---------------------------------------------------------------- CHECKLIST
// Sposta una voce di una posizione e rinumera tutta la checklist della trasferta.
async function spostaCheck(tripId, id, dir) {
  const cs = tripChecks(tripId);
  const i = cs.findIndex(c => c.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= cs.length) return;
  const arr = cs.slice(); const [x] = arr.splice(i, 1); arr.splice(j, 0, x);
  const ids = arr.map(c => c.id);
  await write("check.ordina", { ids }, d => {
    ids.forEach((cid, k) => { const c = (d.checklist || []).find(y => y.id === cid); if (c) c.ordine = k + 1; });
  });
}

// La spunta (Q3): un tocco = una scrittura, ed e' quella che volevi. Prima il
// cerchio girava su quattro stati e ogni giro era una scrittura — tre sbagliate
// per rimediare a una. Il valore scritto per "fatto" e' "pagato", lo stesso che
// il foglio ha sempre avuto: check.save non cambia.
async function segnaCheck(id, fatto) {
  const c = (D.checklist || []).find(x => x.id === id); if (!c) return;
  c.stato = fatto ? "pagato" : "da_fare";
  await write("check.save", Object.assign({}, c), () => {});
}
// I tre stati che si scelgono nel foglietto. "prenotato" non si sceglie piu':
// una voce vecchia che ce l'ha accende "Fatto" e, se non la si tocca, lo tiene.
const STATI_SCELTA = { da_fare: "Da fare", pagato: "Fatto", na: "Non serve" };
function formCheck(id, tripId) {
  const ex = id ? (D.checklist || []).find(c => c.id === id) : null;
  const c = ex ? Object.assign({}, ex) : { trasferta_id: tripId, voce: "", stato: "da_fare", link: "", codice: "", chi: "", note: "", ordine: tripChecks(tripId).length + 1 };
  const accesa = k => (k === "pagato" ? fattoCheck(c) : c.stato === k) ? "on" : "";
  const cs = ex ? tripChecks(ex.trasferta_id) : [], pos = ex ? cs.findIndex(x => x.id === ex.id) : -1;
  openModal(`<h2 style="margin-top:0">${ex ? "Voce checklist" : "Nuova voce"}</h2>
    <div class="field"><label>Cosa</label><input id="cVoce" value="${esc(c.voce)}" placeholder="es. Volo andata"></div>
    <div class="field"><label>Stato</label><div class="seg" id="segSt">${Object.keys(STATI_SCELTA).map(k => `<button data-v="${k}" class="${accesa(k)}">${STATI_SCELTA[k]}</button>`).join("")}</div></div>
    <div class="field"><label>Link prenotazione</label><input id="cLink" value="${esc(c.link)}" placeholder="https://…" inputmode="url"></div>
    <div class="cols"><div class="field"><label>Codice / PNR</label><input id="cCod" value="${esc(c.codice)}"></div><div class="field"><label>Se ne occupa</label><select id="cChi"><option value="">—</option>${PERSONE.map(p => `<option ${c.chi === p ? "selected" : ""}>${p}</option>`).join("")}</select></div></div>
    <div class="field"><label>Note</label><input id="cNote" value="${esc(c.note)}"></div>
    ${ex && cs.length > 1 ? `<div class="field"><label>Posizione nella checklist</label><div class="ord"><button class="obtn" id="cSu" ${pos <= 0 ? "disabled" : ""}>▲</button><button class="obtn" id="cGiu" ${pos >= cs.length - 1 ? "disabled" : ""}>▼</button><span class="muted" id="cPos">${pos + 1} di ${cs.length}</span></div></div>` : ""}
    <div class="row" style="gap:8px"><button class="btn primary grow" id="cSave">Salva</button>${ex ? `<button class="btn danger" id="cDel">Elimina</button>` : ""}<button class="btn" onclick="closeModal()">Annulla</button></div>`);
  $("#segSt").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; $("#segSt").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); c.stato = b.dataset.v; });
  // ▲▼ scrivono subito (check.ordina, come prima) e il foglietto resta aperto: si
  // aggiorna solo il numero. c.ordine segue, se no Salva riporterebbe la voce dov'era.
  if (ex && cs.length > 1) ["cSu", "cGiu"].forEach((bid, i) => $("#" + bid).addEventListener("click", async () => {
    await spostaCheck(ex.trasferta_id, ex.id, i ? 1 : -1);
    const arr = tripChecks(ex.trasferta_id), p = arr.findIndex(x => x.id === ex.id);
    c.ordine = p + 1;
    if ($("#cPos")) { $("#cPos").textContent = `${p + 1} di ${arr.length}`; $("#cSu").disabled = p <= 0; $("#cGiu").disabled = p >= arr.length - 1; }
  }));
  $("#cSave").addEventListener("click", async () => {
    c.voce = $("#cVoce").value.trim(); c.link = $("#cLink").value.trim(); c.codice = $("#cCod").value.trim(); c.chi = $("#cChi").value; c.note = $("#cNote").value.trim();
    if (!c.voce) return toast("Scrivi cosa"); if (c.link && !/^https?:\/\//i.test(c.link)) c.link = "https://" + c.link;
    if (!c.id) c.id = uid(); closeModal();
    await write("check.save", Object.assign({}, c), d => { const i = d.checklist.findIndex(x => x.id === c.id); if (i >= 0) d.checklist[i] = c; else d.checklist.push(c); });
  });
  if (ex) $("#cDel").addEventListener("click", async () => { closeModal(); await write("check.del", { id: ex.id }, d => { d.checklist = d.checklist.filter(x => x.id !== ex.id); }); });
}

// ---------------------------------------------------------------- NOTE SEDE
function formNota(chiave) {
  const n = (D.note || []).find(x => x.chiave === chiave) || { chiave, testo: "" };
  openModal(`<h2 style="margin-top:0">Note: ${esc(chiave)}</h2><div class="field"><textarea id="nTesto" style="min-height:160px">${esc(n.testo)}</textarea></div><div class="row" style="gap:8px"><button class="btn primary grow" id="nSave">Salva</button><button class="btn" onclick="closeModal()">Annulla</button></div>`);
  $("#nSave").addEventListener("click", async () => { const testo = $("#nTesto").value; closeModal(); await write("nota.save", { chiave, testo }, d => { const i = d.note.findIndex(x => x.chiave === chiave); if (i >= 0) d.note[i].testo = testo; else d.note.push({ id: uid(), chiave, testo }); }); });
}

// ---------------------------------------------------------------- DOCUMENTI
function formDoc(id) {
  const ex = id ? (D.documenti || []).find(x => x.id === id) : null;
  const d = ex ? Object.assign({}, ex) : { nome: "", persona: cfg.who, url: "", scadenza: "", note: "" };
  pendingFile = null;
  openModal(`<h2 style="margin-top:0">${ex ? "Documento" : "Nuovo documento"}</h2>
    <div class="field"><label>Nome</label><input id="dNome" value="${esc(d.nome)}" placeholder="es. Passaporto, Licenza caddie, ESTA…"></div>
    <div class="cols"><div class="field"><label>Di chi</label><select id="dChi">${[...PERSONE, "Team"].map(p => `<option ${d.persona === p ? "selected" : ""}>${p}</option>`).join("")}</select></div><div class="field"><label>Scadenza</label><input id="dScad" type="date" value="${esc(d.scadenza)}"></div></div>
    <div class="field"><label>File (foto/PDF) ${d.url ? `· <a href="${esc(d.url)}" target="_blank" rel="noopener">apri attuale</a>` : ""}</label><input id="dFile" type="file" accept="image/*,application/pdf"></div>
    <div class="field"><label>oppure link</label><input id="dUrl" value="${esc(d.url)}" inputmode="url"></div>
    <div class="field"><label>Note (numero, dove si trova l'originale…)</label><input id="dNote" value="${esc(d.note)}"></div>
    <div class="row" style="gap:8px"><button class="btn primary grow" id="dSave">Salva</button>${ex ? `<button class="btn danger" id="dDel">Elimina</button>` : ""}<button class="btn" onclick="closeModal()">Annulla</button></div>`);
  $("#dFile").addEventListener("change", async () => { const f = $("#dFile").files[0]; if (f) pendingFile = await prepFile(f); });
  $("#dSave").addEventListener("click", async () => {
    d.nome = $("#dNome").value.trim(); d.persona = $("#dChi").value; d.scadenza = $("#dScad").value; d.url = $("#dUrl").value.trim(); d.note = $("#dNote").value.trim();
    if (!d.nome) return toast("Dai un nome"); if (!d.id) d.id = uid(); closeModal();
    const payload = Object.assign({}, d); if (pendingFile) payload.file = pendingFile;
    const res = await write("doc.save", payload, x => { const i = x.documenti.findIndex(y => y.id === d.id); if (i >= 0) x.documenti[i] = d; else x.documenti.push(d); });
    if (res) { const i = D.documenti.findIndex(y => y.id === res.id); if (i >= 0) D.documenti[i] = res; LS.set("data", D); render(); }
  });
  if (ex) $("#dDel").addEventListener("click", async () => { if (!await chiediConferma("Eliminare il documento?", `<b>${esc(ex.nome)}</b> sparisce dall'elenco. Il file su Drive resta dov'è.`, { si: "Elimina", rosso: true })) return; closeModal(); await write("doc.del", { id: ex.id }, x => { x.documenti = x.documenti.filter(y => y.id !== ex.id); }); });
}

// ---------------------------------------------------------------- avvio
(function init() {
  // configurazione via link: index.html#api=...&k=...
  const src = location.hash.includes("api=") ? location.hash.slice(1) : (location.search.includes("api=") ? location.search.slice(1) : "");
  if (src) { const h = new URLSearchParams(src); if (h.get("api")) cfg.api = h.get("api"); if (h.get("k")) cfg.token = h.get("k"); LS.set("cfg", cfg); history.replaceState(null, "", location.pathname); }
  render();
  if (cfg.api && cfg.token) { flushQueue().then(() => reload(true)); }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
