-- Sessions détaillées : création, dernière activité, navigateur et poste, pour la page « Sécurité du compte ».
ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN agent TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN address TEXT NOT NULL DEFAULT '';

-- Double authentification TOTP (RFC 6238) et codes de secours hachés (SHA-256).
CREATE TABLE account_mfa (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  secret TEXT,
  pending TEXT,
  last_step INTEGER NOT NULL DEFAULT 0,
  recovery TEXT NOT NULL DEFAULT '[]',
  enabled_at INTEGER
);
