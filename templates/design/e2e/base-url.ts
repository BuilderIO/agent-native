const DEFAULT_PORT = "9333";

export function e2eBaseURL(): string {
  const explicit = process.env.E2E_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const port = process.env.E2E_PORT?.trim() || DEFAULT_PORT;
  if (!/^\d+$/.test(port)) {
    throw new Error(
      `E2E_PORT must be numeric, got ${JSON.stringify(process.env.E2E_PORT)}.`,
    );
  }
  return `http://127.0.0.1:${port}`; // e2e-harness-ignore — the single source
}
