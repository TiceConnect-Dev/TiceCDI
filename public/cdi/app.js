import { renderPrivacy, renderNotice, renderDossier } from "./privacy.js";
import { renderBackup, renderGroups, renderJournal, renderSessions, renderYears, startCall } from "./school.js";
import { renderPlanning, renderScreen } from "./schedule.js";
import { openingForm, renderStatistics } from "./attendance.js";
import { siecleRows } from "./shared.js";
import { routePath, urlFor, brand, api, cardCode, loader, csvRows, day, e, fullName, icon, notice, renderBarcode, time, today, themeButton } from "./shared.js";
import { renderConnection, renderDevices, renderSecurity, securityAlerts } from "./account.js";

const app = document.querySelector("#app");
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const button = (text, glyph, attrs = "", mode = "secondary") =>
  `<button class="btn ${mode}" type="button" ${attrs}>${glyph ? icon(glyph) : ""}${text}</button>`;
const link = (text, href, glyph, mode = "secondary") =>
  `<a class="btn ${mode}" href="${href}">${glyph ? icon(glyph) : ""}${text}</a>`;
const box = (symbol) => `<span class="icon-box">${icon(symbol)}</span>`;
const pill = (text, tone = "") => `<span class="pill ${tone ? "pill-" + tone : ""}">${e(text)}</span>`;

function header(area = "home", canActivate = false) {
  const links=themeButton()+`<a href="${urlFor("/notice")}" title="Données personnelles">${icon("info")}<span class="sr-label">Données personnelles</span></a>`+
    (area==="admin" ? `${canActivate?`<a href="${urlFor("/gestion/borne-poste")}" title="Activer la borne">${icon("scan")}<span class="sr-label">Activer la borne</span></a>`:""}
      <button id="logout" type="button" title="Déconnexion">${icon("logout")}<span class="sr-label">Déconnexion</span></button>`
      : `<a href="${urlFor("/gestion")}" title="Espace personnel">${icon("lock")}<span class="sr-label">Espace personnel</span></a>`);
  return `<header class="masthead"><div class="wrap masthead-inner">
    <a class="brand" href="${urlFor("/")}">${brand(area==="kiosk")}</a>
    <nav class="top-links" aria-label="Accès rapides">${links}</nav>
  </div></header>`;
}

const footer = '<footer class="footer"><div class="wrap footer-inner"><b>TiceCDI</b><span>Une application de TiceConnect</span></div></footer>';
function home() {
  app.innerHTML=`<div class="kiosk-page">${header()}<main class="wrap kiosk" id="main">
    <section class="panel panel-body home-card">
      <h1>${brand(false,true)}</h1><p class="home-subtitle">Présences, planning et fréquentation du CDI</p>
      <nav class="button-row" aria-label="Accès à TiceCDI">
        <a class="btn primary" href="${urlFor("/borne")}">Borne du CDI</a>
        <a class="btn secondary" href="${urlFor("/gestion")}">Espace personnel</a>
        <a class="btn secondary" href="${urlFor("/planning-ecran")}" id="home-planning" hidden>Planning</a>
      </nav></section></main>${footer}</div>`;
  api("/notice").then(data=>{$("#home-planning").hidden=!data.public_planning;}).catch(()=>{});
}

function kiosk() {
  // Borne élèves : page plein écran, sobre, tactile, sans liens vers l’espace du personnel.
  app.innerHTML=`<div class="borne" id="main">
    <header class="borne-top">
      <div class="borne-brand">${brand(true)}<div><b>CDI</b><span>Centre de documentation et d’information</span></div></div>
      <div class="borne-clock"><time id="borne-time"></time><span id="borne-date"></span></div>
    </header>
    <main class="borne-stage">
      <section class="borne-card" aria-labelledby="kiosk-title">
        <div class="borne-head">
          <div><h1 id="kiosk-title">Entrée et sortie du CDI</h1>
          <p id="borne-help">Scanne ta carte, ou tape ton nom puis sélectionne-le dans la liste.</p></div>
          <div class="borne-places" id="borne-places" hidden></div>
          <div class="borne-status" id="borne-status" hidden></div>
        </div>
        <div class="borne-news" id="borne-news" role="status" aria-live="polite" hidden></div>
        <div id="kiosk-state" class="borne-state" role="status"><p>Vérification de l’activation du poste…</p></div>
        <form id="entry-form" autocomplete="off" hidden>
          <label class="borne-label" for="entry-input" id="entry-label">Carte CDI, nom ou prénom</label>
          <div class="borne-scan">${icon("search")}<input id="entry-input" type="text" maxlength="60" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="Ex. Lina, Martin ou Lina 2nde 3" required></div>
          <div id="name-results" class="borne-results" role="list" aria-live="polite"></div>
          <label class="borne-toggle" id="second-hour"><input type="checkbox" id="two-hours"><span class="borne-switch" aria-hidden="true"></span><span>Rester jusqu’à la deuxième heure</span></label>
        </form>
        <div id="entry-message" class="borne-feedback" role="status" aria-live="polite" aria-atomic="true"></div>
        <div class="borne-day" id="borne-day" hidden></div>
        <ul class="borne-rules" id="borne-rules" aria-label="Règles du CDI" hidden></ul>
      </section>
    </main>
    <div class="borne-confirm" id="borne-confirm" role="alertdialog" aria-live="assertive" hidden></div>
    <div class="borne-idle" id="borne-idle" hidden></div>
  </div>`;
  const root=$(".borne"), card=$(".borne-card");
  const clockFormat=new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"});
  const dateFormat=new Intl.DateTimeFormat("fr-FR",{weekday:"long",day:"numeric",month:"long",timeZone:"Europe/Paris"});
  const hourFormat=new Intl.DateTimeFormat("fr-FR",{hour:"numeric",hourCycle:"h23",timeZone:"Europe/Paris"});
  let display={show_places:true,show_planning:true,scan_animation:true,confirm_seconds:4,announcements:[],rules:[],idle_enabled:true,idle_delay:60,theme:"clair",dark_from:17,dark_to:8};
  let state={activated:false,open:false,places:null,capacity:null,occupied:0,today:null};
  const tick=()=>{
    const now=new Date();
    $("#borne-time").textContent=clockFormat.format(now); $("#borne-date").textContent=dateFormat.format(now);
    applyTheme();
    if(!$("#borne-idle").hidden) updateIdle();
  };
  // Thème : clair, sombre ou sombre entre deux heures (réglé dans la gestion).
  function applyTheme() {
    const hour=Number(hourFormat.format(new Date()));
    const {theme,dark_from:from,dark_to:to}=display;
    const dark=theme==="sombre" || (theme==="horaire" && (from===to ? false : from<to ? hour>=from && hour<to : hour>=from || hour<to));
    root.classList.toggle("borne-dark",dark);
  }
  const form=$("#entry-form"), input=$("#entry-input"), two=$("#two-hours"), message=$("#entry-message");
  const results=$("#name-results");
  // Début d’un code de carte (y compris tapé par une douchette en QWERTY sur un poste AZERTY).
  const isCode=(value)=>/^\s*(\]c0)?cdi/i.test(value) || Boolean(cardCode(value));
  let nameSearchEnabled=true, searchTimer, searchVersion=0, clearTimer, rows=[];
  function clearSearch() { rows=[]; results.replaceChildren(); input.value=""; syncMode(); }
  function syncMode() {
    const value=input.value.trim();
    const code=!nameSearchEnabled || !value || isCode(value);
    input.classList.toggle("is-code",nameSearchEnabled ? Boolean(value) && isCode(value) : true);
    // Animation de lecture : la carte pulse dès que la douchette commence à taper un code.
    card.classList.toggle("is-scanning",display.scan_animation && Boolean(value) && isCode(value));
    if(code) { rows=[]; results.replaceChildren(); }
  }
  let lastCard="", lastCardAt=0;
  input.addEventListener("input",()=>{
    wake();
    syncMode();
    const full=cardCode(input.value);
    if(full) {
      if(full===lastCard && Date.now()-lastCardAt<10_000) { input.value=""; syncMode(); show("Carte déjà prise en compte.","info"); return; }
      lastCard=full; lastCardAt=Date.now();
      checkIn("auto",{code:full,two_hours:two.checked});
      return;
    }
    clearTimeout(searchTimer);
    clearTimeout(clearTimer);
    clearTimer=setTimeout(clearSearch,60_000);
    const query=input.value.trim();
    if(!nameSearchEnabled || !query || isCode(query)) return;
    if(query.replace(/\s/g,"").length<2) { results.innerHTML=`<p class="borne-hint">Continue à taper…</p>`; return; }
    searchTimer=setTimeout(async()=>{
      const version=++searchVersion;
      try {
        const result=await api("/borne/recherche","POST",{q:query});
        if(version!==searchVersion || input.value.trim()!==query) return;
        rows=result.rows;
        results.innerHTML=rows.length
          ? (result.fuzzy?`<p class="borne-hint">Aucun nom exact. Est-ce l’un de ces élèves ?</p>`:"")
            +rows.map(row=>`<div class="borne-result" role="listitem">
              <button type="button" class="borne-result-in" data-ref="${e(row.ref)}" data-name="${e(row.label)}" data-direction="entree"><span class="borne-avatar" aria-hidden="true">${e(row.label.charAt(0))}</span><span class="borne-who"><strong>${e(row.label)}</strong><small>${e(row.class_name)}</small></span><em>${icon("login")} Entrer</em></button>
              <button type="button" class="borne-result-out" data-ref="${e(row.ref)}" data-name="${e(row.label)}" data-direction="sortie" aria-label="Sortie de ${e(row.label)}">${icon("logout")}<span>Sortir</span></button></div>`).join("")
            +(result.more?`<p class="borne-hint">D’autres élèves correspondent : ajoute ton nom ou ta classe.</p>`:"")
          : `<p class="borne-hint">Aucun élève trouvé. Vérifie l’orthographe ou adresse-toi au personnel.</p>`;
      } catch(error) { results.innerHTML=`<p class="borne-hint">${e(error.message)}</p>`; }
    },180);
  });
  results.addEventListener("click",event=>{
    const choice=event.target.closest("[data-ref]");
    if(choice) checkIn(choice.dataset.direction,{ref:choice.dataset.ref,two_hours:two.checked},choice.dataset.name);
  });
  let busy=false, expiry, refreshing=false, closed=false, confirmTimer;
  function show(text,tone) {
    clearTimeout(expiry);
    message.className="borne-feedback "+(tone||"info");
    message.innerHTML=`${icon(tone==="success"?"check":tone==="error"?"warning":"info")}<p>${e(text)}</p>`;
    expiry=setTimeout(()=>{message.replaceChildren();message.className="borne-feedback";},6000);
  }
  // Confirmation en grand, lisible de loin ; un toucher la ferme.
  function confirmScreen(tone,title,detail) {
    const box=$("#borne-confirm");
    clearTimeout(confirmTimer);
    box.dataset.tone=tone;
    box.innerHTML=`<div class="borne-confirm-box"><span class="borne-confirm-icon">${icon(tone==="error"?"warning":tone==="out"?"logout":"check")}</span>
      <strong>${e(title)}</strong>${detail?`<p>${e(detail)}</p>`:""}<i class="borne-confirm-timer"></i></div>`;
    box.style.setProperty("--confirm",(tone==="error"?Math.max(display.confirm_seconds,4):display.confirm_seconds)+"s");
    box.hidden=false;
    confirmTimer=setTimeout(()=>{box.hidden=true;},(tone==="error"?Math.max(display.confirm_seconds,4):display.confirm_seconds)*1000);
  }
  $("#borne-confirm").addEventListener("pointerdown",()=>{ clearTimeout(confirmTimer); $("#borne-confirm").hidden=true; input.focus({preventScroll:true}); });

  // Annonces : défilement toutes les 8 secondes, une couleur par annonce.
  let newsIndex=0, newsKey="";
  const toneIcon={info:"info",succes:"check",attention:"warning",alerte:"warning",evenement:"calendar"};
  const newsHtml=(item,list)=>`<p>${icon(toneIcon[item.tone]??"info")}<span>${e(item.text)}</span></p>${list.length>1?`<span class="borne-news-dots">${list.map((_,i)=>`<i class="${i===newsIndex%list.length?"on":""}"></i>`).join("")}</span>`:""}`;
  // Une bulle n’est redessinée que si l’annonce affichée change (pas de clignotement à chaque actualisation).
  function paintNews(box,list) {
    box.hidden=!list.length;
    if(box.hidden) { box.dataset.key=""; return; }
    const item=list[newsIndex%list.length], key=newsIndex%list.length+"|"+item.tone+"|"+item.text+"|"+list.length;
    if(box.dataset.key===key) return;
    box.dataset.key=key;
    box.dataset.tone=item.tone;
    box.innerHTML=newsHtml(item,list);
    box.classList.remove("is-new"); void box.offsetWidth; box.classList.add("is-new");
  }
  function renderNews() { paintNews($("#borne-news"),state.activated?display.announcements:[]); }
  setInterval(()=>{ if(display.announcements.length>1){ newsIndex++; renderNews(); if(!$("#borne-idle").hidden) updateIdle(); } },8000);

  // Places libres en grand, avec une jauge.
  function renderPlaces() {
    const box=$("#borne-places"), status=$("#borne-status");
    const gauge=display.show_places && state.activated && state.open && state.capacity;
    box.hidden=!gauge;
    status.hidden=!state.activated || Boolean(gauge);
    const full=state.open && state.places===0;
    status.dataset.state=!state.open||full?"closed":"open";
    status.textContent=!state.open?"CDI fermé":full?"CDI complet":state.places===null||state.places===undefined?"CDI ouvert":`${state.places} place${state.places>1?"s":""} libre${state.places>1?"s":""}`;
    if(!gauge) return;
    const ratio=Math.min(1,state.occupied/state.capacity);
    box.dataset.level=state.places===0?"full":ratio>=.85?"high":ratio>=.6?"mid":"low";
    box.innerHTML=`<b>${state.places}</b><span>${state.places===0?"CDI complet":`place${state.places>1?"s":""} libre${state.places>1?"s":""}`}</span>
      <progress max="${state.capacity}" value="${state.occupied}" aria-label="${state.occupied} élèves sur ${state.capacity} places"></progress><small>${state.occupied} / ${state.capacity}</small>`;
  }

  // Planning du jour : frise horaire (ouvert, réservé, fermé) et repère de l’heure actuelle.
  const hm=n=>`${Math.floor(n/60)} h${n%60?String(n%60).padStart(2,"0"):""}`;
  function renderDay() {
    const box=$("#borne-day"), today=state.today;
    const items=[...(today?.hours??[]).map(row=>({...row,kind:"ouvert"})),...(today?.rows??[])];
    box.hidden=!display.show_planning || !state.activated || !items.length;
    if(box.hidden) return;
    const start=Math.min(...items.map(row=>row.start_min)), end=Math.max(...items.map(row=>row.end_min));
    const span=Math.max(60,end-start), pos=n=>((n-start)/span*100).toFixed(2);
    const upcoming=(today.rows??[]).find(row=>row.end_min>today.minute);
    const now=today.minute>=start&&today.minute<=end?`<i class="borne-day-now" data-at="${pos(today.minute)}"></i>`:"";
    box.innerHTML=`<div class="borne-day-head"><b>Aujourd’hui</b><span>${upcoming?`${upcoming.start_min<=today.minute?"En cours":"À venir"} : ${e(upcoming.title)} de ${hm(upcoming.start_min)} à ${hm(upcoming.end_min)}`:(today.hours?.length?`Ouvert ${today.hours.map(row=>`${hm(row.start_min)} – ${hm(row.end_min)}`).join(" · ")}`:"")}</span></div>
      <div class="borne-day-bar">${items.map(row=>`<i class="seg-${row.kind}" data-from="${pos(row.start_min)}" data-to="${pos(row.end_min)}" title="${e((row.title??"Ouvert")+" "+hm(row.start_min)+" – "+hm(row.end_min))}"></i>`).join("")}${now}</div>
      <div class="borne-day-scale"><span>${hm(start)}</span><span class="legend"><i class="seg-ouvert"></i>Ouvert<i class="seg-reservation"></i>Réservé<i class="seg-fermeture"></i>Fermé</span><span>${hm(end)}</span></div>`;
    // Positions appliquées en JavaScript (politique CSP : pas de style en ligne dans le HTML).
    box.querySelectorAll("[data-from]").forEach(node=>{ node.style.left=node.dataset.from+"%"; node.style.width=(node.dataset.to-node.dataset.from)+"%"; });
    box.querySelectorAll("[data-at]").forEach(node=>{ node.style.left=node.dataset.at+"%"; });
  }
  function renderRules() {
    const box=$("#borne-rules");
    box.hidden=!state.activated || !display.rules.length;
    box.innerHTML=display.rules.map(rule=>`<li>${e(rule)}</li>`).join("");
  }

  // Écran de repos : horloge, état du CDI, annonce et règles ; un toucher ou un scan réveille la borne.
  let idleTimer;
  function renderIdle() {
    $("#borne-idle").innerHTML=`<div class="borne-idle-box">
      <time id="idle-time"></time><span class="borne-idle-date" id="idle-date"></span>
      <p class="borne-idle-state" id="idle-state"></p>
      <div class="borne-news" id="idle-news" hidden></div>
      <ul class="borne-rules" id="idle-rules"></ul>
      <p class="borne-idle-hint">${icon("scan")} Touche l’écran ou scanne ta carte</p></div>`;
    updateIdle();
  }
  // Mise à jour sans reconstruire l’écran : seuls les textes qui changent sont remplacés.
  function updateIdle() {
    const now=new Date(), set=(id,value)=>{ const node=$("#"+id); if(node && node.textContent!==value) node.textContent=value; };
    set("idle-time",clockFormat.format(now)); set("idle-date",dateFormat.format(now));
    set("idle-state",!state.open?"CDI fermé":state.places===0?"CDI complet":state.places!==null&&state.places!==undefined?`CDI ouvert · ${state.places} place${state.places>1?"s":""} libre${state.places>1?"s":""}`:"CDI ouvert");
    const status=$("#idle-state"); if(status) status.dataset.state=state.open&&state.places!==0?"open":"closed";
    const news=$("#idle-news"); if(news) paintNews(news,display.announcements);
    const rules=$("#idle-rules"), html=display.rules.map(rule=>`<li>${e(rule)}</li>`).join("");
    if(rules && rules.dataset.html!==html) { rules.dataset.html=html; rules.innerHTML=html; rules.hidden=!html; }
  }
  function sleep() {
    if(!display.idle_enabled || !state.activated || busy || input.value.trim()) return armIdle();
    renderIdle();
    $("#borne-idle").hidden=false;
    input.focus({preventScroll:true});
  }
  function armIdle() { clearTimeout(idleTimer); if(display.idle_enabled) idleTimer=setTimeout(sleep,display.idle_delay*1000); }
  function wake() { if(!$("#borne-idle").hidden) $("#borne-idle").hidden=true; armIdle(); }
  $("#borne-idle").addEventListener("pointerdown",event=>{ event.preventDefault(); wake(); input.focus({preventScroll:true}); });
  for(const type of ["pointerdown","keydown"]) root.addEventListener(type,wake,{passive:true});

  async function refresh() {
    if(refreshing) return;
    refreshing=true;
    try {
      const settings=await api("/borne/reglages");
      const wasHidden=form.hidden;
      const before=JSON.stringify(display);
      if(settings.display) display=settings.display;
      state={activated:Boolean(settings.activated),open:Boolean(settings.open),places:settings.places,capacity:settings.capacity,occupied:settings.occupied??0,today:settings.today??null};
      form.hidden=!settings.activated;
      closed=!settings.open;
      $("#second-hour").hidden=!settings.open || !settings.second_hour;
      if(nameSearchEnabled!==Boolean(settings.name_search)) {
        nameSearchEnabled=Boolean(settings.name_search);
        $("#entry-label").textContent=nameSearchEnabled?"Carte CDI, nom ou prénom":"Carte CDI";
        input.placeholder=nameSearchEnabled?"Ex. Lina, Martin ou Lina 2nde 3":"Scanne ta carte";
        $("#borne-help").textContent=nameSearchEnabled?"Scanne ta carte, ou tape ton nom puis sélectionne-le dans la liste.":"Scanne ta carte CDI pour entrer ou sortir.";
        syncMode();
      }
      if($("#second-hour").hidden) two.checked=false;
      const text=!settings.activated ? "Ce poste doit être activé par le personnel du CDI."
        : !settings.open ? settings.reason : settings.message || "";
      if($("#kiosk-state").textContent!==text) $("#kiosk-state").textContent=text;
      $("#kiosk-state").dataset.tone=!settings.activated||!settings.open?"warning":"info";
      const key=JSON.stringify(display.announcements);
      if(key!==newsKey){ newsKey=key; newsIndex=0; }
      renderPlaces(); renderNews(); renderDay(); renderRules(); applyTheme();
      if(!$("#borne-idle").hidden) updateIdle();
      if(before!==JSON.stringify(display)) armIdle();
      if (form.hidden) { form.reset(); }
      else if(wasHidden) input.focus({preventScroll:true});
    } catch {
      form.hidden=true;
      form.reset();
      $("#kiosk-state").textContent="La borne est momentanément indisponible.";
    } finally {refreshing=false;}
  }
  async function checkIn(direction,data,name="") {
    if(busy || form.hidden) return;
    if(direction==="entree" && closed) { confirmScreen("error","CDI fermé",$("#kiosk-state").textContent); return; }
    busy=true;
    results.querySelectorAll("button").forEach(button=>button.disabled=true);
    try {
      const result=await api("/borne/"+direction,"POST",data);
      const out=(result.direction ?? direction)==="sortie";
      confirmScreen(out?"out":"in",
        out?(name?`Au revoir ${name}`:"Sortie enregistrée"):result.already?(name?`${name}, tu es déjà enregistré·e`:"Tu es déjà enregistré·e"):(name?`Bienvenue ${name}`:"Bienvenue au CDI"),
        out?"À bientôt !":"Présence enregistrée jusqu’à "+time(result.expires_at));
      form.reset();
      clearSearch();
    } catch(error) {
      confirmScreen("error","Passage non enregistré",error.message);
      show(error.message,"error");
      results.querySelectorAll("button").forEach(button=>button.disabled=false);
    }
    finally {
      busy=false;
      card.classList.remove("is-scanning");
      refresh();
      input.focus({preventScroll:true});
    }
  }
  form.addEventListener("submit",event=>{
    event.preventDefault();
    const value=input.value.trim();
    if(nameSearchEnabled && value && !isCode(value)) {
      // Touche Entrée dans la recherche : un seul résultat suffit à entrer.
      if(rows.length===1) checkIn("entree",{ref:rows[0].ref,two_hours:two.checked},rows[0].label);
      else show(rows.length?"Touche ton nom dans la liste.":"Tape ton nom puis touche-le dans la liste.","info");
      return;
    }
    if(!value) return;
    const card=cardCode(value);
    if(!card) { confirmScreen("error","Carte illisible","Scanne à nouveau ta carte."); input.value=""; syncMode(); return; }
    checkIn("auto",{code:card,two_hours:two.checked});
  });
  tick();
  setInterval(tick,10_000);
  refresh();
  setInterval(refresh,5000);
  armIdle();
  kioskApp();
}

// Borne en application (PWA) : écran toujours allumé, reconnexion et mise à jour automatiques.
// L’installation passe par le menu du navigateur (aucun bouton sur la borne).
function kioskApp() {
  navigator.serviceWorker?.register(urlFor("/sw.js")).catch(()=>{});
  let lock=null;
  const keepAwake=async()=>{
    if(document.visibilityState!=="visible" || lock || !navigator.wakeLock) return;
    try { lock=await navigator.wakeLock.request("screen"); lock.addEventListener("release",()=>{lock=null;}); } catch { lock=null; }
  };
  keepAwake();
  document.addEventListener("visibilitychange",keepAwake);
  const banner=document.createElement("div");
  banner.className="offline-banner";
  banner.setAttribute("role","alert");
  banner.hidden=true;
  banner.innerHTML=`${icon("warning")}<span>Réseau indisponible · reconnexion automatique…</span>`;
  document.body.append(banner);
  const network=()=>{ banner.hidden=navigator.onLine; };
  addEventListener("online",()=>{ network(); keepAwake(); });
  addEventListener("offline",network);
  network();
  // Rechargement chaque nuit vers 4 h pour appliquer les mises à jour de l'application sans intervention.
  const next=new Date(); next.setHours(4,0,0,0);
  if(next<=new Date()) next.setDate(next.getDate()+1);
  setTimeout(()=>location.reload(),next-new Date());
}

function login(status) {
  const heading = status.setup ? "Configurer TiceCDI" : "Connexion à TiceCDI";
  app.innerHTML = `<div class="login-page">${header("login")}
    <main class="wrap login-layout" id="main"><nav class="crumb" aria-label="Fil d’Ariane"><a href="${urlFor("/")}">Accueil</a>${icon("chevron")} <span>Espace personnel</span></nav>
    <section class="panel login-card">${box("lock")}<h1>${heading}</h1><p class="subtle">${status.setup ? "Créez le premier compte administrateur du CDI." : "Connectez-vous avec le compte fourni par votre administrateur."}</p>
    <form id="login-form" class="stack">
      ${status.setup && status.keyRequired ? '<label class="field"><span>Clé d’installation</span><input name="key" type="password" required autocomplete="off"><small>La clé est dans les journaux Docker ou dans le dossier privé de l’installation PHP.</small></label>' : ""}
      ${status.setup ? '<label class="field"><span>Nom d’affichage</span><input name="name" placeholder="Ex. Thomas Luc" maxlength="100" required autocomplete="name"></label>' : ""}
      <div id="password-step" class="stack">
      <label class="field"><span>Identifiant</span><input name="username" autocomplete="username" maxlength="80" required></label>
      <label class="field"><span>Mot de passe</span><input name="password" type="password" autocomplete="${status.setup ? "new-password" : "current-password"}" required maxlength="160" ${status.setup ? 'minlength="12"' : ""}>${status.setup ? "<small>12 caractères au minimum.</small>" : ""}</label>
      </div>
      ${status.setup ? "" : `<div id="mfa-step" class="mfa-step" hidden>${notice("Votre compte est protégé par la double authentification.", "", "shield")}
        <label class="field"><span>Code de vérification</span><input name="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="12" placeholder="123 456"><small>Code à 6 chiffres de votre application, ou un code de secours (xxxx-xxxx).</small></label></div>`}
      ${status.setup && status.demoAllowed ? '<label class="check-line"><input name="demo" type="checkbox" checked> Ajouter des élèves fictifs pour essayer la borne</label>' : ""}
      <div id="login-error" aria-live="polite" hidden></div>
      <button class="btn primary" type="submit">${icon(status.setup ? "check" : "login")} ${status.setup ? "Créer mon compte" : "Se connecter"}</button>
      ${!status.setup && status.sso?.enabled ? `<div class="sso-divider"><span>ou</span></div><a class="btn secondary sso-button" id="sso-link" href="${urlFor("/api/auth/sso/start")}">${icon("shield")} Se connecter avec ${e(status.sso.label)}</a>` : ""}
    </form></section></main>${footer}</div>`;
  const params = new URLSearchParams(location.search);
  const intro = params.get("sso") === "echec" ? ["La connexion par l’ENT a échoué ou aucun compte TiceCDI ne correspond à votre identifiant. Contactez l’administrateur du CDI.", "error"]
    : params.has("expire") ? ["Votre session a expiré. Reconnectez-vous.", ""] : null;
  if (intro) { $("#login-error").innerHTML = notice(...intro); $("#login-error").hidden = false; }
  const challenge = !status.setup && params.get("etape") === "code";
  if (challenge) {
    // Retour de l’ENT : seul le code de double authentification reste à saisir.
    $("#password-step").remove();
    $("#sso-link")?.remove();
    $("#mfa-step").hidden = false;
    $("#login-form [name=code]").required = true;
    $("#login-form [type=submit]").innerHTML = icon("check") + " Vérifier";
  }
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    data.demo = Boolean(form.elements.demo?.checked);
    const submit = $("[type=submit]", form);
    const target = $("#login-error");
    submit.disabled = true;
    target.hidden = true;
    try {
      const result = await api("/auth/" + (challenge ? "challenge" : status.setup ? "setup" : "login"), "POST", challenge ? { code:data.code } : data);
      if (result.mfa) {
        // Deuxième étape : code de l’application d’authentification ou code de secours.
        $("#mfa-step", form).hidden = false;
        $("#password-step", form).hidden = true;
        const code = form.elements.code;
        code.required = true;
        code.focus();
        submit.innerHTML = icon("check") + " Vérifier";
        submit.disabled = false;
        return;
      }
      location.assign(urlFor("/gestion"));
    }
    catch (error) {
      target.innerHTML = notice(error.message, "error"); target.hidden = false; submit.disabled = false;
      if (error.status === 401 && form.elements.code && !$("#mfa-step", form).hidden) { form.elements.code.value = ""; form.elements.code.focus(); }
      if (challenge && /expiré/.test(error.message)) setTimeout(() => location.assign(urlFor("/connexion")), 2500);
    }
  });
}

// Droits par rubrique : [libellé, droit « consulter », droit « gérer », précision].
// Rubriques : [libellé, droit « consulter », droit « gérer », aide, droit « exporter »].
const rightAreas = [
  ["Présences", "presence", "sorties", "Gérer : prolonger et enregistrer les sorties"],
  ["Planning du CDI", "planning_voir", "planning", "Gérer : créer, déplacer et supprimer des créneaux", "export_planning"],
  ["Fiches d’appel", "seances_voir", "arrivees", "Gérer : faire l’appel et pointer une classe ou un groupe", "export_appel"],
  ["Exclusions", "exclusions_voir", "exclusions", "Gérer : exclure un élève et lever une exclusion"],
  ["Élèves", "eleves_voir", "eleves", "Gérer : ajouter, modifier et retirer des fiches"],
  ["Classes", "classes_voir", "classes", "Gérer : créer, renommer et supprimer des classes"],
  ["Groupes hors classe", "groupes_voir", "groupes", "Gérer : composer et archiver des groupes"],
  ["Dossiers individuels", "dossiers_voir", "donnees", "Gérer : rectifier l’identité et la classe d’un élève", "export_dossiers"],
  ["Réglages et horaires de la borne", "reglages_voir", "reglages", "Gérer : ouverture, capacité, message et horaires"],
  ["Statistiques", "statistiques", null, "", "export_statistiques"],
  ["Journal des modifications", "journal", null, ""],
  ["Comptes du personnel", "comptes_voir", "comptes", "Gérer : créer, modifier et supprimer des comptes (dans la limite de ses propres droits)"],
];
const rightActions = [
  ["import", "Importer des élèves (CSV, Pronote, SIECLE)"], ["badges", "Imprimer les cartes codes-barres"], ["borne", "Activer des postes de borne"],
  ["effacer", "Effacer un dossier individuel sur demande validée"],
  ["sauvegarde", "Créer et télécharger les sauvegardes chiffrées"], ["restaurer", "Restaurer une sauvegarde"],
];
const rightNames = Object.fromEntries([
  ...rightAreas.flatMap(([label, view, manage, , exportKey]) => [[view, label + (manage ? " (consulter)" : "")], ...(manage ? [[manage, label + " (gérer)"]] : []), ...(exportKey ? [[exportKey, label + " (exporter)"]] : [])]),
  ...rightActions,
]);
// Résumé lisible : une rubrique gérée n’affiche pas aussi « consulter ».
function rightsSummary(rights) {
  const areas = rightAreas.map(([label, view, manage, , exportKey]) => {
    const level = rights.includes(manage) ? label + " · gérer" : rights.includes(view) ? label + (manage ? " · consulter" : "") : "";
    return level && exportKey && rights.includes(exportKey) ? level + " + export" : level;
  }).filter(Boolean);
  return [...areas, ...rightActions.filter(([key]) => rights.includes(key)).map(([, label]) => label)].join(", ");
}
// Menu de gestion : [clé, titre de la page, icône, droits, groupe, libellé court du menu].
const tabs = [
  ["presences", "Présences", "users", ["presence", "sorties", "arrivees"], "jour"],
  ["planning", "Planning du CDI", "calendar", ["planning","planning_voir"], "jour", "Planning"],
  ["seances", "Fiches d’appel", "check", ["arrivees","seances_voir"], "jour"],
  ["exclusions", "Exclusions", "ban", ["exclusions","exclusions_voir"], "jour"],
  ["statistiques", "Statistiques", "chart", ["statistiques"], "jour"],
  ["eleves", "Élèves", "user", ["eleves","eleves_voir"], "eleves"],
  ["classes", "Classes", "grid", ["classes","classes_voir"], "eleves"],
  ["groupes", "Groupes hors classe", "users", ["groupes","groupes_voir"], "eleves", "Groupes"],
  ["import", "Importer des élèves", "upload", ["import"], "eleves", "Importer"],
  ["badges", "Codes-barres", "scan", ["badges"], "eleves"],
  ["dossiers", "Dossiers individuels", "users", ["dossiers_voir","donnees"], "eleves", "Dossiers"],
  ["borne-poste", "Activation de la borne", "scan", ["borne"], "borne", "Postes de borne"],
  ["reglages", "Réglages de la borne", "settings", ["reglages","reglages_voir"], "borne", "Réglages et horaires"],
  ["comptes", "Comptes et droits", "lock", ["comptes","comptes_voir"], "admin", "Comptes"],
  ["connexion", "Connexion et sécurité", "shield", ["admin"], "admin", "Connexion"],
  ["annees", "Années scolaires", "calendar", ["admin"], "admin"],
  ["journal", "Journal des modifications", "chart", ["journal"], "admin", "Journal"],
  ["sauvegarde", "Sauvegarde et restauration", "download", ["sauvegarde","restaurer"], "admin", "Sauvegardes"],
  ["confidentialite", "Établissement et données personnelles", "info", ["admin"], "admin", "Données personnelles"],
  ["securite", "Sécurité du compte", "shield", ["self"], "compte", "Sécurité du compte"],
];
const tabGroups = { jour:"Au quotidien", eleves:"Élèves et classes", borne:"Borne", admin:"Administration", compte:"Mon compte" };
const menuKey = "ticecdi-menu";
function menuState() { try { return JSON.parse(localStorage.getItem(menuKey)) || {}; } catch { return {}; } }
function saveMenuState(state) { try { localStorage.setItem(menuKey, JSON.stringify(state)); } catch { /* navigateur sans stockage */ } }
let me, view, records = [], classes = [], activeFilters = { q:"", class:"", archived:"" }, toastTimer, refreshTimer, rosterVersion = 0;
const can = (right) => right === "self" || (right === "admin" ? me.admin : me.rights.includes(right));
const gestion = (resource, method, body) => api("/gestion/" + resource, method, body);
const rowAction = (text, glyph, action, id, mode = "secondary tiny") => button(text, glyph, `data-action="${action}" data-id="${e(id)}"`, mode);
const classOptions = () => classes.map((row) => `<option value="${e(row.id)}" ${row.id === activeFilters.class ? "selected" : ""}>${e(row.name)}</option>`).join("");
const empty = (title, message, symbol = "users") => `<div class="empty">${box(symbol)}<strong>${title}</strong><p>${message}</p></div>`;
const table = (heads, rows) => `<div class="scroll-table"><table><thead><tr>${heads.map((head) => `<th scope="col">${head}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
const identity = (row) => `<strong>${fullName(row)}</strong>`;
const filter = (kind = "all") => `<form class="filter-form" id="filters" role="search">
    ${kind === "all" ? `<label class="with-icon">${icon("search")}<input class="input" type="search" name="q" aria-label="Rechercher un élève" placeholder="Rechercher un élève" value="${e(activeFilters.q)}"></label>` : ""}
    <label><select class="input" name="class" aria-label="Filtrer par classe"><option value="">Toutes les classes</option>${classOptions()}</select></label>
    ${view === "eleves" && can("eleves") ? `<label class="check-line"><input type="checkbox" name="archived" ${activeFilters.archived ? "checked" : ""}> Fiches retirées</label>` : ""}</form>`;
function toast(message, tone = "success") {
  const target = $("#toast");
  clearTimeout(toastTimer);
  target.innerHTML = notice(message, tone);
  target.hidden = false;
  toastTimer = setTimeout(() => { target.hidden = true; }, 4700);
}
function section(title, desc, actions = "") {
  return `<nav class="crumb" aria-label="Fil d’Ariane"><span>TiceCDI</span>${icon("chevron")}<span>${title}</span></nav>
  <div class="page-head"><div><h1>${title}</h1><p>${desc}</p></div><div class="head-actions">${actions}</div></div>`;
}
function adminShell(user, selected) {
  me = user;
  // Double authentification exigée par l’établissement : seule la page « Sécurité du compte » reste accessible.
  const visible = tabs.filter((tab) => (user.mfa_missing ? tab[0] === "securite" : tab[3].some(can)));
  const selectedTab = visible.find((entry) => entry[0] === selected) ?? visible[0];
  if (!selectedTab) { login({ setup:false }); return; }
  view = selectedTab[0];
  if (routePath() !== "/gestion/" + view) history.replaceState(null, "", urlFor("/gestion/" + view));
  app.innerHTML = `<div class="admin-bg">${header("admin",can("borne"))}<div class="wrap admin-shell">
    <aside class="sidebar"><p class="sidebar-title">Espace de gestion</p><nav aria-label="Administration du CDI">
      ${menu(visible)}
    </nav><p class="user-info">${icon("user")}${e(me.name)}</p></aside>
    <main class="admin-main" id="main" tabindex="-1">${loader()}</main>
    <dialog class="dialog" id="dialog" aria-labelledby="dialog-title"></dialog><div role="status" class="toast" id="toast" hidden></div>
    </div></div>`;
  $(".side-link[aria-current]")?.scrollIntoView({ block:"nearest", inline:"center" });
  for (const toggle of $$(".side-toggle")) toggle.addEventListener("click", () => {
    const group = toggle.closest(".side-group");
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    group.classList.toggle("collapsed", !open);
    const state = menuState();
    state[group.dataset.group] = open;
    saveMenuState(state);
  });
  $("#logout").addEventListener("click", async () => {
    try { await api("/auth/logout", "POST"); location.assign(urlFor("/connexion")); }
    catch (error) { toast(error.message, "error"); }
  });
  $("#main").addEventListener("click", actionHandler);
  // Navigation dans l’espace de gestion sans recharger la page : seul le contenu change.
  $(".sidebar nav").addEventListener("click", (event) => {
    const link = event.target.closest("a.side-link");
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const key = new URL(link.href).pathname.split("/").filter(Boolean).at(-1);
    if (!visible.some((tab) => tab[0] === key)) return;
    event.preventDefault();
    go(key, true);
  });
  addEventListener("popstate", () => {
    const key = routePath().split("/")[2];
    if (visible.some((tab) => tab[0] === key) && key !== view) go(key, false);
  });
  showPage().then(() => { if (me.admin && !me.mfa_missing) securityAlerts($("#main")); });
}
let rendering = false, pendingRender = false;
// Affiche la page demandée ; un écran de chargement n’apparaît que si l’attente se prolonge (voir .page-loader).
async function showPage() {
  if (rendering) { pendingRender = true; return; }
  rendering = true;
  document.body.classList.add("is-navigating");
  try { await render(); }
  catch (error) { pageError(error); }
  finally {
    rendering = false;
    document.body.classList.remove("is-navigating");
    if (pendingRender) { pendingRender = false; showPage(); }
  }
}
function go(key, push) {
  if (key === view && push) return;
  view = key;
  if (push) history.pushState(null, "", urlFor("/gestion/" + key));
  for (const link of $$(".side-link")) {
    const current = new URL(link.href).pathname.split("/").filter(Boolean).at(-1) === key;
    if (current) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    if (current) link.closest(".side-group")?.classList.remove("collapsed");
  }
  $("#dialog")?.open && $("#dialog").close();
  $("#main").innerHTML = loader();
  $("#main").focus({ preventScroll:true });
  scrollTo({ top:0 });
  showPage();
}

// Sections repliables ; la section de la page ouverte est toujours dépliée, les autres gardent le dernier choix.
function menu(visible) {
  const state = menuState();
  return Object.entries(tabGroups).map(([group, label]) => {
    const items = visible.filter((tab) => tab[4] === group);
    if (!items.length) return "";
    const open = items.some((tab) => tab[0] === view) || state[group] !== false;
    const link = ([key, title, glyph, , , short]) => `<a class="side-link" href="${urlFor("/gestion/" + key)}" ${key === view ? 'aria-current="page"' : ""} title="${e(title)}">${icon(glyph)}<span>${e(short ?? title)}</span></a>`;
    if (visible.length <= 6) return items.map(link).join("");
    return `<div class="side-group ${open ? "" : "collapsed"}" data-group="${group}">
      <button type="button" class="side-toggle" aria-expanded="${open}" aria-controls="menu-${group}">${e(label)}${icon("chevron")}</button>
      <div class="side-items" id="menu-${group}">${items.map(link).join("")}</div></div>`;
  }).join("");
}
// Consultation seule : boutons d’édition retirés, champs désactivés, mention « Consultation » dans l’en-tête.
function readOnlyPill() { return `<span class="pill read-only-pill">${icon("info")} Consultation seule</span>`; }
function lockPage(target, remove, disable = "") {
  target.querySelectorAll(remove).forEach((node) => node.remove());
  if (disable) target.querySelectorAll(disable).forEach((node) => { node.disabled = true; });
  const actions = target.querySelector(".head-actions");
  if (actions && !actions.querySelector(".read-only-pill")) actions.insertAdjacentHTML("afterbegin", readOnlyPill());
}
function pageError(error) {
  if (error.status === 401) location.assign(urlFor("/connexion?expire=1"));
  else $("#main").innerHTML = `<div class="panel panel-body">${notice(error.message, "error")}</div>`;
}
async function render() {
  clearInterval(refreshTimer);
  clearTimeout(presenceExpiryTimer);
  clearTimeout(filterDebounce);
  if (["presences", "eleves", "classes", "badges"].includes(view)) classes = (await gestion("classes")).rows;
  if (view === "presences") {
    $("#main").innerHTML = section("Présences au CDI", "Consultez les élèves présents et leur heure de départ prévue.", button("Actualiser", "refresh", 'data-action="refresh"') + (can("arrivees") ? button("Arrivée groupée","users",'data-action="class-arrival"',"primary") : ""))
      + '<div id="metrics" class="metrics"></div><section class="panel table-panel"><div class="table-top"><h2>Élèves présents</h2>'
      + filter() + '</div><div id="roster"></div></section>';
    bindFilters(renderPresence);
    await fetchPresence();
    refreshTimer = setInterval(refreshPresence, 10_000);
  } else if (view === "eleves") {
    $("#main").innerHTML = section("Élèves", "Consultez les fiches élèves et modifiez leur affectation.", can("eleves") ? button("Ajouter un élève", "plus", 'data-action="student-new"', "primary") : readOnlyPill())
      + '<section class="panel table-panel"><div class="table-top"><h2>Annuaire des élèves</h2>' + filter() + '</div><div id="roster"></div></section>';
    bindFilters(fetchStudents);
    await fetchStudents();
  } else if (view === "classes") {
    $("#main").innerHTML = section("Classes", "Créez les classes et retrouvez les effectifs associés.", can("classes") ? button("Créer une classe", "plus", 'data-action="class-new"', "primary") : readOnlyPill())
      + `<section class="panel table-panel"><div class="table-top"><h2>Classes enregistrées</h2>${pill(classes.length + " classe" + (classes.length !== 1 ? "s" : ""))}</div>`
      + (classes.length ? table(["Classe", "Élèves", ...(can("classes") ? ["Actions"] : [])], classes.map((row) =>
          `<tr><td><strong>${e(row.name)}</strong></td><td>${row.total}</td>${can("classes") ? `<td><div class="button-row">${rowAction("Modifier","edit","class-edit",row.id)}${rowAction("Supprimer","trash","class-delete",row.id,"danger tiny")}</div></td>` : ""}</tr>`))
        : empty("Aucune classe", "Créez une classe ou importez un fichier élèves.", "grid")) + "</section>";
  } else if (view === "import") {
    renderImport();
  } else if (view === "planning") {
    const noticeSettings=await api("/notice");
    await renderPlanning($("#main"),{section,dialogForm,confirmDialog,toast,showScreenLink:noticeSettings.public_planning, canExport:can("export_planning"), readOnly:!can("planning"),
      openClassArrival:can("arrivees") ? (classes,options)=>startCall(classes,dialogForm,options) : null});
  } else if (view === "seances") {
    await renderSessions($("#main"),{section,dialogForm,toast,canExport:can("export_appel")});
    if (!can("arrivees")) lockPage($("#main"), "#new-call,#keep-at-cdi,#finish-call", ".call-status");
  } else if (view === "groupes") {
    await renderGroups($("#main"),{section,dialogForm,toast});
    if (!can("groupes")) lockPage($("#main"), "#new-group,[data-group]");
  } else if (view === "securite") {
    await renderSecurity($("#main"),{section,toast,me});
  } else if (view === "connexion") {
    await renderConnection($("#main"),{section,toast});
  } else if (view === "journal") {
    await renderJournal($("#main"),{section,toast});
  } else if (view === "sauvegarde") {
    await renderBackup($("#main"),{section,toast,confirmDialog,canExport:can("sauvegarde"),canRestore:can("restaurer")});
  } else if (view === "annees") {
    await renderYears($("#main"),{section,toast,confirmDialog,readCsv});
  } else if (view === "statistiques") {
    await renderStatistics($("#main"),{section,toast,canExport:can("export_statistiques")});
  } else if (view==="confidentialite") {
    await renderPrivacy($("#main"),{section,toast,confirmDialog});
  } else if (view==="dossiers") {
    await renderDossier($("#main"),{section,toast,dialogForm,canExport:can("export_dossiers"),canRectify:can("donnees"),canErase:can("effacer"),readOnlyPill});
  } else if (view==="borne-poste") {
    await renderDevices($("#main"),{section,toast,me,confirmDialog});
  } else if (view === "reglages") {
    await renderKioskSettings();
    await openingForm($("#main"),toast);
    if (!can("reglages")) lockPage($("#main"), "form [type=submit],[data-hours],.opening-form button", "form input,form select,form textarea");
  } else if (view === "badges") {
    $("#main").innerHTML = section("Codes-barres", "Imprimez les cartes CDI à distribuer aux élèves.", button("Imprimer la planche", "print", 'data-action="print" disabled', "primary"))
      + `<section class="panel badge-panel"><div class="table-top"><h2>Planche de cartes CDI</h2>${filter("class")}</div><p class="hint">Format A4 · 3 cartes par ligne à l’impression</p><div id="roster"></div></section>`;
    bindFilters(fetchBadges);
    await fetchBadges();
  } else if (view === "exclusions") {
    const list = await gestion("exclusions");
    records = list.rows;
    const active = (row) => !row.revoked_at && row.until_day >= list.today;
    $("#main").innerHTML = section("Exclusions", "Consultez les motifs et les dates de fin. Une exclusion active empêche le pointage à la borne.", can("exclusions") ? button("Ajouter une exclusion", "plus", 'data-action="exclude-new"', "primary") : readOnlyPill())
      + `<section class="panel table-panel"><div class="table-top"><h2>Registre des exclusions</h2>${pill(records.filter(active).length + " en cours")}</div>`
      + (records.length ? table(["Élève", "Motif", "Jusqu’au", "État", "Actions"], records.map((row) =>
        `<tr><td>${identity(row)}<small>${e(row.class_name)}</small></td><td class="multiline">${e(row.reason)}<small>Par ${e(row.author)} · ${day(row.created_at)}</small></td><td>${day(row.until_day)}</td>
        <td>${active(row) ? pill("En cours","red") : pill(row.revoked_at ? "Levée" : "Terminée","gray")}</td><td>${active(row) && can("exclusions") ? rowAction("Lever","check","exclude-lift",row.id) : "—"}</td></tr>`))
        : empty("Aucune exclusion enregistrée", "Les exclusions du CDI apparaîtront ici.", "ban")) + "</section>";
  } else if (view === "comptes") {
    records = (await gestion("comptes")).rows;
    $("#main").innerHTML = section("Comptes et droits", "Attribuez les accès au personnel du CDI, à la vie scolaire et aux autres services.", can("comptes") ? button("Créer un compte", "plus", 'data-action="account-new"', "primary") : readOnlyPill())
      + '<section class="panel table-panel"><div class="table-top"><h2>Comptes du personnel</h2></div>'
      + table(["Compte", "Accès", "Double authentification", "Actions"], records.map((row) => {
        const editable = me.admin || (can("comptes") && !row.admin && row.id !== me.id && row.rights.every(can));
        return `<tr><td><strong>${e(row.name)}</strong><small>${e(row.username)}${row.id === me.id ? " · Votre compte" : ""}</small></td>
          <td class="multiline">${row.admin ? pill("Administrateur") : e(rightsSummary(row.rights))}</td>
          <td>${row.mfa ? pill("Activée","green") : pill("Non","gray")}</td>
          <td>${editable ? `<div class="button-row">${rowAction("Modifier","edit","account-edit",row.id)}${me.admin && row.mfa && row.id !== me.id ? rowAction("Réinitialiser la 2FA","refresh","account-mfa-reset",row.id) : ""}${row.id !== me.id ? rowAction("Supprimer","trash","account-delete",row.id,"danger tiny") : ""}</div>` : "—"}</td></tr>`;
      })) + "</section>";
  }
}

let filterDebounce;
function bindFilters(update) {
  const form = $("#filters");
  const apply = () => {
    activeFilters = { q:form.elements.q?.value ?? "", class:form.elements.class.value, archived:form.elements.archived?.checked ? "1" : "" };
    Promise.resolve(update()).catch((error) => toast(error.message, "error"));
  };
  form.addEventListener("submit", (event) => { event.preventDefault(); clearTimeout(filterDebounce); apply(); });
  form.elements.class.addEventListener("change", () => { clearTimeout(filterDebounce); apply(); });
  form.elements.archived?.addEventListener("change", apply);
  form.elements.q?.addEventListener("input", () => { clearTimeout(filterDebounce); filterDebounce = setTimeout(apply, 185); });
}
let presenceNow = Date.now(), places=null, capacity=null, presenceExpiryTimer;
function refreshPresence() {
  // Actualisation automatique : ne compte pas comme une activité pour la déconnexion après inactivité.
  fetchPresence(true).catch(error => { if (error.status === 401) pageError(error); else toast(error.message, "error"); });
}
async function fetchPresence(background = false) {
  const version = ++rosterVersion;
  const result = await api("/gestion/presences", "GET", undefined, { background });
  if (version !== rosterVersion) return;
  records = result.rows;
  presenceNow = result.now;
  places=result.places;
  capacity=result.capacity;
  clearTimeout(presenceExpiryTimer);
  const nextExpiry = records[0]?.expires_at - presenceNow;
  if (nextExpiry > 0 && nextExpiry < 10_000) presenceExpiryTimer = setTimeout(refreshPresence, nextExpiry);
  renderPresence();
}
function renderPresence() {
  const roster = $("#roster");
  if (!roster) return;
  const query = activeFilters.q.trim().normalize("NFD").replace(/\p{M}/gu,"").toLowerCase().split(/\s+/).filter(Boolean);
  const group = classes.find((row) => row.id === activeFilters.class)?.name;
  const visible = records.filter((row) => {
    const name = (row.first_name + " " + row.last_name).normalize("NFD").replace(/\p{M}/gu,"").toLowerCase();
    return (!group || group === row.class_name) && query.every((word) => name.includes(word));
  });
  const metrics = [
    ["users",records.length,"Élèves présents"], ["clock",records.filter((row) => row.expires_at - presenceNow <= 15 * 60_000).length,"Départs dans les 15 min"],
    ["grid",capacity===null ? new Set(records.map(row=>row.class_name)).size : places,capacity===null ? "Classes représentées" : "Places disponibles sur "+capacity],
  ];
  $("#metrics").innerHTML = metrics.map(([glyph, value, title]) => `<div class="metric">${box(glyph)}<div><b>${value}</b><span>${title}</span></div></div>`).join("");
  const actions = can("sorties") || can("exclusions");
  roster.innerHTML = visible.length ? table(["Élève","Classe","Arrivée","Départ prévu",...(actions ? ["Actions"] : [])], visible.map((row) =>
    `<tr><td>${identity(row)}</td><td>${pill(row.class_name,"gray")}</td><td>${time(row.starts_at)}${row.source === "classe" ? "<small>En classe</small>" : row.source === "groupe" ? "<small>En groupe</small>" : ""}</td>
    <td>${pill(time(row.expires_at),row.expires_at - presenceNow <= 15 * 60_000 ? "gray" : "green")}</td>
    ${actions ? `<td><div class="button-row">${can("sorties") ? rowAction("Prolonger","clock","visit-extend",row.id) + rowAction("Sortie","logout","visit-close",row.id) : ""}${can("exclusions") ? rowAction("Exclure","ban","exclude-visit",row.id,"danger tiny") : ""}</div></td>` : ""}</tr>`))
    : empty(records.length ? "Aucun résultat" : "Aucun élève présent", records.length ? "Modifiez la recherche ou le filtre de classe." : "Les élèves apparaissent ici dès leur passage à la borne.");
}
async function fetchStudents() {
  const version = ++rosterVersion;
  const result = await gestion("eleves/recherche","POST",activeFilters);
  if (version !== rosterVersion) return;
  records = result.rows;
  // Les codes CDI ne sont pas renvoyés par l’annuaire : ils restent réservés à la planche des codes-barres.
  const editable = can("eleves");
  $("#roster").innerHTML = records.length ? table(["Élève","Classe",...(editable ? ["Actions"] : [])], records.map((row) =>
    `<tr><td>${identity(row)}</td><td>${pill(row.class_name,"gray")}</td>
    ${editable ? `<td><div class="button-row">${rowAction("Modifier","edit","student-edit",row.id)}${activeFilters.archived ? rowAction("Réactiver","check","student-restore",row.id) : rowAction("Retirer","trash","student-delete",row.id,"danger tiny")}</div></td>` : ""}</tr>`))
    : empty("Aucun élève trouvé","Ajoutez un élève ou modifiez les filtres.", "user");
}
async function fetchBadges() {
  const version = ++rosterVersion;
  const print = $('[data-action="print"]');
  print.disabled = true;
  const result = await gestion("eleves?" + new URLSearchParams({ badges:"1", class:activeFilters.class }));
  if (version !== rosterVersion) return;
  records = result.rows;
  print.disabled = !records.length;
  $("#roster").innerHTML = records.length ? `<div class="badge-grid">${records.map((row) =>
    `<article class="badge"><b>${fullName(row)}</b><small>${e(row.class_name)} · Carte CDI</small>${renderBarcode(row.code)}<code>${e(row.code)}</code></article>`).join("")}</div>`
    : empty("Aucune carte à imprimer", "Ajoutez des élèves ou sélectionnez une autre classe.", "scan");
}

// Affichage de la borne : places, annonces colorées, planning du jour, règles, écran de repos, animation et thème.
const tones = [["info","Information (bleu)"],["succes","Bonne nouvelle (vert)"],["attention","Attention (orange)"],["alerte","Important (rouge)"],["evenement","Événement (violet)"]];
const announceRow = (item = { text:"", tone:"info" }) => `<div class="announce-row">
  <input class="input" name="announce-text" maxlength="160" value="${e(item.text)}" placeholder="Ex. Nouveaux mangas au rayon BD" aria-label="Texte de l’annonce">
  <select class="input" name="announce-tone" aria-label="Couleur de l’annonce">${tones.map(([value,label]) => `<option value="${value}" ${item.tone===value?"selected":""}>${label}</option>`).join("")}</select>
  ${button("Retirer","trash",'data-remove-announce',"secondary tiny")}</div>`;
function displayPanel(d) {
  const hours = (selected) => Array.from({ length:24 }, (_, h) => `<option value="${h}" ${h===selected?"selected":""}>${h} h</option>`).join("");
  const delays = [[30,"30 secondes"],[60,"1 minute"],[120,"2 minutes"],[300,"5 minutes"],[600,"10 minutes"]];
  return `<section class="panel panel-body settings-panel display-panel" aria-label="Affichage de la borne"><h2>Affichage de la borne</h2>
    <form id="display-settings" class="stack">
      <div class="display-grid">
        <fieldset class="settings-options"><legend>Éléments affichés</legend>
          <label class="check-line"><input type="checkbox" name="show_places" ${d.show_places?"checked":""}> Places libres en grand (si une capacité est indiquée)</label>
          <label class="check-line"><input type="checkbox" name="show_planning" ${d.show_planning?"checked":""}> Planning du jour (ouvert, réservé, fermé)</label>
          <label class="check-line"><input type="checkbox" name="scan_animation" ${d.scan_animation?"checked":""}> Animation pendant la lecture d’une carte</label>
          <label class="field"><span>Durée de la confirmation</span><input type="number" name="confirm_seconds" min="2" max="10" value="${d.confirm_seconds}"><small>En secondes, de 2 à 10.</small></label>
        </fieldset>
        <fieldset class="settings-options"><legend>Écran de repos et thème</legend>
          <label class="check-line"><input type="checkbox" name="idle_enabled" ${d.idle_enabled?"checked":""}> Écran de repos (horloge, état du CDI, annonce, règles)</label>
          <label class="field"><span>Afficher l’écran de repos après</span><select class="input" name="idle_delay">${delays.map(([v,l]) => `<option value="${v}" ${v===d.idle_delay?"selected":""}>${l}</option>`).join("")}${delays.some(([v]) => v===d.idle_delay)?"":`<option value="${d.idle_delay}" selected>${d.idle_delay} s</option>`}</select></label>
          <label class="field"><span>Thème de la borne</span><select class="input" name="theme">
            <option value="clair" ${d.theme==="clair"?"selected":""}>Clair</option><option value="sombre" ${d.theme==="sombre"?"selected":""}>Sombre</option>
            <option value="horaire" ${d.theme==="horaire"?"selected":""}>Sombre à certaines heures</option></select></label>
          <div class="button-row" id="dark-hours" ${d.theme==="horaire"?"":"hidden"}>
            <label class="field"><span>Sombre à partir de</span><select class="input" name="dark_from">${hours(d.dark_from)}</select></label>
            <label class="field"><span>Jusqu’à</span><select class="input" name="dark_to">${hours(d.dark_to)}</select></label></div>
        </fieldset>
      </div>
      <fieldset class="settings-options"><legend>Annonces</legend>
        <p class="hint">Six au maximum, affichées à tour de rôle (8 secondes chacune). La couleur indique le type d’annonce.</p>
        <div class="announce-list" id="announce-list">${d.announcements.map(announceRow).join("")}</div>
        <div>${button("Ajouter une annonce","plus",'id="announce-add"')}</div>
      </fieldset>
      <label class="field"><span>Règles du CDI</span><textarea class="input" name="rules" rows="4" maxlength="500" placeholder="Une règle par ligne">${e(d.rules.join("\n"))}</textarea>
        <small>Une règle par ligne, six au maximum. Affichées sous la borne et sur l’écran de repos.</small></label>
      <div class="form-actions"><button type="submit" class="btn primary">${icon("check")} Enregistrer l’affichage</button></div>
    </form></section>`;
}
function bindDisplayPanel() {
  const form = $("#display-settings");
  if (!can("reglages")) { form.querySelectorAll("input,select,textarea,button").forEach((node) => { node.disabled = true; }); return; }
  const list = $("#announce-list");
  const sync = () => { $("#announce-add").disabled = list.children.length >= 6; };
  sync();
  $("#announce-add").addEventListener("click", () => { list.insertAdjacentHTML("beforeend", announceRow()); sync(); list.lastElementChild.querySelector("input").focus(); });
  list.addEventListener("click", (event) => { if (event.target.closest("[data-remove-announce]")) { event.target.closest(".announce-row").remove(); sync(); } });
  form.elements.theme.addEventListener("change", () => { $("#dark-hours").hidden = form.elements.theme.value !== "horaire"; });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = {
      show_places:form.elements.show_places.checked, show_planning:form.elements.show_planning.checked, scan_animation:form.elements.scan_animation.checked,
      confirm_seconds:Number(form.elements.confirm_seconds.value), idle_enabled:form.elements.idle_enabled.checked, idle_delay:Number(form.elements.idle_delay.value),
      theme:form.elements.theme.value, dark_from:Number(form.elements.dark_from.value), dark_to:Number(form.elements.dark_to.value),
      announcements:[...list.querySelectorAll(".announce-row")].map((row) => ({ text:row.querySelector("input").value, tone:row.querySelector("select").value })).filter((item) => item.text.trim()),
      rules:form.elements.rules.value.split("\n").map((rule) => rule.trim()).filter(Boolean).slice(0, 6),
    };
    const submit = form.querySelector("[type=submit]");
    submit.disabled = true;
    try { await gestion("borne/affichage", "PATCH", data); toast("Affichage de la borne enregistré. Il s’applique sur la borne en quelques secondes."); }
    catch (error) { toast(error.message, "error"); }
    finally { submit.disabled = false; }
  });
}
async function renderKioskSettings() {
  const [settings, display] = await Promise.all([gestion("reglages"), gestion("borne/affichage")]);
  $("#main").innerHTML = section("Réglages de la borne", "Gérez les inscriptions et le message visible par les élèves.")
    + `<section class="panel panel-body settings-panel" aria-label="Options de la borne">
      <form id="kiosk-settings" class="stack">
        <fieldset class="settings-options"><legend>Inscriptions</legend>
          <label class="check-line"><input type="checkbox" name="open" ${settings.open ? "checked" : ""}> Accepter les nouvelles arrivées</label>
          <p class="hint">La fermeture temporaire conserve les présences en cours.</p>
          <label class="check-line"><input type="checkbox" name="second_hour" ${settings.second_hour ? "checked" : ""}> Autoriser une deuxième heure</label>
          <p class="hint">Si la case est décochée, les nouveaux départs sont fixés à la prochaine heure pleine.</p>
        </fieldset>
        <label class="field"><span>Capacité du CDI</span><input type="number" name="capacity" min="1" max="1000" step="1" value="${e(settings.capacity)}" placeholder="Ex. 30">
          <small>Laisse vide pour un accueil sans limite de places.</small></label>
        <label class="check-line"><input type="checkbox" name="hide_weekend" ${settings.hide_weekend?"checked":""}> Masquer samedi et dimanche dans le planning, la vue écran et le PDF</label>
        <label class="field"><span>Message d’accueil</span><input name="message" value="${e(settings.message)}" maxlength="180" placeholder="Ex. Les ordinateurs sont réservés aux recherches.">
          <small>Facultatif · 180 caractères maximum</small></label>
        <div class="form-actions"><button type="submit" class="btn primary">${icon("check")} Enregistrer les réglages</button></div>
      </form>
    </section>` + displayPanel(display);
  bindDisplayPanel();
  $("#kiosk-settings").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const inputs = [...form.elements].filter((element) => ["INPUT", "BUTTON"].includes(element.tagName));
    const data = { open:form.elements.open.checked, second_hour:form.elements.second_hour.checked, message:form.elements.message.value,
      capacity:form.elements.capacity.value ? Number(form.elements.capacity.value) : null, hide_weekend:form.elements.hide_weekend.checked };
    inputs.forEach((input) => { input.disabled = true; });
    try {
      const saved = await gestion("reglages", "PATCH", data);
      form.elements.message.value = saved.message;
      toast("Réglages de la borne enregistrés.");
    } catch (error) { toast(error.message, "error"); }
    finally { inputs.forEach((input) => { input.disabled = false; }); }
  });
}

function downloadSample() {
  const file = new Blob(["\uFEFFNom;Prénom;Classe;Identifiant externe\r\nMartin;Camille;6e A;EXEMPLE-01\r\nBernard;Noé;5e B;EXEMPLE-02\r\n"], { type:"text/csv;charset=utf-8" });
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.download = "modele-import-cdi.csv";
  anchor.href = url;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function readCsv(file) {
  if (!file) throw new Error("Choisissez un fichier CSV.");
  const xml = /\.xml$/i.test(file.name);
  if (file.size > (xml ? 25_000_000 : 1_700_000)) throw new Error(xml ? "Le fichier dépasse 25 Mo." : "Le fichier dépasse 1,7 Mo.");
  const bytes = await file.arrayBuffer();
  let source;
  try { source = new TextDecoder("utf-8", { fatal:true }).decode(bytes); }
  catch { source = new TextDecoder(xml ? "iso-8859-15" : "windows-1252").decode(bytes); }
  // Export SIECLE en XML, analysé dans le navigateur : seuls nom, prénom, division et identifiant sont envoyés.
  return xml || /^\s*<\?xml/.test(source) ? siecleRows(source) : csvRows(source);
}
function renderImport() {
  $("#main").innerHTML = section("Importer des élèves", "Ajoutez un fichier CSV pour créer les fiches, les classes manquantes et les codes CDI.")
    + `<div class="import-grid">
    <section class="panel panel-body import-main"><h2>Fichier des élèves</h2>
      <form class="stack" id="import-form">
        <label class="file-box">${box("upload")}<strong>Sélectionnez un fichier CSV ou SIECLE (XML)</strong><p class="hint">Jusqu’à 5 000 élèves par fichier</p><input type="file" name="file" accept=".csv,.tsv,.txt,.xml,text/csv,text/tab-separated-values,application/xml,text/xml" required></label>
        <div id="preview-area" aria-live="polite" hidden></div>
        <div class="form-actions"><button class="btn primary" type="submit">${icon("search")} Vérifier le fichier</button></div>
      </form>
    </section>
    <aside class="panel panel-body import-aside"><h2>Format attendu</h2><p class="subtle">Colonnes requises</p>
      <p><code>Nom</code> <code>Prénom</code> <code>Classe</code></p>
      <p class="subtle"><b>Pronote</b> : exportez la liste des élèves en CSV ; la colonne <code>Élève</code> (NOM Prénom) est reconnue. <b>SIECLE</b> : importez directement <code>ElevesSansAdresses.xml</code> (la division sert de classe) ou un CSV avec <code>Division</code>.</p>
      <p class="subtle">Avec la colonne facultative <b>Identifiant externe</b>, un nouvel import peut déplacer un élève de classe en conservant son code-barres. Sans cet identifiant, la correspondance utilise le nom, le prénom et la classe.</p>
      ${button("Télécharger le modèle", "download", 'data-action="sample"')}
    </aside></div>`;
  const form = $("#import-form");
  const target = $("#preview-area");
  const submit = $("[type=submit]", form);
  let rows = null;
  form.elements.file.addEventListener("change", () => {
    rows = null;
    target.hidden = true;
    submit.innerHTML = icon("search") + " Vérifier le fichier";
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    form.elements.file.disabled = true;
    target.hidden = false;
    try {
      const confirm = Boolean(rows);
      const input = rows ?? await readCsv(form.elements.file.files[0]);
      const result = await gestion("import", "POST", { rows:input, preview:!confirm });
      const plural = (n) => n > 1 ? "s" : "";
      const details = [
        `${result.added} ajout${plural(result.added)}`,
        `${result.updated} mise${plural(result.updated)} à jour`,
        `${result.classes} nouvelle${plural(result.classes)} classe${plural(result.classes)}`,
        `${result.skipped} doublon${plural(result.skipped)} ignoré${plural(result.skipped)}`,
      ].join(" · ");
      target.innerHTML = notice((confirm ? "Import terminé. " : "Vérification terminée. ") + (input.format ? "Format reconnu : " + input.format + ". " : "") + details, confirm ? "success" : "");
      if (result.errors.length) {
        target.innerHTML = notice("Corrigez les lignes signalées, puis sélectionnez à nouveau le fichier.", "error")
          + `<div class="preview-info"><ol>${result.errors.slice(0,100).map((row) => `<li>Ligne ${row.line} · ${e(row.message)}</li>`).join("")}</ol></div>`;
      } else if (confirm) {
        rows = null;
        form.reset();
        submit.innerHTML = icon("search") + " Vérifier le fichier";
      } else {
        rows = input;
        submit.innerHTML = icon("check") + " Confirmer l’import";
      }
    } catch (error) {
      rows = null;
      submit.innerHTML = icon("search") + " Vérifier le fichier";
      target.innerHTML = notice(error.message, "error");
    } finally {
      submit.disabled = false;
      form.elements.file.disabled = false;
    }
  });
}

function dialogForm(title, fields, submitText, save, options = {}) {
  const dialog = $("#dialog");
  dialog.classList.remove("dialog-wide");
  dialog.innerHTML = `<div class="dialog-inner"><div class="dialog-header"><h2 id="dialog-title">${e(title)}</h2>
    <button class="dialog-close" type="button" data-close aria-label="Fermer">${icon("close")}</button></div>
    <form class="stack">${fields}<div id="dialog-error" role="alert" hidden></div>
    <div class="form-actions">${button("Annuler", "", "data-close")}
      <button class="btn ${options.danger ? "danger" : "primary"}" type="submit">${e(submitText)}</button></div></form></div>`;
  const form = $("form", dialog);
  for (const node of $$("[data-close]", dialog)) node.addEventListener("click", () => dialog.close());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = $("[type=submit]", form);
    const errorBox = $("#dialog-error");
    submit.disabled = true;
    errorBox.hidden = true;
    try {
      const result = await save(form);
      dialog.close();
      await options.refresh?.();
      toast(typeof result === "string" ? result : options.success ?? "Modification enregistrée.");
    } catch (error) {
      if (dialog.open) {
        errorBox.hidden = false;
        errorBox.innerHTML = notice(error.message, "error");
        submit.disabled = false;
      } else toast(error.message, "error");
    }
  });
  options.ready?.(form);
  dialog.showModal();
}
function confirmDialog(title, description, action, save, success, refresh = render, danger = true) {
  dialogForm(title, `<p>${e(description)}</p>`, action, save, { danger, success, refresh });
}
function studentDialog(row) {
  if (!classes.length) { toast("Créez une classe avant d’ajouter un élève.", "error"); return; }
  const title = row ? "Modifier la fiche élève" : "Ajouter un élève";
  dialogForm(title, `<div class="form-grid">
    <label class="field"><span>Nom</span><input name="last_name" value="${e(row?.last_name)}" maxlength="75" required></label>
    <label class="field"><span>Prénom</span><input name="first_name" value="${e(row?.first_name)}" maxlength="75" required></label></div>
    <label class="field"><span>Classe</span><select name="class_id" required><option value="">Choisir une classe</option>${classOptions()}</select></label>
    <label class="field"><span>Identifiant externe <small>facultatif</small></span><input name="external_id" value="${e(row?.external_id)}" maxlength="120"><small>Utilisé lors des prochains imports pour retrouver cet élève.</small></label>`,
    row ? "Enregistrer" : "Ajouter", (form) => gestion("eleves" + (row ? "/" + row.id : ""), row ? "PATCH" : "POST", Object.fromEntries(new FormData(form))), {
      success:row ? "Fiche élève mise à jour." : "Élève ajouté.",
      refresh:fetchStudents,
      ready:(form) => { form.elements.class_id.value = row?.class_id ?? activeFilters.class; },
    });
}
function classDialog(row) {
  dialogForm(row ? "Modifier la classe" : "Créer une classe",
    `<label class="field"><span>Nom de la classe</span><input name="name" value="${e(row?.name)}" placeholder="Ex. 6e A" maxlength="45" required></label>`,
    row ? "Enregistrer" : "Créer", (form) => gestion("classes" + (row ? "/" + row.id : ""), row ? "PATCH" : "POST", Object.fromEntries(new FormData(form))),
    { success:row ? "Classe mise à jour." : "Classe créée.", refresh:render });
}
function exclusionDialog(known) {
  const listing = known ? notice(`${known.first_name} ${known.last_name} · ${known.class_name}`) + `<input type="hidden" name="student_id" value="${e(known.student_id)}">`
    : `<label class="field"><span>Rechercher un élève</span><input type="search" id="exclude-search" placeholder="Ex. Martin" autocomplete="off"><small>Saisissez au moins 2 caractères.</small></label>
       <label class="field"><span>Élève</span><select name="student_id" required><option value="">Sélectionner un élève</option></select></label>`;
  dialogForm("Exclure un élève", `${listing}<label class="field"><span>Fin de l’exclusion (jour inclus)</span><input type="date" name="until_day" min="${today()}" value="${today()}" required></label>
    <label class="field"><span>Motif de l’exclusion</span><textarea name="reason" maxlength="500" required></textarea><small>Le motif est visible dans le registre pour les comptes autorisés.</small></label>`,
    "Confirmer l’exclusion", (form) => gestion("exclusions", "POST", Object.fromEntries(new FormData(form))), {
      danger:true, success:"Exclusion enregistrée.", refresh:view === "presences" ? fetchPresence : render,
      ready(form) {
        const search = $("#exclude-search", form);
        if (!search) return;
        let timer, sequence = 0;
        search.addEventListener("input", () => {
          clearTimeout(timer);
          const token = ++sequence;
          const q = search.value.trim();
          const select = form.elements.student_id;
          select.innerHTML = '<option value="">Sélectionner un élève</option>';
          if (q.length < 2) return;
          timer = setTimeout(async () => {
            try {
              const result = await gestion("eleves/recherche","POST",{q});
              if (token !== sequence) return;
              select.innerHTML = result.rows.length ? '<option value="">Sélectionner un élève</option>' + result.rows.slice(0, 100).map((row) =>
                `<option value="${e(row.id)}">${fullName(row)} · ${e(row.class_name)}</option>`).join("") : '<option value="">Aucun élève trouvé</option>';
              if (result.rows.length === 1) select.value = result.rows[0].id;
            } catch (error) { toast(error.message, "error"); }
          }, 200);
        });
      },
    });
}
function accountDialog(row) {
  const own = row?.id === me.id;
  const has = (right) => Boolean(row?.rights.includes(right));
  const profiles = {
    vie:["presence","planning_voir","exclusions_voir","eleves_voir"],
    enseignant:["planning_voir","export_planning","seances_voir"],
    direction:["presence","planning_voir","export_planning","seances_voir","export_appel","exclusions_voir","eleves_voir","classes_voir","groupes_voir","reglages_voir","statistiques","export_statistiques","journal","comptes_voir"],
    cdi:["sorties","planning","export_planning","arrivees","export_appel","exclusions","eleves","classes","groupes","statistiques","export_statistiques","import","badges","borne"],
    rgpd:["dossiers_voir","donnees","export_dossiers","effacer","eleves_voir","journal"],
  };
  // Un agent non administrateur ne peut accorder que les droits qu’il possède lui-même.
  const option = (area, level, key) => `<label class="right-level${key && !can(key) ? " locked" : ""}"><input type="radio" name="area-${area}" value="${key ?? ""}" ${key && !can(key) ? "disabled" : ""}
    ${(key ? has(key) && (level !== "view" || !has(rightAreas[area][2])) : !has(rightAreas[area][1]) && !has(rightAreas[area][2])) ? "checked" : ""}><span>${level === "none" ? "Aucun" : level === "view" ? "Consulter" : "Gérer"}</span></label>`;
  dialogForm(row ? "Modifier le compte" : "Créer un compte", `
    <div class="form-grid">
      <label class="field"><span>Nom d’affichage</span><input name="name" value="${e(row?.name)}" maxlength="100" required></label>
      <label class="field"><span>Identifiant</span><input name="username" value="${e(row?.username)}" autocomplete="off" minlength="3" maxlength="80" required></label>
    </div>
    <label class="field"><span>${row ? "Nouveau mot de passe (facultatif)" : "Mot de passe"}</span><input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="160" ${row ? "" : "required"}><small>12 caractères au minimum.</small></label>
    ${me.admin ? `<label class="check-line"><input type="checkbox" name="admin" ${row?.admin ? "checked" : ""} ${own ? "disabled" : ""}> Administrateur · tous les accès</label>` : ""}
    <div id="custom-rights" class="stack">
      <label class="field"><span>Modèle</span><select name="profile"><option value="">Droits personnalisés</option>
        <option value="vie">Vie scolaire · consultation</option><option value="enseignant">Enseignant · planning et fiches d’appel</option>
        <option value="direction">Direction · consultation complète</option><option value="cdi">Équipe CDI · gestion courante</option>
        <option value="rgpd">Référent données · dossiers individuels</option></select>
        <small>Un modèle remplit le tableau ; chaque ligne reste modifiable.</small></label>
      <div class="rights-matrix" role="group" aria-label="Droits par rubrique">
        <div class="rights-head"><span>Rubrique</span><span>Aucun</span><span>Consulter</span><span>Gérer</span><span>Exporter</span></div>
        ${rightAreas.map(([label, view, manage, hint, exportKey], area) => `<div class="rights-row" data-area="${area}"><div><strong>${e(label)}</strong>${hint ? `<small>${e(hint)}</small>` : ""}</div>
          ${option(area, "none", null)}${option(area, "view", view)}${manage ? option(area, "manage", manage) : `<span class="right-none" aria-hidden="true">—</span>`}
          ${exportKey ? `<label class="right-export${can(exportKey) ? "" : " locked"}" title="Exporter en PDF ou CSV"><input type="checkbox" name="rights" value="${exportKey}" ${has(exportKey) ? "checked" : ""} ${can(exportKey) ? "" : "disabled"}><span>Exporter</span></label>` : `<span class="right-none" aria-hidden="true">—</span>`}</div>`).join("")}
      </div>
      <p class="subtle">« Exporter » permet les PDF et CSV de la rubrique, jamais les sauvegardes complètes, qui ont leur propre case ci-dessous.</p>
      <fieldset><legend>Actions complémentaires</legend><div class="permission-grid">${rightActions.map(([key, label]) =>
        `<label class="check-line${can(key) ? "" : " locked"}"><input type="checkbox" name="rights" value="${key}" ${has(key) ? "checked" : ""} ${can(key) ? "" : "disabled"}> ${e(label)}</label>`).join("")}</div></fieldset>
    </div>`, row ? "Enregistrer" : "Créer le compte", (form) => {
      const fields = new FormData(form);
      const data = { name:fields.get("name"), username:fields.get("username"), password:fields.get("password") };
      data.admin = Boolean(form.elements.admin?.checked);
      data.rights = [...rightAreas.map((_, area) => fields.get("area-" + area)).filter(Boolean), ...fields.getAll("rights")];
      return gestion("comptes" + (row ? "/" + row.id : ""), row ? "PATCH" : "POST", data);
    }, {
      success:row ? "Compte mis à jour." : "Compte créé.", refresh:async () => {
        if (own) {
          const current = (await api("/auth/status")).user;
          adminShell(current, view);
        } else await render();
      },
      ready(form) {
        form.closest(".dialog")?.classList.add("dialog-wide");
        const custom = $("#custom-rights", form);
        const profile = form.elements.profile;
        const sync = () => { custom.hidden = Boolean(form.elements.admin?.checked); };
        form.elements.admin?.addEventListener("change", sync);
        profile.addEventListener("change", () => {
          const chosen = profiles[profile.value];
          if (!chosen) return;
          rightAreas.forEach(([, view, manage], area) => {
            const value = manage && chosen.includes(manage) ? manage : chosen.includes(view) ? view : "";
            const input = form.querySelector(`input[name="area-${area}"][value="${value}"]`);
            if (input && !input.disabled) input.checked = true;
          });
          for (const input of $$('.permission-grid input[name="rights"]', form)) if (!input.disabled) input.checked = chosen.includes(input.value);
          syncExports();
          for (const [, , , , exportKey] of rightAreas) {
            const box = exportKey && form.querySelector(`input[name="rights"][value="${exportKey}"]`);
            if (box && !box.disabled) box.checked = chosen.includes(exportKey);
          }
        });
        // L’export n’a de sens qu’avec un accès à la rubrique : la case se désactive sur « Aucun ».
        const syncExports = () => rightAreas.forEach(([, , , , exportKey], area) => {
          const box = exportKey && form.querySelector(`input[name="rights"][value="${exportKey}"]`);
          if (!box) return;
          const none = !form.querySelector(`input[name="area-${area}"]:checked`)?.value;
          box.disabled = none || !can(exportKey);
          if (none) box.checked = false;
          box.closest(".right-export").classList.toggle("off", none);
        });
        for (const input of $$('input[type=radio]', form)) input.addEventListener("change", syncExports);
        syncExports();
        for (const input of $$('input[type=radio], input[name="rights"]', form)) input.addEventListener("change", () => { profile.value = ""; });
        sync();
      },
    });
}
function actionHandler(event) {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) return;
  const { action, id } = trigger.dataset;
  const record = records.find((entry) => entry.id === id);
  const classRow = classes.find((entry) => entry.id === id);
  if (action === "class-arrival" && can("arrivees")) startCall(classes,dialogForm,{roster_id:activeFilters.class}).catch(error=>toast(error.message,"error"));
  if (action === "refresh") fetchPresence().catch((error) => toast(error.message, "error"));
  if (action === "sample") downloadSample();
  if (action === "print" && can("badges")) gestion("export","POST",{type:"badges"}).then(()=>window.print()).catch(error=>toast(error.message,"error"));
  if (action==="activate-device" && can("borne")) {
    dialogForm("Activer ce poste",`<p>La session du personnel se fermera et la borne s’ouvrira sur ce navigateur.</p>
      <label class="field"><span>Nom du poste <small>facultatif</small></span><input name="label" maxlength="60" placeholder="Ex. Borne accueil du CDI" autocomplete="off"></label>`,"Activer",async(form)=>{
      await gestion("borne/activation","POST",{label:form.elements.label.value});
      await api("/auth/logout","POST");
      location.assign(urlFor("/borne"));
    },{success:"Poste activé.",refresh:()=>{}});
  }
  if (action==="revoke-devices" && can("borne")) confirmDialog("Révoquer les activations","Les postes concernés devront être réactivés.","Révoquer",()=>gestion("borne/activation","DELETE"),"Activations révoquées.");
  if (action === "student-new" || (action === "student-edit" && record)) studentDialog(record);
  if (action === "class-new" || (action === "class-edit" && classRow)) classDialog(classRow);
  if (action === "account-new" || (action === "account-edit" && record)) accountDialog(record);
  if (action === "exclude-new" || (action === "exclude-visit" && record)) exclusionDialog(record);
  if (action === "student-restore" && record) confirmDialog("Réactiver la fiche élève", `${record.first_name} ${record.last_name} pourra à nouveau utiliser son code CDI.`, "Réactiver", () => gestion("eleves/" + id, "PATCH", { ...record, reactivate:true }), "Fiche réactivée.", fetchStudents, false);
  if (action === "student-delete" && record) confirmDialog("Retirer l’élève", `${record.first_name} ${record.last_name} ne pourra plus pointer à la borne. Sa présence en cours prendra fin.`, "Retirer", () => gestion("eleves/" + id, "DELETE"), "Élève retiré de la borne.", fetchStudents);
  if (action === "class-delete" && classRow) {
    const others = classes.filter((row) => row.id !== classRow.id);
    dialogForm("Supprimer la classe", `<p>La classe <strong>${e(classRow.name)}</strong> va être supprimée.</p>
      ${classRow.total ? `<label class="field"><span>Déplacer ses ${classRow.total} élève${classRow.total > 1 ? "s" : ""} vers</span><select name="move_to" required><option value="">Choisir une classe</option>
        ${others.map((row) => `<option value="${e(row.id)}">${e(row.name)}</option>`).join("")}</select><small>Les fiches retirées de la classe suivent aussi.</small></label>`
        : `<p class="subtle">Aucun élève actif. Les éventuelles fiches retirées seront rangées dans la classe « Anciens élèves ».</p>`}`,
      "Supprimer", (form) => gestion("classes/" + id, "DELETE", { move_to:form.elements.move_to?.value || "" }), { danger:true, success:"Classe supprimée.", refresh:render });
  }
  if (action === "account-mfa-reset" && record && me.admin) confirmDialog("Réinitialiser la double authentification", `${record.name} pourra se connecter avec son seul mot de passe puis réactiver la double authentification. Ses sessions ouvertes seront fermées.`, "Réinitialiser", () => gestion("comptes/" + id + "/double-authentification", "DELETE"), "Double authentification réinitialisée.");
  if (action === "account-delete" && record) confirmDialog("Supprimer le compte", `Le compte de ${record.name} perdra immédiatement son accès.`, "Supprimer", () => gestion("comptes/" + id, "DELETE"), "Compte supprimé.");
  if (action === "exclude-lift" && record) confirmDialog("Lever l’exclusion", `Confirmez la levée de cette exclusion pour ${record.first_name} ${record.last_name}.`, "Lever l’exclusion", () => gestion("exclusions/" + id, "DELETE"), "Exclusion levée.", render, false);
  if (action === "visit-extend" && record && can("sorties")) {
    dialogForm("Prolonger la présence", `<p><strong>${e(record.first_name)} ${e(record.last_name)}</strong> · Départ prévu à ${time(record.expires_at)}</p>
      <label class="field"><span>Temps à ajouter au départ prévu</span><select name="minutes">
        <option value="15">15 minutes · départ à ${time(record.expires_at + 900_000)}</option>
        <option value="30">30 minutes · départ à ${time(record.expires_at + 1_800_000)}</option>
        <option value="60">Un créneau · départ à ${time(record.expires_at + 3_600_000)}</option>
      </select></label>`, "Prolonger", async form => {
      const result = await gestion("presences/" + id, "PATCH", { minutes:Number(form.elements.minutes.value), expires_at:record.expires_at });
      return "Présence prolongée jusqu’à " + time(result.expires_at) + ".";
    }, { refresh:fetchPresence });
  }
  if (action === "visit-close" && record) {
    trigger.disabled = true;
    gestion("presences/" + id, "DELETE").then(fetchPresence).then(() => toast("Sortie enregistrée."), (error) => { trigger.disabled = false; toast(error.message, "error"); });
  }
}

async function start() {
  const pathname = routePath();
  if (pathname==="/") {home();return;}
  if (pathname==="/notice") {await renderNotice(app,header(),footer);return;}
  if (pathname.replace(/\/$/,"") === "/planning-ecran") { renderScreen(app); return; }
  if (!(pathname === "/connexion" || pathname.startsWith("/gestion"))) { kiosk(); return; }
  try {
    const status = await api("/auth/status");
    if (status.user) adminShell(status.user, pathname.split("/")[2]);
    else login(status);
  } catch (error) {
    app.innerHTML = `<div class="login-page">${header("login")}<main class="wrap login-layout" id="main"><div class="panel panel-body">${notice(error.message, "error")}</div></main>${footer}</div>`;
  }
}
start();
