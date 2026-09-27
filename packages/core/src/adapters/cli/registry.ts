import type { CliAdapter } from "./types.js";

export class CliRegistry {
  private adapters = new Map<string, CliAdapter>();

  register(adapter: CliAdapter): void {
    this.adapters.set(adapter.name, adapter);
  }

  unregister(name: string): void {
    this.adapters.delete(name);
  }

  get(name: string): CliAdapter | undefined {
    return this.adapters.get(name);
  }

  list(): CliAdapter[] {
    return [...this.adapters.values()];
  }

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
