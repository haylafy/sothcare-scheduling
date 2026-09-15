/**
 * Standalone reminder runner, for when you would rather schedule a container
 * than hit the HTTP endpoint (ECS scheduled task, cron on a box, etc.).
 *
 *   npm run cron:run
 */
try {
  process.loadEnvFile(".env");
} catch {
  /* optional */
}

const { processDueWorkflowRuns } = await import("../src/lib/workflows");

const result = await processDueWorkflowRuns();
console.log(`processed=${result.processed} sent=${result.sent} failed=${result.failed}`);
process.exit(0);
