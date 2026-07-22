export const CRM_PROVIDERS = [
  "hubspot",
  "salesforce",
  "native",
  "custom",
] as const;

export type CrmProvider = (typeof CRM_PROVIDERS)[number];

export const CRM_OBJECT_KINDS = [
  "account",
  "person",
  "opportunity",
  "activity",
  "task",
  "custom",
] as const;

export type CrmObjectKind = (typeof CRM_OBJECT_KINDS)[number];

export const CRM_FIELD_STORAGE_POLICIES = [
  "mirrored",
  "remote-only",
  "redacted",
  "derived-local",
  "local-authoritative",
] as const;

export type CrmFieldStoragePolicy = (typeof CRM_FIELD_STORAGE_POLICIES)[number];

export type CrmScalar = string | number | boolean | null;
export type CrmValue = CrmScalar | CrmScalar[] | { [key: string]: CrmValue };

export interface CrmConnectionRef {
  connectionId: string;
  provider: CrmProvider;
  accountId?: string;
  actorId?: string;
}

export interface CrmObjectRef extends CrmConnectionRef {
  objectType: string;
  kind: CrmObjectKind;
}

export interface CrmRecordRef extends CrmObjectRef {
  remoteId: string;
  localId?: string;
}

export interface CrmAccessScope {
  key: string;
  actorId?: string;
  grantId?: string;
  mode: "user" | "service-account" | "native";
  objectReadable: boolean;
  objectCreateable: boolean;
  objectUpdateable: boolean;
  objectDeleteable: boolean;
  recordVisibility: "actor" | "cohort" | "workspace" | "unknown";
  fieldPermissionsHash?: string;
  sharingFingerprint?: string;
}

export interface CrmFieldDefinition {
  name: string;
  label: string;
  valueType:
    | "string"
    | "number"
    | "boolean"
    | "date"
    | "datetime"
    | "currency"
    | "percent"
    | "enum"
    | "multi-enum"
    | "reference"
    | "json";
  storagePolicy: CrmFieldStoragePolicy;
  sensitive: boolean;
  readable: boolean;
  createable: boolean;
  updateable: boolean;
  required: boolean;
  options?: Array<{ value: string; label: string; active?: boolean }>;
  referencedObjectType?: string;
}

export interface CrmObjectDefinition extends CrmObjectRef {
  label: string;
  pluralLabel: string;
  custom: boolean;
  queryable: boolean;
  searchable: boolean;
  createable: boolean;
  updateable: boolean;
  deleteable: boolean;
  fields: CrmFieldDefinition[];
}

export interface CrmRecord {
  ref: CrmRecordRef;
  displayName: string;
  fields: Record<string, CrmValue>;
  remoteRevision?: string;
  remoteUpdatedAt?: string;
  deleted: boolean;
  accessScope: CrmAccessScope;
  provenance: CrmProvenance[];
}

export interface CrmRelationship {
  from: CrmRecordRef;
  to: CrmRecordRef;
  relationshipType: string;
  label?: string;
  inverseLabel?: string;
  sourceField?: string;
}

export interface CrmProvenance {
  provider: CrmProvider;
  connectionId: string;
  objectType: string;
  remoteId: string;
  fieldName?: string;
  remoteRevision?: string;
  observedAt: string;
  evidenceRef?: string;
}

export interface CrmSyncScope {
  objectType: string;
  pipelineIds?: string[];
  ownerIds?: string[];
  recordIds?: string[];
  associatedRecordIds?: string[];
  updatedAfter?: string;
  includeDeleted?: boolean;
}

export interface CrmSyncPage {
  records: CrmRecord[];
  relationships: CrmRelationship[];
  nextCursor?: string;
  complete: boolean;
}

export interface CrmMutation {
  operation: "create" | "update" | "delete" | "associate" | "disassociate";
  record: CrmRecordRef;
  fields?: Record<string, CrmValue>;
  relationship?: CrmRelationship;
  expectedRemoteRevision?: string;
  idempotencyKey: string;
}

export interface CrmMutationResult {
  status: "applied" | "conflict" | "rejected";
  record?: CrmRecord;
  remoteRevision?: string;
  message?: string;
}

export interface CrmAdapterCapabilities {
  schemaDiscovery: boolean;
  customObjects: boolean;
  search: boolean;
  incrementalSync: boolean;
  deletedRecordSync: boolean;
  conditionalMutations: boolean;
  labeledRelationships: boolean;
  perFieldPermissions: boolean;
  perRecordPermissions: boolean;
}

export interface CrmAdapter {
  readonly connection: CrmConnectionRef;
  readonly capabilities: CrmAdapterCapabilities;
  discoverObjects(): Promise<CrmObjectDefinition[]>;
  describeObject(objectType: string): Promise<CrmObjectDefinition>;
  syncPage(input: {
    scope: CrmSyncScope;
    fieldAllowList: string[];
    cursor?: string;
    limit: number;
  }): Promise<CrmSyncPage>;
  getRecord(input: {
    record: CrmRecordRef;
    fields: string[];
  }): Promise<CrmRecord | null>;
  search(input: {
    objectTypes: string[];
    query: string;
    fields: string[];
    limit: number;
    cursor?: string;
  }): Promise<CrmSyncPage>;
  listRelationships(input: {
    record: CrmRecordRef;
    targetObjectTypes?: string[];
    limit: number;
    cursor?: string;
  }): Promise<{
    relationships: CrmRelationship[];
    nextCursor?: string;
    complete: boolean;
  }>;
  applyMutation(mutation: CrmMutation): Promise<CrmMutationResult>;
}

export const CRM_WRITE_DECISIONS = [
  "execute",
  "propose",
  "require-approval",
  "deny",
] as const;

export type CrmWriteDecision = (typeof CRM_WRITE_DECISIONS)[number];

export interface CrmWritePolicyInput {
  initiatedBy: "human" | "agent" | "automation";
  target: "local" | "provider";
  reversibility: "reversible" | "compensatable" | "destructive";
  scope: "single-field" | "single-record" | "bulk";
  risk: "routine" | "ownership" | "amount" | "stage" | "external-side-effect";
  delegatedAuthority: boolean;
  storedAutomationPolicy: boolean;
}

export function decideCrmWritePolicy(
  input: CrmWritePolicyInput,
): CrmWriteDecision {
  if (
    input.reversibility === "destructive" ||
    input.scope === "bulk" ||
    input.risk !== "routine"
  ) {
    return input.initiatedBy === "human" ? "execute" : "require-approval";
  }

  if (input.initiatedBy === "human") return "execute";

  if (input.initiatedBy === "automation") {
    if (input.target === "provider") return "propose";
    return input.storedAutomationPolicy && input.delegatedAuthority
      ? "execute"
      : "deny";
  }

  if (input.target === "local") return "execute";
  return "propose";
}
