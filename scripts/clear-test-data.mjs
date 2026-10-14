// Empties the app's tables in a dedicated test database. Refuses to run unless the database name
// ends in _test or _e2e, so it can never touch a development or production database.
import pg from "pg";

const url = process.env.DATABASE_URL ?? "";
const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
if (!/_(test|e2e)$/.test(dbName)) {
  console.error(`Refusing to clear "${dbName}": only databases named *_test or *_e2e can be cleared.`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(
    'TRUNCATE TABLE "UsageRecord", "Message", "Conversation", "AppSettings", "Task", "Milestone", "Project", "Note", "NoteFolder", "AgentStep", "AgentRun", "Agent" RESTART IDENTITY CASCADE',
  );
  console.log(`Cleared test data in "${dbName}".`);
} finally {
  await client.end();
}
