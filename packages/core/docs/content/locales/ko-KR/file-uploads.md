---
title: "파일 업로드"
description: "파일 업로드 저장소 구성 - 개발용 SQL 대체, 프로덕션용 Builder.io 또는 사용자 지정 공급자"
---

# 파일 업로드

프레임워크는 구성 가능한 공급자를 통해 업로드를 라우팅하는 파일 업로드 추상화를 제공합니다. 템플릿은 `uploadFile()`를 호출하고 URL를 반환합니다. 스토리지 백엔드는 애플리케이션 코드를 변경하지 않고도 교체 가능합니다.

## 작동 방식 {#how-it-works}

업로드 요청은 활성 공급자에게 전달되는 `POST /_agent-native/file-upload`로 이동합니다. `GET /_agent-native/file-upload/status`에서 어떤 공급자가 구성되어 있는지 확인할 수 있습니다.

공급자 해결 순서는 다음과 같습니다.

1. **사용자 등록 공급자** — `registerFileUploadProvider()`를 통해 등록된 맞춤형 공급자
2. **Builder.io 공급자** — 내장, Builder.io가 연결되면 자동으로 활성화됨
3. **SQL 대체** — 파일을 데이터베이스에 base64로 저장합니다(프로덕션이 아닌 개발에 적합)

```an-diagram title="공급자 해결 순서" summary="uploadFile()은 첫 번째로 구성된 공급자를 순서대로 선택합니다. SQL 대체는 항상 존재하므로 업로드는 설정 없이 작동합니다."
{
  "html": "<div class=\"diagram-upload\"><div class=\"diagram-box\" data-rough>uploadFile()<br><small class=\"diagram-muted\">POST /_agent-native/file-upload</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-step\"><span class=\"diagram-pill accent\">1</span><div class=\"diagram-node\">사용자 등록<br><small class=\"diagram-muted\">registerFileUploadProvider() — S3, R2, GCS…</small></div></div><div class=\"diagram-step\"><span class=\"diagram-pill\">2</span><div class=\"diagram-node\">Builder.io<br><small class=\"diagram-muted\">연결 시 자동 — CDN 제공</small></div></div><div class=\"diagram-step\"><span class=\"diagram-pill warn\">3</span><div class=\"diagram-node\">SQL 폴백<br><small class=\"diagram-muted\">DB의 base64 — 개발 전용</small></div></div></div></div>",
  "css": ".diagram-upload{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-upload .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-upload .diagram-step{display:flex;align-items:center;gap:8px}.diagram-upload .diagram-arrow{font-size:22px;line-height:1}"
}
```

```an-api title="업로드 엔드포인트" method="POST" path="/_agent-native/file-upload"
{
  "method": "POST",
  "path": "/_agent-native/file-upload",
  "summary": "활성 공급자를 통해 파일을 업로드하고 공개 URL을 다시 가져옵니다.",
  "description": "Dispatches to the first configured provider in resolution order. Check the active provider at `GET /_agent-native/file-upload/status`.",
  "request": { "contentType": "multipart/form-data" },
  "responses": [
    { "status": "200", "description": "{ url, id?, provider } — the public URL and which provider handled it." }
  ]
}
```

## 기본값: SQL 대체 {#sql-fallback}

구성된 공급자가 없으면 파일은 리소스 시스템을 통해 SQL 데이터베이스에 base64 데이터로 저장됩니다. 이는 로컬 개발에서는 기본적으로 작동하지만 프로덕션에서는 권장되지 않습니다. 대용량 파일은 데이터베이스를 부풀리고 CDN가 없습니다.

대체를 사용할 때 일회성 경고가 기록됩니다.

## Builder.io 호스팅 {#builder-hosting}

앱이 Builder.io에 연결되면 파일 업로드가 자동으로 Builder의 자산 호스팅으로 라우팅됩니다. 파일은 구성이 필요 없이 CDN에서 제공됩니다. 이는 권장되는 제작 설정입니다.

## 맞춤 제공자 {#custom-providers}

스토리지 백엔드(S3, Cloudflare R2, GCS 등)를 사용하려면 서버 플러그인에 사용자 지정 공급자를 등록하세요.

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

## API 업로드 {#upload-api}

`FileUploadProvider` 인터페이스:

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

actions 또는 서버 코드에서 `@agent-native/core/file-upload`의 `uploadFile()`를 사용합니다.

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
  // No provider configured — handle SQL 폴백 yourself, or skip
}
```
