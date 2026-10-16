import path from "node:path";

// The runner loads the config before global setup and hands its environment
// to every worker it starts, so an account made here for this run is the one
// global setup signs in and every worker reads. Each worker loads the config
// again, so a value kept anywhere but the environment would differ per worker.
// guard:allow-env-mutation — Playwright config, never a server request path.
process.env.CONTENT_E2E_EMAIL ||= `e2e+autoz-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}@content.test`;

/** The account this run signs in as. */
export const RUN_EMAIL = process.env.CONTENT_E2E_EMAIL;

// Keyed on the account, so two runs in one checkout, such as the two gate
// arms, cannot sign each other's specs in with the wrong session.
const dir = path.join(
  import.meta.dirname,
  "..",
  ".auth",
  RUN_EMAIL.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
);

/** The files global setup writes for the run's account. */
export const AUTH_FILES = {
  dir,
  state: path.join(dir, "state.json"),
  email: path.join(dir, "email.txt"),
  connector: path.join(dir, "mcp-connector.json"),
};
