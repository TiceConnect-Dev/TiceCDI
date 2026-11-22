// Réglages de connexion : double authentification exigée, inactivité, alertes et connexion ENT (CAS ou OpenID Connect).
// Logique identique à php/app/connection.php pour l’édition PHP.
const encoder = new TextEncoder();
const STATE_MS = 10 * 60_000;
export const FAILURE_ACTIONS = ["Échec de connexion", "Échec de la double authentification", "Échec de connexion ENT"];

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const random = (size) => hex(crypto.getRandomValues(new Uint8Array(size)));
const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sha256(value) { return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))); }

export async function connectionSettings(m) {
  return await m.one("SELECT * FROM security_settings WHERE id=1") ?? {
    mfa_policy:"none", idle_minutes:0, alert_threshold:5, sso_mode:"", sso_label:"ENT", cas_url:"", oidc_issuer:"", oidc_client_id:"", oidc_client_secret:"", oidc_claim:"preferred_username",
  };
}
export function ssoPublic(settings) {
  return { enabled:Boolean(settings.sso_mode), label:settings.sso_label || "ENT" };
}
function safeUrl(value, field, fail) {
  if (!value) return "";
  let url;
  try { url = new URL(value); } catch { fail(400, `${field} : adresse invalide.`); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) fail(400, `${field} : utilisez une adresse en https://.`);
  if (url.username || url.password || url.hash) fail(400, `${field} : adresse invalide.`);
  return url.href.replace(/\/$/, "");
}
async function outbound(url, options = {}) {
  const response = await fetch(url, { ...options, redirect:"error", signal:AbortSignal.timeout(8000) });
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error("Réponse trop volumineuse");
  return { ok:response.ok, status:response.status, text };
}
async function discovery(issuer) {
  const result = await outbound(issuer + "/.well-known/openid-configuration", { headers:{ Accept:"application/json" } });
  if (!result.ok) throw new Error("Découverte OpenID Connect impossible");
  const config = JSON.parse(result.text);
  if (!config.authorization_endpoint || !config.token_endpoint || !config.issuer) throw new Error("Configuration OpenID Connect incomplète");
  return config;
}
const decodeJwt = (token) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))));
const xmlText = (value) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();

export function settingsView(settings, callback) {
  const { oidc_client_secret, ...rest } = settings;
  return { ...rest, id:undefined, has_secret:Boolean(oidc_client_secret), callback };
}

// Routes /api/gestion/connexion (administrateurs) et /api/gestion/securite/alertes.
export async function connectionApi(ctx) {
  const { m, request, me, path, method, clock, json, fail, payload, audit, callback } = ctx;
  if (path === "/api/gestion/securite/alertes" && method === "GET") {
    if (!me.admin) return json({ rows:[] });
    const settings = await connectionSettings(m);
    const rows = await m.list(`SELECT target,count(*) AS count,max(at) AS last FROM audit_log
      WHERE area='securite' AND action IN (?,?,?) AND at>? GROUP BY target HAVING count(*)>=? ORDER BY count DESC LIMIT 20`,
      ...FAILURE_ACTIONS, clock - 86_400_000, settings.alert_threshold);
    return json({ threshold:settings.alert_threshold, rows });
  }
  if (!path.startsWith("/api/gestion/connexion")) return null;
  if (!me.admin) fail(403, "Cette rubrique est réservée aux administrateurs.");
  const settings = await connectionSettings(m);
  if (path === "/api/gestion/connexion" && method === "GET") return json(settingsView(settings, callback));
  if (path === "/api/gestion/connexion" && method === "PATCH") {
    const data = await payload(request);
    const text = (value, limit) => typeof value === "string" ? value.trim().slice(0, limit) : "";
    const next = {
      mfa_policy:["none", "admins", "all"].includes(data.mfa_policy) ? data.mfa_policy : fail(400, "Choisissez une règle de double authentification."),
      idle_minutes:Number.isInteger(data.idle_minutes) && data.idle_minutes >= 0 && data.idle_minutes <= 720 ? data.idle_minutes : fail(400, "La durée d’inactivité doit être comprise entre 0 et 720 minutes."),
      alert_threshold:Number.isInteger(data.alert_threshold) && data.alert_threshold >= 3 && data.alert_threshold <= 100 ? data.alert_threshold : fail(400, "Le seuil d’alerte doit être compris entre 3 et 100."),
      sso_mode:["", "cas", "oidc"].includes(data.sso_mode) ? data.sso_mode : fail(400, "Mode de connexion ENT inconnu."),
      sso_label:text(data.sso_label, 40) || "ENT",
      cas_url:safeUrl(text(data.cas_url, 300), "Adresse CAS", fail),
      oidc_issuer:safeUrl(text(data.oidc_issuer, 300), "Émetteur OpenID Connect", fail),
      oidc_client_id:text(data.oidc_client_id, 200),
      oidc_client_secret:typeof data.oidc_client_secret === "string" && data.oidc_client_secret ? data.oidc_client_secret.slice(0, 500) : settings.oidc_client_secret,
      oidc_claim:/^[a-zA-Z0-9_:.-]{1,60}$/.test(text(data.oidc_claim, 60)) ? text(data.oidc_claim, 60) : "preferred_username",
    };
    if (data.clear_secret === true) next.oidc_client_secret = "";
    if (next.sso_mode === "cas" && !next.cas_url) fail(400, "Renseignez l’adresse du serveur CAS de l’ENT.");
    if (next.sso_mode === "oidc" && (!next.oidc_issuer || !next.oidc_client_id)) fail(400, "Renseignez l’émetteur et l’identifiant client OpenID Connect.");
    const before = { ...settingsView(settings, undefined), callback:undefined };
    await m.batch([
      m.stmt(`UPDATE security_settings SET mfa_policy=?,idle_minutes=?,alert_threshold=?,sso_mode=?,sso_label=?,cas_url=?,oidc_issuer=?,oidc_client_id=?,oidc_client_secret=?,oidc_claim=? WHERE id=1`,
        next.mfa_policy, next.idle_minutes, next.alert_threshold, next.sso_mode, next.sso_label, next.cas_url, next.oidc_issuer, next.oidc_client_id, next.oidc_client_secret, next.oidc_claim),
      audit(m, me, "securite", "Modification des réglages de connexion", "Connexion et sécurité", before, { ...settingsView(next, undefined), callback:undefined }),
    ]);
    return json({ ok:true });
  }
  if (path === "/api/gestion/connexion/test" && method === "POST") {
    try {
      if (settings.sso_mode === "oidc") {
        const config = await discovery(settings.oidc_issuer);
        return json({ ok:true, message:`Fournisseur joignable : ${config.issuer}` });
      }
      if (settings.sso_mode === "cas") {
        const result = await outbound(settings.cas_url + "/login");
        return json({ ok:result.status < 500, message:`Serveur CAS joignable (HTTP ${result.status}).` });
      }
      return json({ ok:false, message:"La connexion ENT est désactivée." });
    } catch (error) {
      return json({ ok:false, message:"Fournisseur injoignable : " + (error.message || "erreur réseau") + "." });
    }
  }
  fail(404, "Action introuvable.");
}

// Connexion ENT. `links` fournit les adresses propres à l’édition (redirection, pages).
export async function ssoApi(ctx) {
  const { m, request, path, method, clock, fail, links, finish, audit, trace, cookieHeader } = ctx;
  const settings = await connectionSettings(m);
  const url = new URL(request.url);
  if (path === "/api/auth/sso/start" && method === "GET") {
    if (!settings.sso_mode) fail(404, "La connexion ENT est désactivée.");
    const state = random(16), nonce = random(16), verifier = random(32);
    await m.batch([
      m.stmt("DELETE FROM sso_states WHERE expires_at<=?", clock),
      m.stmt("INSERT INTO sso_states VALUES (?,?,?,?)", state, nonce, verifier, clock + STATE_MS),
    ]);
    let target;
    if (settings.sso_mode === "cas") {
      target = settings.cas_url + "/login?service=" + encodeURIComponent(links.callback(state));
    } else {
      const config = await discovery(settings.oidc_issuer).catch(() => fail(502, "Le fournisseur d’identité ne répond pas."));
      const query = new URLSearchParams({ response_type:"code", client_id:settings.oidc_client_id, redirect_uri:links.callback(), scope:"openid profile email",
        state, nonce, code_challenge:base64url(await sha256(verifier)), code_challenge_method:"S256" });
      target = config.authorization_endpoint + (config.authorization_endpoint.includes("?") ? "&" : "?") + query;
    }
    // Le cookie (SameSite=Lax) lie le retour de l’ENT à ce navigateur.
    return new Response(null, { status:303, headers:{ Location:target, "Cache-Control":"no-store", "Set-Cookie":cookieHeader("cdi_sso", state, 600, "Lax") } });
  }
  if (path !== "/api/auth/sso/callback" || method !== "GET") return null;
  const failure = async (reason, who = "Identifiant ENT inconnu") => {
    await m.batch([audit(m, { name:who }, "securite", "Échec de connexion ENT", reason, null, trace)]);
    return new Response(null, { status:303, headers:{ Location:links.page("/connexion", { sso:"echec" }), "Cache-Control":"no-store", "Set-Cookie":cookieHeader("cdi_sso", "", 0, "Lax") } });
  };
  const state = url.searchParams.get("state") ?? "";
  const bound = request.headers.get("cookie")?.match(/(?:^|;\s*)cdi_sso=([a-f0-9]{32})(?:;|$)/)?.[1];
  if (!/^[a-f0-9]{32}$/.test(state) || bound !== state) return failure("Retour ENT non reconnu");
  const saved = await m.one("SELECT * FROM sso_states WHERE state=? AND expires_at>?", state, clock);
  await m.run("DELETE FROM sso_states WHERE state=?", state);
  if (!saved || !settings.sso_mode) return failure("Retour ENT expiré");
  let login = "";
  try {
    if (settings.sso_mode === "cas") {
      const ticket = url.searchParams.get("ticket") ?? "";
      if (!/^[\w.-]{1,256}$/.test(ticket)) return failure("Ticket CAS absent");
      const result = await outbound(`${settings.cas_url}/serviceValidate?service=${encodeURIComponent(links.callback(state))}&ticket=${encodeURIComponent(ticket)}`);
      if (!/<cas:authenticationSuccess>/.test(result.text)) return failure("Ticket CAS refusé");
      login = xmlText(result.text.match(/<cas:user>([^<]{1,200})<\/cas:user>/)?.[1] ?? "");
    } else {
      const code = url.searchParams.get("code") ?? "";
      if (!code || code.length > 2000) return failure("Code OpenID Connect absent");
      const config = await discovery(settings.oidc_issuer);
      const body = new URLSearchParams({ grant_type:"authorization_code", code, redirect_uri:links.callback(), client_id:settings.oidc_client_id, code_verifier:saved.verifier });
      if (settings.oidc_client_secret) body.set("client_secret", settings.oidc_client_secret);
      const token = await outbound(config.token_endpoint, { method:"POST", headers:{ "Content-Type":"application/x-www-form-urlencoded", Accept:"application/json" }, body });
      if (!token.ok) return failure("Jeton OpenID Connect refusé");
      const tokens = JSON.parse(token.text);
      // Jeton reçu directement du fournisseur en TLS : on contrôle émetteur, audience, expiration et nonce (OIDC Core 3.1.3.7).
      const claims = decodeJwt(tokens.id_token);
      const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (claims.iss !== config.issuer || !audience.includes(settings.oidc_client_id) || !(claims.exp * 1000 > clock) || claims.nonce !== saved.nonce)
        return failure("Jeton OpenID Connect invalide");
      let value = claims[settings.oidc_claim];
      if (value === undefined && config.userinfo_endpoint && tokens.access_token) {
        const info = await outbound(config.userinfo_endpoint, { headers:{ Authorization:"Bearer " + tokens.access_token, Accept:"application/json" } });
        if (info.ok) value = JSON.parse(info.text)[settings.oidc_claim];
      }
      login = typeof value === "string" ? value : "";
    }
  } catch {
    return failure("Fournisseur d’identité injoignable");
  }
  login = login.trim().toLowerCase();
  const account = /^[a-z0-9][a-z0-9_.@-]{2,79}$/.test(login) ? await m.one("SELECT * FROM accounts WHERE username=?", login) : null;
  if (!account) return failure("Aucun compte TiceCDI pour « " + login.slice(0, 80) + " »");
  return finish(account);
}
