-- Accès des élèves pendant un créneau du planning (v1.14) : 1 = la borne accepte les élèves, 0 = la borne refuse les entrées.
-- Une fermeture exceptionnelle refuse toujours les élèves.
ALTER TABLE planning ADD COLUMN students_allowed INTEGER NOT NULL DEFAULT 1 CHECK(students_allowed IN (0,1));
UPDATE planning SET students_allowed=0 WHERE kind='fermeture';
