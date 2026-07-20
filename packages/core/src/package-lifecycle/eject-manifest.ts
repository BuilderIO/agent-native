export const AGENT_NATIVE_EJECT_MANIFEST_VERSION = 1 as const;

export const AGENT_NATIVE_EJECT_CATALOGS = [
  "toolkit-ui",
  "remote-mcp-presets",
  "workspace-connections",
  "provider-api-definitions",
  "messaging-adapters",
  "setup-readiness-ui",
  "domain-packages",
] as const;

export const REQUIRED_AGENT_NATIVE_EJECT_CATALOGS = [
  "remote-mcp-presets",
  "workspace-connections",
  "provider-api-definitions",
  "messaging-adapters",
  "setup-readiness-ui",
  "domain-packages",
] as const;

export type AgentNativeEjectCatalog =
  (typeof AGENT_NATIVE_EJECT_CATALOGS)[number];

export interface AgentNativeEjectStyle {
  /** Package export key, such as `./chat-history.css`. */
  entrypoint: string;
  source: string;
}

export interface AgentNativeEjectUnit {
  /** Globally stable id, such as `toolkit/chat-history`. */
  id: string;
  label: string;
  catalog: AgentNativeEjectCatalog;
  /** Every first-party catalog item this definition owns. */
  catalogItems: string[];
  /** Package export keys. The engine expands these to consumer specifiers. */
  entrypoints: string[];
  /** Explicit ownership transfer or protected runtime contract. */
  strategy: "source-copy" | "package-eject" | "protected-seam";
  /** Package-relative source files or directories that seed the copied closure. */
  sourceEntries?: string[];
  /** App-relative directory that owns the copied source after ejection. */
  targetRoot?: string;
  /** Required for protected units; remains a package import after ejection. */
  seam?: string;
  styles?: AgentNativeEjectStyle[];
  /** Dependencies the app must retain after imports move to app-owned source. */
  dependencies?: string[];
  /** Runtime contracts that must continue to import from their package. */
  protectedImports?: string[];
  /** Read-only commands printed after an eject plan; never package scripts. */
  verification?: string[];
}

export interface AgentNativeEjectManifest {
  manifestVersion: typeof AGENT_NATIVE_EJECT_MANIFEST_VERSION;
  package: string;
  units: AgentNativeEjectUnit[];
  /** Catalogs this manifest covers. Repeated on units so coverage is auditable. */
  catalogs: AgentNativeEjectCatalog[];
}

export function assertAgentNativeEjectManifest(
  value: unknown,
): asserts value is AgentNativeEjectManifest {
  const manifest = value as Partial<AgentNativeEjectManifest> | null;
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Eject manifest must be an object");
  }
  if (manifest.manifestVersion !== AGENT_NATIVE_EJECT_MANIFEST_VERSION) {
    throw new Error(
      `Unsupported eject manifest version ${String(manifest.manifestVersion)}`,
    );
  }
  if (!isPackageName(manifest.package)) {
    throw new Error(
      `Invalid eject manifest package: ${String(manifest.package)}`,
    );
  }
  if (!Array.isArray(manifest.units) || !Array.isArray(manifest.catalogs)) {
    throw new Error("Eject manifest units and catalogs must be arrays");
  }

  const catalogSet = new Set<AgentNativeEjectCatalog>();
  for (const catalog of manifest.catalogs) {
    assertCatalog(catalog);
    if (catalogSet.has(catalog)) {
      throw new Error(`Duplicate eject manifest catalog: ${catalog}`);
    }
    catalogSet.add(catalog);
  }

  const unitIds = new Set<string>();
  const entrypoints = new Set<string>();
  const catalogItems = new Set<string>();
  for (const unit of manifest.units) {
    assertUnit(unit, catalogSet);
    if (unitIds.has(unit.id)) {
      throw new Error(`Duplicate eject unit id: ${unit.id}`);
    }
    unitIds.add(unit.id);
    for (const item of unit.catalogItems) {
      const key = `${unit.catalog}:${item}`;
      if (catalogItems.has(key)) {
        throw new Error(`Duplicate eject catalog item: ${key}`);
      }
      catalogItems.add(key);
    }
    for (const entrypoint of [
      ...unit.entrypoints,
      ...(unit.styles ?? []).map((style) => style.entrypoint),
    ]) {
      if (entrypoints.has(entrypoint)) {
        throw new Error(`Duplicate eject entrypoint: ${entrypoint}`);
      }
      entrypoints.add(entrypoint);
    }
  }

  for (const catalog of catalogSet) {
    if (!manifest.units.some((unit) => unit.catalog === catalog)) {
      throw new Error(`Eject manifest catalog has no unit: ${catalog}`);
    }
  }
}

function assertUnit(
  value: unknown,
  catalogs: ReadonlySet<AgentNativeEjectCatalog>,
): asserts value is AgentNativeEjectUnit {
  const unit = value as Partial<AgentNativeEjectUnit> | null;
  if (!unit || typeof unit !== "object") {
    throw new Error("Eject unit must be an object");
  }
  if (!isUnitId(unit.id)) {
    throw new Error(`Invalid eject unit id: ${String(unit.id)}`);
  }
  if (
    typeof unit.label !== "string" ||
    unit.label.trim() !== unit.label ||
    unit.label.length === 0 ||
    unit.label.length > 120
  ) {
    throw new Error(`Invalid eject unit label: ${String(unit.label)}`);
  }
  assertCatalog(unit.catalog);
  if (!catalogs.has(unit.catalog)) {
    throw new Error(
      `Eject unit ${unit.id} uses undeclared catalog ${unit.catalog}`,
    );
  }
  if (!Array.isArray(unit.catalogItems) || unit.catalogItems.length === 0) {
    throw new Error(`Eject unit ${unit.id} requires catalogItems`);
  }
  assertUniqueStrings(
    unit.catalogItems,
    `Eject unit ${unit.id} catalogItems`,
    isCatalogItemId,
  );
  if (!Array.isArray(unit.entrypoints)) {
    throw new Error(`Eject unit ${unit.id} entrypoints must be an array`);
  }
  assertUniqueStrings(
    unit.entrypoints,
    `Eject unit ${unit.id} entrypoints`,
    isPackageExportKey,
  );
  if (
    unit.strategy !== "source-copy" &&
    unit.strategy !== "package-eject" &&
    unit.strategy !== "protected-seam"
  ) {
    throw new Error(`Eject unit ${unit.id} has an invalid strategy`);
  }
  if (unit.strategy === "protected-seam") {
    if (!unit.seam || !isPackageSpecifier(unit.seam)) {
      throw new Error(`Protected eject unit ${unit.id} requires a safe seam`);
    }
    if (unit.sourceEntries?.length || unit.targetRoot || unit.styles?.length) {
      throw new Error(
        `Protected eject unit ${unit.id} cannot declare copied source`,
      );
    }
  } else {
    if (
      (!Array.isArray(unit.sourceEntries) || unit.sourceEntries.length === 0) &&
      (!Array.isArray(unit.styles) || unit.styles.length === 0)
    ) {
      throw new Error(`Eject unit ${unit.id} requires copied source or styles`);
    }
    if (unit.sourceEntries !== undefined) {
      assertUniqueStrings(
        unit.sourceEntries,
        `Eject unit ${unit.id} sourceEntries`,
        isSafeRelativePath,
      );
    }
    if (!unit.targetRoot || !isSafeRelativePath(unit.targetRoot)) {
      throw new Error(`Eject unit ${unit.id} has an unsafe targetRoot`);
    }
    if (unit.seam !== undefined && !isPackageSpecifier(unit.seam)) {
      throw new Error(`Copy eject unit ${unit.id} has an unsafe seam`);
    }
  }

  if (unit.styles !== undefined) {
    if (!Array.isArray(unit.styles)) {
      throw new Error(`Eject unit ${unit.id} styles must be an array`);
    }
    const styleEntrypoints = new Set<string>();
    for (const style of unit.styles) {
      if (
        !style ||
        typeof style !== "object" ||
        !isPackageExportKey(style.entrypoint) ||
        !isSafeRelativePath(style.source)
      ) {
        throw new Error(`Eject unit ${unit.id} has an invalid style`);
      }
      if (styleEntrypoints.has(style.entrypoint)) {
        throw new Error(
          `Eject unit ${unit.id} has duplicate style ${style.entrypoint}`,
        );
      }
      styleEntrypoints.add(style.entrypoint);
    }
  }

  assertOptionalStringList(
    unit.dependencies,
    `Eject unit ${unit.id} dependencies`,
    isPackageName,
  );
  assertOptionalStringList(
    unit.protectedImports,
    `Eject unit ${unit.id} protectedImports`,
    isPackageSpecifier,
  );
  assertOptionalStringList(
    unit.verification,
    `Eject unit ${unit.id} verification`,
    isSafeVerificationCommand,
  );
}

function assertCatalog(
  value: unknown,
): asserts value is AgentNativeEjectCatalog {
  if (!(AGENT_NATIVE_EJECT_CATALOGS as readonly unknown[]).includes(value)) {
    throw new Error(`Unknown eject catalog: ${String(value)}`);
  }
}

function assertOptionalStringList(
  value: unknown,
  label: string,
  predicate: (item: string) => boolean,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  assertUniqueStrings(value, label, predicate);
}

function assertUniqueStrings(
  values: unknown[],
  label: string,
  predicate: (item: string) => boolean,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || !predicate(value)) {
      throw new Error(`${label} contains an invalid value: ${String(value)}`);
    }
    if (seen.has(value)) {
      throw new Error(`${label} contains a duplicate: ${value}`);
    }
    seen.add(value);
  }
}

function isUnitId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)+$/.test(value)
  );
}

function isCatalogItemId(value: string): boolean {
  return /^[a-z0-9][a-z0-9._/-]*$/.test(value);
}

function isPackageName(value: unknown): value is string {
  return (
    typeof value === "string" && /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(value)
  );
}

function isPackageSpecifier(value: string): boolean {
  if (value.includes("\\") || value.includes("\0")) return false;
  const [scopeOrName, scopedName, ...rest] = value.split("/");
  if (scopeOrName?.startsWith("@")) {
    return Boolean(
      scopedName &&
      isPackageName(`${scopeOrName}/${scopedName}`) &&
      rest.every(isSafePathSegment),
    );
  }
  return isPackageName(scopeOrName) && rest.every(isSafePathSegment);
}

function isPackageExportKey(value: string): boolean {
  if (value === ".") return true;
  if (!value.startsWith("./") || value.includes("\\") || value.includes("\0")) {
    return false;
  }
  const segments = value.slice(2).split("/");
  return segments.every(
    (segment) => segment === "*" || isSafePathSegment(segment),
  );
}

function isSafeRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value.split("/").every(isSafePathSegment)
  );
}

function isSafePathSegment(value: string): boolean {
  return value.length > 0 && value !== "." && value !== "..";
}

function isSafeVerificationCommand(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 240 &&
    value.trim() === value &&
    !/[\r\n\0]/.test(value)
  );
}
