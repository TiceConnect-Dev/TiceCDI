-- Motif de présence (v1.15) : saisi par le personnel dans la liste des présents ou lors d’une arrivée manuelle. Supprimé avec le passage.
ALTER TABLE visits ADD COLUMN reason TEXT CHECK(reason IS NULL OR length(reason) BETWEEN 1 AND 60);
