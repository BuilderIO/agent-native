import { AsyncLocalStorage } from "node:async_hooks";

export type CredentialUse =
  | {
      kind: "stored";
      key: string;
      scope: string | null;
      scopeId: string | null;
    }
  | { kind: "unreadable"; key: string }
  | {
      kind: "provider-auth";
      provider: string;
      key: string;
      source: string;
      scope: string | null;
      scopeId: string | null;
      connectionId: string | null;
      accountId: string | null;
    }
  | {
      kind:
        | "provider-request"
        | "provider-unresolved"
        | "provider-connection"
        | "caller-auth"
        | "custom-provider"
        | "provider-effect";
      provider: string;
    };

export class CredentialUseLedger {
  readonly #uses = new Map<string, CredentialUse>();
  readonly readsOnly: boolean;
  readonly orgCredentialsOnly: boolean;
  readonly bridgeTools: ReadonlySet<string> | null;

  constructor(
    options: {
      readsOnly?: boolean;
      orgCredentialsOnly?: boolean;
      bridgeTools?: ReadonlySet<string>;
    } = {},
  ) {
    this.readsOnly = options.readsOnly ?? false;
    this.orgCredentialsOnly = options.orgCredentialsOnly ?? false;
    this.bridgeTools = options.bridgeTools ?? null;
  }

  record(use: CredentialUse): void {
    this.#uses.set(JSON.stringify(use), use);
  }

  get uses(): CredentialUse[] {
    return Array.from(this.#uses.values());
  }
}

const ledgerStorage = new AsyncLocalStorage<CredentialUseLedger>();

export function runWithCredentialUseLedger<T>(
  ledger: CredentialUseLedger,
  work: () => T,
): T {
  return ledgerStorage.run(ledger, work);
}

export function runWithoutCredentialUseLedger<T>(work: () => T): T {
  return ledgerStorage.exit(work);
}

export function credentialUseLedgerReadsOnly(): boolean {
  return ledgerStorage.getStore()?.readsOnly ?? false;
}

export function credentialUseLedgerOrgCredentialsOnly(): boolean {
  return ledgerStorage.getStore()?.orgCredentialsOnly ?? false;
}

export function recordCredentialUse(use: CredentialUse): void {
  ledgerStorage.getStore()?.record(use);
}
