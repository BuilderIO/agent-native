import type {
  CrmAccessScope,
  CrmAdapter,
  CrmFieldStoragePolicy,
  CrmObjectKind,
  CrmRecord,
  CrmRelationship,
} from "../../shared/crm-contract.js";

export const MAX_READ_THROUGH_RELATIONSHIPS = 100;

export type ReadThroughFieldPolicy = {
  fieldName: string;
  storagePolicy: CrmFieldStoragePolicy;
  readable: boolean;
  sensitive: boolean;
};

export type RelatedRecordSummary = {
  id: string;
  displayName: string;
  kind: string;
  relationshipType: string;
  relationshipLabel?: string;
  subtitle?: string;
};

export type ReadThroughRecordContext = {
  id: string;
  objectType: string;
  kind: CrmObjectKind;
  remoteId: string;
  accessScopeJson: string;
  fieldPolicies: ReadThroughFieldPolicy[];
};

export type VerifiedReadThroughRecord = {
  remote: CrmRecord;
  currentScope: CrmAccessScope;
  relationships: CrmRelationship[];
  currentScopes: Map<string, CrmAccessScope>;
};

type ReadThroughAdapter = CrmAdapter & {
  getAccessScope(objectType: string): CrmAccessScope | Promise<CrmAccessScope>;
};

export function parseCrmAccessScope(value: string): CrmAccessScope | null {
  try {
    const scope = JSON.parse(value) as Partial<CrmAccessScope>;
    if (
      !scope ||
      typeof scope.key !== "string" ||
      !scope.key ||
      (scope.mode !== "user" &&
        scope.mode !== "service-account" &&
        scope.mode !== "native") ||
      typeof scope.objectReadable !== "boolean" ||
      (scope.recordVisibility !== "actor" &&
        scope.recordVisibility !== "cohort" &&
        scope.recordVisibility !== "workspace" &&
        scope.recordVisibility !== "unknown")
    ) {
      return null;
    }
    return scope as CrmAccessScope;
  } catch {
    return null;
  }
}

export function scopesAreCompatible(
  stored: CrmAccessScope | null,
  current: CrmAccessScope,
): boolean {
  if (!stored || !stored.objectReadable || !current.objectReadable)
    return false;
  return (
    stored.key === current.key &&
    stored.mode === current.mode &&
    stored.actorId === current.actorId &&
    stored.grantId === current.grantId &&
    stored.recordVisibility === current.recordVisibility &&
    stored.fieldPermissionsHash === current.fieldPermissionsHash &&
    stored.sharingFingerprint === current.sharingFingerprint
  );
}

export function readThroughFieldNames(
  policies: ReadThroughFieldPolicy[],
): string[] {
  return policies
    .filter(
      (policy) =>
        policy.readable &&
        !policy.sensitive &&
        policy.storagePolicy === "mirrored",
    )
    .map((policy) => policy.fieldName)
    .slice(0, 80);
}

export async function loadVerifiedReadThroughRecord(input: {
  adapter: ReadThroughAdapter;
  context: ReadThroughRecordContext;
}): Promise<VerifiedReadThroughRecord> {
  const currentScope = await input.adapter.getAccessScope(
    input.context.objectType,
  );
  const storedScope = parseCrmAccessScope(input.context.accessScopeJson);
  if (!scopesAreCompatible(storedScope, currentScope)) {
    throw new Error(
      "CRM provider access changed; the local record is withheld until it is refreshed.",
    );
  }
  const remote = await input.adapter.getRecord({
    record: {
      connectionId: input.adapter.connection.connectionId,
      provider: input.adapter.connection.provider,
      objectType: input.context.objectType,
      kind: input.context.kind,
      remoteId: input.context.remoteId,
      localId: input.context.id,
    },
    fields: readThroughFieldNames(input.context.fieldPolicies),
  });
  if (!remote || !scopesAreCompatible(storedScope, remote.accessScope)) {
    throw new Error(
      "CRM provider access changed or the record is unavailable; the local record is withheld until it is refreshed.",
    );
  }
  const relationshipPage = await input.adapter.listRelationships({
    record: remote.ref,
    limit: MAX_READ_THROUGH_RELATIONSHIPS,
  });
  const targetObjectTypes = Array.from(
    new Set(
      relationshipPage.relationships.map(
        (relationship) => relationship.to.objectType,
      ),
    ),
  ).slice(0, 20);
  return {
    remote,
    currentScope,
    relationships: relationshipPage.relationships,
    currentScopes: new Map(
      await Promise.all(
        targetObjectTypes.map(
          async (objectType) =>
            [
              objectType,
              await input.adapter.getAccessScope(objectType),
            ] as const,
        ),
      ),
    ),
  };
}

export function relatedSummaries<
  T extends {
    id: string;
    remoteId: string;
    objectType: string;
    displayName: string;
    kind: string;
    primaryEmail: string | null;
    domain: string | null;
  },
>(
  sourceRemoteId: string,
  relationships: CrmRelationship[],
  localRecords: T[],
): Array<RelatedRecordSummary & { localId: string; remoteId: string }> {
  const recordsByIdentity = new Map(
    localRecords.map((record) => [
      `${record.objectType}:${record.remoteId}`,
      record,
    ]),
  );
  return relationships
    .filter((relationship) => relationship.from.remoteId === sourceRemoteId)
    .slice(0, MAX_READ_THROUGH_RELATIONSHIPS)
    .flatMap((relationship) => {
      const record = recordsByIdentity.get(
        `${relationship.to.objectType}:${relationship.to.remoteId}`,
      );
      if (!record) return [];
      return [
        {
          id: record.id,
          localId: record.id,
          remoteId: record.remoteId,
          displayName: record.displayName,
          kind: record.kind,
          relationshipType: relationship.relationshipType,
          ...(relationship.label
            ? { relationshipLabel: relationship.label }
            : {}),
          ...((record.domain ?? record.primaryEmail)
            ? { subtitle: record.domain ?? record.primaryEmail ?? undefined }
            : {}),
        },
      ];
    });
}
