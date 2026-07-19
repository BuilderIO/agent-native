import { randomBytes } from "node:crypto";

import { encodeAncV1SemanticJobPayload } from "@agent-native/core/e2ee";
import { encodePrivateVaultActionRequest } from "@agent-native/private-vault-broker";

import type { PrivateVaultContentBrokerRuntimeDescriptor } from "./content-broker-runtime-transport.js";
import type { PrivateVaultContentSession } from "./content-genesis-transport.js";
import {
  PrivateVaultContentRequesterTransport,
  PrivateVaultContentRequesterTransportError,
} from "./content-requester-transport.js";
import {
  createPrivateVaultNativeServiceClient,
  type NativeListedContentGrantsResult,
  type NativeListedVaultMembersResult,
  type NativeCreatedContentGrantResult,
  type NativeRevokedContentGrantResult,
  type PrivateVaultNativeServiceClient,
} from "./native-service-client.js";

const VAULT_ACTIONS = new Set([
  "create-document",
  "list-documents",
  "search-documents",
]);
const VERSION_ACTIONS = new Set([
  "list-document-versions",
  "restore-document-version",
]);
const CONTENT_ACTIONS = new Set([
  ...VAULT_ACTIONS,
  "delete-document",
  "edit-document",
  "get-document",
  "list-document-versions",
  "move-document",
  "pull-document",
  "restore-document-version",
  "update-document",
]);
const GRANT_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const JOB_LIFETIME_SECONDS = 10 * 60;

export class PrivateVaultContentRequesterRuntimeError extends Error {
  constructor() {
    super("Private Vault Content action unavailable");
    this.name = "PrivateVaultContentRequesterRuntimeError";
  }
}

interface GrantCache {
  readonly vaultId: string;
  readonly recipientEndpointId: string;
  readonly subjectAgentId: string;
  readonly disclosureProviderId: string;
  readonly disclosureDestination: string;
  readonly grantId: string;
  readonly grantRef: string;
  readonly expiresAt: number;
}

function lowerHex(value: unknown, bytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length === bytes * 2 &&
    /^[0-9a-f]+$/.test(value)
  );
}

function resourceId(
  vaultId: string,
  actionName: string,
  args: unknown,
): Uint8Array {
  if (!CONTENT_ACTIONS.has(actionName))
    throw new PrivateVaultContentRequesterRuntimeError();
  const resource = VAULT_ACTIONS.has(actionName)
    ? vaultId
    : args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)[
          VERSION_ACTIONS.has(actionName) ? "documentId" : "id"
        ]
      : undefined;
  if (!lowerHex(resource, 16))
    throw new PrivateVaultContentRequesterRuntimeError();
  return Buffer.from(resource, "hex");
}

function secondsToIso(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new PrivateVaultContentRequesterRuntimeError();
  return new Date(value * 1000).toISOString();
}

function decodeActionResult(
  payload: Uint8Array,
  state: "completed" | "failed",
) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record).sort().join("\0");
    if (
      record.version !== 1 ||
      record.type !== "content-action-result" ||
      record.ok !== (state === "completed") ||
      (state === "completed"
        ? keys !== "ok\0result\0type\0version"
        : keys !== "error\0ok\0type\0version" ||
          record.error !== "action_failed") ||
      JSON.stringify(record) !== text
    )
      throw new Error();
    if (state === "failed") throw new Error();
    return record.result;
  } catch {
    throw new PrivateVaultContentRequesterRuntimeError();
  }
}

export class PrivateVaultContentRequesterRuntime {
  readonly #descriptor: {
    read(): Promise<PrivateVaultContentBrokerRuntimeDescriptor>;
  };
  readonly #native: PrivateVaultNativeServiceClient;
  readonly #transport: PrivateVaultContentRequesterTransport;
  readonly #now: () => number;
  readonly #wait: (milliseconds: number) => Promise<void>;
  readonly #pollMilliseconds: number;
  readonly #timeoutMilliseconds: number;
  readonly #grants = new Map<string, GrantCache>();
  readonly #grantFlights = new Map<string, Promise<GrantCache>>();
  readonly #revokedGrantRefs = new Set<string>();

  constructor(input: {
    descriptor: {
      read(): Promise<PrivateVaultContentBrokerRuntimeDescriptor>;
    };
    native: PrivateVaultNativeServiceClient;
    transport: PrivateVaultContentRequesterTransport;
    now?: () => number;
    wait?: (milliseconds: number) => Promise<void>;
    pollMilliseconds?: number;
    timeoutMilliseconds?: number;
  }) {
    this.#descriptor = input.descriptor;
    this.#native = input.native;
    this.#transport = input.transport;
    this.#now = input.now ?? Date.now;
    this.#wait =
      input.wait ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#pollMilliseconds = input.pollMilliseconds ?? 500;
    this.#timeoutMilliseconds = input.timeoutMilliseconds ?? 2 * 60 * 1000;
  }

  async runAction(input: {
    actionName: string;
    args: unknown;
    subjectAgentId: string;
    disclosureProviderId: string;
    disclosureDestination: string;
  }) {
    let actionRequest: Uint8Array | null = null;
    let semanticPayload: Uint8Array | null = null;
    let jobEnvelope: Uint8Array | null = null;
    let resultEnvelope: Uint8Array | null = null;
    let resultPayload: Uint8Array | null = null;
    try {
      const descriptor = await this.#descriptor.read();
      if (!lowerHex(input.subjectAgentId, 16))
        throw new PrivateVaultContentRequesterRuntimeError();
      const resource = resourceId(
        descriptor.vaultId,
        input.actionName,
        input.args,
      );
      const grant = await this.#grantFor(
        descriptor,
        input.subjectAgentId,
        input.disclosureProviderId,
        input.disclosureDestination,
      );
      actionRequest = encodePrivateVaultActionRequest({
        actionName: input.actionName,
        args: input.args,
        disclosure: {
          providerId: input.disclosureProviderId,
          destination: input.disclosureDestination,
        },
      });
      semanticPayload = encodeAncV1SemanticJobPayload({
        resourceId: resource,
        operation: input.actionName,
        provider: "content",
        body: actionRequest,
        disclosureProviderId: input.disclosureProviderId,
        disclosureDestination: input.disclosureDestination,
      });
      const nowSeconds = Math.floor(this.#now() / 1000);
      const jobId = randomBytes(16).toString("hex");
      const sealed = await this.#native.sealContentJob({
        vaultId: descriptor.vaultId,
        jobId,
        grantRef: grant.grantRef,
        recipientEndpointId: descriptor.endpointId,
        expiresAt: nowSeconds + JOB_LIFETIME_SECONDS,
        jobPayload: semanticPayload,
      });
      jobEnvelope = sealed.jobEnvelope;
      await this.#transport.putJob({
        vaultId: descriptor.vaultId,
        jobId,
        grantId: grant.grantId,
        recipientEndpointId: descriptor.endpointId,
        epoch: sealed.epoch,
        issuedAt: secondsToIso(sealed.issuedAt),
        expiresAt: secondsToIso(sealed.expiresAt),
        ciphertext: jobEnvelope,
      });
      const hosted = await this.#waitForResult(descriptor.vaultId, jobId);
      resultEnvelope = hosted.ciphertext;
      const opened = await this.#native.openContentResult({
        vaultId: descriptor.vaultId,
        jobId,
        jobHash: hosted.jobHash,
        senderEndpointId: descriptor.endpointId,
        resultEnvelope,
      });
      if (opened.state !== hosted.state)
        throw new PrivateVaultContentRequesterRuntimeError();
      resultPayload = opened.resultPayload;
      return decodeActionResult(resultPayload, opened.state);
    } catch (error) {
      if (error instanceof PrivateVaultContentRequesterRuntimeError)
        throw error;
      throw new PrivateVaultContentRequesterRuntimeError();
    } finally {
      actionRequest?.fill(0);
      semanticPayload?.fill(0);
      jobEnvelope?.fill(0);
      resultEnvelope?.fill(0);
      resultPayload?.fill(0);
    }
  }

  listContentGrants(vaultId: string): Promise<NativeListedContentGrantsResult> {
    return this.#native.listContentGrants(vaultId);
  }

  listVaultMembers(vaultId: string): Promise<NativeListedVaultMembersResult> {
    return this.#native.listVaultMembers(vaultId);
  }

  async revokeContentGrant(
    vaultId: string,
    grantRef: string,
  ): Promise<NativeRevokedContentGrantResult> {
    this.#revokedGrantRefs.add(grantRef);
    try {
      return await this.#native.revokeContentGrant({ vaultId, grantRef });
    } finally {
      for (const [key, grant] of this.#grants) {
        if (grant.vaultId === vaultId && grant.grantRef === grantRef)
          this.#grants.delete(key);
      }
    }
  }

  async #grantFor(
    descriptor: PrivateVaultContentBrokerRuntimeDescriptor,
    subjectAgentId: string,
    disclosureProviderId: string,
    disclosureDestination: string,
  ): Promise<GrantCache> {
    const nowSeconds = Math.floor(this.#now() / 1000);
    const key = `${descriptor.vaultId}:${descriptor.endpointId}:${subjectAgentId}:${disclosureProviderId}:${disclosureDestination}`;
    const cached = this.#grants.get(key);
    if (
      cached?.vaultId === descriptor.vaultId &&
      cached.recipientEndpointId === descriptor.endpointId &&
      cached.subjectAgentId === subjectAgentId &&
      cached.disclosureProviderId === disclosureProviderId &&
      cached.disclosureDestination === disclosureDestination &&
      cached.expiresAt > nowSeconds + JOB_LIFETIME_SECONDS &&
      !this.#revokedGrantRefs.has(cached.grantRef)
    )
      return cached;
    const existingFlight = this.#grantFlights.get(key);
    if (existingFlight) return existingFlight;
    const flight = this.#createGrant(
      descriptor,
      subjectAgentId,
      disclosureProviderId,
      disclosureDestination,
      nowSeconds,
    );
    this.#grantFlights.set(key, flight);
    try {
      const grant = await flight;
      this.#grants.set(key, grant);
      return grant;
    } finally {
      if (this.#grantFlights.get(key) === flight)
        this.#grantFlights.delete(key);
    }
  }

  async #createGrant(
    descriptor: PrivateVaultContentBrokerRuntimeDescriptor,
    subjectAgentId: string,
    disclosureProviderId: string,
    disclosureDestination: string,
    nowSeconds: number,
  ): Promise<GrantCache> {
    const created: NativeCreatedContentGrantResult =
      await this.#native.createContentGrant({
        vaultId: descriptor.vaultId,
        recipientEndpointId: descriptor.endpointId,
        subjectAgentId,
        expiresAt: nowSeconds + GRANT_LIFETIME_SECONDS,
      });
    try {
      const grantId = Buffer.from(created.grantId).toString("hex");
      const grantRef = Buffer.from(created.grantRef).toString("hex");
      if (!lowerHex(grantId, 16) || !lowerHex(grantRef, 32))
        throw new PrivateVaultContentRequesterRuntimeError();
      await this.#transport.putGrant({
        vaultId: descriptor.vaultId,
        grantId,
        recipientEndpointId: descriptor.endpointId,
        issuedAt: secondsToIso(created.issuedAt),
        expiresAt: secondsToIso(created.expiresAt),
        ciphertext: created.grantEnvelope,
      });
      return Object.freeze({
        vaultId: descriptor.vaultId,
        recipientEndpointId: descriptor.endpointId,
        subjectAgentId,
        disclosureProviderId,
        disclosureDestination,
        grantId,
        grantRef,
        expiresAt: created.expiresAt,
      });
    } finally {
      created.grantEnvelope.fill(0);
      created.grantId.fill(0);
      created.grantRef.fill(0);
    }
  }

  async #waitForResult(vaultId: string, jobId: string) {
    const deadline = this.#now() + this.#timeoutMilliseconds;
    while (this.#now() <= deadline) {
      try {
        return await this.#transport.getResult({ vaultId, jobId });
      } catch (error) {
        if (
          !(error instanceof PrivateVaultContentRequesterTransportError) ||
          error.status !== 404 ||
          this.#now() + this.#pollMilliseconds > deadline
        )
          throw error;
      }
      await this.#wait(this.#pollMilliseconds);
    }
    throw new PrivateVaultContentRequesterRuntimeError();
  }
}

export function createPrivateVaultContentRequesterRuntime(input: {
  session: PrivateVaultContentSession;
  origin: string;
  descriptor: {
    read(): Promise<PrivateVaultContentBrokerRuntimeDescriptor>;
  };
}) {
  const native = createPrivateVaultNativeServiceClient();
  return new PrivateVaultContentRequesterRuntime({
    descriptor: input.descriptor,
    native,
    transport: new PrivateVaultContentRequesterTransport(input),
  });
}
