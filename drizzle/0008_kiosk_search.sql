-- Recherche par nom sur la borne pour les élèves sans carte : réglage et sélections temporaires (3 minutes).
ALTER TABLE kiosk_device_settings ADD COLUMN name_search INTEGER NOT NULL DEFAULT 1 CHECK(name_search IN (0,1));
CREATE TABLE kiosk_refs (
  ref TEXT PRIMARY KEY NOT NULL,
  student_id TEXT NOT NULL,
  device TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
