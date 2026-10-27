/**
 * Web Locks shared by every "tab" in one origin, for tests. Grants happen a
 * microtask later, as in browsers, so a caller that does not await sees
 * nothing held.
 */
export class FakeLockManager {
  readonly held = new Set<string>();

  async request(
    name: string,
    optionsOrCallback:
      | { ifAvailable?: boolean }
      | ((lock: { name: string } | null) => unknown),
    maybeCallback?: (lock: { name: string } | null) => unknown,
  ): Promise<unknown> {
    const options =
      typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
    const callback =
      typeof optionsOrCallback === "function"
        ? optionsOrCallback
        : maybeCallback!;
    await Promise.resolve();
    if (this.held.has(name)) {
      if (options.ifAvailable) return callback(null);
      throw new Error("FakeLockManager does not model queued waiters");
    }
    this.held.add(name);
    try {
      return await callback({ name });
    } finally {
      this.held.delete(name);
    }
  }

  async query() {
    return { held: [...this.held].map((name) => ({ name })), pending: [] };
  }
}
