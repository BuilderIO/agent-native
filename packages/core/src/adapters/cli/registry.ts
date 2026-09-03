import type { CliAdapter } from "./types.js";

/**
 * Registry of CLI adapters available to the agent.
 *
 * Register adapters at app startup. The agent can then discover what
 * CLIs are available and execute commands through them.
 */
export class CliRegistry {
  private adapters = new Map<string, CliAdapter>();

  /** Register an adapter. Replaces any existing adapter with the same name. */
  register(adapter: CliAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  /** Unregister an adapter by name. */
  unregister(name: string): void {
    this.adapters.delete(name);
  }

  /** Get an adapter by name. Returns undefined if not registered. */
  get(name: string): CliAdapter | undefined {
    return this.adapters.get(name);
  }

  /** List all registered adapters. */
  list(): CliAdapter[] {
    return [...this.adapters.values()];
  }

  /**
   * List only adapters whose CLI is currently available (installed).
   * Checks each adapter in parallel.
   */
  async listAvailable(): Promise<CliAdapter[]> {
    const entries = this.list();
    const checks = await Promise.all(
      entries.map(async (adapter) => {
        try {
          const available = await adapter.isAvailable();
          return available ? adapter : null;
        } catch {
          return null;
        }
      }),
    );
    return checks.filter((a): a is CliAdapter => a !== null);
  }

  /**
   * Return a summary of all registered adapters for agent discovery.
   * Includes availability status.
   */
  async describe(): Promise<
    { name: string; description: string; available: boolean }[]
  > {
    const entries = this.list();
    return Promise.all(
      entries.map(async (adapter) => {
        let available = false;
        try {
          available = await adapter.isAvailable();
        } catch {}
        return {
          name: adapter.name,
          description: adapter.description,
          available,
        };
      }),
    );
  }
}
