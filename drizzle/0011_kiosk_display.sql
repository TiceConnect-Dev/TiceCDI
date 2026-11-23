-- Affichage de la borne (v1.13) : places libres, annonces, planning du jour, règles du CDI, écran de repos et thème.
-- Réglages purement visuels, stockés en JSON validé par le serveur.
CREATE TABLE kiosk_display (
  id INTEGER PRIMARY KEY CHECK(id=1),
  settings TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO kiosk_display (id,settings) VALUES (1,'{}');
