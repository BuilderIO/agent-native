import {
  PROTECTED_CIPHERTEXT_VERSION,
  ProtectedCiphertextLengthMismatchError,
  ProtectedCiphertextProviderAmbiguousError,
  ProtectedCiphertextStorageUnavailableError,
  protectedCiphertextCoordinateSchema,
  protectedCiphertextLocatorSchema,
  protectedCiphertextMaximumBytes,
  protectedCiphertextPrefixSchema,
  type ProtectedCiphertextDeleteResult,
  type ProtectedCiphertextLocator,
  type ProtectedCiphertextPrefix,
  type ProtectedCiphertextPrefixDeleteResult,
  type ProtectedCiphertextProvider,
  type ProtectedCiphertextPutInput,
  type ProtectedCiphertextPutResult,
  type ProtectedCiphertextReadResult,
} from "./types.js";

interface ProtectedCiphertextGlobals {
  __agentNativeProtectedCiphertextProviders?: Map<
    string,
    ProtectedCiphertextProvider
  >;
}

const globals = globalThis as typeof globalThis & ProtectedCiphertextGlobals;
const providers = (globals.__agentNativeProtectedCiphertextProviders ??=
  new Map());

export function registerProtectedCiphertextProvider(
  provider: ProtectedCiphertextProvider,
): void {
  if (providers.has(provider.id)) {
    throw new ProtectedCiphertextStorageUnavailableError(
      `Protected ciphertext provider is already registered: ${provider.id}`,
    );
  }
  providers.set(provider.id, provider);
}

export function unregisterProtectedCiphertextProvider(id: string): void {
  providers.delete(id);
}

export function listProtectedCiphertextProviders(): ProtectedCiphertextProvider[] {
  return [...providers.values()];
}

export function getActiveProtectedCiphertextProvider(): ProtectedCiphertextProvider | null {
  const configured = [...providers.values()].filter((provider) =>
    provider.isConfigured(),
  );
  if (configured.length > 1) {
    throw new ProtectedCiphertextProviderAmbiguousError();
  }
  return configured[0] ?? null;
}

function locatorAt(
  provider: ProtectedCiphertextProvider,
  input: unknown,
): ProtectedCiphertextLocator {
  const coordinate = protectedCiphertextCoordinateSchema.parse(input);
  return protectedCiphertextLocatorSchema.parse({
    kind: "agent-native.protected-ciphertext",
    version: PROTECTED_CIPHERTEXT_VERSION,
    provider: provider.id,
    opaque: true,
    coordinate,
  });
}

function requireActiveProvider(): ProtectedCiphertextProvider {
  const provider = getActiveProtectedCiphertextProvider();
  if (!provider) throw new ProtectedCiphertextStorageUnavailableError();
  return provider;
}

function requireProviderForLocator(
  input: unknown,
): [ProtectedCiphertextProvider, ProtectedCiphertextLocator] {
  const locator = protectedCiphertextLocatorSchema.parse(input);
  const provider = providers.get(locator.provider);
  if (!provider || !provider.isConfigured()) {
    throw new ProtectedCiphertextStorageUnavailableError(
      `Protected ciphertext provider is unavailable: ${locator.provider}`,
    );
  }
  return [provider, locator];
}

export async function putProtectedCiphertext(
  input: ProtectedCiphertextPutInput,
): Promise<ProtectedCiphertextPutResult> {
  const coordinate = protectedCiphertextCoordinateSchema.parse(
    input.coordinate,
  );
  if (
    !(input.ciphertext instanceof Uint8Array) ||
    !Number.isSafeInteger(input.expectedByteLength) ||
    input.expectedByteLength < 1 ||
    input.expectedByteLength > protectedCiphertextMaximumBytes(coordinate) ||
    input.ciphertext.byteLength !== input.expectedByteLength
  ) {
    throw new ProtectedCiphertextLengthMismatchError();
  }
  return requireActiveProvider().put({ ...input, coordinate });
}

export async function readProtectedCiphertext(
  input: unknown,
): Promise<ProtectedCiphertextReadResult> {
  const [provider, locator] = requireProviderForLocator(input);
  return provider.read(locator);
}

export async function readProtectedCiphertextAt(
  coordinate: unknown,
): Promise<ProtectedCiphertextReadResult> {
  const provider = requireActiveProvider();
  return provider.read(locatorAt(provider, coordinate));
}

export async function deleteProtectedCiphertext(
  input: unknown,
): Promise<ProtectedCiphertextDeleteResult> {
  const [provider, locator] = requireProviderForLocator(input);
  return provider.delete(locator);
}

export async function deleteProtectedCiphertextAt(
  coordinate: unknown,
): Promise<ProtectedCiphertextDeleteResult> {
  const provider = requireActiveProvider();
  return provider.delete(locatorAt(provider, coordinate));
}

export async function deleteProtectedCiphertextPrefix(
  input: ProtectedCiphertextPrefix,
): Promise<ProtectedCiphertextPrefixDeleteResult> {
  const prefix = protectedCiphertextPrefixSchema.parse(input);
  const provider = requireActiveProvider();
  if (!provider.deletePrefix) {
    throw new ProtectedCiphertextStorageUnavailableError(
      `Protected ciphertext provider does not support prefix deletion: ${provider.id}`,
    );
  }
  return provider.deletePrefix(prefix);
}
