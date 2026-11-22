import { renderPrivacy, renderNotice, renderDossier } from "./privacy.js";
import { renderBackup, renderGroups, renderJournal, renderSessions, renderYears, startCall } from "./school.js";
import { renderPlanning, renderScreen } from "./schedule.js";
import { openingForm, renderStatistics } from "./attendance.js";
import { routePath, urlFor, brand, api, csvRows, day, e, fullName, icon, notice, renderBarcode, time, today } from "./shared.js";

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
  const links=`<a href="${urlFor("/notice")}" title="Données personnelles">${icon("info")}<span class="sr-label">Données personnelles</span></a>`+
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
  app.innerHTML=`<div class="kiosk-page">${header("kiosk")}<main class="wrap kiosk" id="main">
    <section class="panel kiosk-card" aria-labelledby="kiosk-title">
      <header class="kiosk-intro"><div><h1 id="kiosk-title">Pointage du CDI</h1>
        <p>Scanne ta carte ou saisis son code. Choisis Entrée ou Sortie.</p></div></header>
      <div class="kiosk-body">
        <div id="kiosk-state" role="status"><p>Vérification de l’activation du poste…</p></div>
        <form id="entry-form" autocomplete="off" hidden>
          <label class="field" for="entry-input"><span>Code-barres de ta carte CDI</span>
            <input id="entry-input" type="password" maxlength="13" spellcheck="false" autocapitalize="characters" required></label>
          <label class="check-line" id="second-hour"><input type="checkbox" id="two-hours"> Rester jusqu’à la deuxième heure pleine</label>
          <div class="button-row"><button class="btn primary" id="entry-submit" type="submit" name="direction" value="entree">Entrée</button>
            <button class="btn secondary" type="submit" name="direction" value="sortie">Sortie</button>
            <button type="button" class="btn secondary" id="kiosk-fullscreen">Plein écran</button></div>
        </form><div id="entry-message" role="status" aria-live="polite" aria-atomic="true"></div></div>
    </section></main>${footer}</div>`;
  const form=$("#entry-form"), input=$("#entry-input"), two=$("#two-hours"), message=$("#entry-message");
  const entry=$("#entry-submit"), buttons=$$("button[type=submit]",form);
  let busy=false, expiry, refreshing=false;
  function show(text,tone) {
    clearTimeout(expiry);
    message.innerHTML=notice(text,tone);
    expiry=setTimeout(()=>message.replaceChildren(),5000);
  }
  async function refresh() {
    if(refreshing) return;
    refreshing=true;
    try {
      const settings=await api("/borne/reglages");
      const wasHidden=form.hidden;
      form.hidden=!settings.activated;
      entry.disabled=busy || !settings.open;
      $("#second-hour").hidden=!settings.open || !settings.second_hour;
      if($("#second-hour").hidden) two.checked=false;
      const text=!settings.activated ? "Ce poste doit être activé par le personnel du CDI."
        : !settings.open ? settings.reason : settings.message || "";
      if($("#kiosk-state").textContent!==text) $("#kiosk-state").textContent=text;
      if (form.hidden) { form.reset(); }
      else if(wasHidden) input.focus({preventScroll:true});
    } catch {
      form.hidden=true;
      form.reset();
      $("#kiosk-state").textContent="La borne est momentanément indisponible.";
    } finally {refreshing=false;}
  }
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if(busy || form.hidden) return;
    const direction=event.submitter?.value ?? "entree";
    if(direction==="entree" && entry.disabled) return;
    const data={code:input.value.trim(),two_hours:two.checked};
    form.reset();
    busy=true;
    buttons.forEach(button=>button.disabled=true);
    try {
      const result=await api("/borne/"+direction,"POST",data);
      show(direction==="sortie" ? "Pointage de sortie traité." : "Présence enregistrée jusqu’à "+time(result.expires_at)+".","success");
    } catch(error) { show(error.message,"error"); }
    finally {
      busy=false;
      buttons.forEach(button=>button.disabled=false);
      refresh();
      input.focus({preventScroll:true});
    }
  });
  $("#kiosk-fullscreen").hidden=!document.fullscreenEnabled;
  $("#kiosk-fullscreen").addEventListener("click",async event=>{
    try {
      if(document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {show("Utilise le mode plein écran du navigateur.");}
  });
  document.addEventListener("fullscreenchange",()=>{
    const control=$("#kiosk-fullscreen");
    if(control) control.textContent=document.fullscreenElement?"Quitter le plein écran":"Plein écran";
  });
  refresh();
  setInterval(refresh,5000);
}

function login(status) {
  const heading = status.setup ? "Configurer TiceCDI" : "Connexion à TiceCDI";
  app.innerHTML = `<div class="login-page">${header("login")}
    <main class="wrap login-layout" id="main"><nav class="crumb" aria-label="Fil d’Ariane"><a href="${urlFor("/")}">Accueil</a>${icon("chevron")} <span>Espace personnel</span></nav>
    <section class="panel login-card">${box("lock")}<h1>${heading}</h1><p class="subtle">${status.setup ? "Créez le premier compte administrateur du CDI." : "Connectez-vous avec le compte fourni par votre administrateur."}</p>
    <form id="login-form" class="stack">
      ${status.setup && status.keyRequired ? '<label class="field"><span>Clé d’installation</span><input name="key" type="password" required autocomplete="off"><small>La clé est dans les journaux Docker ou dans le dossier privé de l’installation PHP.</small></label>' : ""}
      ${status.setup ? '<label class="field"><span>Nom d’affichage</span><input name="name" placeholder="Ex. Thomas Luc" maxlength="100" required autocomplete="name"></label>' : ""}
      <label class="field"><span>Identifiant</span><input name="username" autocomplete="username" maxlength="80" required></label>
      <label class="field"><span>Mot de passe</span><input name="password" type="password" autocomplete="${status.setup ? "new-password" : "current-password"}" required maxlength="160" ${status.setup ? 'minlength="12"' : ""}>${status.setup ? "<small>12 caractères au minimum.</small>" : ""}</label>
      ${status.setup && status.demoAllowed ? '<label class="check-line"><input name="demo" type="checkbox" checked> Ajouter des élèves fictifs pour essayer la borne</label>' : ""}
      <div id="login-error" aria-live="polite" hidden></div>
      <button class="btn primary" type="submit">${icon(status.setup ? "check" : "login")} ${status.setup ? "Créer mon compte" : "Se connecter"}</button>
    </form></section></main>${footer}</div>`;
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    data.demo = Boolean(form.elements.demo?.checked);
    const submit = $("[type=submit]", form);
    const target = $("#login-error");
    submit.disabled = true;
    target.hidden = true;
    try { await api("/auth/" + (status.setup ? "setup" : "login"), "POST", data); location.assign(urlFor("/gestion")); }
    catch (error) { target.innerHTML = notice(error.message, "error"); target.hidden = false; submit.disabled = false; }
  });
}

const rightNames = {
  presence:"Consulter les présences", sorties:"Enregistrer les sorties", exclusions:"Gérer les exclusions", eleves:"Gérer les élèves",
  classes:"Gérer les classes", import:"Importer les élèves", badges:"Imprimer les codes-barres", comptes:"Gérer les comptes",
  arrivees:"Pointer une classe ou un groupe", planning:"Gérer le planning", statistiques:"Consulter les statistiques", groupes:"Gérer les groupes hors classe",
  borne:"Activer un poste de pointage", export:"Exporter les données", restaurer:"Restaurer une sauvegarde", donnees:"Traiter les dossiers individuels",
};
const tabs = [
  ["presences", "Présences", "users", ["presence", "sorties", "arrivees"]],
  ["planning", "Planning du CDI", "calendar", ["planning"]],
  ["seances", "Fiches d’appel", "check", ["arrivees"]],
  ["statistiques", "Statistiques", "chart", ["statistiques"]],
  ["eleves", "Élèves", "user", ["eleves"]],
  ["classes", "Classes", "grid", ["classes"]],
  ["groupes", "Groupes hors classe", "users", ["groupes"]],
  ["import", "Importer des élèves", "upload", ["import"]],
  ["badges", "Codes-barres", "scan", ["badges"]],
  ["exclusions", "Exclusions", "ban", ["exclusions"]],
  ["comptes", "Comptes et droits", "lock", ["comptes"]],
  ["reglages", "Réglages de la borne", "settings", ["admin"]],
  ["annees", "Années scolaires", "calendar", ["admin"]],
  ["journal", "Journal des modifications", "chart", ["admin"]],
  ["sauvegarde", "Sauvegarde et restauration", "download", ["export","restaurer"]],
  ["confidentialite", "Établissement et données personnelles", "lock", ["admin"]],
  ["dossiers", "Dossiers individuels", "users", ["donnees"]],
  ["borne-poste", "Activation de la borne", "scan", ["borne"]],
];
let me, view, records = [], classes = [], activeFilters = { q:"", class:"", archived:"" }, toastTimer, refreshTimer, rosterVersion = 0;
const can = (right) => right === "admin" ? me.admin : me.rights.includes(right);
const gestion = (resource, method, body) => api("/gestion/" + resource, method, body);
const rowAction = (text, glyph, action, id, mode = "secondary tiny") => button(text, glyph, `data-action="${action}" data-id="${e(id)}"`, mode);
const classOptions = () => classes.map((row) => `<option value="${e(row.id)}" ${row.id === activeFilters.class ? "selected" : ""}>${e(row.name)}</option>`).join("");
const empty = (title, message, symbol = "users") => `<div class="empty">${box(symbol)}<strong>${title}</strong><p>${message}</p></div>`;
const table = (heads, rows) => `<div class="scroll-table"><table><thead><tr>${heads.map((head) => `<th scope="col">${head}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
const identity = (row) => `<strong>${fullName(row)}</strong>`;
const filter = (kind = "all") => `<form class="filter-form" id="filters" role="search">
    ${kind === "all" ? `<label class="with-icon">${icon("search")}<input class="input" type="search" name="q" aria-label="Rechercher un élève" placeholder="Rechercher un élève" value="${e(activeFilters.q)}"></label>` : ""}
    <label><select class="input" name="class" aria-label="Filtrer par classe"><option value="">Toutes les classes</option>${classOptions()}</select></label>
    ${view === "eleves" ? `<label class="check-line"><input type="checkbox" name="archived" ${activeFilters.archived ? "checked" : ""}> Fiches retirées</label>` : ""}</form>`;
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
  const visible = tabs.filter((tab) => tab[3].some(can) && (tab[0]!=="badges" || can("export")));
  const selectedTab = visible.find((entry) => entry[0] === selected) ?? visible[0];
  if (!selectedTab) { login({ setup:false }); return; }
  view = selectedTab[0];
  if (routePath() !== "/gestion/" + view) history.replaceState(null, "", urlFor("/gestion/" + view));
  app.innerHTML = `<div class="admin-bg">${header("admin",can("borne"))}<div class="wrap admin-shell">
    <aside class="sidebar"><p class="sidebar-title">Espace de gestion</p><nav aria-label="Administration du CDI">
      ${visible.map(([key, title, glyph]) => `<a class="side-link" href="${urlFor("/gestion/" + key)}" ${key === view ? 'aria-current="page"' : ""}>${icon(glyph)}${title}</a>`).join("")}
    </nav><p class="user-info">${icon("user")}${e(me.name)}</p></aside>
    <main class="admin-main" id="main"><p class="loading">Chargement…</p></main>
    <dialog class="dialog" id="dialog" aria-labelledby="dialog-title"></dialog><div role="status" class="toast" id="toast" hidden></div>
    </div></div>`;
  $(".side-link[aria-current]")?.scrollIntoView({ block:"nearest", inline:"center" });
  $("#logout").addEventListener("click", async () => {
    try { await api("/auth/logout", "POST"); location.assign(urlFor("/connexion")); }
    catch (error) { toast(error.message, "error"); }
  });
  $("#main").addEventListener("click", actionHandler);
  render().catch(pageError);
}

function pageError(error) {
  if (error.status === 401) location.assign(urlFor("/connexion"));
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
    $("#main").innerHTML = section("Élèves", "Consultez les fiches élèves et modifiez leur affectation.", button("Ajouter un élève", "plus", 'data-action="student-new"', "primary"))
      + '<section class="panel table-panel"><div class="table-top"><h2>Annuaire des élèves</h2>' + filter() + '</div><div id="roster"></div></section>';
    bindFilters(fetchStudents);
    await fetchStudents();
  } else if (view === "classes") {
    $("#main").innerHTML = section("Classes", "Créez les classes et retrouvez les effectifs associés.", button("Créer une classe", "plus", 'data-action="class-new"', "primary"))
      + `<section class="panel table-panel"><div class="table-top"><h2>Classes enregistrées</h2>${pill(classes.length + " classe" + (classes.length !== 1 ? "s" : ""))}</div>`
      + (classes.length ? table(["Classe", "Élèves", "Actions"], classes.map((row) =>
          `<tr><td><strong>${e(row.name)}</strong></td><td>${row.total}</td><td><div class="button-row">${rowAction("Modifier","edit","class-edit",row.id)}${rowAction("Supprimer","trash","class-delete",row.id,"danger tiny")}</div></td></tr>`))
        : empty("Aucune classe", "Créez une classe ou importez un fichier élèves.", "grid")) + "</section>";
  } else if (view === "import") {
    renderImport();
  } else if (view === "planning") {
    const noticeSettings=await api("/notice");
    await renderPlanning($("#main"),{section,dialogForm,confirmDialog,toast,showScreenLink:noticeSettings.public_planning, canExport:can("export"),
      openClassArrival:can("arrivees") ? (classes,options)=>startCall(classes,dialogForm,options) : null});
  } else if (view === "seances") {
    await renderSessions($("#main"),{section,dialogForm,toast,canExport:can("export")});
  } else if (view === "groupes") {
    await renderGroups($("#main"),{section,dialogForm,toast});
  } else if (view === "journal") {
    await renderJournal($("#main"),{section,toast});
  } else if (view === "sauvegarde") {
    await renderBackup($("#main"),{section,toast,confirmDialog,canExport:can("export"),canRestore:can("restaurer")});
  } else if (view === "annees") {
    await renderYears($("#main"),{section,toast,confirmDialog,readCsv});
  } else if (view === "statistiques") {
    await renderStatistics($("#main"),{section,toast,canExport:can("export")});
  } else if (view==="confidentialite") {
    await renderPrivacy($("#main"),{section,toast,confirmDialog});
  } else if (view==="dossiers") {
    await renderDossier($("#main"),{section,toast,dialogForm,canExport:can("export")});
  } else if (view==="borne-poste") {
    $("#main").innerHTML=section("Activation de la borne","Activez ce navigateur sur un poste dédié pour douze heures.")+
      `<div class="panel panel-body button-row">${button("Activer ce poste","scan",'data-action="activate-device"',"primary")}
      ${button(me.admin?"Révoquer tous les postes":"Révoquer mes postes","lock",'data-action="revoke-devices"')}</div>`;
  } else if (view === "reglages") {
    await renderKioskSettings();
    await openingForm($("#main"),toast);
  } else if (view === "badges") {
    $("#main").innerHTML = section("Codes-barres", "Imprimez les cartes CDI à distribuer aux élèves.", button("Imprimer la planche", "print", 'data-action="print" disabled', "primary"))
      + `<section class="panel badge-panel"><div class="table-top"><h2>Planche de cartes CDI</h2>${filter("class")}</div><p class="hint">Format A4 · 3 cartes par ligne à l’impression</p><div id="roster"></div></section>`;
    bindFilters(fetchBadges);
    await fetchBadges();
  } else if (view === "exclusions") {
    const list = await gestion("exclusions");
    records = list.rows;
    const active = (row) => !row.revoked_at && row.until_day >= list.today;
    $("#main").innerHTML = section("Exclusions", "Consultez les motifs et les dates de fin. Une exclusion active empêche le pointage à la borne.", button("Ajouter une exclusion", "plus", 'data-action="exclude-new"', "primary"))
      + `<section class="panel table-panel"><div class="table-top"><h2>Registre des exclusions</h2>${pill(records.filter(active).length + " en cours")}</div>`
      + (records.length ? table(["Élève", "Motif", "Jusqu’au", "État", "Actions"], records.map((row) =>
        `<tr><td>${identity(row)}<small>${e(row.class_name)}</small></td><td class="multiline">${e(row.reason)}<small>Par ${e(row.author)} · ${day(row.created_at)}</small></td><td>${day(row.until_day)}</td>
        <td>${active(row) ? pill("En cours","red") : pill(row.revoked_at ? "Levée" : "Terminée","gray")}</td><td>${active(row) ? rowAction("Lever","check","exclude-lift",row.id) : "—"}</td></tr>`))
        : empty("Aucune exclusion enregistrée", "Les exclusions du CDI apparaîtront ici.", "ban")) + "</section>";
  } else if (view === "comptes") {
    records = (await gestion("comptes")).rows;
    $("#main").innerHTML = section("Comptes et droits", "Attribuez les accès au personnel du CDI, à la vie scolaire et aux autres services.", button("Créer un compte", "plus", 'data-action="account-new"', "primary"))
      + '<section class="panel table-panel"><div class="table-top"><h2>Comptes du personnel</h2></div>'
      + table(["Compte", "Accès", "Actions"], records.map((row) => {
        const editable = me.admin || (!row.admin && row.id !== me.id && row.rights.every(can));
        return `<tr><td><strong>${e(row.name)}</strong><small>${e(row.username)}${row.id === me.id ? " · Votre compte" : ""}</small></td>
          <td class="multiline">${row.admin ? pill("Administrateur") : e(row.rights.map((right) => rightNames[right]).join(", "))}</td>
          <td>${editable ? `<div class="button-row">${rowAction("Modifier","edit","account-edit",row.id)}${row.id !== me.id ? rowAction("Supprimer","trash","account-delete",row.id,"danger tiny") : ""}</div>` : "—"}</td></tr>`;
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
  fetchPresence().catch(error => { if (error.status === 401) pageError(error); else toast(error.message, "error"); });
}
async function fetchPresence() {
  const version = ++rosterVersion;
  const result = await gestion("presences");
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
  $("#roster").innerHTML = records.length ? table(["Élève","Classe","Actions"], records.map((row) =>
    `<tr><td>${identity(row)}</td><td>${pill(row.class_name,"gray")}</td>
    <td><div class="button-row">${rowAction("Modifier","edit","student-edit",row.id)}${activeFilters.archived ? rowAction("Réactiver","check","student-restore",row.id) : rowAction("Retirer","trash","student-delete",row.id,"danger tiny")}</div></td></tr>`))
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

async function renderKioskSettings() {
  const settings = await gestion("reglages");
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
    </section>`;
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
  if (file.size > 1_700_000) throw new Error("Le fichier dépasse 1,7 Mo.");
  const bytes = await file.arrayBuffer();
  let source;
  try { source = new TextDecoder("utf-8", { fatal:true }).decode(bytes); }
  catch { source = new TextDecoder("windows-1252").decode(bytes); }
  return csvRows(source);
}
function renderImport() {
  $("#main").innerHTML = section("Importer des élèves", "Ajoutez un fichier CSV pour créer les fiches, les classes manquantes et les codes CDI.")
    + `<div class="import-grid">
    <section class="panel panel-body import-main"><h2>Fichier des élèves</h2>
      <form class="stack" id="import-form">
        <label class="file-box">${box("upload")}<strong>Sélectionnez un fichier CSV</strong><p class="hint">Jusqu’à 5 000 élèves par fichier</p><input type="file" name="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" required></label>
        <div id="preview-area" aria-live="polite" hidden></div>
        <div class="form-actions"><button class="btn primary" type="submit">${icon("search")} Vérifier le fichier</button></div>
      </form>
    </section>
    <aside class="panel panel-body import-aside"><h2>Format attendu</h2><p class="subtle">Colonnes requises</p>
      <p><code>Nom</code> <code>Prénom</code> <code>Classe</code></p>
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
      target.innerHTML = notice((confirm ? "Import terminé. " : "Vérification terminée. ") + details, confirm ? "success" : "");
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
  const directRights = Object.keys(rightNames).filter(can);
  const profiles = {
    vie:["presence"],
    cdi:["presence","sorties","exclusions","eleves","borne"],
  };
  dialogForm(row ? "Modifier le compte" : "Créer un compte", `
    <label class="field"><span>Nom d’affichage</span><input name="name" value="${e(row?.name)}" maxlength="100" required></label>
    <label class="field"><span>Identifiant</span><input name="username" value="${e(row?.username)}" autocomplete="off" minlength="3" maxlength="80" required></label>
    <label class="field"><span>${row ? "Nouveau mot de passe (facultatif)" : "Mot de passe"}</span><input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="160" ${row ? "" : "required"}><small>12 caractères au minimum.</small></label>
    ${me.admin ? `<label class="check-line"><input type="checkbox" name="admin" ${row?.admin ? "checked" : ""} ${own ? "disabled" : ""}> Administrateur · tous les accès</label>` : ""}
    <div id="custom-rights">
      <label class="field"><span>Préréglage</span><select name="profile"><option value="">Droits personnalisés</option><option value="vie">Vie scolaire · consultation</option><option value="cdi">Équipe CDI · présences et élèves</option></select></label>
      <fieldset><legend>Droits détaillés</legend><div class="permission-grid">${directRights.map((right) =>
        `<label class="check-line"><input type="checkbox" name="rights" value="${right}" ${row?.rights.includes(right) ? "checked" : ""}> ${rightNames[right]}</label>`).join("")}</div></fieldset>
    </div>`, row ? "Enregistrer" : "Créer le compte", (form) => {
      const fields = new FormData(form);
      const data = Object.fromEntries(fields);
      data.admin = Boolean(form.elements.admin?.checked);
      data.rights = fields.getAll("rights");
      delete data.profile;
      return gestion("comptes" + (row ? "/" + row.id : ""), row ? "PATCH" : "POST", data);
    }, {
      success:row ? "Compte mis à jour." : "Compte créé.", refresh:async () => {
        if (own) {
          const current = (await api("/auth/status")).user;
          adminShell(current, view);
        } else await render();
      },
      ready(form) {
        const custom = $("#custom-rights", form);
        const profile = form.elements.profile;
        const sync = () => { custom.hidden = Boolean(form.elements.admin?.checked); };
        form.elements.admin?.addEventListener("change", sync);
        profile.addEventListener("change", () => {
          if (!profiles[profile.value]) return;
          for (const input of $$('input[name="rights"]', form)) input.checked = profiles[profile.value].includes(input.value);
        });
        for (const input of $$('input[name="rights"]', form)) input.addEventListener("change", () => { profile.value = ""; });
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
  if (action === "print" && can("export")) gestion("export","POST",{type:"badges"}).then(()=>window.print()).catch(error=>toast(error.message,"error"));
  if (action==="activate-device" && can("borne")) {
    confirmDialog("Activer ce poste","La session du personnel se fermera et la borne s’ouvrira sur ce poste.","Activer",async()=>{
      await gestion("borne/activation","POST",{});
      await api("/auth/logout","POST");
      location.assign(urlFor("/borne"));
    },"Poste activé.",()=>{},false);
  }
  if (action==="revoke-devices" && can("borne")) confirmDialog("Révoquer les activations","Les postes concernés devront être réactivés.","Révoquer",()=>gestion("borne/activation","DELETE"),"Activations révoquées.");
  if (action === "student-new" || (action === "student-edit" && record)) studentDialog(record);
  if (action === "class-new" || (action === "class-edit" && classRow)) classDialog(classRow);
  if (action === "account-new" || (action === "account-edit" && record)) accountDialog(record);
  if (action === "exclude-new" || (action === "exclude-visit" && record)) exclusionDialog(record);
  if (action === "student-restore" && record) confirmDialog("Réactiver la fiche élève", `${record.first_name} ${record.last_name} pourra à nouveau utiliser son code CDI.`, "Réactiver", () => gestion("eleves/" + id, "PATCH", { ...record, reactivate:true }), "Fiche réactivée.", fetchStudents, false);
  if (action === "student-delete" && record) confirmDialog("Retirer l’élève", `${record.first_name} ${record.last_name} ne pourra plus pointer à la borne. Sa présence en cours prendra fin.`, "Retirer", () => gestion("eleves/" + id, "DELETE"), "Élève retiré de la borne.", fetchStudents);
  if (action === "class-delete" && classRow) confirmDialog("Supprimer la classe", `Confirmez la suppression de la classe ${classRow.name}.`, "Supprimer", () => gestion("classes/" + id, "DELETE"), "Classe supprimée.");
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
