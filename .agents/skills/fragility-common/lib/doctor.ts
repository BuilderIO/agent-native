// Runs preflight checks and exits 0 ready, 1 a check failed, 2 a check could
// not run (credentials, network). Every check reports; none is skipped.
type Status = "ok" | "warn" | "fail" | "error";

export interface Check {
  name: string;
  run: () => Promise<string> | string;
  /** Status when run() throws. "warn" never fails the doctor. */
  onFail?: Status;
}

export async function runDoctor(checks: Check[]): Promise<void> {
  const results: { name: string; status: Status; detail: string }[] = [];
  for (const check of checks) {
    try {
      results.push({
        name: check.name,
        status: "ok",
        detail: await check.run(),
      });
    } catch (error) {
      results.push({
        name: check.name,
        status: check.onFail ?? "fail",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  for (const r of results)
    console.log(`${r.status.toUpperCase().padEnd(5)} ${r.name}: ${r.detail}`);
  const credentialError = results.some(
    (r) => r.status === "fail" && /credentials|not set/.test(r.detail),
  );
  if (credentialError || results.some((r) => r.status === "error"))
    process.exit(2);
  if (results.some((r) => r.status === "fail")) process.exit(1);
}
