<?php
declare(strict_types=1);

const BACKUP_TABLES = [
    'classes', 'students', 'school_groups', 'group_members', 'planning', 'attendance', 'attendance_members',
    'visits', 'exclusions', 'kiosk_settings', 'opening_hours', 'school_year', 'school_year_members', 'audit_log',
];

function exportBackup(Store $db, int $clock): array
{
    $tables = [];
    foreach (BACKUP_TABLES as $name) {
        $tables[$name] = $db->all("SELECT * FROM $name");
    }
    $data = ['format' => 'cdi-backup', 'version' => 1, 'created_at' => gmdate('Y-m-d\TH:i:s\Z', intdiv($clock, 1000)),
        'tables' => $tables,
        'privacy' => recoveryState($db)];
    if (strlen(jsonData($data)) > MAX_BACKUP_BYTES) {
        fail(413, 'Les données dépassent la taille maximale d’une sauvegarde depuis l’administration.');
    }
    return $data;
}

function validBackupRow(string $table, array $row): bool
{
    return match ($table) {
        'students', 'school_groups' => in_array($row['active'], [0, 1], true),
        'planning' => validDay($row['day']) && $row['start_min'] >= 0 && $row['end_min'] <= 1440
            && $row['start_min'] < $row['end_min'] && in_array($row['kind'], SCHEDULE_KINDS, true),
        'attendance' => in_array($row['roster_kind'], ['classe', 'groupe'], true)
            && $row['duration'] >= 5 && $row['duration'] <= 240,
        'attendance_members' => in_array($row['status'], ['present', 'retard', 'absent', 'excuse', 'attente', 'exclu'], true),
        'visits' => $row['starts_at'] < $row['expires_at'] && in_array($row['source'], ['individuel', 'classe', 'groupe'], true),
        'exclusions' => validDay($row['until_day']),
        'kiosk_settings' => $row['id'] === 1 && !array_diff([$row['is_open'], $row['allow_second_hour'], $row['use_hours'], $row['hide_weekend']], [0, 1])
            && ($row['capacity'] === null || ($row['capacity'] >= 1 && $row['capacity'] <= 1000)),
        'audit_log' => ($row['before_json'] === null || is_object(json_decode($row['before_json'])))
            && ($row['after_json'] === null || is_object(json_decode($row['after_json']))),
        default => true,
    };
}

function replaceBackupTables(Store $db, array $tables): void
{
    foreach (array_reverse(BACKUP_TABLES) as $name) {
        if ($name !== 'audit_log') {
            $db->run("DELETE FROM $name");
        }
    }
    foreach (BACKUP_TABLES as $name) {
        $schema = $db->all("PRAGMA table_info($name)");
        $columns = implode(',', array_column($schema, 'name'));
        $placeholders = implode(',', array_fill(0, count($schema), '?'));
        foreach ($tables[$name] as $row) {
            if (!is_array($row) || count($row) !== count($schema)) {
                fail(400, "Données invalides dans la rubrique « $name ».");
            }
            $values = [];
            foreach ($schema as $column) {
                $key = $column['name'];
                $value = $row[$key] ?? null;
                if (!array_key_exists($key, $row) || ($value === null ? $column['notnull'] || $column['pk']
                    : (strtoupper($column['type']) === 'INTEGER' ? !is_int($value) : !is_string($value)))) {
                    fail(400, "Données invalides dans la rubrique « $name ».");
                }
                $values[] = $value;
            }
            if (!validBackupRow($name, $row)) {
                fail(400, "Données invalides dans la rubrique « $name ».");
            }
            $verb = $name === 'audit_log' ? 'INSERT OR IGNORE' : 'INSERT';
            $db->run("$verb INTO $name ($columns) VALUES ($placeholders)", ...$values);
        }
    }
    normalizeHours($tables['opening_hours']);
}

function backupResource(Store $db, array $me, string $path, string $method, int $clock): array
{
    if ($path === '/api/gestion/sauvegarde' && $method === 'GET') {
        need($me,'sauvegarde','restaurer');
        return ['rows' => in_array('sauvegarde',$me['rights'],true)
            ? $db->all('SELECT id,created_at FROM encrypted_backups ORDER BY created_at DESC,id DESC') : []];
    }
    if ($path === '/api/gestion/sauvegarde/export' && $method === 'POST') {
        need($me,'sauvegarde');
        $data = requestData();
        $envelope = encryptBackup(jsonData(exportBackup($db,$clock)),$data['phrase'] ?? null);
        $db->run('INSERT INTO encrypted_backups VALUES (?,?,?)',uid(),$clock,jsonData($envelope));
        rotateBackups($db);
        audit($db,$me,'sauvegarde','Export chiffré','Sauvegarde',null,null);
        return $envelope;
    }
    if ($path === '/api/gestion/sauvegarde/etat/export' && $method === 'POST') {
        need($me,'sauvegarde');
        $data = requestData();
        $envelope = encryptBackup(jsonData(['format'=>'cdi-recovery','privacy'=>recoveryState($db)]),$data['phrase'] ?? null);
        audit($db,$me,'sauvegarde','Export de l’état de reprise','Historique des purges et effacements',null,null);
        return $envelope;
    }
    if ($path === '/api/gestion/sauvegarde/etat' && $method === 'POST') {
        need($me,'restaurer');
        $data = requestData(MAX_ENVELOPE_BYTES);
        $file = decryptBackup($data['backup'] ?? null,$data['phrase'] ?? null);
        if (($file['format'] ?? null) !== 'cdi-recovery' || !isset($file['privacy'])) {
            fail(400,'Ce fichier n’est pas un état de reprise.');
        }
        applyRecovery($db,checkedPrivacyState($file['privacy']),$clock);
        audit($db,$me,'sauvegarde','Import de l’état de reprise','Historique des purges et effacements',null,null);
        return ['ok'=>true];
    }
    if ($method === 'GET' && preg_match('~^/api/gestion/sauvegarde/([a-f0-9-]+)$~D',$path,$match)) {
        need($me,'sauvegarde');
        $row = $db->one('SELECT envelope FROM encrypted_backups WHERE id=?',$match[1]);
        if (!$row) {
            fail(404,'Sauvegarde indisponible.');
        }
        audit($db,$me,'sauvegarde','Téléchargement','Sauvegarde chiffrée',null,null);
        header('Content-Disposition: attachment; filename="TiceCDI-Sauvegarde.json"');
        return json_decode($row['envelope'],true,flags:JSON_THROW_ON_ERROR);
    }
    if ($path !== '/api/gestion/sauvegarde' || $method !== 'POST') {
        fail(404,'Action introuvable.');
    }
    need($me,'restaurer');
    $data = requestData(MAX_ENVELOPE_BYTES);
    $encoded = $data['backup'] ?? null;
    $backup = decryptBackup($encoded,$data['phrase'] ?? null);
    $privacy = checkedPrivacyState($backup['privacy'] ?? null);
    $tables = $backup['tables'] ?? null;
    $date = $backup['created_at'] ?? null;
    if (!is_array($backup) || ($backup['format'] ?? null) !== 'cdi-backup' || ($backup['version'] ?? null) !== 1
        || !is_string($date) || strtotime($date) === false || !is_array($tables)
        || count($tables) !== count(BACKUP_TABLES)) {
        fail(400, 'Le fichier n’est pas une sauvegarde CDI dans un format pris en charge.');
    }
    $counts = [];
    foreach (BACKUP_TABLES as $name) {
        if (!is_array($tables[$name] ?? null) || !array_is_list($tables[$name])) {
            fail(400, 'La sauvegarde est incomplète.');
        }
        $counts[$name] = count($tables[$name]);
    }
    $serialized = jsonData($backup);
    if (strlen($serialized) > MAX_BACKUP_BYTES) {
        fail(413, 'Le fichier est trop volumineux.');
    }
    $fingerprint = hash('sha256', jsonData($encoded));
    $summary = ['created_at' => $date, 'counts' => $counts];
    $preview = !array_key_exists('token', $data);
    if (!$preview && (!is_string($data['token']) || !hash_equals($fingerprint, $data['token']))) {
        fail(409, 'Analysez à nouveau le fichier avant de confirmer la restauration.');
    }

    // Une prévisualisation vérifie aussi l’intégrité SQLite, puis annule toutes les écritures.
    if ($preview) {
        $db->run('SAVEPOINT backup_preview');
    }
    try {
        replaceBackupTables($db, $tables);
    } catch (PDOException $error) {
        if (($error->errorInfo[0] ?? null) === '23000') {
            fail(400, 'La sauvegarde contient un doublon ou une référence invalide.');
        }
        throw $error;
    }
    if ($preview) {
        $db->run('ROLLBACK TO backup_preview');
        $db->run('RELEASE backup_preview');
        return $summary + ['token' => $fingerprint];
    }
    $db->run("UPDATE audit_log SET target='Présence',before_json=NULL,after_json=NULL WHERE area='presences'");
    $db->run("UPDATE audit_log SET target='Fiche d’appel',before_json=NULL,after_json=NULL WHERE area='seances' AND action='Correction d’un appel'");
    applyRecovery($db,$privacy,$clock);
    audit($db, $me, 'sauvegarde', 'Restauration d’une sauvegarde', 'Données du CDI', null, [
        'sauvegarde_du' => $date, 'élèves' => $counts['students'], 'présences' => $counts['visits'], 'créneaux' => $counts['planning'],
    ]);
    return $summary;
}

function journal(Store $db, int $clock): array
{
    $before = filter_var(q('before', (string) ($clock + 1)), FILTER_VALIDATE_INT);
    if ($before === false || $before < 0 || $before > $clock + 1000) {
        fail(400, 'Page de journal invalide.');
    }
    $area = q('area');
    $rows = $db->all("SELECT * FROM audit_log WHERE (?='' OR area=?) AND at<? ORDER BY at DESC,id DESC LIMIT 101",
        $area, $area, $before);
    if (count($rows) <= 100) {
        return ['rows' => $rows, 'next' => null];
    }
    $edge = $rows[99]['at'];
    $head = array_values(array_filter($rows, static fn ($row) => $row['at'] > $edge));
    $tail = $db->all("SELECT * FROM audit_log WHERE at=? AND (?='' OR area=?) ORDER BY id DESC", $edge, $area, $area);
    return ['rows' => [...$head, ...$tail], 'next' => $edge];
}
