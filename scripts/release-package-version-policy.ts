export type PackageManifestAtRef = {
  version: string | null;
};

export function packageManifestVersionChange(
  file: string,
  status: string,
  before: PackageManifestAtRef | null,
  after: PackageManifestAtRef | null,
): { before: string; after: string } | null {
  if (status === "added") {
    if (before !== null || after === null || after.version === null) {
      throw new Error(`Could not verify added package manifest ${file}`);
    }
    return null;
  }

  if (status === "removed") {
    if (before === null || before.version === null || after !== null) {
      throw new Error(`Could not verify removed package manifest ${file}`);
    }
    return null;
  }

  if (status !== "modified" || before === null || after === null) {
    throw new Error(`Could not verify package manifest versions for ${file}`);
  }

  if (before.version === null && after.version === null) return null;
  if (before.version === null || after.version === null) {
    throw new Error(`Could not verify package manifest versions for ${file}`);
  }

  return { before: before.version, after: after.version };
}

export function isMajorVersionPromotion(
  before: string,
  after: string,
): boolean {
  if (before === after) return false;
  return versionParts(after)[0] > versionParts(before)[0];
}

function versionParts(version: string): number[] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`unparseable version "${version}"`);
  return match.slice(1).map(Number);
}
