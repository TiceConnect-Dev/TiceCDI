// Page « Sécurité du compte » : double authentification, codes de secours et sessions actives.
import { api, day, e, icon, notice, time } from "./shared.js";
import { button, saveFile } from "./schedule.js";
import { qrSvg } from "./qr.js";

const $ = (q, root = document) => root.querySelector(q);
const gestion = (path, method, body) => api("/gestion/" + path, method, body);
const pill = (text, tone = "gray") => `<span class="pill pill-${tone}">${e(text)}</span>`;
const stamp = (value) => value ? day(value) + " à " + time(value) : "—";
const table = (heads, rows) => `<div class="scroll-table"><table><thead><tr>${heads.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
const passwordField = `<label class="field"><span>Mot de passe actuel</span><input name="password" type="password" autocomplete="current-password" maxlength="160" required></label>`;
const codeField = (label = "Code à 6 chiffres") => `<label class="field"><span>${label}</span><input name="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="12" required placeholder="123 456"></label>`;

// Fenêtre à étapes : chaque étape renvoie le contenu suivant ou termine.
function wizard(title, step) {
  const dialog = $("#dialog");
  const show = (current) => {
    dialog.innerHTML = `<div class="dialog-inner"><div class="dialog-header"><h2 id="dialog-title">${e(title)}</h2>
      <button class="dialog-close" type="button" data-close aria-label="Fermer">${icon("close")}</button></div>
      <form class="stack">${current.html}<div id="dialog-error" role="alert" hidden></div>
      <div class="form-actions">${current.cancel === false ? "" : button("Annuler", "", "data-close")}
      <button class="btn ${current.danger ? "danger" : "primary"}" type="submit">${e(current.submit)}</button></div></form></div>`;
    const form = $("form", dialog);
    dialog.querySelectorAll("[data-close]").forEach((node) => node.addEventListener("click", () => dialog.close()));
    current.ready?.(form);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = $("[type=submit]", form);
      const errorBox = $("#dialog-error", form);
      submit.disabled = true;
      errorBox.hidden = true;
      try {
        const next = await current.save(form);
        if (next) show(next); else dialog.close();
      } catch (error) {
        errorBox.hidden = false;
        errorBox.innerHTML = notice(error.message, "error");
        submit.disabled = false;
      }
    });
    (form.querySelector("input:not([type=hidden]):not([type=checkbox])") ?? $("[type=submit]", form)).focus();
  };
  show(step);
  if (!dialog.open) dialog.showModal();
}

function codesStep(codes, done) {
  const text = "Codes de secours TiceCDI\nChaque code ne fonctionne qu’une fois.\n\n" + codes.join("\n") + "\n";
  return {
    cancel:false,
    submit:"Terminer",
    html:`${notice("Conservez ces codes en lieu sûr (gestionnaire de mots de passe, impression rangée). Ils remplacent le téléphone en cas de perte et ne seront plus affichés.", "warning", "warning")}
      <ol class="recovery-grid">${codes.map((code) => `<li><code>${e(code)}</code></li>`).join("")}</ol>
      <div class="button-row">${button("Copier", "copy", 'type="button" data-copy')}${button("Télécharger", "download", 'type="button" data-download')}</div>
      <label class="check-line"><input type="checkbox" name="kept" required> J’ai conservé ces codes</label>`,
    ready(form) {
      $("[data-copy]", form).addEventListener("click", async (event) => {
        try { await navigator.clipboard.writeText(text); event.currentTarget.innerHTML = icon("check") + " Copiés"; }
        catch { event.currentTarget.disabled = true; }
      });
      $("[data-download]", form).addEventListener("click", () => saveFile("TiceCDI-codes-de-secours.txt", "text/plain;charset=utf-8", text));
    },
    async save() { await done(); return null; },
  };
}

export async function renderSecurity(target, { section, toast, me }) {
  const [data, global] = await Promise.all([gestion("securite"), me.admin && !me.mfa_missing ? gestion("sessions") : Promise.resolve(null)]);
  const reload = () => renderSecurity(target, { section, toast, me });
  const mfa = data.mfa;
  const sessionRow = (row, admin = false) => `<tr>
    ${admin ? `<td><strong>${e(row.name)}</strong><small>${e(row.username)}${row.mfa ? " · 2FA" : ""}</small></td>` : ""}
    <td><strong>${e(row.agent || "Navigateur inconnu")}</strong><small>${e(row.address || "Poste inconnu")}</small></td>
    <td>${stamp(row.created_at)}</td><td>${stamp(row.last_seen)}</td>
    <td>${row.current ? pill("Cette session", "green") : button("Fermer", "logout", `data-session="${e(row.id)}" data-scope="${admin ? "all" : "own"}"`, "secondary tiny")}</td></tr>`;

  target.innerHTML = section("Sécurité du compte", "Protégez votre compte par un code sur téléphone et surveillez les connexions ouvertes.")
    + (me.mfa_missing && !mfa.enabled ? notice("Votre établissement exige la double authentification. Activez-la pour accéder aux autres rubriques.", "warning", "warning") : "") + `
    <section class="panel security-panel"><div class="table-top"><h2>Double authentification</h2>${mfa.enabled ? pill("Active", "green") : pill("Inactive", "red")}</div>
      <div class="panel-body stack">
        <p>${mfa.enabled
          ? `Un code à 6 chiffres de votre application d’authentification est demandé à chaque connexion. Activée le ${stamp(mfa.enabled_at)}.`
          : "Ajoutez un code temporaire généré par une application (Microsoft Authenticator, Google Authenticator, FreeOTP, Aegis…) en plus du mot de passe."}</p>
        ${mfa.enabled ? `<p class="subtle">${mfa.recovery_left} code${mfa.recovery_left > 1 ? "s" : ""} de secours restant${mfa.recovery_left > 1 ? "s" : ""}.</p>` : ""}
        ${mfa.enabled && mfa.recovery_left <= 3 ? notice("Il vous reste peu de codes de secours : générez-en de nouveaux.", "warning", "warning") : ""}
        ${me.admin && !mfa.enabled ? notice("Recommandé : activez la double authentification sur les comptes administrateurs.", "", "lock") : ""}
        <div class="button-row">${mfa.enabled
          ? button("Nouveaux codes de secours", "refresh", 'data-mfa="codes"') + button("Désactiver", "ban", 'data-mfa="off"', "danger")
          : button("Activer la double authentification", "lock", 'data-mfa="on"', "primary")}</div>
      </div></section>
    <section class="panel table-panel"><div class="table-top"><h2>Mes sessions ouvertes</h2>${pill(data.sessions.length + " session" + (data.sessions.length > 1 ? "s" : ""))}
      ${data.sessions.length > 1 ? button("Fermer les autres sessions", "logout", 'data-session-others') : ""}</div>
      ${table(["Navigateur et poste", "Ouverte le", "Dernière activité", "Action"], data.sessions.map((row) => sessionRow(row)))}</section>
    ${global ? `<section class="panel table-panel"><div class="table-top"><h2>Sessions de tous les comptes</h2>${pill(global.rows.length + " active" + (global.rows.length > 1 ? "s" : ""))}</div>
      ${table(["Compte", "Navigateur et poste", "Ouverte le", "Dernière activité", "Action"], global.rows.map((row) => sessionRow(row, true)))}</section>` : ""}`;

  target.querySelector('[data-mfa="on"]')?.addEventListener("click", () => wizard("Activer la double authentification", {
    submit:"Continuer",
    html:`<p>Confirmez votre identité pour commencer.</p>${passwordField}`,
    async save(form) {
      const { secret, uri } = await gestion("securite/totp", "POST", { password:form.elements.password.value });
      return {
        submit:"Activer",
        html:`<ol class="steps"><li>Ouvrez votre application d’authentification et ajoutez un compte.</li><li>Scannez ce QR code ou saisissez la clé.</li><li>Entrez le code affiché.</li></ol>
          <div class="qr-box">${qrSvg(uri, "QR code d’activation de la double authentification")}
          <div><span class="subtle">Clé de configuration</span><code class="secret-key">${e(secret.match(/.{1,4}/g).join(" "))}</code></div></div>${codeField()}`,
        async save(next) {
          const { codes } = await gestion("securite/totp/activation", "POST", { code:next.elements.code.value });
          return codesStep(codes, async () => {
            if (me.mfa_missing) { location.reload(); return; }
            toast("Double authentification activée. Vos autres sessions ont été fermées.");
            await reload();
          });
        },
      };
    },
  }));
  target.querySelector('[data-mfa="off"]')?.addEventListener("click", () => wizard("Désactiver la double authentification", {
    submit:"Désactiver", danger:true,
    html:`<p>Votre compte ne sera plus protégé que par son mot de passe.</p>${passwordField}${codeField("Code à 6 chiffres ou code de secours")}`,
    async save(form) {
      await gestion("securite/totp/desactivation", "POST", { password:form.elements.password.value, code:form.elements.code.value });
      toast("Double authentification désactivée.");
      await reload();
      return null;
    },
  }));
  target.querySelector('[data-mfa="codes"]')?.addEventListener("click", () => wizard("Nouveaux codes de secours", {
    submit:"Générer",
    html:`<p>Les anciens codes de secours cesseront immédiatement de fonctionner.</p>${passwordField}`,
    async save(form) {
      const { codes } = await gestion("securite/codes", "POST", { password:form.elements.password.value });
      return codesStep(codes, async () => { toast("Nouveaux codes de secours enregistrés."); await reload(); });
    },
  }));
  target.querySelector("[data-session-others]")?.addEventListener("click", async () => {
    try { await gestion("securite/sessions", "DELETE"); toast("Les autres sessions sont fermées."); await reload(); }
    catch (error) { toast(error.message, "error"); }
  });
  target.querySelectorAll("[data-session]").forEach((node) => node.addEventListener("click", async () => {
    try {
      await gestion((node.dataset.scope === "all" ? "sessions/" : "securite/sessions/") + node.dataset.session, "DELETE");
      toast("Session fermée.");
      await reload();
    } catch (error) { toast(error.message, "error"); }
  }));
}

// Encart d’alerte (administrateurs) : comptes visés par des échecs de connexion répétés sur 24 heures.
export async function securityAlerts(target) {
  try {
    const { rows, threshold } = await gestion("securite/alertes");
    if (!rows.length || !target.isConnected) return;
    const box = document.createElement("div");
    box.className = "security-alert";
    box.setAttribute("role", "alert");
    box.innerHTML = notice(`Échecs de connexion répétés (${threshold} ou plus en 24 h) : ` + rows.map((row) => `${row.target} (${row.count})`).join(", ")
      + ". Consultez la rubrique « Sécurité des comptes » du journal.", "warning", "warning");
    target.prepend(box);
  } catch { /* Encart facultatif */ }
}

const policyNames = { none:"Facultative", admins:"Obligatoire pour les administrateurs", all:"Obligatoire pour tous les comptes" };
export async function renderConnection(target, { section, toast }) {
  const data = await gestion("connexion");
  target.innerHTML = section("Connexion et sécurité", "Règles de connexion du personnel et connexion par l’ENT de l’établissement.") + `
    <form class="panel panel-body stack settings-panel" id="connection-form">
      <h2>Règles de connexion</h2>
      <label class="field"><span>Double authentification</span><select name="mfa_policy">${Object.entries(policyNames).map(([value, name]) => `<option value="${value}" ${data.mfa_policy === value ? "selected" : ""}>${name}</option>`).join("")}</select>
        <small>Un compte concerné sans double authentification ne voit plus que « Sécurité du compte » jusqu’à son activation.</small></label>
      <div class="form-grid">
        <label class="field"><span>Déconnexion après inactivité (minutes)</span><input name="idle_minutes" type="number" min="0" max="720" step="5" value="${data.idle_minutes}" required><small>0 désactive la déconnexion. Les actualisations automatiques ne comptent pas comme activité.</small></label>
        <label class="field"><span>Seuil d’alerte (échecs en 24 h)</span><input name="alert_threshold" type="number" min="3" max="100" value="${data.alert_threshold}" required><small>Un encart prévient les administrateurs au-delà de ce nombre d’échecs pour un même compte.</small></label>
      </div>
      <h2>Connexion par l’ENT</h2>
      <label class="field"><span>Mode</span><select name="sso_mode"><option value="">Désactivée</option><option value="cas" ${data.sso_mode === "cas" ? "selected" : ""}>CAS (ENT académiques, Skolengo, Atrium…)</option><option value="oidc" ${data.sso_mode === "oidc" ? "selected" : ""}>OpenID Connect</option></select></label>
      <div id="sso-fields" class="stack">
        <label class="field"><span>Libellé du bouton</span><input name="sso_label" maxlength="40" value="${e(data.sso_label)}" placeholder="ENT"><small>Affiché « Se connecter avec … » sur la page de connexion.</small></label>
        <label class="field" data-mode="cas"><span>Adresse du serveur CAS</span><input name="cas_url" type="url" maxlength="300" value="${e(data.cas_url)}" placeholder="https://cas.ent.exemple.fr/cas"></label>
        <div class="form-grid" data-mode="oidc">
          <label class="field"><span>Émetteur (issuer)</span><input name="oidc_issuer" type="url" maxlength="300" value="${e(data.oidc_issuer)}" placeholder="https://auth.exemple.fr/realms/ent"></label>
          <label class="field"><span>Identifiant client</span><input name="oidc_client_id" maxlength="200" value="${e(data.oidc_client_id)}"></label>
          <label class="field"><span>Secret client</span><input name="oidc_client_secret" type="password" maxlength="500" autocomplete="new-password" placeholder="${data.has_secret ? "Enregistré · laisser vide pour le conserver" : "Facultatif (client public avec PKCE)"}"></label>
          <label class="field"><span>Champ portant l’identifiant</span><input name="oidc_claim" maxlength="60" value="${e(data.oidc_claim)}"><small>Ex. preferred_username ou email.</small></label>
        </div>
        ${notice("Adresse de retour à déclarer auprès de l’ENT : " + data.callback, "", "info")}
        <p class="subtle">L’identifiant renvoyé par l’ENT doit correspondre exactement à l’identifiant du compte TiceCDI. Aucun compte n’est créé automatiquement.</p>
      </div>
      <div id="connection-result" aria-live="polite"></div>
      <div class="form-actions"><button class="btn secondary" type="button" id="sso-test">${icon("refresh")} Tester les réglages enregistrés</button>
        <button class="btn primary" type="submit">${icon("check")} Enregistrer</button></div>
    </form>`;
  const form = $("#connection-form", target);
  const result = $("#connection-result", target);
  const sync = () => {
    const mode = form.elements.sso_mode.value;
    $("#sso-fields", form).hidden = !mode;
    form.querySelectorAll("[data-mode]").forEach((node) => { node.hidden = node.dataset.mode !== mode; });
    $("#sso-test", form).hidden = !mode;
  };
  form.elements.sso_mode.addEventListener("change", sync);
  sync();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(form));
    try {
      await gestion("connexion", "PATCH", { ...fields, idle_minutes:Number(fields.idle_minutes), alert_threshold:Number(fields.alert_threshold) });
      toast("Réglages de connexion enregistrés.");
      await renderConnection(target, { section, toast });
    } catch (error) { result.innerHTML = notice(error.message, "error"); }
  });
  $("#sso-test", form).addEventListener("click", async () => {
    result.innerHTML = notice("Test en cours…");
    try {
      const outcome = await gestion("connexion/test", "POST", {});
      result.innerHTML = notice(outcome.message, outcome.ok ? "success" : "error");
    } catch (error) { result.innerHTML = notice(error.message, "error"); }
  });
}

const durationNames = { "12h":"12 heures", "7j":"7 jours", "30j":"30 jours", annee:"Jusqu’à la fin de l’année scolaire (31 août)" };
// Page « Postes de borne » : activation, durée et renouvellement (administrateurs), liste des postes activés.
export async function renderDevices(target, { section, toast, me, confirmDialog }) {
  const data = await gestion("borne/postes");
  const reload = () => renderDevices(target, { section, toast, me, confirmDialog });
  const { settings, rows } = data;
  const expiry = (row) => settings.renew && settings.duration !== "annee"
    ? `Renouvelée à l’usage<small>sinon le ${stamp(row.expires_at)}</small>` : stamp(row.expires_at);
  target.innerHTML = section("Postes de borne", "Activez un navigateur dédié au pointage et gérez les postes déjà activés.",
    button("Activer ce poste", "scan", 'data-action="activate-device"', "primary")) + `
    <section class="panel panel-body stack devices-intro">
      <p>Ce navigateur ${rows.some((row) => row.current) ? "<strong>est déjà activé</strong> comme borne." : "n’est pas activé comme borne."}
        Activation valable <strong>${e(durationNames[settings.duration])}</strong>${settings.renew && settings.duration !== "annee" ? ", <strong>renouvelée automatiquement</strong> tant que la borne est utilisée" : ""}.</p>
      ${me.admin ? `<form id="device-settings" class="device-settings">
        <label class="field"><span>Durée d’activation</span><select name="duration">${Object.entries(durationNames).map(([value, name]) => `<option value="${value}" ${value === settings.duration ? "selected" : ""}>${name}</option>`).join("")}</select></label>
        <label class="check-line"><input type="checkbox" name="renew" ${settings.renew ? "checked" : ""}> Renouveler automatiquement tant que la borne est utilisée</label>
        <button class="btn secondary" type="submit">${icon("check")} Enregistrer</button></form>
        <p class="subtle">La nouvelle durée s’applique aux prochaines activations et aux renouvellements. Une borne ne donne accès qu’au pointage.</p>` : ""}
    </section>
    <section class="panel table-panel"><div class="table-top"><h2>${me.admin ? "Postes activés" : "Mes postes activés"}</h2>${pill(rows.length + " poste" + (rows.length > 1 ? "s" : ""))}
      ${rows.length ? button(me.admin ? "Révoquer tous les postes" : "Révoquer mes postes", "lock", 'data-action="revoke-devices"', "danger") : ""}</div>
      ${rows.length ? table(["Poste", "Activé par", "Activé le", "Dernière activité", "Validité", "Action"], rows.map((row) => `<tr>
        <td><strong>${e(row.label || "Poste sans nom")}</strong><small>${e(row.agent || "Navigateur inconnu")} · ${e(row.address || "—")}${row.current ? " · ce navigateur" : ""}</small></td>
        <td>${e(row.activated_by)}</td><td>${stamp(row.created_at)}</td><td>${stamp(row.last_seen)}</td><td class="multiline">${expiry(row)}</td>
        <td>${button("Révoquer", "ban", `data-device="${e(row.id)}" data-label="${e(row.label || "ce poste")}"`, "danger tiny")}</td></tr>`))
        : `<p class="empty-line">Aucun poste activé pour le moment.</p>`}</section>`;
  target.querySelector("#device-settings")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await gestion("borne/postes", "PATCH", { duration:form.elements.duration.value, renew:form.elements.renew.checked });
      toast("Durée d’activation enregistrée.");
      await reload();
    } catch (error) { toast(error.message, "error"); }
  });
  target.querySelectorAll("[data-device]").forEach((node) => node.addEventListener("click", () =>
    confirmDialog("Révoquer le poste", `« ${node.dataset.label} » devra être réactivé par le personnel pour pointer à nouveau.`, "Révoquer",
      () => gestion("borne/postes/" + node.dataset.device, "DELETE"), "Poste révoqué.", reload)));
}
