-- Activation d'une borne par code (v1.17) : le personnel génère un code à 8 chiffres, valable 10 minutes et à usage unique,
-- puis le saisit sur la borne sans s'y connecter. Seule l'empreinte SHA-256 du code est conservée.
CREATE TABLE kiosk_codes (
  code TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX kiosk_codes_account ON kiosk_codes(account_id);
