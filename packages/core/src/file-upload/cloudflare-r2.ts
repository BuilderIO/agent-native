/**
 * Cloudflare object storage provider for the file-upload registry.
 *
 * A Worker has no filesystem and the framework's architecture contract keeps
 * raw payloads out of SQL, so on this host the R2 binding is the only place an
 * uploaded file can go. That makes the provider a platform capability rather
 * than app configuration: it registers itself (see `registry.ts`) instead of
 * waiting for a plugin a generated app has no reason to add.
 */

import { FileUploadStorageNotConfiguredError } from "./errors.js";
import type {
  FileUploadInput,
  FileUploadProvider,
  FileUploadResult,
} from "./types.js";

export const CLOUDFLARE_R2_PROVIDER_ID = "cloudflare-r2";

/**
 * The R2 binding name the provider reads. Fixed rather than configurable for
 * the same reason the D1 binding name is: a renameable binding would be
 * configuration no reader honours.
 */
export const CLOUDFLARE_R2_BINDING_NAME = "UPLOADS";

/** The key holding the bucket's public base URL (custom domain or r2.dev). */
export const CLOUDFLARE_R2_PUBLIC_BASE_URL_KEY =
  "CLOUDFLARE_R2_PUBLIC_BASE_URL";

export const CLOUDFLARE_R2_SETUP_GUIDANCE =
  `Object storage is not configured for this Cloudflare Worker. Uploaded files ` +
  `cannot be stored in SQL, so the upload was refused rather than silently ` +
  `degraded. Create a bucket with \`wrangler r2 bucket create <name>\`, build ` +
  `with CLOUDFLARE_R2_BUCKET_NAME=<name> so the generated wrangler.json gains ` +
  `the \`${CLOUDFLARE_R2_BINDING_NAME}\` binding, and set ` +
  `${CLOUDFLARE_R2_PUBLIC_BASE_URL_KEY} to the bucket's public base URL. ` +
  `Alternatively connect Builder.io in Settings → File uploads, or register ` +
  `another provider via registerFileUploadProvider().`;

/** The slice of the R2 bucket binding this provider uses. */
export interface CloudflareR2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
}

/**
 * Absent and unusable are deliberately different results. An absent binding is
 * an app that has not configured storage yet; a bound value that cannot store
 * an object is a broken deploy, and collapsing the two would report the second
 * as the first and send the operator to the wrong setup step.
 */
export type CloudflareR2BindingLookup =
  | { status: "bound"; bucket: CloudflareR2Bucket }
  | { status: "absent" }
  | { status: "unusable"; reason: string };

interface CloudflareBindingGlobals {
  __cf_env?: Record<string, unknown>;
  __env__?: Record<string, unknown>;
}

export function lookupCloudflareR2Binding(): CloudflareR2BindingLookup {
  const bindingName = CLOUDFLARE_R2_BINDING_NAME;
  const runtime = globalThis as typeof globalThis & CloudflareBindingGlobals;
  const binding =
    runtime.__cf_env?.[bindingName] ?? runtime.__env__?.[bindingName];
  if (binding === undefined || binding === null) return { status: "absent" };
  if (
    typeof binding !== "object" ||
    typeof (binding as CloudflareR2Bucket).put !== "function"
  ) {
    return {
      status: "unusable",
      reason:
        `env.${bindingName} is bound to a ${typeof binding} with no put() — ` +
        `expected an R2 bucket. Check that the wrangler binding is declared ` +
        `under \`r2_buckets\` and not as a plain var.`,
    };
  }
  return { status: "bound", bucket: binding as CloudflareR2Bucket };
}

const EXTENSION_RE = /\.[A-Za-z0-9]{1,12}$/;

function extensionFor(input: FileUploadInput): string {
  const fromName = input.filename?.match(EXTENSION_RE)?.[0];
  if (fromName) return fromName.toLowerCase();
  const subtype = input.mimeType?.split(";")[0]?.trim().split("/")[1];
  if (subtype && /^[a-z0-9.+-]{1,12}$/i.test(subtype)) {
    return `.${subtype.replace(/^x[-.]/, "").toLowerCase()}`;
  }
  return "";
}

/**
 * Object keys are unguessable rather than owner-scoped: the bucket is served
 * from a public base URL, so the key is the only thing standing between a URL
 * holder and the object.
 */
export function buildCloudflareR2ObjectKey(
  input: FileUploadInput,
  id: string = crypto.randomUUID(),
): string {
  return `uploads/${id}${extensionFor(input)}`;
}

export function joinPublicUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

async function resolvePublicBaseUrl(): Promise<string | null> {
  const { resolveSecret } = await import("../server/credential-provider.js");
  const value = await resolveSecret(CLOUDFLARE_R2_PUBLIC_BASE_URL_KEY);
  return value?.trim() || null;
}

function toArrayBufferView(data: Uint8Array | Buffer): ArrayBufferView {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

export const cloudflareR2FileUploadProvider: FileUploadProvider = {
  id: CLOUDFLARE_R2_PROVIDER_ID,
  name: "Cloudflare R2",
  // An unusable binding still claims the upload so `upload()` can name what is
  // wrong. Reporting it as unconfigured would hand the file to the next
  // provider — and, with none configured, to the SQL fallback.
  isConfigured: () => lookupCloudflareR2Binding().status !== "absent",
  upload: async (input: FileUploadInput): Promise<FileUploadResult> => {
    const lookup = lookupCloudflareR2Binding();
    if (lookup.status === "absent") {
      throw new FileUploadStorageNotConfiguredError(
        CLOUDFLARE_R2_SETUP_GUIDANCE,
      );
    }
    if (lookup.status === "unusable") {
      throw new FileUploadStorageNotConfiguredError(
        `Cloudflare object storage is misconfigured: ${lookup.reason}`,
      );
    }

    const baseUrl = await resolvePublicBaseUrl();
    if (!baseUrl) {
      throw new FileUploadStorageNotConfiguredError(
        `The ${CLOUDFLARE_R2_BINDING_NAME} bucket is bound but ` +
          `${CLOUDFLARE_R2_PUBLIC_BASE_URL_KEY} is not set, so an uploaded ` +
          `file would have no URL to persist. Set it to the bucket's public ` +
          `base URL (custom domain or r2.dev address).`,
      );
    }

    const key = buildCloudflareR2ObjectKey(input);
    await lookup.bucket.put(key, toArrayBufferView(input.data), {
      httpMetadata: input.mimeType
        ? { contentType: input.mimeType }
        : undefined,
    });

    return {
      url: joinPublicUrl(baseUrl, key),
      id: key,
      provider: CLOUDFLARE_R2_PROVIDER_ID,
    };
  },
};
