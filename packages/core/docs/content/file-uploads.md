---
title: "File Uploads"
description: "Configure file upload storage — SQL fallback for dev, Builder.io or custom providers for production."
---

# File Uploads

The framework provides a file upload abstraction that routes uploads through a configurable provider. Templates call `uploadFile()` and get back a URL — the storage backend is swappable without changing application code.

## How It Works {#how-it-works}

Upload requests go to `POST /_agent-native/file-upload`, which dispatches to the active provider. You can check which provider is configured at `GET /_agent-native/file-upload/status`.

The provider resolution order is:

1. **User-registered providers** — custom providers registered via `registerFileUploadProvider()`
2. **Builder.io provider** — built-in, activates automatically when Builder.io is connected
3. **SQL fallback** — stores files as base64 in the database (fine for dev, not for production)

## Default: SQL Fallback {#sql-fallback}

When no provider is configured, files are stored as base64 data in the SQL database via the resources system. This works out of the box for local development but is not recommended for production — large files bloat the database and there's no CDN.

A one-time warning is logged when the fallback is used.

## Builder.io Hosting {#builder-hosting}

When your app is connected to Builder.io, file uploads are automatically routed to Builder's asset hosting. Files are served from a CDN with no configuration needed. This is the recommended production setup.

## Custom Providers {#custom-providers}

Register a custom provider in a server plugin to use any storage backend (S3, Cloudflare R2, GCS, etc.):

```ts
// server/plugins/file-upload.ts
import { registerFileUploadProvider } from "@agent-native/core/file-upload";

export default defineNitroPlugin(() => {
  registerFileUploadProvider({
    id: "s3",
    name: "Amazon S3",
    isConfigured: () => !!process.env.S3_BUCKET,
    upload: async ({ data, filename, mimeType }) => {
      const key = `uploads/${Date.now()}-${filename}`;
      await s3Client.putObject({
        Bucket: process.env.S3_BUCKET!,
        Key: key,
        Body: data,
        ContentType: mimeType,
      });
      return {
        url: `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${key}`,
        provider: "s3",
      };
    },
  });
});
```

## Upload API {#upload-api}

The `FileUploadProvider` interface:

```ts
interface FileUploadProvider {
  id: string; // Unique id, e.g. "s3"
  name: string; // Human-readable name
  isConfigured: () => boolean; // True when ready (env vars set, etc.)
  upload: (input: FileUploadInput) => Promise<FileUploadResult>;
}

interface FileUploadInput {
  data: Uint8Array | Buffer; // File contents
  filename?: string; // Original filename
  mimeType?: string; // MIME type, e.g. "image/png"
  ownerEmail?: string; // For per-user scoping in fallback
}

interface FileUploadResult {
  url: string; // Public URL for the uploaded file
  id?: string; // Provider-specific id
  provider: string; // Which provider handled it
}
```

Use `uploadFile()` from `@agent-native/core/file-upload` in actions or server code:

```ts
import { uploadFile } from "@agent-native/core/file-upload";

const result = await uploadFile({
  data: fileBuffer,
  filename: "photo.jpg",
  mimeType: "image/jpeg",
});

if (result) {
  // Provider handled it — result.url is the public URL
} else {
  // No provider configured — handle SQL fallback yourself, or skip
}
```
