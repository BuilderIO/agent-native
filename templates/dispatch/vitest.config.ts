import { defineConfig } from "vitest/config";

/**
 * Minimal node test runner for the Dispatch template's server-side unit
 * tests (currently the identity-SSO redirect-allowlist + claim logic).
 * Scoped to `server/**` so it never tries to bundle the React app.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.spec.ts"],
  },
});
