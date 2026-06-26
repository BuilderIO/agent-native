---
title: "檔案上傳"
description: "設定檔案上傳儲存 - 用於開發的 SQL 後備、Builder.io 或用於正式環境的自訂提供者。"
---

# 檔案上傳

此框架提供了一個檔案上傳抽象，可透過可設定的提供者路由上傳。範本呼叫 `uploadFile()` 並傳回 URL — 儲存後端可交換，無需更改應用程式的程式碼。

## 它是如何工作的 {#how-it-works}

上傳請求傳送至 `POST /_agent-native/file-upload`，後者分派至活動提供者。您可以在`GET /_agent-native/file-upload/status`處檢視設定了哪個提供者。

提供者解析順序是：

1. **使用者註冊的提供者** — 透過 `registerFileUploadProvider()` 註冊的自訂提供者
2. **Builder.io 提供者** — 內建，連線 Builder.io 時自動啟用
3. **SQL 後備** - 將檔案作為 base64 儲存在資料庫中（適合開發，不適用於正式環境）

```an-diagram title="提供者決議順序" summary="uploadFile() 按順序選取第一個設定的提供者。 SQL 後備始終存在，因此上傳可以零設定進行。"
{
  "html": "<div class=\"diagram-upload\"><div class=\"diagram-box\" data-rough>uploadFile()<br><small class=\"diagram-muted\">POST /_agent-native/file-upload</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-step\"><span class=\"diagram-pill accent\">1</span><div class=\"diagram-node\">使用者註冊<br><small class=\"diagram-muted\">registerFileUploadProvider() — S3, R2, GCS…</small></div></div><div class=\"diagram-step\"><span class=\"diagram-pill\">2</span><div class=\"diagram-node\">Builder.io<br><small class=\"diagram-muted\">連線後自動啟用——由 CDN 提供</small></div></div><div class=\"diagram-step\"><span class=\"diagram-pill warn\">3</span><div class=\"diagram-node\">SQL 兜底<br><small class=\"diagram-muted\">資料庫中的 base64——僅開發使用</small></div></div></div></div>",
  "css": ".diagram-upload{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-upload .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-upload .diagram-step{display:flex;align-items:center;gap:8px}.diagram-upload .diagram-arrow{font-size:22px;line-height:1}"
}
```

```an-api title="上傳端點" method="POST" path="/_agent-native/file-upload"
{
  "method": "POST",
  "path": "/_agent-native/file-upload",
  "summary": "透過活動提供者上傳檔案並返回公開 URL。",
  "description": "Dispatches to the first configured provider in resolution order. Check the active provider at `GET /_agent-native/file-upload/status`.",
  "request": { "contentType": "multipart/form-data" },
  "responses": [
    { "status": "200", "description": "{ url, id?, provider } — the public URL and which provider handled it." }
  ]
}
```

## 預設：SQL 後備 {#sql-fallback}

當沒有設定提供者時，檔案透過資源系統以base64資料儲存在 SQL 資料庫中。這對於本機開發來說是開箱即用的，但不建議用於正式環境——大檔案會使資料庫膨脹，而且沒有 CDN。

使用後備時會紀錄一次性警告。

## Builder.io 託管 {#builder-hosting}

當您的應用連線到 Builder.io 時，檔案上傳會自動路由到 Builder 的資產託管。檔案由 CDN 提供，無需設定。這是推薦的正式環境設定。

## 自訂提供者 {#custom-providers}

在伺服器外掛中註冊自訂提供者以使用任何儲存後端（S3、Cloudflare R2、GCS 等）：

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

## 上傳 API {#upload-api}

`FileUploadProvider`介面：

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

在 actions 或伺服器程式碼中使用 `@agent-native/core/file-upload` 中的 `uploadFile()`：

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
  // No provider configured — handle SQL 兜底 yourself, or skip
}
```
