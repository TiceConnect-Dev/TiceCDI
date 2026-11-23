-- Notifications du personnel (v1.15) : élève exclu à la borne, CDI presque plein ou complet. Conservées 48 heures.
CREATE TABLE kiosk_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('exclu','presque_plein','complet')),
  message TEXT NOT NULL
);
CREATE INDEX kiosk_events_time ON kiosk_events(at);
