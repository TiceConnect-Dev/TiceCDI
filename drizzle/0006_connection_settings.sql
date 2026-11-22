-- Réglages de connexion : double authentification exigée, déconnexion après inactivité, alertes et connexion ENT.
CREATE TABLE security_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  mfa_policy TEXT NOT NULL DEFAULT 'none' CHECK(mfa_policy IN ('none','admins','all')),
  idle_minutes INTEGER NOT NULL DEFAULT 60 CHECK(idle_minutes BETWEEN 0 AND 720),
  alert_threshold INTEGER NOT NULL DEFAULT 5 CHECK(alert_threshold BETWEEN 3 AND 100),
  sso_mode TEXT NOT NULL DEFAULT '' CHECK(sso_mode IN ('','cas','oidc')),
  sso_label TEXT NOT NULL DEFAULT 'ENT',
  cas_url TEXT NOT NULL DEFAULT '',
  oidc_issuer TEXT NOT NULL DEFAULT '',
  oidc_client_id TEXT NOT NULL DEFAULT '',
  oidc_client_secret TEXT NOT NULL DEFAULT '',
  oidc_claim TEXT NOT NULL DEFAULT 'preferred_username'
);
INSERT INTO security_settings (id) VALUES (1);

-- Connexion ENT : état anti-rejeu (state, nonce, PKCE) valable dix minutes.
CREATE TABLE sso_states (
  state TEXT PRIMARY KEY NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Étape « code » après une connexion ENT quand le compte a la double authentification.
CREATE TABLE login_challenges (
  token TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Heure et jour locaux (Europe/Paris) des passages encore conservés, pour la carte de fréquentation.
CREATE VIEW local_visits AS
WITH visits_utc AS (
  SELECT starts_at / 1000 AS utc, date(starts_at / 1000,'unixepoch','start of year') AS yr FROM visits
)
SELECT utc + CASE
  WHEN utc >= unixepoch(yr,'+3 months','-1 day','-6 days','weekday 0','+1 hour')
   AND utc < unixepoch(yr,'+10 months','-1 day','-6 days','weekday 0','+1 hour')
  THEN 7200 ELSE 3600 END AS local
FROM visits_utc;
