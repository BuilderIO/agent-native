export type NativeTextureProviderRead = {
  mimeType: string;
  data: Uint8Array;
};

export class NativeTextureProviderError extends Error {
  constructor(
    readonly code:
      | "invalid-reference"
      | "forbidden"
      | "unavailable"
      | "unreadable"
      | "limit"
      | "mismatch"
      | "unsupported",
    message: string,
  ) {
    super(message);
    this.name = "NativeTextureProviderError";
  }
}

const LOCAL_QA_PREFIX = "/api/qa-figma-import-assets/";
const LOCAL_QA_URL =
  /^\/api\/qa-figma-import-assets\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(?:png|jpg|webp)$/;

export async function readNativeTextureProviderWith(
  args: {
    url: string;
    ownerEmail: string;
    maxBytes: number;
  },
  dependencies: {
    localQaEnabled(): boolean;
    readLocal(
      url: string,
      ownerEmail: string,
      maxBytes: number,
    ): Promise<NativeTextureProviderRead>;
    readHttps(
      url: string,
      ownerEmail: string,
      maxBytes: number,
    ): Promise<NativeTextureProviderRead>;
  },
): Promise<NativeTextureProviderRead> {
  if (!args.ownerEmail.trim())
    throw new NativeTextureProviderError(
      "forbidden",
      "Native texture provider requires an authenticated owner.",
    );
  if (
    !Number.isSafeInteger(args.maxBytes) ||
    args.maxBytes < 1 ||
    args.maxBytes > 1_000_000
  )
    throw new NativeTextureProviderError(
      "limit",
      "Native texture provider read limit is invalid.",
    );
  let result: NativeTextureProviderRead;
  if (args.url.startsWith(LOCAL_QA_PREFIX)) {
    if (!LOCAL_QA_URL.test(args.url))
      throw new NativeTextureProviderError(
        "invalid-reference",
        "Local QA texture URL is malformed.",
      );
    if (!dependencies.localQaEnabled())
      throw new NativeTextureProviderError(
        "unavailable",
        "Local QA texture storage is disabled.",
      );
    result = await dependencies.readLocal(
      args.url,
      args.ownerEmail,
      args.maxBytes,
    );
  } else if (/^https:\/\//.test(args.url)) {
    result = await dependencies.readHttps(
      args.url,
      args.ownerEmail,
      args.maxBytes,
    );
  } else {
    throw new NativeTextureProviderError(
      "invalid-reference",
      "Native texture storage URL is unsupported.",
    );
  }
  if (
    !(result.data instanceof Uint8Array) ||
    !result.data.byteLength ||
    result.data.byteLength > args.maxBytes
  )
    throw new NativeTextureProviderError(
      "limit",
      "Native texture provider bytes exceed the requested bound.",
    );
  if (!["image/png", "image/jpeg", "image/webp"].includes(result.mimeType))
    throw new NativeTextureProviderError(
      "unsupported",
      "Native texture provider returned an unsupported image type.",
    );
  return result;
}
