-- Postes de borne : durée d'activation réglable, renouvellement automatique et liste des postes activés.
CREATE TABLE kiosk_device_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  duration TEXT NOT NULL DEFAULT '30j' CHECK(duration IN ('12h','7j','30j','annee')),
  renew INTEGER NOT NULL DEFAULT 1 CHECK(renew IN (0,1))
);
INSERT INTO kiosk_device_settings (id) VALUES (1);
ALTER TABLE kiosk_devices ADD COLUMN label TEXT NOT NULL DEFAULT '';
ALTER TABLE kiosk_devices ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kiosk_devices ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kiosk_devices ADD COLUMN agent TEXT NOT NULL DEFAULT '';
ALTER TABLE kiosk_devices ADD COLUMN address TEXT NOT NULL DEFAULT '';
