import { appendFileSync, statSync, truncateSync } from "node:fs";

const LOG_PATH = "data/server.log";
const MAX_BYTES = 10 * 1024 * 1024;

function teeLine(level: string, args: unknown[]): void {
  try {
    const line = `${new Date().toISOString()} [${level}] ${args
      .map((a) =>
        typeof a === "string"
          ? a
          : (() => {
              try {
                return JSON.stringify(a);
              } catch {
                return String(a);
              }
            })(),
      )
      .join(" ")}\n`;
    appendFileSync(LOG_PATH, line);
    if (statSync(LOG_PATH).size > MAX_BYTES) {
      truncateSync(LOG_PATH, 0);
    }
  } catch {
    // Logging must never break the server.
  }
}

/**
 * Tee console output into data/server.log so the server's story is
 * readable by agents and after the terminal scrolls away. The terminal
 * output is unchanged.
 */
export default () => {
  for (const level of ["log", "info", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      teeLine(level, args);
    };
  }
};
