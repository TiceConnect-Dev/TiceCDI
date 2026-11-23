// Réinitialisation des données (administrateurs) : statistiques, fiches d’appel, passages, alertes, journal ; période ou totalité.
import { api, e, icon, notice, today, urlFor } from "./shared.js";

const items = [
  ["statistiques", "Statistiques", "Totaux par jour et répartitions archivées (affluence, classes, durées…)."],
  ["appels", "Fiches d’appel", "Cours et séances marqués, avec les élèves pointés."],
  ["passages", "Passages des élèves", "Entrées et sorties enregistrées, présences en cours comprises."],
  ["alertes", "Alertes", "Notifications de la cloche (exclusion, CDI plein)."],
  ["journal", "Journal des modifications", "Une ligne « Réinitialisation des données » est toujours conservée."],
];
const unit = { statistiques:"jour(s)", appels:"fiche(s)", passages:"passage(s)", alertes:"alerte(s)", journal:"entrée(s)" };

export async function renderReset(target, { section, toast, canBackup }) {
  const now = today();
  target.innerHTML = section("Réinitialiser les données", "Videz les statistiques, les fiches d’appel, les passages, les alertes ou le journal, sur une période ou en totalité.")
    + notice("Opération définitive. Les comptes, les élèves, les classes, le planning et les réglages ne sont jamais supprimés.", "warning", "warning")
    + (canBackup ? `<p class="reset-backup">${icon("download")} Conseillé : <a href="${urlFor("/gestion/sauvegarde")}">téléchargez d’abord une sauvegarde chiffrée</a>, qui permet de tout retrouver.</p>` : "")
    + `<form class="panel panel-body stack reset-form" id="reset-form" autocomplete="off">
      <fieldset class="settings-options"><legend>Période</legend>
        <label class="check-line"><input type="radio" name="scope" value="tout" checked> Tout, depuis le début</label>
        <label class="check-line"><input type="radio" name="scope" value="periode"> Une période</label>
        <div class="button-row" id="reset-period" hidden>
          <label class="field"><span>Du</span><input type="date" name="from" max="${now}" value="${now.slice(0, 4)}-01-01"></label>
          <label class="field"><span>Au</span><input type="date" name="to" value="${now}"></label>
        </div>
      </fieldset>
      <fieldset class="settings-options"><legend>Données à vider</legend>
        ${items.map(([key, label, hint]) => `<label class="reset-item"><input type="checkbox" name="targets" value="${key}">
          <span><b>${label}</b><small>${hint}</small></span><em data-count="${key}">…</em></label>`).join("")}
      </fieldset>
      <label class="field reset-confirm"><span>Pour confirmer, tapez <b>VIDER</b></span><input name="confirm" autocapitalize="characters" placeholder="VIDER"></label>
      <div class="form-actions"><button type="submit" class="btn danger" disabled>${icon("trash")} Vider les données sélectionnées</button></div>
    </form>`;
  const form = target.querySelector("#reset-form"), submit = form.querySelector("[type=submit]");
  const scope = () => form.elements.scope.value;
  const chosen = () => [...form.querySelectorAll("[name=targets]:checked")].map((input) => input.value);
  let counts = {};
  async function refresh() {
    target.querySelector("#reset-period").hidden = scope() !== "periode";
    const params = new URLSearchParams({ scope:scope() });
    if (scope() === "periode") { params.set("from", form.elements.from.value); params.set("to", form.elements.to.value); }
    try { counts = await api("/gestion/reinitialisation?" + params); }
    catch (error) { counts = {}; form.querySelectorAll("[data-count]").forEach((node) => { node.textContent = "—"; }); toast(error.message, "error"); return sync(); }
    form.querySelectorAll("[data-count]").forEach((node) => { node.textContent = `${counts[node.dataset.count]} ${unit[node.dataset.count]}`; });
    sync();
  }
  function sync() { submit.disabled = !chosen().length || form.elements.confirm.value.trim().toUpperCase() !== "VIDER"; }
  form.addEventListener("change", (event) => { if (["scope", "from", "to"].includes(event.target.name)) refresh(); else sync(); });
  form.elements.confirm.addEventListener("input", sync);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = { targets:chosen(), scope:scope(), confirm:form.elements.confirm.value.trim().toUpperCase() };
    if (body.scope === "periode") Object.assign(body, { from:form.elements.from.value, to:form.elements.to.value });
    submit.disabled = true;
    try {
      const result = await api("/gestion/reinitialisation", "POST", body);
      toast("Données vidées : " + Object.entries(result.counts).map(([key, value]) => `${value} ${unit[key]}`).join(", ") + ".");
      form.elements.confirm.value = "";
      form.querySelectorAll("[name=targets]").forEach((input) => { input.checked = false; });
      await refresh();
    } catch (error) { toast(error.message, "error"); sync(); }
  });
  await refresh();
}
