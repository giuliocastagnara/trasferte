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
let checkOrdina = false;                      // modalità "riordina checklist" nella pagina trasferta
const PERSONE = ["Giulio", "Alessandra"];
const STATI = { da_fare: { ico: "", lab: "Da fare" }, prenotato: { ico: "📅", lab: "Prenotato" }, pagato: { ico: "✓", lab: "Pagato" }, na: { ico: "–", lab: "Non serve" } };
const TIPI = { condivisa: "Condivisa", ciascuno: "Ognuno la sua parte", personale: "Personale", caddie: "Compenso caddie", regolamento: "Pagamento" };
const CATS_COLORS = ["--s1","--s2","--s3","--s4","--s5","--s6","--s7","--s8"];

// ---------------------------------------------------------------- util
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = n => (Number(n) || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const num = (n, d = 2) => (Number(n) || 0).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d });
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
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });

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
function boxLibri(s, eurImp) {
  const noto = (Number(eurImp) || 0) > 0;
  const c = computeSpesa({ importo_eur: Number(eurImp) || 0, n_persone: s.n_persone, tipo: s.tipo,
                           pagato_da: s.pagato_da, conto: s.tipo === "personale" ? (s.conto || cfg.who) : "" });
  const riga = (lab, val) => `<div class="brow"><span>${lab}</span><b>${noto ? eur(val) : "\u2014"}</b></div>`;
  const mio = p => p + (cfg.who === p ? " (tu)" : "");
  return `<div class="bhead">Che cosa fa questa spesa</div>
    ${riga("Libri " + mio("Alessandra"), c.libri_ale)}
    ${riga("Libri " + mio("Giulio"), c.libri_giulio)}
    <div class="brow"><span>Saldo</span><b>${noto ? esc(saldoIo(c.saldo)) : "\u2014"}</b></div>
    <p class="bnote">${esc(TIPO_NOTA[s.tipo] || "")}</p>
    ${noto ? "" : `<p class="bnote">Scrivi l'importo per vedere le cifre.</p>`}`;
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
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("active", b.dataset.v === view));
  setNet();
  const map = { prenotazioni: vPrenotazioni, proposte: vProposte, compensi: vCompensi, oggi: vOggi, trasferte: vTrasferte, trip: vTrip, spese: vSpese, saldo: vSaldo, altro: vAltro, dashboard: vDashboard, documenti: vDocumenti, impostazioni: vImpostazioni };
  $("#view").innerHTML = (map[view] || vOggi)();
  const mainEl = document.querySelector("main"); if (mainEl) mainEl.scrollTop = 0; window.scrollTo(0, 0);
}
function go(v, arg) { if (v !== "trip" || arg !== viewArg) checkOrdina = false; view = v; viewArg = arg; render(); }
document.querySelectorAll("#nav button").forEach(b => b.addEventListener("click", () => { if (b.dataset.v === "add") return formSpesa(); go(b.dataset.v); }));
$("#whoBtn").addEventListener("click", () => toast("Sei collegato come " + cfg.who + " (dipende dal token)"));

// ---- setup iniziale
function renderSetup() {
  $("#view").innerHTML = `
    <h1>Benvenuto 👋</h1>
    <div class="card">
      <p class="small">Incolla il link personale che hai ricevuto (contiene indirizzo e token: il token dice all'app chi sei).</p>
      <div class="field"><label>URL API (…/exec) — oppure incolla qui il link completo ricevuto</label><input id="inApi" value="${esc(cfg.api)}" placeholder="https://script.google.com/macros/s/…/exec"></div>
      <div class="field"><label>Token</label><input id="inTok" value="${esc(cfg.token)}"></div>
      <button class="btn primary block" id="saveCfg">Collega</button>
    </div>`;
  $("#saveCfg").addEventListener("click", async () => {
    let apiIn = $("#inApi").value.trim(), tokIn = $("#inTok").value.trim();
    const m = apiIn.match(/api=([^&\s]+)/); if (m) { apiIn = decodeURIComponent(m[1]); const k = $("#inApi").value.match(/[#&]k=([^&\s]+)/); if (k) tokIn = k[1]; }
    cfg.api = apiIn; cfg.token = tokIn;
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(cfg.api)) return toast("L'URL API deve essere quello di Apps Script che finisce con /exec", 4000);
    if (!cfg.token) return toast("Manca il token");
    LS.set("cfg", cfg); toast("Collego…"); await reload(false); render();
  });
}

// ---- OGGI
function vOggi() {
  const t = currentTrip(); const nxt = nextTrips().slice(0, 3); const s = saldoTot();
  let h = `<h1>Ciao ${cfg.who} 👋</h1>`;
  if (t) {
    const cs = checkSummary(t.id), tot = tripTotals(t.nome);
    h += `<div class="card hero tap" onclick="go('trip','${t.id}')">
      <div class="muted">Trasferta in corso</div>
      <div class="big">${esc(t.nome)}</div>
      <div class="row between" style="margin-top:6px"><span>${fmtD(t.inizio)} → ${fmtD(t.fine)} ${t.citta ? "· " + esc(t.citta) : ""}</span><span class="pill">${t.valuta || "EUR"}</span></div>
      <div class="row between" style="margin-top:10px"><span>Checklist ${cs.done}/${cs.tot}</span><span>Spese: ${eur(tot.mio)}</span></div>
      ${cs.open.length ? `<div class="muted" style="margin-top:6px">Da fare: ${cs.open.map(c => esc(c.voce)).join(", ")}</div>` : ""}
    </div>`;
  } else {
    h += `<div class="card"><div class="muted">Nessuna trasferta in corso</div>${nxt[0] ? `<div>Prossima: <b>${esc(nxt[0].nome)}</b> dal ${fmtDY(nxt[0].inizio)}</div>` : `<div>Aggiungi la prossima trasferta 👇</div>`}</div>`;
  }
  const nPren = (D.prenotazioni || []).filter(p => p.stato === "nuova").length;
  if (nPren) h += `<div class="card tap" onclick="go('prenotazioni')"><div class="row between"><div><b>📧 ${nPren} prenotazioni trovate nella mail</b><div class="muted">Tocca per collegarle alla checklist</div></div><span>›</span></div></div>`;
  const nProp = proposteNuove().length;
  if (nProp) h += `<div class="card tap" onclick="go('proposte')"><div class="row between"><div class="grow"><b>💳 ${nProp} propost${nProp === 1 ? "a" : "e"} di spesa</b><div class="muted">Ricevute trovate nella mail, da confermare una a una</div></div><span class="pill warn">${nProp}</span><span>›</span></div></div>`;
  // Promemoria scontrini: solo le MIE spese dell'anno in corso a cui manca la foto
  const annoOra = today().slice(0, 4), meseOra = today().slice(0, 7);
  const noSc = mieSpese().filter(x => !x.scontrino && String(x.data).slice(0, 4) === annoOra);
  const noScMese = noSc.filter(x => String(x.data).slice(0, 7) === meseOra).length;
  if (noSc.length) h += `<div class="card tap" onclick="apriSenzaScontrino('${annoOra}')"><div class="row between"><div class="grow"><b>🧾 Scontrini mancanti</b><div class="muted">${noSc.length} spes${noSc.length === 1 ? "a" : "e"} senza foto nel ${annoOra}${noScMese ? ` · ${noScMese} di questo mese` : ""}</div></div><span class="pill ${noScMese ? "bad" : "warn"}">${noSc.length}</span><span>›</span></div></div>`;
  h += `<div class="card tap" onclick="go('saldo')"><div class="row between"><div><div class="muted">Conto tra voi</div><div style="font-weight:700;font-size:18px">${saldoLabel(s)}</div></div><span>›</span></div></div>`;
  if (nxt.length) {
    h += `<h2>Prossime trasferte</h2>`;
    nxt.forEach(x => { const cs = checkSummary(x.id); const days = Math.round((new Date(x.inizio) - new Date(today())) / 864e5);
      h += `<div class="card tap" onclick="go('trip','${x.id}')"><div class="row between"><div class="grow"><b>${esc(x.nome)}</b><div class="muted">${fmtDY(x.inizio)} → ${fmtDY(x.fine)} · tra ${days} gg</div></div>
        <span class="pill ${cs.open.length ? (days < 14 ? "bad" : "warn") : ""}">${cs.open.length ? cs.open.length + " da fare" : "✓ pronta"}</span></div></div>`; });
  }
  const recent = visibleSpese().slice().sort((a, b) => (b.creato || "") < (a.creato || "") ? -1 : 1).slice(0, 5);
  if (recent.length) { h += `<h2>Ultime spese</h2><div class="card list">` + recent.map(s => itemSpesa(s)).join("") + `</div>`; }
  h += `<button class="btn primary block" onclick="formSpesa()">＋ Aggiungi spesa</button>`;
  return h;
}

function itemSpesa(s, mio) {
  const pieno = Math.round((+s.importo_eur || 0) * 100) / 100, val = mio ? mioImporto(s) : pieno, parz = mio && Math.abs(val - pieno) > 0.005;
  const tag = s.tipo === "condivisa" ? `<span class="pill">condivisa${+s.n_persone > 2 ? " /" + s.n_persone : ""}</span>` : s.tipo === "ciascuno" ? `<span class="pill blue">ognuno la sua</span>` : s.tipo === "personale" ? `<span class="pill grey">${esc(s.conto)}</span>` : s.tipo === "caddie" ? `<span class="pill warn">compenso caddie</span>` : `<span class="pill warn">pagamento</span>`;
  const orig = !parz && s.valuta && s.valuta !== "EUR" ? `<span class="muted">${num(s.importo)} ${esc(s.valuta)}</span> ` : "";
  return `<div class="item tap" onclick="formSpesa('${s.id}')">
    <div class="thumb">${s.scontrino ? "🧾" : "·"}</div>
    <div class="grow"><div class="ellipsis"><b>${esc(s.descrizione || s.categoria)}</b></div><div class="muted ellipsis">${fmtD(s.data)} · ${esc(s.trasferta)} · ${esc(s.categoria)} · ${esc(s.pagato_da)}</div><div>${tag}</div></div>
    <div style="text-align:right">${orig}<div class="amt">${eur(val)}</div>${parz ? `<div class="muted">su ${eur(pieno)}</div>` : ""}</div></div>`;
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
// Colore della carta per tipo di trasferta: torneo resta bianco.
const TIPO_CARD = { qualifica: " t-qualifica", casa: " t-casa", altro: " t-altro" };
const cardCls = tp => TIPO_CARD[String(tp || "").toLowerCase()] || "";
// Trasferte che esistono solo nelle spese: toccandole si crea la scheda,
// cosi' diventano modificabili come tutte le altre. Il nome NON va cambiato:
// le spese sono collegate alla trasferta per nome.
function creaScheda(i) {
  const t = trVirt[i]; if (!t) return;
  toast("Questa trasferta non ha ancora una scheda. Non cambiare il nome: le spese sono collegate per nome.", 5000);
  formTrip(null, { nome: t.nome, inizio: t.inizio, fine: t.fine, tipo: "altro" });
}
function vTrasferte() {
  const all = trasferteVisibili().sort((a, b) => a.inizio < b.inizio ? 1 : -1);
  trVirt = all.filter(t => t.virtuale);
  const years = [...new Set(all.map(t => String(t.anno || (t.inizio || "").slice(0, 4))))].sort().reverse();
  const y = viewArg || years[0] || String(new Date().getFullYear());
  let h = `<div class="row between"><h1>Trasferte</h1><button class="btn sm primary" onclick="formTrip()">＋ Nuova</button></div>
    <div class="filters">${years.map(yy => `<button class="btn sm ${yy === y ? "primary" : ""}" onclick="go('trasferte','${yy}')">${yy}</button>`).join("")}</div>
    <div class="leg trip"><span><i class="t-torneo"></i>Torneo</span><span><i class="t-qualifica"></i>Qualifica</span><span><i class="t-casa"></i>Casa</span><span><i class="t-altro"></i>Altro</span></div>`;
  const list = all.filter(t => String(t.anno || (t.inizio || "").slice(0, 4)) === y);
  if (!list.length) h += `<div class="empty">Nessuna trasferta per il ${y}</div>`;
  list.forEach(t => {
    if (t.virtuale) {
      const tot = tripTotals(t.nome);
      h += `<div class="card tap t-altro" onclick="creaScheda(${trVirt.indexOf(t)})"><div class="row between"><div class="grow"><b>${esc(t.nome)}</b><div class="muted">${fmtDY(t.inizio)} → ${fmtDY(t.fine)}</div></div>
        <div style="text-align:right"><div class="amt">${eur(tot.mio)}</div><div class="muted">${tot.n} spese</div></div></div></div>`;
      return;
    }
    const cs = checkSummary(t.id), tot = tripTotals(t.nome), past = t.fine < today(), cur = currentTrip() && currentTrip().id === t.id;
    h += `<div class="card tap${cardCls(t.tipo)}" onclick="go('trip','${t.id}')"><div class="row between"><div class="grow"><b>${esc(t.nome)}</b> ${cur ? '<span class="pill">in corso</span>' : ""}<div class="muted">${fmtDY(t.inizio)} → ${fmtDY(t.fine)}${t.citta ? " · " + esc(t.citta) : ""}</div></div>
      <div style="text-align:right"><div class="amt">${eur(tot.mio)}</div><div class="muted">${past ? tot.n + " spese" : "checklist " + cs.done + "/" + cs.tot}</div></div></div></div>`;
  });
  return h;
}

function vTrip() {
  const t = (D.trasferte || []).find(x => x.id === viewArg); if (!t) return vTrasferte();
  const cs = tripChecks(t.id), tot = tripTotals(t.nome), ss = tripSpese(t.nome).sort((a, b) => a.data < b.data ? 1 : -1);
  const nota = (D.note || []).find(n => n.chiave === baseName(t.nome));
  const byCat = {}; ss.forEach(s => { if (s.tipo !== "caddie" && s.tipo !== "regolamento") byCat[s.categoria] = (byCat[s.categoria] || 0) + mioImporto(s); });
  let h = `<div class="row"><button class="btn sm" onclick="go('trasferte')">‹</button><h1 class="grow" style="margin:0">${esc(t.nome)}</h1><button class="btn sm" onclick="formTrip('${t.id}')">Modifica</button></div>
    <div class="muted" style="margin:6px 0 12px">${fmtDY(t.inizio)} → ${fmtDY(t.fine)}${t.citta ? " · " + esc(t.citta) : ""}${t.paese ? ", " + esc(t.paese) : ""} · ${t.valuta || "EUR"}${t.fuso ? " · " + esc(t.fuso) : ""}</div>
    ${t.note ? `<div class="card small">${esc(t.note).replace(/\n/g, "<br>")}</div>` : ""}
    <div class="row between"><h2>Checklist</h2><div class="row" style="gap:6px">${cs.length > 1 ? `<button class="btn sm ${checkOrdina ? "primary" : ""}" onclick="toggleOrdinaCheck()">⇅ ${checkOrdina ? "Fatto" : "Ordina"}</button>` : ""}<button class="btn sm" onclick="formCheck(null,'${t.id}')">＋ voce</button></div></div>
    ${checkOrdina ? `<div class="muted" style="margin:-4px 0 8px">Sposta le voci con ▲▼. Tocca "Fatto" per tornare a usare la checklist.</div>` : ""}
    <div class="card">${cs.length ? cs.map((c, i) => `<div class="check ${c.stato}">
        ${checkOrdina
          ? `<div class="ordbtn"><button class="obtn" ${i === 0 ? "disabled" : ""} onclick="spostaCheck('${t.id}','${c.id}',-1)">▲</button><button class="obtn" ${i === cs.length - 1 ? "disabled" : ""} onclick="spostaCheck('${t.id}','${c.id}',1)">▼</button></div>`
          : `<div class="st ${c.stato}" onclick="cycleCheck('${c.id}')">${STATI[c.stato]?.ico || ""}</div>`}
        <div class="grow" ${checkOrdina ? "" : `onclick="formCheck('${c.id}')"`}><div class="name">${esc(c.voce)} ${c.chi ? `<span class="muted">· ${esc(c.chi)}</span>` : ""}</div>
          <div class="muted">${STATI[c.stato]?.lab || ""}${c.codice ? " · " + esc(c.codice) : ""}${c.note ? " · " + esc(c.note) : ""}</div></div>
        ${checkOrdina ? "" : bottoniVoce(c)}
      </div>`).join("") : `<div class="muted">Nessuna voce</div>`}</div>
    ${cs.some(c => prenDiVoce(c.id)) ? `<div class="muted" style="margin:6px 0 0">✉️ apre la mail della prenotazione · 📄 il PDF salvato in Drive, che si apre anche in aereo. Il link del fornitore è nella pagina Prenotazioni.</div>` : ""}
    <h2>Spese</h2>
    <div class="kpis"><div class="kpi"><div class="v">${eur(tot.ale)}</div><div class="l">Alessandra</div></div><div class="kpi"><div class="v">${eur(tot.giu)}</div><div class="l">Giulio</div></div>${t.budget ? `<div class="kpi"><div class="v">${eur(t.budget)}</div><div class="l">Budget · ${pct(tot.ale / t.budget)} usato</div></div>` : ""}</div>
    ${Object.keys(byCat).length ? `<div class="card">${bars(byCat)}</div>` : ""}
    <div class="card list">${ss.length ? ss.map(s => itemSpesa(s, true)).join("") : `<div class="muted">Nessuna spesa</div>`}</div>
    <button class="btn block" onclick="formSpesa(null,'${esc(t.nome)}')">＋ Spesa per questa trasferta</button>
    ${bookingsSection(t)}
    <h2>Note sede <span class="muted">(${esc(baseName(t.nome))}, valide ogni anno)</span></h2>
    <div class="card" onclick="formNota('${esc(baseName(t.nome))}')">${nota && nota.testo ? esc(nota.testo).replace(/\n/g, "<br>") : `<span class="muted">Hotel che vi è piaciuto, distanza dal campo, dove fare la spesa… tocca per scrivere</span>`}</div>
    <div class="row" style="margin-top:14px;gap:8px"><button class="btn grow" onclick="duplicaTrip('${t.id}')">Duplica per l'anno prossimo</button><button class="btn danger" onclick="delTrip('${t.id}')">Elimina</button></div>`;
  return h;
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
  go("spese");
}

// ---- SPESE (lista con filtri)
// La pagina mostra SOLO le spese che compongono la carta "Spese <chi guarda>" della dashboard:
// le mie personali + le condivise / ognuno-la-sua (per Giulio la sua quota, per Alessandra
// l’intero, come mioImporto). Restano fuori le personali dell’altro (già filtrate dal server),
// i compensi caddie e i pagamenti fra loro due: quelli si vedono in "Conto tra voi".
const mieSpese = () => visibleSpese().filter(s => s.tipo !== "caddie" && s.tipo !== "regolamento" && Math.abs(mioImporto(s)) > 0.004);
let fSp = { q: "", trip: "", tipo: "", cat: "", anno: "", noScont: false };
function vSpese() {
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
  // se un filtro punta a un valore che nell’anno scelto non esiste, lo lascio cadere
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
  const nota = cfg.who === "Giulio"
    ? "Solo le tue spese, come nella carta \u201cSpese Giulio\u201d: la tua quota delle condivise. Compensi e pagamenti sono in Conto tra voi."
    : "Solo le tue spese, come nella carta \u201cSpese Alessandra\u201d: le tue e le condivise per intero. Compensi e pagamenti sono in Conto tra voi.";
  let h = `<h1>Spese</h1>
    <div class="card fbox">
      <input class="fq" placeholder="Cerca descrizione, categoria, trasferta\u2026" value="${esc(fSp.q)}" oninput="fSp.q=this.value;render()">
      <div class="fgrid">
        <label class="fcell"><span>Anno</span><select onchange="fSp.anno=this.value;render()">${years.length ? years.map(y => `<option ${y === fSp.anno ? "selected" : ""}>${y}</option>`).join("") : `<option value="">\u2014</option>`}</select></label>
        <label class="fcell"><span>Tipo</span><select onchange="fSp.tipo=this.value;render()"><option value="">Tutti i tipi</option>${tipi.map(k => `<option value="${k}" ${k === fSp.tipo ? "selected" : ""}>${TIPI[k]}</option>`).join("")}</select></label>
        <label class="fcell"><span>Trasferta</span><select onchange="fSp.trip=this.value;render()"><option value="">Tutte le trasferte</option>${trips.map(t => `<option ${t === fSp.trip ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
        <label class="fcell"><span>Categoria</span><select onchange="fSp.cat=this.value;render()"><option value="">Tutte le categorie</option>${cats.map(c => `<option ${c === fSp.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
      </div>
      <div class="frow">
        <button class="btn sm ${fSp.noScont ? "primary" : ""}" onclick="fSp.noScont=!fSp.noScont;render()">\ud83e\uddfe Senza scontrino</button>
        ${attivi ? `<button class="btn sm" onclick="fSp.q='';fSp.trip='';fSp.tipo='';fSp.cat='';fSp.noScont=false;render()">\u2715 Azzera filtri</button>` : ""}
      </div>
    </div>
    <div class="row between" style="margin-bottom:2px"><span class="muted">${list.length} spes${list.length === 1 ? "a" : "e"}${senzaS ? ` \u00b7 ${senzaS} senza scontrino` : ""}</span><span class="amt">${eur(tot)}</span></div>
    <div class="muted small" style="margin-bottom:10px">${nota}</div>`;
  let lastM = ""; let open = false;
  list.forEach(s => { const m = String(s.data).slice(0, 7); if (m !== lastM) { if (open) h += `</div>`; h += `<div class="month row between"><span>${monthName(m + "-01")}</span><span>${eur(byM[m])}</span></div><div class="card list">`; open = true; lastM = m; } h += itemSpesa(s, true); });
  if (open) h += `</div>`;
  if (!list.length) h += `<div class="empty">Nessuna spesa${attivi ? `<br><span class="small">Prova ad azzerare i filtri</span>` : ""}</div>`;
  return h;
}

// ---- SALDO
function vSaldo() {
  const s = saldoTot();
  const mov = visibleSpese().filter(x => Math.abs(+x.saldo || 0) > 0.004).sort((a, b) => a.data < b.data ? 1 : -1);
  const byTrip = {}; mov.forEach(x => byTrip[x.trasferta] = (byTrip[x.trasferta] || 0) + (+x.saldo));
  let h = `<h1>Conto tra voi</h1>
    <div class="card hero"><div class="muted">Saldo attuale</div><div class="big">${saldoLabel(s)}</div>
      <div class="muted" style="margin-top:6px">Le spese condivise pagate da uno creano il debito della quota dell'altro; i compensi caddie vanno a credito di Giulio; i pagamenti azzerano.</div></div>
    <div class="row" style="gap:8px"><button class="btn grow" onclick="go('compensi')">💶 Compensi</button><button class="btn grow primary" onclick="formSpesa(null,null,'regolamento')">＋ Registra pagamento</button></div>
    <h2>Per trasferta</h2><div class="card">${Object.keys(byTrip).sort((a, b) => Math.abs(byTrip[b]) - Math.abs(byTrip[a])).map(k => `<div class="row between" style="padding:6px 0"><span class="ellipsis">${esc(k)}</span><span class="amt" style="color:${byTrip[k] > 0 ? "var(--good)" : "var(--bad)"}">${byTrip[k] > 0 ? "+" : ""}${eur(byTrip[k])}</span></div>`).join("") || `<div class="muted">Nessun movimento</div>`}</div>
    <h2>Movimenti <span class="muted">(+ = Ale deve a Giulio)</span></h2><div class="card list">${mov.slice(0, 200).map(x => `<div class="item tap" onclick="formSpesa('${x.id}')"><div class="grow"><div class="ellipsis"><b>${esc(x.descrizione)}</b> <span class="pill ${x.tipo === "caddie" ? "warn" : x.tipo === "regolamento" ? "blue" : ""}">${TIPI[x.tipo]}</span></div><div class="muted">${fmtDY(x.data)} · ${esc(x.trasferta)} · ha pagato ${esc(x.pagato_da)}${x.tipo === "condivisa" ? " · tot " + eur(x.importo_eur) + " /" + x.n_persone : ""}</div></div><div class="amt" style="color:${x.saldo > 0 ? "var(--good)" : "var(--bad)"}">${x.saldo > 0 ? "+" : ""}${eur(x.saldo)}</div></div>`).join("")}</div>`;
  return h;
}

// ---- ALTRO
function vAltro() {
  return `<h1>Altro</h1>
    <div class="card tap" onclick="go('compensi')"><b>💶 Compensi caddie</b><div class="muted">Settimane, montepremi, cosa resta da bonificare</div></div>
    <div class="card tap" onclick="go('prenotazioni')"><b>📧 Prenotazioni email</b><div class="muted">${(D.prenotazioni || []).filter(p => p.stato === "nuova").length} da collegare alla checklist</div></div>
    <div class="card tap" onclick="go('proposte')"><b>💳 Proposte di spesa</b><div class="muted">${proposteNuove().length} ricevute dalla mail da confermare</div></div>
    <div class="card tap" onclick="go('dashboard')"><b>📊 Dashboard</b><div class="muted">Totali per trasferta, categoria e mese</div></div>
    <div class="card tap" onclick="go('documenti')"><b>🪪 Documenti</b><div class="muted">Passaporti, licenze, visti, assicurazioni</div></div>
    <div class="card tap" onclick="go('impostazioni')"><b>⚙️ Impostazioni</b><div class="muted">Categorie, checklist, report per il commercialista</div></div>
    <div class="card tap" onclick="reload()"><b>🔄 Ricarica dati</b><div class="muted">${queue.length ? queue.length + " modifiche in attesa di invio" : "Tutto sincronizzato"}</div></div>`;
}

// ---- DASHBOARD
// Entrate (guadagni) dell'anno per chi sta guardando:
//  - Giulio      -> compenso caddie = fisso + % montepremi + extra                   (campo "totale")
//  - Alessandra  -> montepremi vinto sul LET                                        (campo "montepremi")
// La data usata e' la fine della trasferta collegata (in mancanza, l'inizio).
function entrateAnno(y) {
  const byId = {}; (D.trasferte || []).forEach(t => byId[t.id] = t);
  return (D.compensi || []).map(c => {
    const t = byId[c.trasferta_id];
    const nome = c.trasferta || (t ? t.nome : "—");
    const data = String((t && (t.fine || t.inizio)) || c.pagato_il || c.creato || "").slice(0, 10);
    const val = Math.round((cfg.who === "Giulio" ? (+c.totale || 0) : (+c.montepremi || 0)) * 100) / 100;
    return { nome, data, val };
  }).filter(c => c.val > 0 && c.data.startsWith(y));
}

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

function vDashboard() {
  const all = visibleSpese(); const years = [...new Set(all.map(s => String(s.data).slice(0, 4)))].sort().reverse();
  const y = viewArg || years[0]; const ss = all.filter(s => String(s.data).startsWith(y) && s.tipo !== "regolamento");
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
  const totIn = Math.round(ent.reduce((a, c) => a + c.val, 0) * 100) / 100;
  const totOut = Math.round(Object.keys(byMonth).reduce((a, m) => a + byMonth[m], 0) * 100) / 100;
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
  return `<div class="row"><button class="btn sm" onclick="go('altro')">‹</button><h1 class="grow" style="margin:0">Dashboard</h1><select onchange="go('dashboard',this.value)">${years.map(yy => `<option ${yy === y ? "selected" : ""}>${yy}</option>`).join("")}</select></div>
    <div class="kpis" style="margin-top:12px">
      <div class="kpi"><div class="v">${eur(team.val)}</div><div class="l">Spese Team ${y}${team.esatto ? "" : ` <span class="muted">(solo visibili)</span>`}</div></div>
      <div class="kpi"><div class="v">${eur(totOut)}</div><div class="l">Spese ${esc(cfg.who)}</div></div>
      <div class="kpi"><div class="v in">${eur(totIn)}</div><div class="l">${esc(labIn)} ${y}</div></div>
      <div class="kpi"><div class="v ${totIn - totOut < 0 ? "out" : "in"}">${eur(totIn - totOut)}</div><div class="l">Netto ${y} <span class="muted">(entrate − spese ${esc(cfg.who)})</span></div></div>
    </div>
    <div class="muted small" style="margin:-4px 0 12px">Spese Team: quanto vi è costata la stagione nelle settimane di torneo e qualifica, ogni spesa contata una volta per l'importo pieno.${team.esatto ? "" : " <b>Per ora somma solo le spese visibili da questa app</b>: mancano le personali dell'altra persona."}</div>
    ${ent.length ? "" : `<div class="empty">Nessuna entrata registrata per il ${y}. Le entrate si compilano in <b>Compensi caddie</b>: apri la settimana di torneo e inserisci montepremi e risultato.</div>`}
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
  return `<div class="row"><button class="btn sm" onclick="go('altro')">‹</button><h1 class="grow" style="margin:0">Documenti</h1><button class="btn sm primary" onclick="formDoc()">＋</button></div>
    <div class="card list" style="margin-top:12px">${docs.length ? docs.map(d => `<div class="item"><div class="thumb">🪪</div><div class="grow" onclick="formDoc('${d.id}')"><b>${esc(d.nome)}</b> <span class="pill grey">${esc(d.persona)}</span><div class="muted">${d.scadenza ? "Scade " + fmtDY(d.scadenza) : ""}${soon(d) ? ' <span class="pill bad">in scadenza</span>' : ""}${d.note ? " · " + esc(d.note) : ""}</div></div>${d.url ? `<a class="btn sm" href="${esc(d.url)}" target="_blank" rel="noopener">Apri</a>` : ""}</div>`).join("") : `<div class="muted">Nessun documento. Carica passaporti, licenza caddie, visti, assicurazione…</div>`}</div>`;
}

// ---- IMPOSTAZIONI
function vImpostazioni() {
  const s = D.settings || {};
  return `<div class="row"><button class="btn sm" onclick="go('altro')">‹</button><h1 class="grow" style="margin:0">Impostazioni</h1></div>
    <h2>Report per il commercialista</h2><div class="card"><div class="row" style="gap:8px"><select id="repAnno">${[...new Set((D.spese || []).map(x => String(x.data).slice(0, 4)))].sort().reverse().map(y => `<option>${y}</option>`).join("")}</select><select id="repChi"><option>Alessandra</option><option>Giulio</option></select><button class="btn primary grow" onclick="makeReport()">Genera foglio</button></div><div class="muted" style="margin-top:6px">Crea un Google Sheet con dettaglio + riepilogo per categoria e trasferta.</div></div>
    <h2>Categorie <span class="muted">(una per riga)</span></h2><div class="card"><textarea id="setCat" style="width:100%;min-height:160px;border:1px solid var(--line);border-radius:10px;padding:8px;background:var(--bg)">${esc((s.categorie || []).join("\n"))}</textarea></div>
    <h2>Checklist di default <span class="muted">(una per riga)</span></h2><div class="card"><textarea id="setChk" style="width:100%;min-height:120px;border:1px solid var(--line);border-radius:10px;padding:8px;background:var(--bg)">${esc((s.checklist_template || []).join("\n"))}</textarea></div>
    <h2>Valute <span class="muted">(separate da virgola)</span></h2><div class="card"><input id="setVal" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:8px;background:var(--bg)" value="${esc((s.valute || []).join(", "))}"></div>
    <button class="btn primary block" onclick="saveSettings()">Salva impostazioni</button>
    <h2>Collegamento</h2><div class="card"><div class="field"><label>URL API</label><input id="cfgApi" value="${esc(cfg.api)}"></div><div class="field"><label>Token</label><input id="cfgTok" value="${esc(cfg.token)}"></div><button class="btn block" onclick="cfg.api=$('#cfgApi').value.trim();cfg.token=$('#cfgTok').value.trim();LS.set('cfg',cfg);reload()">Salva e ricollega</button>
    <div class="muted" style="margin-top:8px">Calendario condiviso: ${s.calendar_id ? "attivo" : "non configurato"} · Modifiche in attesa: ${queue.length}</div></div>`;
}
async function saveSettings() {
  const p = { categorie: $("#setCat").value.split("\n").map(x => x.trim()).filter(Boolean), checklist_template: $("#setChk").value.split("\n").map(x => x.trim()).filter(Boolean), valute: $("#setVal").value.split(",").map(x => x.trim().toUpperCase()).filter(Boolean) };
  await write("settings.save", p, d => Object.assign(d.settings, p)); toast("Impostazioni salvate");
}
async function makeReport() {
  toast("Genero il report…", 6000);
  try { const r = await api("report", { anno: $("#repAnno").value, persona: $("#repChi").value }); openModal(`<h2>Report pronto</h2><p>${r.righe} righe · totale ${eur(r.totale)}</p><a class="btn primary block" href="${esc(r.url)}" target="_blank" rel="noopener">Apri il foglio</a>`); }
  catch (e) { toast("Errore: " + e.message, 4000); }
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
  const props = D.proposte || [];
  const id = (notePren(p) || {}).prop_id;
  // prima l'aggancio esplicito; poi il messaggio, perche' le prenotazioni
  // scritte prima di T8 non hanno prop_id ma hanno lo stesso msg_id
  return (id && props.find(x => x.id === id)) ||
         (p.msg_id && props.find(x => x.msg_id === p.msg_id)) || null;
}
// Il bottone della riga. Tre stati: c'e' una spesa da registrare, c'e' gia' ed
// e' registrata (si apre per controllarla), oppure quella mail non ha prodotto
// nessuna proposta e allora non si mostra niente.
function btnSpesaPren(p) {
  const q = propDiPren(p);
  if (!q) return "";
  if (q.stato === "confermata") {
    return q.spesa_id
      ? `<button class="btn sm" onclick="formSpesa('${q.spesa_id}')" title="Spesa gia' registrata: apri per controllarla">\u2713 spesa</button>`
      : `<button class="btn sm" disabled>\u2713 spesa</button>`;
  }
  return `<button class="btn sm primary" onclick="spesaDaPren('${p.id}')" title="Apri la proposta di spesa letta da questa stessa mail">\ud83d\udcb3 Spesa</button>`;
}
// Apre la proposta passando la trasferta della prenotazione: se la proposta non
// ne aveva una (o ne aveva un'altra), quella giusta e' quella appena collegata.
function spesaDaPren(prenId) {
  const p = (D.prenotazioni || []).find(x => x.id === prenId);
  const q = propDiPren(p);
  if (!q) return toast("Da questa mail non e' nata nessuna proposta di spesa", 4000);
  const t = (D.trasferte || []).find(x => x.id === (p || {}).trasferta_id);
  formProposta(q.id, { trasferta: (t && t.nome) || q.trasferta || "" });
}
// Quale prenotazione e' agganciata a una voce di checklist.
function prenDiVoce(voceId) {
  if (!voceId) return null;
  return (D.prenotazioni || []).find(p => p.voce_id === voceId && p.stato === "collegata") || null;
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
function bookingsSection(t) {
  const pren = (D.prenotazioni || []).filter(p => p.trasferta_id === t.id);
  const nuove = pren.filter(p => p.stato === "nuova"), fatte = pren.filter(p => p.stato === "collegata");
  if (!nuove.length && !fatte.length) return "";
  let h = "";
  if (nuove.length) h += `<h2>Trovate nella mail <span class="muted">(${nuove.length})</span></h2><div class="card list">${nuove.map(p => itemPren(p)).join("")}</div>`;
  if (fatte.length) h += `<h2>Già collegate <span class="muted">(${fatte.length})</span></h2>
    <div class="card list">${fatte.map(p => `<div class="item"><div class="thumb">✓</div><div class="grow"><div class="ellipsis">${esc(p.oggetto)}</div><div class="dett">${esc(prenQuando(p))}</div>
      ${p.link || pdfPren(p) ? `<div class="muted">${p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener">sito del fornitore</a>` : ""}${p.link && pdfPren(p) ? " · " : ""}${pdfPren(p) ? `<a href="${esc(pdfPren(p))}" target="_blank" rel="noopener">PDF</a>` : ""}</div>` : ""}</div><button class="btn sm" onclick="scollegaPren('${p.id}')">Scollega</button></div>`).join("")}</div>
    <div class="muted" style="margin-top:6px">"Scollega" la rimette fra quelle da collegare: serve se hai collegato la voce sbagliata o se hai cancellato le note qui sopra.</div>`;
  return h;
}
function itemPren(p) {
  const righe = prenRighe(p);
  return `<div class="item"><div class="thumb">${(TIPO_PREN[p.tipo] || "📧").slice(0, 2)}</div><div class="grow"><div class="ellipsis"><b>${esc(p.oggetto)}</b></div>
    ${righe.length ? righe.map(r => `<div class="dett">${esc(r)}</div>`).join("") : `<div class="dett">${esc(prenQuando(p))}</div>`}
    <div class="muted ellipsis">${esc(p.mittente)}${p.codice ? " · " + esc(p.codice) : ""}${p.importo ? " · " + num(p.importo) + " " + esc(p.valuta) : ""}</div></div><button class="btn sm primary" onclick="formPren('${p.id}')">Collega</button></div>`;
}
function vPrenotazioni() {
  const all = (D.prenotazioni || []).slice().sort((a, b) => a.data_email < b.data_email ? 1 : -1);
  const nuove = all.filter(p => p.stato === "nuova"), fatte = all.filter(p => p.stato === "collegata");
  const ignorate = all.filter(p => p.stato === "ignorata");
  const tripName = id => ((D.trasferte || []).find(t => t.id === id) || {}).nome || "";
  return `<div class="row"><button class="btn sm" onclick="go('altro')">‹</button><h1 class="grow" style="margin:0">Prenotazioni email</h1><button class="btn sm primary" onclick="scanEmail()">Scansiona</button></div>
    <div class="muted" style="margin:8px 0 12px">Legge le conferme di voli, hotel, auto e treni dalla Gmail di Giulio (anche quelle inoltrate da Alessandra) ogni 6 ore. "Collega" mette link, codice e date nella voce giusta della checklist.</div>
    <h2>Da collegare <span class="muted">(${nuove.length})</span></h2><div class="card list">${nuove.length ? nuove.map(p => { const righe = prenRighe(p); return `<div class="item"><div class="thumb">${(TIPO_PREN[p.tipo] || "📧").slice(0, 2)}</div><div class="grow"><div class="ellipsis"><b>${esc(p.oggetto)}</b></div>
      ${righe.length ? righe.map(r => `<div class="dett">${esc(r)}</div>`).join("") : `<div class="dett">${esc(prenQuando(p))}</div>`}
      <div class="muted ellipsis">${esc(p.mittente)}${p.codice ? " · " + esc(p.codice) : ""}${p.trasferta_id ? " · " + esc(tripName(p.trasferta_id)) : ' · <span class="pill warn">trasferta?</span>'}</div></div><div style="display:flex;flex-direction:column;gap:4px"><button class="btn sm primary" onclick="formPren('${p.id}')">Collega</button>${btnSpesaPren(p)}<button class="btn sm" onclick="ignoraPren('${p.id}')">Ignora</button></div></div>`; }).join("") : `<div class="muted">Niente di nuovo. Premi "Scansiona" per cercare adesso.</div>`}</div>
    ${fatte.length ? `<h2>Già collegate</h2><div class="card list">${fatte.slice(0, 30).map(p => `<div class="item"><div class="thumb">✓</div><div class="grow"><div class="ellipsis">${esc(p.oggetto)}</div><div class="muted">${esc(tripName(p.trasferta_id))}${p.codice ? " · " + esc(p.codice) : ""}</div>
      <div class="muted">${p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener">sito del fornitore</a> · ` : ""}${p.msg_id ? `<a href="${esc(linkMail(p))}" target="_blank" rel="noopener">mail</a>` : ""}${pdfPren(p) ? ` · <a href="${esc(pdfPren(p))}" target="_blank" rel="noopener">PDF</a>` : ""}</div></div><div style="display:flex;flex-direction:column;gap:4px">${btnSpesaPren(p)}<button class="btn sm" onclick="scollegaPren('${p.id}')">Scollega</button></div></div>`).join("")}</div>
    <div class="muted" style="margin-top:6px">Il link del fornitore vive qui: serve per il check-in e per cambiare una prenotazione. Sulla voce di checklist ci sono invece la mail e il PDF, che reggono anche senza rete. "Scollega" rimette la prenotazione fra quelle da collegare (la voce di checklist resta dov'è).</div>` : ""}
    <div class="muted" style="margin-top:10px">\ud83d\udcb3 <b>Spesa</b> compare quando dalla stessa mail è nata anche una proposta di spesa: apre il solito modulo di conferma, dove scegli personale/condivisa/ciascuno e chi ha pagato. Come sempre, in Spese non entra niente finché non premi "Crea la spesa".</div>
    ${ignorate.length ? `<h2>Ignorate <span class="muted">(${ignorate.length})</span></h2><div class="card list">${ignorate.map(p => `<div class="item"><div class="thumb">✕</div><div class="grow"><div class="ellipsis muted">${esc(p.oggetto)}</div><div class="muted">${esc(p.mittente)}</div></div><button class="btn sm" onclick="ripristinaPren('${p.id}')">Ripristina</button></div>`).join("")}</div>
    <div class="muted" style="margin-top:6px">Solo quelle ignorate adesso: al prossimo caricamento dell'app spariscono da qui.</div>` : ""}`;
}
async function scanEmail() {
  toast("Leggo la mail… (può volerci un minuto)", 8000);
  try { const r = await api("email.scan"); D.prenotazioni = r.prenotazioni; LS.set("data", D); render(); toast(r.nuove ? `${r.nuove} nuove prenotazioni trovate` : "Nessuna prenotazione nuova"); }
  catch (e) { toast("Errore: " + e.message, 5000); }
}
// La prenotazione resta in memoria come "ignorata" così puoi ripensarci subito;
// il server non la rimanda più al prossimo caricamento.
async function ignoraPren(id) {
  try {
    await api("pren.stato", { id, stato: "ignorata" });
    const x = (D.prenotazioni || []).find(y => y.id === id); if (x) x.stato = "ignorata";
    LS.set("data", D); render(); toast("Ignorata. Se hai sbagliato, in fondo alla pagina c'è \"Ripristina\".", 4000);
  } catch (e) { toast("Errore: " + e.message, 4000); }
}
async function ripristinaPren(id) {
  try {
    await api("pren.stato", { id, stato: "nuova" });
    const x = (D.prenotazioni || []).find(y => y.id === id); if (x) x.stato = "nuova";
    LS.set("data", D); render();
  } catch (e) { toast("Errore: " + e.message, 4000); }
}
// Annulla un "Collega" sbagliato: la prenotazione torna fra quelle da collegare,
// mantenendo la trasferta. La voce di checklist non viene toccata.
async function scollegaPren(id) {
  const p = (D.prenotazioni || []).find(x => x.id === id); if (!p) return;
  await write("pren.stato", { id, stato: "nuova", voce_id: "" }, d => {
    const x = (d.prenotazioni || []).find(y => y.id === id); if (x) { x.stato = "nuova"; x.voce_id = ""; }
  });
  toast("Rimessa fra quelle da collegare. Ricollegandola, link, codice e dettagli vengono riscritti nella voce.", 5000);
}
function formPren(id) {
  const p = (D.prenotazioni || []).find(x => x.id === id); if (!p) return;
  const trips = (D.trasferte || []).slice().sort((a, b) => a.inizio < b.inizio ? 1 : -1);
  const sugg = { volo: ["Volo andata", "Volo ritorno"], alloggio: ["Alloggio"], auto: ["Auto"], treno: ["Treno"], altro: [] }[p.tipo] || [];
  const tid0 = p.trasferta_id || (trips[0] || {}).id;
  const voci = tid => tripChecks(tid);
  const voceOptions = tid => { const cs = voci(tid); const pref = cs.find(c => sugg.some(s => c.voce.toLowerCase().startsWith(s.toLowerCase())) && c.stato === "da_fare") || cs.find(c => sugg.some(s => c.voce.toLowerCase().startsWith(s.toLowerCase()))); return cs.map(c => `<option value="${c.id}" ${pref && pref.id === c.id ? "selected" : ""}>${esc(c.voce)} (${STATI[c.stato]?.lab || c.stato})</option>`).join("") + `<option value="">＋ Nuova voce: ${esc(sugg[0] || p.oggetto.slice(0, 30))}</option>`; };
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
  const p = (D.prenotazioni || []).find(x => x.id === prenId);
  const q = propDiPren(p);
  if (!q || q.stato !== "nuova") return false;
  setTimeout(() => spesaDaPren(prenId), 900);   // dopo il toast, non sopra
  return true;
}

// ------------------------------------------------- PROPOSTE DI SPESA (email)
// Lo script legge dalla posta ricevute e fatture e prepara delle proposte.
// Niente finisce in Spese finché non premi "Crea la spesa" qui sotto: chi ha
// pagato e il tipo (personale / condivisa / ciascuno) la mail non può saperli.
const proposteNuove = () => (D.proposte || []).filter(p => p.stato === "nuova");
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
function propImporto(p) {
  const v = Number(p.importo) || 0;
  return (p.valuta && p.valuta !== "EUR") ? num(v) + " " + esc(p.valuta) : eur(v);
}
function itemProposta(p) {
  const n = propNote(p);
  return `<div class="item"><div class="thumb">${p.allegato ? "🧾" : "💳"}</div>
    <div class="grow"><div class="ellipsis"><b>${esc(p.vendor || p.descrizione || p.oggetto)}</b></div>
      <div class="dett">${fmtDY(p.data)} · ${esc(String(p.categoria || "Altro").split(" - ").pop())}${p.trasferta ? " · " + esc(p.trasferta) : ' · <span class="pill warn">trasferta?</span>'}</div>
      ${rigaCarta(p)}
      <div class="muted ellipsis">${esc(p.mittente)}${p.file_url ? ` · <a href="${esc(p.file_url)}" target="_blank" rel="noopener">apri il PDF</a>` : n.pdf ? " · PDF non salvato" : ""}</div></div>
    <div style="text-align:right"><div class="amt">${propImporto(p)}</div>
      <div style="display:flex;flex-direction:column;gap:4px;margin-top:4px"><button class="btn sm primary" onclick="formProposta('${p.id}')">Conferma</button><button class="btn sm" onclick="ignoraProposta('${p.id}')">Ignora</button></div></div></div>`;
}
function vProposte() {
  const all = (D.proposte || []).slice().sort((a, b) => a.data < b.data ? 1 : -1);
  const nuove = all.filter(p => p.stato === "nuova"), fatte = all.filter(p => p.stato === "confermata");
  const ignorate = all.filter(p => p.stato === "ignorata");
  const tot = nuove.reduce((a, p) => a + (p.valuta === "EUR" || !p.valuta ? Number(p.importo) || 0 : 0), 0);
  return `<div class="row"><button class="btn sm" onclick="go('altro')">‹</button><h1 class="grow" style="margin:0">Proposte di spesa</h1><button class="btn sm primary" onclick="scanSpese()">Scansiona</button></div>
    <div class="muted" style="margin:8px 0 12px">Ricevute e fatture lette dalla mail, con il PDF già allegato quando c'è. <b>Nessuna diventa una spesa finché non la confermi tu</b>: chi ha pagato e personale/condivisa/ciascuno li scegli qui.</div>
    <h2>Da confermare <span class="muted">(${nuove.length}${tot ? " · " + eur(tot) : ""})</span></h2>
    <div class="card list">${nuove.length ? nuove.map(itemProposta).join("") : `<div class="muted">Niente di nuovo. Premi "Scansiona" per cercare adesso.</div>`}</div>
    ${fatte.length ? `<h2>Confermate <span class="muted">(${fatte.length})</span></h2><div class="card list">${fatte.slice(0, 20).map(p => `<div class="item tap" onclick="${p.spesa_id ? `formSpesa('${p.spesa_id}')` : ""}"><div class="thumb">✓</div><div class="grow"><div class="ellipsis">${esc(p.vendor || p.descrizione)}</div><div class="muted">${fmtDY(p.data)}${p.trasferta ? " · " + esc(p.trasferta) : ""}</div></div><div class="amt">${propImporto(p)}</div></div>`).join("")}</div>` : ""}
    ${ignorate.length ? `<h2>Ignorate <span class="muted">(${ignorate.length})</span></h2><div class="card list">${ignorate.slice(0, 20).map(p => `<div class="item"><div class="thumb">✕</div><div class="grow"><div class="ellipsis muted">${esc(p.vendor || p.oggetto)}</div><div class="muted">${fmtDY(p.data)} · ${propImporto(p)}</div></div><button class="btn sm" onclick="ripristinaProposta('${p.id}')">Ripristina</button></div>`).join("")}</div>
    <div class="muted" style="margin-top:6px">Solo quelle ignorate adesso: al prossimo caricamento dell'app spariscono da qui (e il PDF messo da parte va nel cestino).</div>` : ""}`;
}
async function scanSpese() {
  toast("Cerco ricevute nella mail… (può volerci un minuto)", 8000);
  try {
    const r = await api("spese.scan");
    D.proposte = r.proposte; LS.set("data", D); render();
    toast(r.nuove ? `${r.nuove} proposte${r.pdf ? ` · ${r.pdf} PDF salvati` : ""}` : "Nessuna spesa nuova trovata");
  } catch (e) { toast("Errore: " + e.message, 5000); }
}
async function ignoraProposta(id) {
  try {
    await api("proposta.stato", { id, stato: "ignorata" });
    const x = (D.proposte || []).find(y => y.id === id); if (x) { x.stato = "ignorata"; x.allegato = ""; x.file_url = ""; }
    LS.set("data", D); render(); toast("Ignorata. In fondo alla pagina c'è \"Ripristina\".", 4000);
  } catch (e) { toast("Errore: " + e.message, 4000); }
}
async function ripristinaProposta(id) {
  try {
    await api("proposta.stato", { id, stato: "nuova" });
    const x = (D.proposte || []).find(y => y.id === id); if (x) x.stato = "nuova";
    LS.set("data", D); render();
  } catch (e) { toast("Errore: " + e.message, 4000); }
}
// La conferma: tutto già compilato, mancano solo chi ha pagato e come si divide.
// `pre` (facoltativo) preseleziona dei campi: lo usa il bottone della
// prenotazione per proporre la trasferta a cui la prenotazione e' collegata.
function formProposta(id, pre) {
  const p = (D.proposte || []).find(x => x.id === id); if (!p) return;
  const n = propNote(p);
  const trip0 = (pre && pre.trasferta) || p.trasferta;
  const s = { tipo: "condivisa", pagato_da: cfg.who, n_persone: 2 };
  const cats = D.settings.categorie || [];
  const vals = D.settings.valute || ["EUR"];
  const trips = [...new Set([...(D.trasferte || []).map(t => t.nome), ...(D.spese || []).map(x => x.trasferta), p.trasferta, trip0])].filter(Boolean).sort();
  openModal(`<h2 style="margin-top:0">Conferma spesa</h2>
    <div class="card small"><b>${esc(p.oggetto)}</b><div class="muted">${esc(p.mittente)} · ${fmtDY(p.data_email)}</div>
      ${n.evidenza ? `<div class="dett">letto da: "${esc(n.evidenza)}"</div>` : ""}
      ${rigaCarta(p)}
      ${p.file_url ? `<a href="${esc(p.file_url)}" target="_blank" rel="noopener">🧾 apri il PDF allegato</a>` : n.pdf ? `<div class="muted">PDF nella mail ma non salvato</div>` : `<div class="muted">Nessun allegato: la spesa resterà senza scontrino</div>`}
      ${n.link ? ` · <a href="${esc(n.link)}" target="_blank" rel="noopener">apri la mail del fornitore</a>` : ""}</div>
    <div class="cols3"><div class="field"><label>Importo</label><input id="qImp" inputmode="decimal" value="${esc(p.importo)}"></div>
      <div class="field"><label>Valuta</label><select id="qVal">${[...new Set([p.valuta || "EUR", ...vals])].map(v => `<option ${v === (p.valuta || "EUR") ? "selected" : ""}>${v}</option>`).join("")}</select></div></div>
    <div class="preview" id="qPrev"></div>
    <div class="cols"><div class="field"><label>Data</label><input id="qData" type="date" value="${esc(p.data)}"></div>
      <div class="field"><label>Trasferta</label><select id="qTrip">${trips.map(t => `<option ${t === trip0 ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div></div>
    <div class="field"><label>Categoria</label><select id="qCat">${cats.map(c => `<option ${c === p.categoria ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
    <div class="field"><label>Descrizione</label><input id="qDesc" value="${esc(p.descrizione || p.vendor)}"></div>
    <div class="field"><label>Tipo di spesa</label><div class="seg" id="qTipo">${["condivisa", "ciascuno", "personale"].map(k => `<button data-v="${k}" class="${s.tipo === k ? "on" : ""}">${TIPI[k]}</button>`).join("")}</div></div>

    <div class="field"><label>Chi ha pagato</label><div class="seg" id="qChi">${PERSONE.map(x => `<button data-v="${x}" class="${s.pagato_da === x ? "on" : ""}">${x}</button>`).join("")}</div></div>
    <div class="field" id="qN"><label>In quante persone si divide</label><div class="seg" id="qSegN">${[2, 3, 4, 5, 6].map(x => `<button data-v="${x}" class="${s.n_persone === x ? "on" : ""}">${x}</button>`).join("")}</div></div>
    <div class="books" id="qBooks"></div>
    <div class="row" style="gap:8px"><button class="btn primary grow" id="qSave">Crea la spesa</button><button class="btn" onclick="closeModal()">Annulla</button></div>
    <div class="muted" style="margin-top:8px">Il PDF viene rinominato con la convenzione solita e spostato nella cartella della trasferta.</div>`);
  const seg = (sel, cb) => { const el = $(sel); if (!el) return; el.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; el.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); cb(b.dataset.v); }); };
  const qEurOra = () => { const i = parseFloat(String($("#qImp").value).replace(",", ".")) || 0; return $("#qVal").value === "EUR" ? i : i * (Number(s.cambio) || 0); };
  const qUpdBooks = () => { const b = $("#qBooks"); if (b) b.innerHTML = boxLibri(s, qEurOra()); };
  seg("#qTipo", v => { s.tipo = v; $("#qN").hidden = !(v === "condivisa" || v === "ciascuno"); qUpdBooks(); });
  seg("#qChi", v => { s.pagato_da = v; qUpdBooks(); }); seg("#qSegN", v => { s.n_persone = +v; qUpdBooks(); });
  ["#qImp", "#qVal"].forEach(x => $(x).addEventListener("input", qUpdBooks));
  const prev = async () => {
    const v = $("#qVal").value, imp = parseFloat(String($("#qImp").value).replace(",", "."));
    if (!imp || v === "EUR") return $("#qPrev").textContent = "";
    $("#qPrev").textContent = "cambio…";
    try { const r = await api("fx", { valuta: v, data: $("#qData").value }); s.cambio = r.cambio; $("#qPrev").textContent = `≈ ${eur(imp * r.cambio)} (cambio ${num(r.cambio, 4)} del ${fmtD($("#qData").value)})`; }
    catch (e) { $("#qPrev").textContent = "cambio non disponibile (lo calcola il server)"; }
  };
  ["#qImp", "#qVal", "#qData"].forEach(x => $(x).addEventListener("change", () => prev().then(qUpdBooks)));
  prev().then(qUpdBooks); qUpdBooks();
  $("#qSave").addEventListener("click", async () => {
    const importo = parseFloat(String($("#qImp").value).replace(",", "."));
    if (!importo) return toast("Inserisci l'importo");
    const trasferta = $("#qTrip").value; if (!trasferta) return toast("Scegli la trasferta");
    const payload = {
      id: p.id, importo: importo, valuta: $("#qVal").value, data: $("#qData").value, trasferta: trasferta,
      categoria: $("#qCat").value, descrizione: $("#qDesc").value.trim(),
      tipo: s.tipo, pagato_da: s.pagato_da, n_persone: s.n_persone, conto: cfg.who,
    };
    closeModal(); toast("Creo la spesa…");
    try {
      const r = await api("proposta.conferma", payload);
      const i = (D.proposte || []).findIndex(x => x.id === p.id); if (i >= 0) D.proposte[i] = r.proposta;
      const j = (D.spese || []).findIndex(x => x.id === r.spesa.id); if (j >= 0) D.spese[j] = r.spesa; else (D.spese = D.spese || []).push(r.spesa);
      LS.set("data", D); render();
      toast("Spesa creata" + (r.spesa.scontrino ? " · scontrino archiviato" : ""), 4000);
    } catch (e) { toast("Errore: " + e.message, 5000); }
  });
}

// ---------------------------------------------------------------- COMPENSI
const RIS = { taglio: "Taglio superato", mancato: "Taglio mancato", vittoria: "Vittoria", np: "Non giocato" };
function vCompensi() {
  const st = D.settings || {}; const fisso = Number(st.compenso_fisso || 900);
  const trips = (D.trasferte || []).filter(t => t.tipo !== "casa" && t.tipo !== "altro" && t.fine <= today()).sort((a, b) => a.inizio < b.inizio ? 1 : -1);
  const comp = D.compensi || []; const byTrip = {}; comp.forEach(c => byTrip[c.trasferta_id] = c);
  const tot = comp.reduce((a, c) => a + (+c.totale || 0), 0), pag = comp.filter(c => c.stato === "pagato").reduce((a, c) => a + (+c.totale || 0), 0);
  const daSaldare = comp.filter(c => c.stato !== "pagato");
  const totDaPagare = Math.round(daSaldare.reduce((a, c) => a + daPagare(c), 0) * 100) / 100;
  const saldo = saldoTot();
  let h = `<div class="row"><button class="btn sm" onclick="go('altro')">‹</button><h1 class="grow" style="margin:0">Compensi caddie</h1></div>
    <div class="kpis" style="margin-top:12px"><div class="kpi"><div class="v">${eur(tot)}</div><div class="l">Compensi maturati</div></div><div class="kpi"><div class="v">${eur(tot - pag)}</div><div class="l">Compensi non ancora saldati</div></div><div class="kpi"><div class="v">${eur(totDaPagare)}</div><div class="l">Da bonificare (compensi non saldati, al netto delle spese)</div></div><div class="kpi"><div class="v">${eur(Math.abs(saldo))}</div><div class="l">${saldo > 0 ? "Netto che Alessandra deve a Giulio" : saldo < 0 ? "Netto che Giulio deve ad Alessandra" : "Netto: pari"}</div></div></div>
    <div class="muted" style="margin-bottom:10px">Regole: ${eur(fisso)} a settimana di torneo · ${st.perc_taglio || 8}% del montepremi con taglio superato · ${st.perc_vittoria || 10}% con vittoria · il 50% delle tratte intercontinentali arriva dal saldo, non dal compenso (quei voli si registrano come spesa <i>condivisa</i>). Il netto tiene conto delle spese condivise e dei pagamenti già registrati.<br>Il <b>compenso</b> resta lordo: è quello che Alessandra scarica. <b>Da bonificare</b> è il compenso più il saldo delle spese di quella trasferta — un bonifico solo chiude tutti e due.</div>
    <div class="row" style="gap:8px;margin-bottom:8px"><button class="btn grow" onclick="segnaPagati()">Segna tutti come saldati</button><button class="btn grow primary" onclick="formSpesa(null,null,'regolamento')">＋ Registra pagamento</button></div>`;
  if (!trips.length) h += `<div class="empty">Nessuna settimana di torneo conclusa</div>`;
  trips.forEach(t => { const c = byTrip[t.id];
    // st = saldo delle spese della trasferta, dp = quanto va bonificato davvero
    const st = c ? saldoTrasferta(c.trasferta) : 0, dp = c ? daPagare(c) : 0;
    h += `<div class="card tap" onclick="formCompenso('${t.id}')"><div class="row between"><div class="grow"><b>${esc(t.nome)}</b> ${t.tipo === "qualifica" ? '<span class="pill grey">qualifica</span>' : ""}${t.intercontinentale === "si" ? '<span class="pill blue">intercont.</span>' : ""}<div class="muted">${fmtDY(t.inizio)} → ${fmtDY(t.fine)}${c ? " · " + RIS[c.risultato] + (c.montepremi ? " · montepremi " + eur(c.montepremi) : "") : ""}</div>
      ${c ? `<div class="muted">fisso ${eur(c.fisso)}${+c.quota_percentuale ? " + " + c.percentuale + "% = " + eur(c.quota_percentuale) : ""}${+c.rimborso_voli ? " + voli " + eur(c.rimborso_voli) : ""}${+c.extra ? " + extra " + eur(c.extra) : ""}</div>
      <div class="muted">compenso ${eur(c.totale)} ${st < 0 ? "−" : "+"} ${eur(Math.abs(st))} di saldo trasferta = <b>${eur(Math.abs(dp))}</b> ${dp < 0 ? "che deve Giulio ad Alessandra" : "da bonificare a Giulio"}</div>` : ""}</div>
      <div style="text-align:right">${c ? `<div class="amt">${eur(Math.abs(dp))}</div><div class="muted" style="font-size:11px;margin:-2px 0 4px">${dp < 0 ? "li deve Giulio" : "da bonificare"}</div><span class="pill ${c.stato === "pagato" ? "" : "warn"}">${c.stato === "pagato" ? "saldato" : "da saldare"}</span>` : `<span class="pill grey">da compilare</span>`}</div></div></div>`; });
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
  if (ex) $("#kPay").addEventListener("click", () => { const imp = Math.abs(dpOra); closeModal(); formSpesa(null, t.nome, "regolamento", { importo: imp ? imp : "", valuta: "EUR", cambio: 1, pagato_da: dpOra < 0 ? "Giulio" : "Alessandra", descrizione: "Saldo " + t.nome }); });
  $("#kSave").addEventListener("click", async () => {
    c.fisso = String($("#kFisso").value).replace(",", "."); c.montepremi = String($("#kPrize").value).replace(",", ".") || 0; c.extra = String($("#kExtra").value).replace(",", ".") || 0; c.note = $("#kNote").value.trim(); c.stato = $("#kStato").value;
    closeModal(); toast("Salvo…");
    try { const r = await api("compenso.save", c); const i = D.compensi.findIndex(x => x.id === r.compenso.id); if (i >= 0) D.compensi[i] = r.compenso; else D.compensi.push(r.compenso); const j = D.spese.findIndex(x => x.id === r.spesa.id); if (j >= 0) D.spese[j] = r.spesa; else D.spese.push(r.spesa); LS.set("data", D); render(); toast("Compenso salvato: " + eur(r.compenso.totale)); }
    catch (e) { toast("Errore: " + e.message, 4000); }
  });
  if (ex) $("#kDel").addEventListener("click", async () => { if (!confirm("Eliminare questo compenso (e la riga collegata nel saldo)?")) return; closeModal(); try { await api("compenso.del", { id: ex.id }); D.compensi = D.compensi.filter(x => x.id !== ex.id); D.spese = D.spese.filter(x => x.id !== ex.spesa_id); LS.set("data", D); render(); } catch (e) { toast("Errore: " + e.message, 4000); } });
}
async function segnaPagati() {
  const ids = (D.compensi || []).filter(c => c.stato !== "pagato").map(c => c.id);
  if (!ids.length) return toast("Niente da saldare");
  if (!confirm(`Segnare ${ids.length} compensi come saldati? (Il pagamento vero va registrato con "Registra pagamento")`)) return;
  try { const r = await api("compenso.stato", { ids, stato: "pagato", data: today() }); r.forEach(c => { const i = D.compensi.findIndex(x => x.id === c.id); if (i >= 0) D.compensi[i] = c; }); LS.set("data", D); render(); } catch (e) { toast("Errore: " + e.message, 4000); }
}

// ---------------------------------------------------------------- FORM SPESA
let pendingFile = null;
// pre = valori gia' compilati (importo, pagato_da, descrizione): serve a "Registra pagamento",
// che arriva dal compenso con l'importo netto gia' calcolato
function formSpesa(id, tripName, forceTipo, pre) {
  const ex = id ? (D.spese || []).find(s => s.id === id) : null;
  const cur = currentTrip();
  const s = ex ? Object.assign({}, ex) : Object.assign({ data: today(), trasferta: tripName || (cur ? cur.nome : ""), categoria: forceTipo === "caddie" ? "Golf - Caddie" : "", descrizione: "", importo: "", valuta: (cur && cur.valuta) || "EUR", pagato_da: forceTipo === "regolamento" ? "Alessandra" : cfg.who, tipo: forceTipo || "condivisa", n_persone: 2, conto: cfg.who, note: "", cambio: "" }, pre || {});
  pendingFile = null;
  const TRIP_PRIV = ["casa", "altro"];
  const miaSpesa = x => !(x.tipo === "personale" && x.conto && x.conto !== cfg.who);
  const hoSpese = n => (D.spese || []).some(x => x.trasferta === n && miaSpesa(x));
  const soloAltro = n => (D.spese || []).some(x => x.trasferta === n && !miaSpesa(x)) && !hoSpese(n);
  const trips = [...new Set([...(D.trasferte || []).filter(t => !TRIP_PRIV.includes(String(t.tipo || "").toLowerCase()) || !soloAltro(t.nome)).map(t => t.nome), ...(D.spese || []).filter(miaSpesa).map(x => x.trasferta), s.trasferta])].filter(Boolean).sort();
  const cats = D.settings.categorie || []; const vals = D.settings.valute || ["EUR"];
  const isMov = s.tipo === "caddie" || s.tipo === "regolamento";
  openModal(`
    <h2 style="margin-top:0">${ex ? "Modifica" : "Nuova"} ${isMov ? TIPI[s.tipo].toLowerCase() : "spesa"}</h2>
    ${isMov ? "" : `<div class="field"><div class="seg" id="segTipo">${["condivisa", "ciascuno", "personale"].map(k => `<button data-v="${k}" class="${s.tipo === k ? "on" : ""}">${TIPI[k]}</button>`).join("")}</div></div>
`}
    <div class="cols3"><div class="field"><label>Importo</label><input id="fImp" inputmode="decimal" placeholder="0,00" value="${esc(s.importo)}"></div>
      <div class="field"><label>Valuta</label><select id="fVal">${[...new Set([s.valuta, ...vals])].map(v => `<option ${v === s.valuta ? "selected" : ""}>${v}</option>`).join("")}</select></div></div>
    <div class="preview" id="fPrev">${ex && s.valuta !== "EUR" ? `= ${eur(s.importo_eur)} (cambio ${num(s.cambio, 4)})` : ""}</div>
    <div class="cols"><div class="field"><label>Data</label><input id="fData" type="date" value="${esc(s.data)}"></div>
      <div class="field"><label>Trasferta</label><select id="fTrip">${trips.map(t => `<option ${t === s.trasferta ? "selected" : ""}>${esc(t)}</option>`).join("")}<option value="__new">＋ Nuova…</option></select></div></div>
    ${isMov && s.tipo === "regolamento" ? "" : `<div class="field"><label>Categoria</label><select id="fCat">${cats.map(c => `<option ${c === s.categoria ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>`}
    <div class="field"><label>Descrizione</label><input id="fDesc" value="${esc(s.descrizione)}" placeholder="${s.tipo === "caddie" ? "es. Caddie Aprile/Maggio" : s.tipo === "regolamento" ? "es. Bonifico saldo Australia" : "es. Cena, Benzina, Hotel…"}"></div>
    <div class="field"><label>${s.tipo === "regolamento" ? "Chi paga" : "Chi ha pagato"}</label><div class="seg" id="segChi">${PERSONE.map(p => `<button data-v="${p}" class="${s.pagato_da === p ? "on" : ""}">${p}</button>`).join("")}</div></div>
    <div class="field" id="fN" ${s.tipo === "condivisa" || s.tipo === "ciascuno" ? "" : "hidden"}><label>In quante persone si divide</label><div class="seg" id="segN">${[2, 3, 4, 5, 6].map(n => `<button data-v="${n}" class="${+s.n_persone === n ? "on" : ""}">${n}</button>`).join("")}</div></div>
    ${isMov ? "" : `<div class="field"><label>Scontrino ${s.scontrino ? `· <a href="${esc(s.scontrino)}" target="_blank" rel="noopener">apri quello attuale</a>` : ""}</label><input id="fFile" type="file" accept="image/*,application/pdf"><div class="muted" id="fFileInfo"></div></div>`}
    <div class="field"><label>Note</label><input id="fNote" value="${esc(s.note || "")}"></div>
    <div class="books" id="fBooks"></div>
    <div class="row" style="gap:8px"><button class="btn primary grow" id="fSave">Salva</button>${ex ? `<button class="btn danger" id="fDel">Elimina</button>` : ""}<button class="btn" onclick="closeModal()">Annulla</button></div>`);
  const seg = (sel, cb) => { const el = $(sel); if (!el) return; el.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; el.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); cb(b.dataset.v); }); };
  // il riquadro "che cosa fa questa spesa" si riaggiorna a ogni scelta
  const eurOra = () => { const i = parseFloat(String($("#fImp").value).replace(",", ".")) || 0; return $("#fVal").value === "EUR" ? i : i * (Number(s.cambio) || 0); };
  const updBooks = () => { const b = $("#fBooks"); if (b) b.innerHTML = boxLibri(s, eurOra()); };
  seg("#segTipo", v => { s.tipo = v; $("#fN").hidden = !(v === "condivisa" || v === "ciascuno"); updBooks(); });
  seg("#segChi", v => { s.pagato_da = v; updBooks(); }); seg("#segN", v => { s.n_persone = +v; updBooks(); });
  ["#fImp", "#fVal"].forEach(x => $(x).addEventListener("input", updBooks));
  $("#fTrip").addEventListener("change", e => { if (e.target.value === "__new") { const n = prompt("Nome nuova trasferta"); if (n) { const o = document.createElement("option"); o.textContent = n; e.target.insertBefore(o, e.target.firstChild); e.target.value = n; } else e.target.value = s.trasferta; } });
  const prev = async () => { const v = $("#fVal").value, imp = parseFloat(String($("#fImp").value).replace(",", ".")); if (!imp) return $("#fPrev").textContent = ""; if (v === "EUR") return $("#fPrev").textContent = ""; $("#fPrev").textContent = "cambio…"; try { const r = await api("fx", { valuta: v, data: $("#fData").value }); s.cambio = r.cambio; $("#fPrev").textContent = `≈ ${eur(imp * r.cambio)} (cambio ${num(r.cambio, 4)} del ${fmtD($("#fData").value)})`; } catch (e) { $("#fPrev").textContent = "cambio non disponibile (verrà calcolato al salvataggio)"; } };
  ["#fImp", "#fVal", "#fData"].forEach(x => $(x).addEventListener("change", () => prev().then(updBooks)));
  updBooks();
  const fileIn = $("#fFile"); if (fileIn) fileIn.addEventListener("change", async () => { const f = fileIn.files[0]; if (!f) return; $("#fFileInfo").textContent = "Preparo la foto…"; pendingFile = await prepFile(f); $("#fFileInfo").textContent = `${pendingFile.name} · ${Math.round(pendingFile.base64.length * 0.75 / 1024)} KB`; });
  $("#fSave").addEventListener("click", async () => {
    s.importo = parseFloat(String($("#fImp").value).replace(",", ".")); if (!s.importo) return toast("Inserisci l'importo");
    s.valuta = $("#fVal").value; s.data = $("#fData").value; s.trasferta = $("#fTrip").value; s.descrizione = $("#fDesc").value.trim(); s.note = $("#fNote").value.trim();
    if ($("#fCat")) s.categoria = $("#fCat").value; if (s.tipo === "regolamento") s.categoria = "Altro";
    if (!s.trasferta) return toast("Scegli la trasferta");
    if (s.valuta === "EUR") s.cambio = 1;
    if (s.tipo === "personale") s.conto = cfg.who;
    if (!s.id) { s.id = uid(); s.creato = new Date().toISOString().slice(0, 19); s.inserito_da = cfg.who; }
    s.modificato = new Date().toISOString().slice(0, 19);
    // stima locale (il server ricalcola col cambio del giorno)
    s.importo_eur = Math.round(s.importo * (s.cambio || 1) * 100) / 100; computeSpesa(s);
    const payload = Object.assign({}, s); if (pendingFile) payload.file = pendingFile;
    if (pendingFile) payload.scontrino = "";
    closeModal();
    const res = await write("spesa.save", payload, d => { const i = d.spese.findIndex(x => x.id === s.id); if (i >= 0) d.spese[i] = s; else d.spese.push(s); });
    if (res) { const i = D.spese.findIndex(x => x.id === res.id); if (i >= 0) D.spese[i] = res; LS.set("data", D); render(); toast("Salvato" + (res.valuta !== "EUR" ? ` · ${eur(res.importo_eur)}` : "")); }
  });
  if (ex) $("#fDel").addEventListener("click", async () => { if (!confirm("Eliminare questa spesa?")) return; closeModal(); await write("spesa.del", { id: ex.id }, d => { d.spese = d.spese.filter(x => x.id !== ex.id); }); });
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
  const TIPI_T = { torneo: "Torneo (settimana pagata)", qualifica: "Qualifica / Q-School (non pagata)", casa: "Casa", altro: "Altro" };
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
    const res = await write("trasferta.save", t, d => { const i = d.trasferte.findIndex(x => x.id === t.id); if (i >= 0) d.trasferte[i] = t; else { d.trasferte.push(t); (d.settings.checklist_template || []).forEach((v, k) => d.checklist.push({ id: uid(), trasferta_id: t.id, voce: v, stato: "da_fare", link: "", codice: "", chi: "", note: "", ordine: k + 1, _tmp: true })); } });
    if (isNew) go("trip", t.id);
    if (res) { const i = D.trasferte.findIndex(x => x.id === res.trasferta.id); if (i >= 0) D.trasferte[i] = res.trasferta; if (res.checklist && res.checklist.length) { D.checklist = D.checklist.filter(c => !(c.trasferta_id === t.id && c._tmp)).concat(res.checklist); } LS.set("data", D); render(); }
  });
}
async function delTrip(id) { if (!confirm("Eliminare la trasferta e la sua checklist? Le spese restano.")) return; await write("trasferta.del", { id }, d => { d.trasferte = d.trasferte.filter(t => t.id !== id); d.checklist = d.checklist.filter(c => c.trasferta_id !== id); }); go("trasferte"); }
function duplicaTrip(id) {
  const t = (D.trasferte || []).find(x => x.id === id); if (!t) return;
  const shift = s => { const d = new Date(s + "T00:00:00"); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); };
  const y = String(Number(t.anno || t.inizio.slice(0, 4)) + 1);
  formTrip(null, { nome: /\b20\d\d\b/.test(t.nome) ? t.nome.replace(/\b20\d\d\b/, y) : t.nome + " " + y, inizio: shift(t.inizio), fine: shift(t.fine), citta: t.citta, paese: t.paese, valuta: t.valuta, fuso: t.fuso, note: t.note, budget: t.budget, tipo: t.tipo, intercontinentale: t.intercontinentale });
}

// ---------------------------------------------------------------- CHECKLIST
function toggleOrdinaCheck() { checkOrdina = !checkOrdina; render(); }

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

async function cycleCheck(id) {
  const c = (D.checklist || []).find(x => x.id === id); if (!c) return;
  const order = ["da_fare", "prenotato", "pagato", "na"]; c.stato = order[(order.indexOf(c.stato) + 1) % order.length];
  await write("check.save", Object.assign({}, c), () => {});
}
function formCheck(id, tripId) {
  const ex = id ? (D.checklist || []).find(c => c.id === id) : null;
  const c = ex ? Object.assign({}, ex) : { trasferta_id: tripId, voce: "", stato: "da_fare", link: "", codice: "", chi: "", note: "", ordine: tripChecks(tripId).length + 1 };
  openModal(`<h2 style="margin-top:0">${ex ? "Voce checklist" : "Nuova voce"}</h2>
    <div class="field"><label>Cosa</label><input id="cVoce" value="${esc(c.voce)}" placeholder="es. Volo andata"></div>
    <div class="field"><label>Stato</label><div class="seg" id="segSt">${Object.keys(STATI).map(k => `<button data-v="${k}" class="${c.stato === k ? "on" : ""}">${STATI[k].lab}</button>`).join("")}</div></div>
    <div class="field"><label>Link prenotazione</label><input id="cLink" value="${esc(c.link)}" placeholder="https://…" inputmode="url"></div>
    <div class="cols"><div class="field"><label>Codice / PNR</label><input id="cCod" value="${esc(c.codice)}"></div><div class="field"><label>Se ne occupa</label><select id="cChi"><option value="">—</option>${PERSONE.map(p => `<option ${c.chi === p ? "selected" : ""}>${p}</option>`).join("")}</select></div></div>
    <div class="field"><label>Note</label><input id="cNote" value="${esc(c.note)}"></div>
    <div class="row" style="gap:8px"><button class="btn primary grow" id="cSave">Salva</button>${ex ? `<button class="btn danger" id="cDel">Elimina</button>` : ""}<button class="btn" onclick="closeModal()">Annulla</button></div>`);
  $("#segSt").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; $("#segSt").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); c.stato = b.dataset.v; });
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
  if (ex) $("#dDel").addEventListener("click", async () => { if (!confirm("Eliminare?")) return; closeModal(); await write("doc.del", { id: ex.id }, x => { x.documenti = x.documenti.filter(y => y.id !== ex.id); }); });
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
