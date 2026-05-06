import fs from "node:fs/promises";
import path from "node:path";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

interface StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
}

export interface StoredObject {
  key: string;
  url?: string;
}

const LOCAL_ROOT = path.join(process.cwd(), "data", "images-objects");

function readConfig(): StorageConfig | null {
  const bucket = process.env.IMAGES_STORAGE_BUCKET || process.env.S3_BUCKET;
  const accessKeyId =
    process.env.IMAGES_STORAGE_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.IMAGES_STORAGE_SECRET_ACCESS_KEY ||
    process.env.S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    region:
      process.env.IMAGES_STORAGE_REGION || process.env.S3_REGION || "auto",
    endpoint: process.env.IMAGES_STORAGE_ENDPOINT || process.env.S3_ENDPOINT,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl:
      process.env.IMAGES_STORAGE_PUBLIC_BASE_URL ||
      process.env.S3_PUBLIC_BASE_URL ||
      undefined,
  };
}

export function isObjectStorageConfigured(): boolean {
  return readConfig() !== null;
}

function s3Client(config: StorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: !!config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export async function putObject(input: {
  key: string;
  body: Uint8Array | Buffer;
  contentType: string;
}): Promise<StoredObject> {
  const config = readConfig();
  if (config) {
    const client = s3Client(config);
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
    return {
      key: input.key,
      url: config.publicBaseUrl
        ? `${config.publicBaseUrl.replace(/\/$/, "")}/${input.key}`
        : undefined,
    };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Image object storage is not configured. Set the IMAGES_STORAGE_* secrets before generating or uploading images.",
    );
  }

  const file = path.join(LOCAL_ROOT, input.key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, input.body);
  return { key: input.key };
}

export async function getObject(key: string): Promise<Buffer> {
  const config = readConfig();
  if (config) {
    const client = s3Client(config);
    const res = await client.send(
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    );
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  return fs.readFile(path.join(LOCAL_ROOT, key));
}

export async function getPresignedObjectUrl(
  key: string,
  expiresIn = 60 * 30,
): Promise<{ url: string; expiresAt: string } | null> {
  const config = readConfig();
  if (!config) return null;
  const client = s3Client(config);
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn },
  );
  return {
    url,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}
