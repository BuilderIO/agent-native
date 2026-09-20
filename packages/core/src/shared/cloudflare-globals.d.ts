/**
 * Cloudflare Workers runtime globals.
 *
 * These are injected by the Workers runtime at request time.
 * They don't exist in Node.js or other runtimes.
 */

interface CfEnv {
  [key: string]: unknown;
}

declare var __cf_env: CfEnv | undefined;
/** Nitro's native Cloudflare preset exposes the request environment here. */
declare var __env__: CfEnv | undefined;
