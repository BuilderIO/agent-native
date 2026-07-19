import { randomBytes } from "node:crypto";

import {
  ANC_V1_MIGRATION_EVIDENCE_MAX_BYTES,
  ancV1BytesToHex,
  ancV1Hash,
  decodeAncV1MigrationEvidenceResponse,
  encodeAncV1MigrationEvidence,
  encodeEndpointRequestUnsignedProof,
  endpointRequestProofSchema,
  endpointRequestUnsignedProofSchema,
  type AncV1MigrationEvidence,
} from "@agent-native/core/e2ee";

import type { PrivateVaultContentSession } from "./content-genesis-transport.js";
import type { PrivateVaultNativeServiceClient } from "./native-service-client.js";

export const PRIVATE_VAULT_MIGRATION_EVIDENCE_PATH =
  "/api/private-vault/migration/evidence";

export class PrivateVaultMigrationEvidenceTransportError extends Error {
  constructor() {
    super("Private Vault migration evidence transport unavailable");
    this.name = "PrivateVaultMigrationEvidenceTransportError";
  }
}

function exactOrigin(value: string): string {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      throw new Error();
    return parsed.origin;
  } catch {
    throw new PrivateVaultMigrationEvidenceTransportError();
  }
}

export class PrivateVaultMigrationEvidenceTransport {
  readonly #origin: string;
  readonly #session: PrivateVaultContentSession;
  readonly #native: Pick<
    PrivateVaultNativeServiceClient,
    "listVaultMembers" | "signEndpointRequest"
  >;
  readonly #now: () => Date;
  readonly #nonce: () => string;

  constructor(input: {
    origin: string;
    session: PrivateVaultContentSession;
    native: Pick<
      PrivateVaultNativeServiceClient,
      "listVaultMembers" | "signEndpointRequest"
    >;
    now?: () => Date;
    nonce?: () => string;
  }) {
    this.#origin = exactOrigin(input.origin);
    this.#session = input.session;
    this.#native = input.native;
    this.#now = input.now ?? (() => new Date());
    this.#nonce = input.nonce ?? (() => randomBytes(32).toString("hex"));
  }

  async append(evidence: AncV1MigrationEvidence) {
    const body = encodeAncV1MigrationEvidence(evidence);
    const requestBody = Buffer.from(body);
    try {
      const membership = await this.#native.listVaultMembers(evidence.vaultId);
      const current = membership.members.filter((member) => member.current);
      if (
        current.length !== 1 ||
        current[0]!.role !== "endpoint" ||
        current[0]!.unattended
      )
        throw new Error();
      const unsigned = endpointRequestUnsignedProofSchema.parse({
        version: 1,
        suite: "anc/v1",
        type: "endpoint_request",
        vaultId: evidence.vaultId,
        endpointId: current[0]!.endpointId,
        method: "POST",
        path: PRIVATE_VAULT_MIGRATION_EVIDENCE_PATH,
        bodyHash: ancV1BytesToHex(
          await ancV1Hash("endpoint-request-body", body),
        ),
        issuedAt: this.#now().toISOString(),
        nonce: this.#nonce(),
      });
      const signature = await this.#native.signEndpointRequest({
        version: 1,
        suite: "anc/v1",
        operation: "signEndpointRequest",
        unsignedProof: encodeEndpointRequestUnsignedProof(unsigned),
      });
      const proof = endpointRequestProofSchema.parse({
        ...unsigned,
        signature: ancV1BytesToHex(signature.signature),
      });
      const proofHeader = Buffer.from(JSON.stringify(proof)).toString(
        "base64url",
      );
      if (proofHeader.length > 16_384) throw new Error();
      const url = `${this.#origin}${PRIVATE_VAULT_MIGRATION_EVIDENCE_PATH}`;
      const response = await this.#session.fetch(url, {
        method: "POST",
        redirect: "error",
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/octet-stream",
          "Cache-Control": "no-store",
          "Content-Type": "application/octet-stream",
          "Content-Length": String(body.byteLength),
          "X-Agent-Native-CSRF": "1",
          "X-Anc-Endpoint-Proof": proofHeader,
        },
        body: requestBody,
      });
      const length = response.headers.get("content-length") ?? "";
      if (
        response.status !== 200 ||
        response.url !== url ||
        response.redirected ||
        response.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
          "application/octet-stream" ||
        !/^[1-9][0-9]*$/.test(length) ||
        Number(length) > ANC_V1_MIGRATION_EVIDENCE_MAX_BYTES
      )
        throw new Error();
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== Number(length)) throw new Error();
      const receipt = decodeAncV1MigrationEvidenceResponse(bytes);
      if (
        receipt.kind !== evidence.kind ||
        receipt.migrationId !== evidence.migrationId ||
        receipt.evidenceId !==
          (evidence.kind === "export"
            ? evidence.exportId
            : evidence.recoveryDrillId)
      )
        throw new Error();
      return receipt;
    } catch {
      throw new PrivateVaultMigrationEvidenceTransportError();
    } finally {
      requestBody.fill(0);
      body.fill(0);
    }
  }
}
