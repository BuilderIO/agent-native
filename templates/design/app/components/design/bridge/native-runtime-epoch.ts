type EpochCrypto = Partial<Pick<Crypto, "randomUUID" | "getRandomValues">>;

let localEpochCounter = 0;

export function createNativeRuntimeEpoch(
  source: EpochCrypto | null | undefined = globalThis.crypto,
): string {
  if (typeof source?.randomUUID === "function")
    return source.randomUUID.call(source);
  if (typeof source?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    source.getRandomValues(bytes);
    return `local-${Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")}`;
  }
  localEpochCounter += 1;
  // The epoch correlates status messages; source/origin and request checks own trust.
  return `local-${Date.now().toString(36)}-${localEpochCounter.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
