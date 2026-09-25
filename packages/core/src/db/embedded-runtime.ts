/**
 * Embedded host duty: the process-local claim that a real host product
 * (`createAgentNativeEmbeddedPlugin()`) explicitly configured this process's
 * database, including a legitimate `pglite:` URL for a packaged/desktop
 * install.
 *
 * That install can set `NODE_ENV=production` and boots a real H3 app the
 * same way a deployed Node/Docker server does (see `db/server-runtime.js`),
 * so `assertHostedRuntimeDatabase()` cannot otherwise tell "the embedding
 * host chose this database on purpose" apart from "a deploy silently fell
 * back to it because nobody configured `DATABASE_URL`." Claimed with
 * {@link markEmbeddedRuntimeAuthorized}.
 *
 * Its own module, mirroring `./migration-runtime.js`: `client.js` reads it,
 * and keeping it dependency-free avoids adding one more stub to every
 * `vi.mock("../db/client.js")` in the codebase.
 */

type EmbeddedRuntimeGlobal = typeof globalThis & {
  __AGENT_NATIVE_EMBEDDED_RUNTIME__?: boolean;
};

/** True once an embedding host has explicitly configured this process's database. */
export function isEmbeddedRuntimeAuthorized(): boolean {
  return (
    (globalThis as EmbeddedRuntimeGlobal).__AGENT_NATIVE_EMBEDDED_RUNTIME__ ===
    true
  );
}

/** Claim embedded-host duty. Idempotent; never unset for the life of the process. */
export function markEmbeddedRuntimeAuthorized(): void {
  (globalThis as EmbeddedRuntimeGlobal).__AGENT_NATIVE_EMBEDDED_RUNTIME__ =
    true;
}
