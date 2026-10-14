// Runs once when the server starts. It switches on the automation scheduler, which checks every few seconds
// whether a scheduled automation is due.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // A build also loads this file in its workers; they have no database and nothing to schedule.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.OMNI_DISABLE_SCHEDULER === "1") return;
  const { startScheduler } = await import("@/lib/automations/engine");
  await startScheduler();
}
