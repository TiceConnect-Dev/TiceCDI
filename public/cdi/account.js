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
  const [data, global] = await Promise.all([gestion("securite"), me.admin ? gestion("sessions") : Promise.resolve(null)]);
  const reload = () => renderSecurity(target, { section, toast, me });
  const mfa = data.mfa;
  const sessionRow = (row, admin = false) => `<tr>
    ${admin ? `<td><strong>${e(row.name)}</strong><small>${e(row.username)}${row.mfa ? " · 2FA" : ""}</small></td>` : ""}
    <td><strong>${e(row.agent || "Navigateur inconnu")}</strong><small>${e(row.address || "Poste inconnu")}</small></td>
    <td>${stamp(row.created_at)}</td><td>${stamp(row.last_seen)}</td>
    <td>${row.current ? pill("Cette session", "green") : button("Fermer", "logout", `data-session="${e(row.id)}" data-scope="${admin ? "all" : "own"}"`, "secondary tiny")}</td></tr>`;

  target.innerHTML = section("Sécurité du compte", "Protégez votre compte par un code sur téléphone et surveillez les connexions ouvertes.") + `
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
          return codesStep(codes, async () => { toast("Double authentification activée. Vos autres sessions ont été fermées."); await reload(); });
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
