import type {
  ContextImportConnector,
  ContextImportConnectorSummary,
  ContextConnectorKind,
} from "./types.js";

export class ContextImportConnectorRegistry {
  readonly #connectors = new Map<
    ContextConnectorKind,
    ContextImportConnector
  >();

  constructor(connectors: readonly ContextImportConnector[] = []) {
    for (const connector of connectors) this.register(connector);
  }

  register(connector: ContextImportConnector): this {
    if (this.#connectors.has(connector.kind)) {
      throw new Error(
        `Context connector ${connector.kind} is already registered.`,
      );
    }
    this.#connectors.set(connector.kind, connector);
    return this;
  }

  get(kind: string): ContextImportConnector {
    const connector = this.#connectors.get(kind as ContextConnectorKind);
    if (!connector) {
      throw new Error(`Unknown context connector ${kind}.`);
    }
    return connector;
  }

  has(kind: string): boolean {
    return this.#connectors.has(kind as ContextConnectorKind);
  }

  list(): ContextImportConnectorSummary[] {
    return [...this.#connectors.values()]
      .map((connector) => ({
        kind: connector.kind,
        label: connector.label,
        supportsIncremental: connector.supportsIncremental,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
}
