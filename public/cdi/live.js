// Tableau de bord en direct, arrivée manuelle d’un élève, motif de présence et notifications du personnel.
import { api, e, icon, notice, time } from "./shared.js";

// Motifs proposés (un autre motif peut être saisi librement).
export const reasons = ["Travail personnel","Lecture","Recherche documentaire","Ordinateur ou impression","Devoir ou exposé","Orientation","Envoyé par un professeur","Permanence"];
export const reasonField = (current = "") => {
  const custom = current && !reasons.includes(current);
  return `<label class="field"><span>Motif de présence</span><select name="reason_pick">
      <option value="">Non précisé</option>${reasons.map((item) => `<option ${item === current ? "selected" : ""}>${e(item)}</option>`).join("")}
      <option value="__autre" ${custom ? "selected" : ""}>Autre…</option></select></label>
    <label class="field" data-reason-other ${custom ? "" : "hidden"}><span>Préciser le motif</span><input name="reason_other" maxlength="60" value="${custom ? e(current) : ""}" placeholder="Ex. Club lecture"></label>`;
};
export const bindReason = (form) => {
  const sync = () => { form.querySelector("[data-reason-other]").hidden = form.elements.reason_pick.value !== "__autre"; };
  form.elements.reason_pick.addEventListener("change", () => { sync(); if (form.elements.reason_pick.value === "__autre") form.elements.reason_other.focus(); });
  sync();
};
export const readReason = (form) => form.elements.reason_pick.value === "__autre" ? form.elements.reason_other.value.trim() || null : form.elements.reason_pick.value || null;
export function editReason({ dialogForm, visit, done }) {
  dialogForm(`Motif de présence · ${visit.first_name} ${visit.last_name}`, reasonField(visit.reason ?? ""), "Enregistrer", async (form) => {
    await api("/gestion/presences/" + visit.id, "PATCH", { reason:readReason(form) });
    await done?.();
    return "Motif enregistré.";
  }, { ready:bindReason });
}

const $ = (selector, root = document) => root.querySelector(selector);
const hm = (minute) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const kindLabel = { exclu:"Exclusion", presque_plein:"Presque plein", complet:"Complet" };
const kindIcon = { exclu:"ban", presque_plein:"warning", complet:"warning" };
const ago = (at, now) => {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  return minutes < 1 ? "à l’instant" : minutes < 60 ? `il y a ${minutes} min` : `à ${time(at)}`;
};
export const eventList = (rows, now) => rows.length
  ? `<ul class="live-events">${rows.map((row) => `<li data-kind="${e(row.kind)}">${icon(kindIcon[row.kind] ?? "info")}<div><b>${e(kindLabel[row.kind] ?? "Alerte")}</b><p>${e(row.message)}</p><small>${ago(row.at, now)}</small></div></li>`).join("")}</ul>`
  : `<p class="hint live-empty">Aucune alerte depuis 24 heures.</p>`;

// Page « En direct » : rafraîchie toutes les 10 secondes sans clignotement (seul le contenu change).
export async function renderLive(target, { section, button, canArrive, openArrival, setTimer }) {
  target.innerHTML = section("Tableau de bord en direct", "Présences, places, arrivées et alertes du CDI, actualisés toutes les 10 secondes.",
    (canArrive ? button("Ajouter un élève", "plus", 'id="live-add"', "primary") : ""))
    + `<div id="live-body" aria-live="polite"></div>`;
  $("#live-add", target)?.addEventListener("click", () => openArrival(() => load()));
  const body = $("#live-body", target);
  let last = "";
  async function load() {
    try {
      const data = await api("/gestion/direct", "GET", undefined, { background:true });
      const html = board(data);
      if (html !== last) { last = html; body.innerHTML = html; paint(body); }
    } catch (error) { body.innerHTML = notice(error.message, "error"); }
  }
  await load();
  setTimer(setInterval(load, 10_000));
}

function board(d) {
  const ratio = d.capacity ? Math.min(1, d.occupied / d.capacity) : 0;
  const level = !d.capacity ? "none" : d.places === 0 ? "full" : ratio >= .9 ? "high" : ratio >= .6 ? "mid" : "low";
  const current = d.planning.find((row) => row.start_min <= d.minute && row.end_min > d.minute);
  const next = d.planning.find((row) => row.start_min > d.minute);
  const slot = (row) => `${hm(row.start_min)} – ${hm(row.end_min)} · ${e(row.title)}${row.class_name ? ` · ${e(row.class_name)}` : ""}${row.students_allowed === 0 && row.kind !== "fermeture" ? " · élèves refusés" : ""}`;
  const person = (row) => `${e(row.first_name)} ${e(row.last_name)}`;
  return `<div class="live-top">
    <section class="live-gauge" data-level="${level}">
      <div><b>${d.present}</b><span>élève${d.present > 1 ? "s" : ""} présent${d.present > 1 ? "s" : ""}</span></div>
      ${d.capacity ? `<progress max="${d.capacity}" value="${d.occupied}" aria-label="${d.occupied} sur ${d.capacity} places"></progress>
        <small>${d.places === 0 ? "CDI complet" : `${d.places} place${d.places > 1 ? "s" : ""} libre${d.places > 1 ? "s" : ""} sur ${d.capacity}`}</small>` : `<small>Capacité non renseignée</small>`}
    </section>
    <section class="live-card live-state" data-open="${d.open}">${icon(d.open ? "check" : "lock")}<div><b>${d.open ? "Borne ouverte" : "Borne fermée"}</b><p>${e(d.open ? "Les élèves peuvent pointer." : d.reason)}</p></div></section>
    <section class="live-card"><span class="live-label">Aujourd’hui</span><b class="live-number">${d.today.visits}</b><p>passage${d.today.visits > 1 ? "s" : ""} · ${d.today.students} élève${d.today.students > 1 ? "s" : ""}</p></section>
    <section class="live-card"><span class="live-label">Créneau</span><p class="live-slot">${current ? `<b>En cours</b> ${slot(current)}` : "Aucun créneau en cours"}</p>${next ? `<p class="live-next">Ensuite : ${slot(next)}</p>` : ""}</section>
  </div>
  <div class="live-grid">
    <section class="panel panel-body live-panel"><h2>${icon("login")} Dernières arrivées</h2>${d.arrivals.length ? `<ul class="live-list">${d.arrivals.map((row) => `<li><time>${time(row.starts_at)}</time><span>${person(row)}</span><small>${e(row.class_name)}${row.source !== "individuel" ? " · avec la classe" : ""}${row.reason ? " · " + e(row.reason) : ""}</small></li>`).join("")}</ul>` : `<p class="hint live-empty">Aucune arrivée aujourd’hui.</p>`}</section>
    <section class="panel panel-body live-panel"><h2>${icon("clock")} Départs dans 15 minutes</h2>${d.leaving.length ? `<ul class="live-list">${d.leaving.map((row) => `<li><time>${time(row.expires_at)}</time><span>${person(row)}</span><small>${e(row.class_name)}</small></li>`).join("")}</ul>` : `<p class="hint live-empty">Aucun départ prévu dans le quart d’heure.</p>`}</section>
    <section class="panel panel-body live-panel"><h2>${icon("grid")} Classes présentes</h2>${d.classes.length ? `<ul class="live-classes">${d.classes.map((row) => `<li><span>${e(row.name)}</span><progress max="${Math.max(...d.classes.map((item) => item.total))}" value="${row.total}" aria-hidden="true"></progress><b>${row.total}</b></li>`).join("")}</ul>` : `<p class="hint live-empty">Personne au CDI.</p>`}</section>
    <section class="panel panel-body live-panel"><h2>${icon("bell")} Alertes</h2>${eventList(d.events, d.now)}</section>
    <section class="panel panel-body live-panel live-wide"><h2>${icon("calendar")} Planning du jour</h2>${timeline(d)}</section>
  </div>`;
}

function timeline(d) {
  const items = [...d.hours.map((row) => ({ ...row, kind:"ouvert" })), ...d.planning];
  if (!items.length) return `<p class="hint live-empty">Aucun horaire ni créneau aujourd’hui.</p>`;
  const start = Math.min(...items.map((row) => row.start_min)), end = Math.max(...items.map((row) => row.end_min)), span = Math.max(60, end - start);
  const pos = (minute) => ((minute - start) / span * 100).toFixed(2);
  const segment = (row) => row.kind === "ouvert" ? "ouvert" : row.kind === "fermeture" || row.students_allowed === 0 ? "fermeture" : "reservation";
  return `<div class="borne-day-bar live-bar">${items.map((row) => `<i class="seg-${segment(row)}" data-from="${pos(row.start_min)}" data-to="${pos(row.end_min)}"></i>`).join("")}
    ${d.minute >= start && d.minute <= end ? `<i class="borne-day-now" data-at="${pos(d.minute)}"></i>` : ""}</div>
    <div class="borne-day-scale"><span>${hm(start)}</span><span class="legend"><i class="seg-ouvert"></i>Ouvert<i class="seg-reservation"></i>Réservé<i class="seg-fermeture"></i>Fermé aux élèves</span><span>${hm(end)}</span></div>
    ${d.planning.length ? `<ul class="live-list live-slots">${d.planning.map((row) => `<li class="${row.start_min <= d.minute && row.end_min > d.minute ? "is-now" : ""}"><time>${hm(row.start_min)}</time><span>${e(row.title)}${row.class_name ? ` · ${e(row.class_name)}` : ""}</span><small>${hm(row.start_min)} – ${hm(row.end_min)}${row.kind === "fermeture" ? " · fermeture" : row.students_allowed === 0 ? " · élèves refusés" : ""}</small></li>`).join("")}</ul>` : ""}`;
}
// Positions appliquées en JavaScript (politique CSP : pas de style en ligne dans le HTML).
function paint(root) {
  root.querySelectorAll("[data-from]").forEach((node) => { node.style.left = node.dataset.from + "%"; node.style.width = (node.dataset.to - node.dataset.from) + "%"; });
  root.querySelectorAll("[data-at]").forEach((node) => { node.style.left = node.dataset.at + "%"; });
}

// Arrivée manuelle : recherche par nom, prénom ou classe, puis enregistrement (deuxième heure possible).
export function manualArrival({ dialogForm, toast, done }) {
  let picked = null, version = 0, timer;
  dialogForm("Ajouter un élève au CDI", `
    <label class="field"><span>Élève</span><input name="q" autocomplete="off" placeholder="Nom, prénom ou classe" required></label>
    <div class="arrival-results" id="arrival-results" role="listbox" aria-label="Élèves trouvés"><p class="hint">Tapez au moins deux lettres.</p></div>
    ${reasonField()}
    <label class="check-line"><input type="checkbox" name="two_hours"> Jusqu’à la deuxième heure</label>
    <p class="hint">L’arrivée est enregistrée même hors horaires ou pendant un créneau fermé aux élèves. Un élève exclu ne peut pas être ajouté.</p>`,
  "Enregistrer l’arrivée", async (form) => {
    if (!picked) throw new Error("Sélectionnez un élève dans la liste.");
    const result = await api("/gestion/presences", "POST", { student_id:picked.id, two_hours:form.elements.two_hours.checked, reason:readReason(form) });
    done?.();
    return result.already ? `${picked.first_name} ${picked.last_name} est déjà au CDI (jusqu’à ${time(result.expires_at)}).`
      : `Arrivée de ${picked.first_name} ${picked.last_name} enregistrée jusqu’à ${time(result.expires_at)}.`;
  }, {
    ready(form) {
      bindReason(form);
      const list = $("#arrival-results", form);
      form.elements.q.focus();
      form.elements.q.addEventListener("input", () => {
        clearTimeout(timer);
        picked = null;
        const query = form.elements.q.value.trim();
        if (query.replace(/\s/g, "").length < 2) { list.innerHTML = `<p class="hint">Tapez au moins deux lettres.</p>`; return; }
        timer = setTimeout(async () => {
          const index = ++version;
          try {
            const { rows } = await api("/gestion/presences/recherche", "POST", { q:query });
            if (index !== version) return;
            list.innerHTML = rows.length ? rows.map((row) => `<button type="button" role="option" aria-selected="false" class="arrival-option" data-id="${e(row.id)}" ${row.excluded ? "disabled" : ""}>
              <span><b>${e(row.first_name)} ${e(row.last_name)}</b><small>${e(row.class_name)}</small></span>
              ${row.excluded ? `<em class="pill pill-danger">Exclu</em>` : row.present ? `<em class="pill">Déjà présent</em>` : ""}</button>`).join("")
              : `<p class="hint">Aucun élève trouvé.</p>`;
            list.onclick = (event) => {
              const option = event.target.closest(".arrival-option");
              if (!option || option.disabled) return;
              picked = rows.find((row) => row.id === option.dataset.id);
              list.querySelectorAll(".arrival-option").forEach((node) => node.setAttribute("aria-selected", String(node === option)));
            };
          } catch (error) { list.innerHTML = notice(error.message, "error"); }
        }, 200);
      });
      form.elements.q.addEventListener("keydown", (event) => { if (event.key === "Enter" && !picked) { event.preventDefault(); list.querySelector(".arrival-option:not([disabled])")?.click(); } });
    },
  });
}

// Cloche des notifications : interrogée toutes les 20 secondes ; alerte du navigateur si l’agent l’a autorisée.
export function startNotifications(button, panel, { toast }) {
  const key = "ticecdi-notifications-vues";
  let seen = Number(localStorage.getItem(key) || 0), latest = 0, rows = [], first = true;
  const badge = button.querySelector(".notif-badge");
  const render = (now) => {
    const unread = rows.filter((row) => row.id > seen).length;
    badge.textContent = unread > 9 ? "9+" : String(unread);
    badge.hidden = unread === 0;
    button.setAttribute("aria-label", unread ? `Alertes : ${unread} nouvelle${unread > 1 ? "s" : ""}` : "Alertes");
    const permission = "Notification" in globalThis ? Notification.permission : "unsupported";
    panel.innerHTML = `<div class="notif-head"><b>Alertes du CDI</b>${permission === "default" ? `<button type="button" class="btn secondary tiny" data-enable>${icon("bell")} Alertes du navigateur</button>` : ""}</div>${eventList(rows, now)}`;
  };
  async function poll() {
    try {
      const data = await api("/gestion/notifications", "GET", undefined, { background:true });
      const fresh = data.rows.filter((row) => row.id > latest);
      rows = data.rows;
      latest = Math.max(latest, ...rows.map((row) => row.id), 0);
      if (!first) for (const row of fresh.reverse()) {
        toast(row.message, row.kind === "exclu" ? "error" : "");
        if ("Notification" in globalThis && Notification.permission === "granted") new Notification("TiceCDI · " + (kindLabel[row.kind] ?? "Alerte"), { body:row.message, tag:"ticecdi-" + row.id });
      }
      first = false;
      render(data.now);
    } catch { /* nouvelle tentative au prochain passage */ }
  }
  button.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { seen = latest; try { localStorage.setItem(key, String(seen)); } catch { /* sans stockage */ } render(Date.now()); }
  });
  panel.addEventListener("click", async (event) => {
    if (!event.target.closest("[data-enable]")) return;
    await Notification.requestPermission().catch(() => null);
    render(Date.now());
  });
  document.addEventListener("click", (event) => { if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) panel.hidden = true; });
  poll();
  return setInterval(poll, 20_000);
}
