// Applies the project's SQL migrations (prisma/migrations/*/migration.sql) to the app's own database, once each, in order.
// The desktop app owns that database, so a small runner is enough and the Prisma command line is not needed at run time.
const fs = require("node:fs");
const path = require("node:path");

async function applyMigrations(client, directory, log = () => {}) {
  await client.query("CREATE TABLE IF NOT EXISTS _omni_desktop_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await client.query("SELECT name FROM _omni_desktop_migrations")).rows.map((row) => row.name));
  const names = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(directory, entry.name, "migration.sql")))
    .map((entry) => entry.name)
    .sort();
  let applied = 0;
  for (const name of names) {
    if (done.has(name)) continue;
    const sql = fs.readFileSync(path.join(directory, name, "migration.sql"), "utf8");
    log(`Applying migration ${name}`);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _omni_desktop_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
      applied += 1;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw new Error(`Migration ${name} failed: ${error.message}`);
    }
  }
  return applied;
}

module.exports = { applyMigrations };
