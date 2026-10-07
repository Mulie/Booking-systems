import pg from "pg";
import fs from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const client = new pg.Client({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === "1" ? { rejectUnauthorized: false } : undefined,
});
await client.connect();
await client.query(
  "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
);
const dir = path.resolve("db/migrations");
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  const done = await client.query("SELECT 1 FROM schema_migrations WHERE name=$1", [file]);
  if (done.rowCount) continue;
  console.log("applying", file);
  await client.query("BEGIN");
  try {
    await client.query(fs.readFileSync(path.join(dir, file), "utf8"));
    await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}
await client.end();
console.log("migrations up to date");
