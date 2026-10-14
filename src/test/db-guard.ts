/** Integration tests delete rows, so they must only ever run against a dedicated *_test database. */
export function assertTestDatabase(): void {
  const dbName = decodeURIComponent(new URL(process.env.DATABASE_URL ?? "postgresql://x/").pathname.replace(/^\//, ""));
  if (!/_test$/.test(dbName)) throw new Error(`Integration tests only run against a *_test database, got "${dbName}"`);
}
