---
title: "ファイルのアップロード"
description: "ファイル アップロード ストレージを構成します — 開発用の SQL フォールバック、本番用の Builder.io またはカスタム プロバイダー。"
---

# ファイルのアップロード

このフレームワークは、構成可能なプロバイダーを通じてアップロードをルーティングするファイル アップロードの抽象化を提供します。テンプレートは `uploadFile()` を呼び出し、URL を返します。ストレージ バックエンドはアプリケーション コードを変更せずに交換可能です。

## 仕組み {#how-it-works}

アップロード リクエストは `POST /_agent-native/file-upload` に送信され、アクティブなプロバイダーにディスパッチされます。どのプロバイダーが設定されているかは、`GET /_agent-native/file-upload/status` で確認できます。

プロバイダーの解決順序は次のとおりです:

1. **ユーザー登録プロバイダー** — `registerFileUploadProvider()` 経由で登録されたカスタムプロバイダー
2. **Builder.io プロバイダー** — 組み込み、Builder.io が接続されると自動的にアクティブ化されます
3. **SQL フォールバック** — ファイルをデータベースに Base64 として保存します (開発には問題ありませんが、運用には問題ありません)

```an-diagram title="プロバイダーの解決順序" summary="UploadFile() は、最初に構成されたプロバイダーを順番に選択します。 SQL フォールバックは常に存在するため、アップロードはセットアップなしで機能します。"
{
  "html": "<div class=\"diagram-upload\"><div class=\"diagram-box\" data-rough>uploadFile()<br><small class=\"diagram-muted\">POST /_agent-native/file-upload</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-step\"><span class=\"diagram-pill accent\">1</span><div class=\"diagram-node\">ユーザー登録<br><small class=\"diagram-muted\">registerFileUploadProvider() — S3, R2, GCS…</small></div></div><div class=\"diagram-step\"><span class=\"diagram-pill\">2</span><div class=\"diagram-node\">Builder.io<br><small class=\"diagram-muted\">接続時に自動 — CDN 配信</small></div></div><div class=\"diagram-step\"><span class=\"diagram-pill warn\">3</span><div class=\"diagram-node\">SQL フォールバック<br><small class=\"diagram-muted\">DB 内 base64 — 開発専用</small></div></div></div></div>",
  "css": ".diagram-upload{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-upload .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-upload .diagram-step{display:flex;align-items:center;gap:8px}.diagram-upload .diagram-arrow{font-size:22px;line-height:1}"
}
```

```an-api title="アップロードエンドポイント" method="POST" path="/_agent-native/file-upload"
{
  "method": "POST",
  "path": "/_agent-native/file-upload",
  "summary": "アクティブなプロバイダーを通じてファイルをアップロードし、パブリック URL を取得します。",
  "description": "Dispatches to the first configured provider in resolution order. Check the active provider at `GET /_agent-native/file-upload/status`.",
  "request": { "contentType": "multipart/form-data" },
  "responses": [
    { "status": "200", "description": "{ url, id?, provider } — the public URL and which provider handled it." }
  ]
}
```

## デフォルト: SQL フォールバック {#sql-fallback}

プロバイダーが構成されていない場合、ファイルはリソース システムを介して SQL データベースに Base64 データとして保存されます。これは、ローカル開発ではそのまま使用できますが、運用環境では推奨されません。ファイルが大きいとデータベースが肥大化し、CDN がありません。

フォールバックが使用されると、1 回限りの警告がログに記録されます。

## Builder.io ホスティング {#builder-hosting}

アプリが Builder.io に接続されている場合、ファイルのアップロードは Builder のアセット ホスティングに自動的にルーティングされます。ファイルは、構成を必要とせずに CDN から提供されます。これは推奨される運用環境設定です。

## カスタムプロバイダー {#custom-providers}

任意のストレージ バックエンド (S3、Cloudflare R2、GCS など) を使用するには、サーバー プラグインにカスタム プロバイダーを登録します。

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

## API をアップロード {#upload-api}

`FileUploadProvider` インターフェイス:

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

actions またはサーバー コードで `@agent-native/core/file-upload` の `uploadFile()` を使用します。

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
  // No provider configured — handle SQL フォールバック yourself, or skip
}
```
