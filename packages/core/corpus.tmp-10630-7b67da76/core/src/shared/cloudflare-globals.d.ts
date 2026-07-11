/**
 * Cloudflare Workers runtime globals.
 *
 * These are injected by the Workers runtime at request time.
 * They don't exist in Node.js or other runtimes.
 */

/** Minimal D1 Database binding interface (Cloudflare Workers) */
interface CfD1Database {
  prepare(query: string): CfD1PreparedStatement;
  batch(
    statements: CfD1PreparedStatement[],
  ): Promise<
    { results: Record<string, unknown>[]; meta?: { changes?: number } }[]
  >;
}

interface CfD1PreparedStatement {
  bind(...values: unknown[]): CfD1PreparedStatement;
  all(): Promise<{
    results: Record<string, unknown>[];
    meta?: { changes?: number };
  }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

interface CfEnv {
  DB?: CfD1Database;
  [key: string]: unknown;
}

declare var __cf_env: CfEnv | undefined;
declare var __cf_ctx: { waitUntil(p: Promise<unknown>): void } | undefined;
