export class OptionalPeerDependencyError extends Error {
  readonly code = "ERR_AGENT_NATIVE_OPTIONAL_PEER";

  constructor(
    readonly packageName: string,
    options?: ErrorOptions,
  ) {
    super(
      `This feature requires optional peer ${packageName}. Install it with \`pnpm add ${packageName}\`.`,
      options,
    );
    this.name = "OptionalPeerDependencyError";
  }
}

export async function loadOptionalPeer<T>(
  packageName: string,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (isMissingPeer(error, packageName)) {
      throw new OptionalPeerDependencyError(packageName, { cause: error });
    }
    throw error;
  }
}

function isMissingPeer(error: unknown, packageName: string): boolean {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 8; depth++) {
    if (!current || typeof current !== "object" || seen.has(current)) {
      return false;
    }
    seen.add(current);

    const code = "code" in current ? current.code : undefined;
    const message = "message" in current ? String(current.message) : "";
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
      const missingModule = message.match(
        /Cannot find (?:package|module) ['"]([^'"]+)['"]/,
      )?.[1];
      if (isPackageOrSubpath(missingModule, packageName)) return true;
    }

    const unresolvedImport = [
      /Could not resolve ["']([^"']+)["'] imported by ["'][^"']+["']\. Is it installed\?/.exec(
        message,
      )?.[1],
      /Failed to resolve import ["']([^"']+)["'] from ["'][^"']+["']\. Does the file exist\?/.exec(
        message,
      )?.[1],
      /(?:Rollup|Rolldown) failed to resolve import ["']([^"']+)["']/.exec(
        message,
      )?.[1],
    ].find((specifier) => specifier !== undefined);
    if (isPackageOrSubpath(unresolvedImport, packageName)) {
      return true;
    }

    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

function isPackageOrSubpath(
  specifier: string | undefined,
  packageName: string,
): boolean {
  return (
    specifier === packageName ||
    specifier?.startsWith(`${packageName}/`) === true
  );
}
