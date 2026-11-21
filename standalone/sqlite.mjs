import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";

export function openDatabase(filename, migrationFolder) {
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  database.exec("CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)");
  const done = database.prepare("SELECT 1 FROM local_migrations WHERE name=?");
  const applied = database.prepare("INSERT INTO local_migrations VALUES (?)");
  function transaction(work) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  for (const name of readdirSync(migrationFolder).filter((entry) => /\.sql$/.test(entry)).sort()) {
    transaction(() => {
      if (done.get(name)) return;
      database.exec(readFileSync(new URL(name, migrationFolder), "utf8"));
      applied.run(name);
    });
  }
  const modified = database.prepare("SELECT changes() AS count");
  return {
    database,
    prepare(sql) {
      const query = database.prepare(sql);
      return {
        bind(...params) {
          return {
            async first() { return query.get(...params) ?? null; },
            async all() { return { results: query.all(...params) }; },
            async run() { return { meta: { changes: Number(query.run(...params).changes) } }; },
            runBatch() {
              if (!query.columns().length) return { results: [], meta: { changes: Number(query.run(...params).changes) } };
              const results = query.all(...params);
              return { results, meta: { changes: Number(modified.get().count) } };
            },
          };
        },
      };
    },
    async batch(statements) { return transaction(() => statements.map((statement) => statement.runBatch())); },
  };
}
