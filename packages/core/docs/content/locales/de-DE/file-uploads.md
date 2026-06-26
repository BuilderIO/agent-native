---
title: "Datei-Uploads"
description: "Datei-Upload-Speicher konfigurieren – SQL-Fallback für Entwickler, Builder.io oder benutzerdefinierte Anbieter für die Produktion."
---

# Datei-Uploads

Das Framework bietet eine Datei-Upload-Abstraktion, die Uploads über einen konfigurierbaren Anbieter weiterleitet. Vorlagen rufen `uploadFile()` auf und erhalten ein URL zurück – das Speicher-Backend ist austauschbar, ohne dass der Anwendungscode geändert werden muss.

## Wie es funktioniert {#how-it-works}

Upload-Anfragen gehen an `POST /_agent-native/file-upload`, das an den aktiven Anbieter weiterleitet. Welcher Anbieter konfiguriert ist, können Sie unter `GET /_agent-native/file-upload/status`.

Die Reihenfolge der Anbieterauflösung lautet:

1. **Vom Benutzer registrierte Anbieter** – benutzerdefinierte Anbieter, die über `registerFileUploadProvider()` registriert wurden
2. **Builder.io-Anbieter** – integriert, wird automatisch aktiviert, wenn Builder.io verbunden ist
3. **SQL Fallback** – speichert Dateien als Base64 in der Datenbank (gut für Entwickler, nicht für Produktion)

```an-diagram title="Anordnung zur Lösung des Anbieters" summary="uploadFile() wählt den ersten konfigurierten Anbieter der Reihe nach aus. Der SQL-Fallback ist immer vorhanden, sodass Uploads ohne Setup funktionieren."
{
  "html": "<div class=\"diagram-upload\"><div class=\"diagram-box\" data-rough>uploadFile()<br><small class=\"diagram-muted\">POST /_agent-native/file-upload</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-step\"><span class=\"diagram-pill accent\">1</span><div class=\"diagram-node\">Vom Benutzer registriert<br><small class=\"diagram-muted\">registerFileUploadProvider() — S3, R2, GCS…</small></div></div><div class=\"diagram-step\"><span class=\"diagram-pill\">2</span><div class=\"diagram-node\">Builder.io<br><small class=\"diagram-muted\">automatisch nach Verbindung — per CDN bereitgestellt</small></div></div><div class=\"diagram-step\"><span class=\"diagram-pill warn\">3</span><div class=\"diagram-node\">SQL-Fallback<br><small class=\"diagram-muted\">base64 in DB — nur Entwicklung</small></div></div></div></div>",
  "css": ".diagram-upload{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-upload .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-upload .diagram-step{display:flex;align-items:center;gap:8px}.diagram-upload .diagram-arrow{font-size:22px;line-height:1}"
}
```

```an-api title="Der Upload-Endpunkt" method="POST" path="/_agent-native/file-upload"
{
  "method": "POST",
  "path": "/_agent-native/file-upload",
  "summary": "Laden Sie eine Datei über den aktiven Anbieter hoch und erhalten Sie eine öffentliche URL zurück.",
  "description": "Dispatches to the first configured provider in resolution order. Check the active provider at `GET /_agent-native/file-upload/status`.",
  "request": { "contentType": "multipart/form-data" },
  "responses": [
    { "status": "200", "description": "{ url, id?, provider } — the public URL and which provider handled it." }
  ]
}
```

## Standard: SQL Fallback {#sql-fallback}

Wenn kein Anbieter konfiguriert ist, werden Dateien über das Ressourcensystem als Base64-Daten in der SQL-Datenbank gespeichert. Dies funktioniert sofort für die lokale Entwicklung, wird jedoch nicht für die Produktion empfohlen – große Dateien blähen die Datenbank auf und es gibt kein CDN.

Eine einmalige Warnung wird protokolliert, wenn der Fallback verwendet wird.

## Builder.io Hosting {#builder-hosting}

Wenn Ihre App mit Builder.io verbunden ist, werden Datei-Uploads automatisch an das Asset-Hosting von Builder weitergeleitet. Dateien werden von einem CDN bereitgestellt, ohne dass eine Konfiguration erforderlich ist. Dies ist die empfohlene Produktionskonfiguration.

## Benutzerdefinierte Anbieter {#custom-providers}

Registrieren Sie einen benutzerdefinierten Anbieter in einem Server-Plugin, um ein beliebiges Speicher-Backend (S3, Cloudflare R2, GCS usw.) zu verwenden:

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

## API hochladen {#upload-api}

Die `FileUploadProvider`-Schnittstelle:

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

Verwenden Sie `uploadFile()` von `@agent-native/core/file-upload` in actions oder Servercode:

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
  // No provider configured — handle SQL-Fallback yourself, or skip
}
```
