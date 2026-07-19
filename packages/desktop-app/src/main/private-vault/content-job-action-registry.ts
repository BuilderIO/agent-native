import type {
  PrivateVaultAuthorizedActionContext,
  PrivateVaultLocalActionRegistry,
} from "@agent-native/private-vault-broker";

import { createPrivateVaultContentActionRegistry } from "./content-action-registry.js";
import type {
  PrivateVaultContentDocument,
  PrivateVaultLocalManifestHead,
} from "./content-document-codec.js";
import { PrivateVaultContentMutations } from "./content-document-mutations.js";
import { PrivateVaultContentRegistry } from "./content-document-registry.js";
import { PrivateVaultContentSync } from "./content-document-sync.js";
import type { PrivateVaultContentSession } from "./content-genesis-transport.js";
import {
  createPrivateVaultContentJobObjectRuntime,
  type PrivateVaultContentJobObjectRuntime,
} from "./content-job-object-runtime.js";
import { PrivateVaultContentObjectTransport } from "./content-object-transport.js";

const VAULT_ACTIONS = new Set([
  "list-documents",
  "search-documents",
  "create-document",
]);
const HISTORY_ACTIONS = new Set([
  "list-document-versions",
  "restore-document-version",
]);
const NO_DOCUMENT_ACTIONS = new Set(["create-document", "delete-document"]);

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

class JobContentIndex {
  #manifest: PrivateVaultLocalManifestHead | null = null;
  readonly #documents = new Map<string, PrivateVaultContentDocument>();

  async readManifest(vaultId: string) {
    return this.#manifest?.manifest.vaultId === vaultId ? this.#manifest : null;
  }

  async writeManifest(head: PrivateVaultLocalManifestHead) {
    this.#manifest = head;
  }

  async readDocument(vaultId: string, objectId: string, revisionId: string) {
    const value = this.#documents.get(`${vaultId}:${revisionId}`);
    return value?.id === objectId ? value : null;
  }

  async writeDocument(
    vaultId: string,
    revisionId: string,
    document: PrivateVaultContentDocument,
  ) {
    this.#documents.set(`${vaultId}:${revisionId}`, document);
  }

  async deleteDocument(vaultId: string, objectId: string) {
    for (const [key, document] of this.#documents) {
      if (key.startsWith(`${vaultId}:`) && document.id === objectId)
        this.#documents.delete(key);
    }
  }

  close() {
    this.#manifest = null;
    this.#documents.clear();
  }
}

export class PrivateVaultContentJobActionRegistry {
  readonly #transport: PrivateVaultContentObjectTransport;
  readonly #objects: PrivateVaultContentJobObjectRuntime;
  readonly #vaultId: string;

  constructor(input: {
    readonly vaultId: string;
    readonly session: PrivateVaultContentSession;
    readonly origin: string;
    readonly objects?: PrivateVaultContentJobObjectRuntime;
    readonly transport?: PrivateVaultContentObjectTransport;
  }) {
    this.#vaultId = input.vaultId;
    this.#transport =
      input.transport ?? new PrivateVaultContentObjectTransport(input);
    this.#objects =
      input.objects ?? createPrivateVaultContentJobObjectRuntime();
  }

  registry(): PrivateVaultLocalActionRegistry {
    const output: Record<
      string,
      {
        run(
          args: unknown,
          context: PrivateVaultAuthorizedActionContext,
        ): Promise<unknown>;
      }
    > = Object.create(null);
    for (const actionName of [
      "list-documents",
      "search-documents",
      "get-document",
      "pull-document",
      "create-document",
      "update-document",
      "edit-document",
      "move-document",
      "delete-document",
      "list-document-versions",
      "restore-document-version",
    ]) {
      output[actionName] = {
        run: (args, context) => this.#run(actionName, args, context),
      };
    }
    return Object.freeze(output);
  }

  async #run(
    actionName: string,
    args: unknown,
    context: PrivateVaultAuthorizedActionContext,
  ) {
    if (context.operation !== actionName) throw new Error();
    const resourceId = hex(context.resourceId);
    if (VAULT_ACTIONS.has(actionName) && resourceId !== this.#vaultId)
      throw new Error();
    const jobHash = (context as { readonly jobHash?: unknown }).jobHash;
    if (typeof jobHash !== "string" || !/^[0-9a-f]{64}$/.test(jobHash))
      throw new Error();
    const jobContext = { jobId: context.jobId, jobHash };
    const index = new JobContentIndex();
    try {
      const sync = new PrivateVaultContentSync({
        index,
        gateway: {
          list: (vaultId) => this.#transport.list(vaultId),
          open: async (request) => {
            const opened = await this.#objects.downloadAndOpen({
              context: jobContext,
              transport: this.#transport,
              ...request,
            });
            return {
              plaintext: opened.plaintext,
              contentType:
                opened.metadata.objectType === "document"
                  ? "application/vnd.agent-native.content-document+json"
                  : "application/vnd.agent-native.content-vault-manifest+json",
            } as const;
          },
        },
      });
      const documentIds = VAULT_ACTIONS.has(actionName)
        ? actionName === "create-document"
          ? new Set<string>()
          : undefined
        : NO_DOCUMENT_ACTIONS.has(actionName)
          ? new Set<string>()
          : new Set([resourceId]);
      await sync.synchronize(this.#vaultId, {
        documentIds,
        includeHistory: HISTORY_ACTIONS.has(actionName),
      });
      const registry = new PrivateVaultContentRegistry(index);
      const mutations = new PrivateVaultContentMutations({
        index,
        gateway: {
          sealAndUpload: (request) =>
            this.#objects.sealAndUpload({
              context: jobContext,
              transport: this.#transport,
              ...request,
            }),
        },
      });
      const handler = createPrivateVaultContentActionRegistry({
        vaultId: this.#vaultId,
        registry,
        mutations,
      })[actionName];
      if (!handler) throw new Error();
      return await handler.run(args, context);
    } finally {
      index.close();
    }
  }
}

export function createPrivateVaultContentJobActionRegistry(input: {
  readonly vaultId: string;
  readonly session: PrivateVaultContentSession;
  readonly origin: string;
}) {
  return new PrivateVaultContentJobActionRegistry(input).registry();
}
