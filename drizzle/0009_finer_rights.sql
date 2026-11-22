-- Droits plus fins : l’ancien droit « export » est réparti par rubrique et séparé des sauvegardes ;
-- l’ancien droit « donnees » (dossiers individuels) est réparti entre consulter, rectifier et effacer.
-- Les comptes existants gardent exactement les mêmes possibilités.
UPDATE accounts SET permissions=replace(permissions,'"export"','"export_planning","export_appel","export_statistiques","export_dossiers","sauvegarde"') WHERE instr(permissions,'"export"')>0;
UPDATE accounts SET permissions=replace(permissions,'"donnees"','"dossiers_voir","donnees","effacer"') WHERE instr(permissions,'"donnees"')>0;
