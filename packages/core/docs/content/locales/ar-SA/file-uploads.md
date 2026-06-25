---
title: "تحميل الملفات"
description: "قم بتكوين مساحة تخزين تحميل الملفات — احتياطي SQL للمطورين، أو Builder.io أو موفري الخدمة المخصصين للإنتاج."
---

# تحميلات الملفات

يوفر إطار العمل تجريدًا لتحميل الملفات والذي يقوم بتوجيه التحميلات من خلال موفر قابل للتكوين. تستدعي القوالب `uploadFile()` وتستعيد URL — واجهة التخزين الخلفية قابلة للتبديل دون تغيير رمز التطبيق.

## كيفية العمل {#how-it-works}

تنتقل طلبات التحميل إلى `POST /_agent-native/file-upload`، والتي ترسلها إلى الموفر النشط. يمكنك التحقق من الموفر الذي تم تكوينه في `GET /_agent-native/file-upload/status`.

ترتيب حل الموفر هو:

1. **الموفرون المسجلون بواسطة المستخدم** — مقدمو الخدمة المخصصون المسجلون عبر `registerFileUploadProvider()`
2. **موفر Builder.io** — مدمج، يتم تنشيطه تلقائيًا عند اتصال Builder.io
3. **الاحتياطي SQL** — يخزن الملفات بتنسيق base64 في قاعدة البيانات (مناسب للتطوير، وليس للإنتاج)

```an-diagram title="ترتيب حل الموفر" summary="uploadFile() يختار الموفر الأول الذي تم تكوينه بالترتيب. الخيار الاحتياطي SQL موجود دائمًا، لذا تعمل التحميلات بدون أي إعداد."
{
  "html": "<div class=\"diagram-upload\"><div class=\"diagram-box\" data-rough>uploadFile()<br><small class=\"diagram-muted\">POST /_agent-native/file-upload</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-step\"><span class=\"diagram-pill accent\">1</span><div class=\"diagram-node\">مسجل من المستخدم<br><small class=\"diagram-muted\">registerFileUploadProvider() — S3, R2, GCS…</small></div></div><div class=\"diagram-step\"><span class=\"diagram-pill\">2</span><div class=\"diagram-node\">Builder.io<br><small class=\"diagram-muted\">تلقائي عند الاتصال — مقدم عبر CDN</small></div></div><div class=\"diagram-step\"><span class=\"diagram-pill warn\">3</span><div class=\"diagram-node\">احتياطي SQL<br><small class=\"diagram-muted\">base64 في قاعدة البيانات — للتطوير فقط</small></div></div></div></div>",
  "css": ".diagram-upload{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-upload .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-upload .diagram-step{display:flex;align-items:center;gap:8px}.diagram-upload .diagram-arrow{font-size:22px;line-height:1}"
}
```

```an-api title="نقطة نهاية التحميل" method="POST" path="/_agent-native/file-upload"
{
  "method": "POST",
  "path": "/_agent-native/file-upload",
  "summary": "قم بتحميل ملف من خلال الموفر النشط واسترجع URL عام.",
  "description": "Dispatches to the first configured provider in resolution order. Check the active provider at `GET /_agent-native/file-upload/status`.",
  "request": { "contentType": "multipart/form-data" },
  "responses": [
    { "status": "200", "description": "{ url, id?, provider } — the public URL and which provider handled it." }
  ]
}
```

## الافتراضي: SQL الاحتياطي {#sql-fallback}

عند عدم تكوين أي موفر، يتم تخزين الملفات كبيانات base64 في قاعدة بيانات SQL عبر نظام الموارد. يعمل هذا بشكل خارج الصندوق للتطوير المحلي ولكن لا يوصى به للإنتاج - فالملفات الكبيرة تؤدي إلى تضخم قاعدة البيانات ولا يوجد CDN.

يتم تسجيل تحذير لمرة واحدة عند استخدام الإجراء الاحتياطي.

## استضافة Builder.io {#builder-hosting}

عندما يكون تطبيقك متصلاً بـ Builder.io، يتم توجيه تحميلات الملفات تلقائيًا إلى استضافة أصول Builder. يتم تقديم الملفات من CDN دون الحاجة إلى تكوين. هذا هو إعداد الإنتاج الموصى به.

## موفرو الخدمة المخصصون {#custom-providers}

قم بتسجيل موفر مخصص في مكون إضافي للخادم لاستخدام أي واجهة تخزين خلفية (S3، Cloudflare R2، GCS، وما إلى ذلك):

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

## تحميل API {#upload-api}

واجهة `FileUploadProvider`:

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

استخدم `uploadFile()` من `@agent-native/core/file-upload` في actions أو رمز الخادم:

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
  // No provider configured — handle احتياطي SQL yourself, or skip
}
```
