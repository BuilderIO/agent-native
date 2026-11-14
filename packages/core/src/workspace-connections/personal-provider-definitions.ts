import { getWorkspaceConnectionProvider } from "../connections/catalog.js";

const STATIC_MESSAGE =
  "The personal credential provider definitions are invalid.";

const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

const DEFINITION_KEYS: ReadonlySet<string> = new Set([
  "id",
  "label",
  "credentialKeys",
  "configurationFields",
]);

const CREDENTIAL_KEY_FIELDS: ReadonlySet<string> = new Set([
  "key",
  "label",
  "description",
  "required",
  "preserveWhitespace",
]);

const CONFIGURATION_FIELD_KEYS: ReadonlySet<string> = new Set([
  "key",
  "label",
  "description",
  "required",
  "defaultValue",
]);

export interface PersonalCredentialFieldBase {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly required?: boolean;
}

export interface PersonalCredentialKeyDefinition extends PersonalCredentialFieldBase {
  /** Trusted opt-in: keep the literal value exactly as supplied. */
  readonly preserveWhitespace?: boolean;
}

export interface PersonalConfigurationFieldDefinition extends PersonalCredentialFieldBase {
  readonly defaultValue?: string;
}

export interface PersonalCredentialProviderDefinition {
  readonly id: string;
  readonly label: string;
  readonly credentialKeys: readonly PersonalCredentialKeyDefinition[];
  readonly configurationFields?: readonly PersonalConfigurationFieldDefinition[];
}

/** Closed, input-free error. Its message never echoes definition data. */
export class PersonalCredentialProviderDefinitionError extends Error {
  constructor() {
    super(STATIC_MESSAGE);
    this.name = "PersonalCredentialProviderDefinitionError";
  }
}

function fail(): never {
  throw new PersonalCredentialProviderDefinitionError();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Own enumerable data properties only. Accessors are never invoked. */
function readDataRecord(
  value: unknown,
  allowed?: ReadonlySet<string>,
): Record<string, unknown> {
  if (!isPlainObject(value)) fail();
  const record = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail();
    if (RESERVED_KEYS.has(key) || (allowed !== undefined && !allowed.has(key)))
      fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      fail();
    }
    record[key] = descriptor.value;
  }
  return record;
}

function readArray(value: unknown): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    fail();
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number"
  )
    fail();
  const length = lengthDescriptor.value;
  if (Reflect.ownKeys(value).length !== length + 1) fail();
  const items: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) fail();
    items.push(descriptor.value);
  }
  return items;
}

function readText(value: unknown): string {
  if (typeof value !== "string") fail();
  const normalized = value.trim();
  if (!normalized) fail();
  return normalized;
}

function readString(value: unknown): string {
  if (typeof value !== "string") fail();
  return value;
}

function readBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") fail();
  return value;
}

function readFieldBase(
  record: Record<string, unknown>,
): PersonalCredentialFieldBase {
  const key = readText(record.key);
  if (
    key === "__proto__" ||
    key === "constructor" ||
    key === "prototype" ||
    key === "workspaceConnectionScope"
  )
    fail();
  return {
    key,
    label: readText(record.label),
    ...(record.description === undefined
      ? {}
      : { description: readString(record.description) }),
    ...(record.required === undefined
      ? {}
      : { required: readBoolean(record.required) }),
  };
}

function readCredentialKey(value: unknown): PersonalCredentialKeyDefinition {
  const record = readDataRecord(value, CREDENTIAL_KEY_FIELDS);
  return {
    ...readFieldBase(record),
    ...(record.preserveWhitespace === undefined
      ? {}
      : { preserveWhitespace: readBoolean(record.preserveWhitespace) }),
  };
}

function readConfigurationField(
  value: unknown,
): PersonalConfigurationFieldDefinition {
  const record = readDataRecord(value, CONFIGURATION_FIELD_KEYS);
  return {
    ...readFieldBase(record),
    ...(record.defaultValue === undefined
      ? {}
      : { defaultValue: readString(record.defaultValue) }),
  };
}

function readDefinition(value: unknown): PersonalCredentialProviderDefinition {
  const record = readDataRecord(value, DEFINITION_KEYS);
  const id = readText(record.id);
  const label = readText(record.label);
  const credentialKeys = readArray(record.credentialKeys).map(
    readCredentialKey,
  );
  const configurationFields =
    record.configurationFields === undefined
      ? undefined
      : readArray(record.configurationFields).map(readConfigurationField);
  const seen = new Set<string>();
  for (const field of [...credentialKeys, ...(configurationFields ?? [])]) {
    if (seen.has(field.key)) fail();
    seen.add(field.key);
  }
  return {
    id,
    label,
    credentialKeys,
    ...(configurationFields === undefined ? {} : { configurationFields }),
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function buildSnapshot(
  raw: unknown,
): readonly PersonalCredentialProviderDefinition[] {
  const seenIds = new Set<string>();
  const definitions: PersonalCredentialProviderDefinition[] = [];
  for (const entry of readArray(raw)) {
    const definition = readDefinition(entry);
    if (
      seenIds.has(definition.id) ||
      getWorkspaceConnectionProvider(definition.id)
    ) {
      fail();
    }
    seenIds.add(definition.id);
    definitions.push(definition);
  }
  return deepFreeze(definitions);
}

/** Internal shared data snapshots: no property accessor is invoked. */
export function readPersonalCredentialDataRecord(
  value: unknown,
  allowed?: ReadonlySet<string>,
): Record<string, unknown> {
  try {
    return readDataRecord(value, allowed);
  } catch {
    throw new PersonalCredentialProviderDefinitionError();
  }
}

export function readPersonalCredentialDataArray(value: unknown): unknown[] {
  try {
    return readArray(value);
  } catch {
    throw new PersonalCredentialProviderDefinitionError();
  }
}

/**
 * Validates trusted server-side custom credential definitions and returns a
 * deep-frozen clone. The input is never mutated and no getter is invoked.
 * Every failure surfaces as the same static error without input echo.
 */
export function createPersonalCredentialProviderSnapshot(
  raw: unknown,
): readonly PersonalCredentialProviderDefinition[] {
  try {
    return buildSnapshot(raw);
  } catch {
    throw new PersonalCredentialProviderDefinitionError();
  }
}

/**
 * Snapshot one trusted server workspace-credential definition. Unlike the
 * personal custom-provider catalog, this does not register or override a
 * catalog entry: a fixed server descriptor can select a supported alternate
 * authentication mode for an existing provider. Never accept this from a request.
 */
export function createWorkspaceCredentialProviderSnapshot(
  raw: unknown,
): PersonalCredentialProviderDefinition {
  try {
    return deepFreeze(readDefinition(raw));
  } catch {
    throw new PersonalCredentialProviderDefinitionError();
  }
}
