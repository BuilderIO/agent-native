---
title: "Uploads de arquivos"
description: "Configurar armazenamento de upload de arquivo — substituto SQL para dev, Builder.io ou provedores personalizados para produção."
---

# Uploads de arquivos

A estrutura fornece uma abstração de upload de arquivo que roteia uploads por meio de um provedor configurável. Os modelos chamam `uploadFile()` e retornam um URL — o back-end de armazenamento pode ser trocado sem alterar o código do aplicativo.

## Como funciona {#how-it-works}

As solicitações de upload vão para `POST /_agent-native/file-upload`, que é despachado para o provedor ativo. Você pode verificar qual provedor está configurado em `GET /_agent-native/file-upload/status`.

A ordem de resolução do provedor é:

1. **Provedores registrados pelo usuário** — provedores personalizados registrados via `registerFileUploadProvider()`
2. **Provedor Builder.io** — integrado, ativado automaticamente quando Builder.io é conectado
3. **SQL substituto** — armazena arquivos como base64 no banco de dados (ótimo para desenvolvimento, não para produção)

```an-diagram title="Ordem de resolução do provedor" summary="uploadFile() escolhe o primeiro provedor configurado na ordem. O substituto SQL sempre existe, então os uploads funcionam sem configuração."
{
  "html": "<div class=\"diagram-upload\"><div class=\"diagram-box\" data-rough>uploadFile()<br><small class=\"diagram-muted\">POST /_agent-native/file-upload</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-col\"><div class=\"diagram-step\"><span class=\"diagram-pill accent\">1</span><div class=\"diagram-node\">Registrado pelo usuário<br><small class=\"diagram-muted\">registerFileUploadProvider() — S3, R2, GCS…</small></div></div><div class=\"diagram-step\"><span class=\"diagram-pill\">2</span><div class=\"diagram-node\">Builder.io<br><small class=\"diagram-muted\">automático ao conectar — servido por CDN</small></div></div><div class=\"diagram-step\"><span class=\"diagram-pill warn\">3</span><div class=\"diagram-node\">fallback SQL<br><small class=\"diagram-muted\">base64 no DB — só desenvolvimento</small></div></div></div></div>",
  "css": ".diagram-upload{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.diagram-upload .diagram-col{display:flex;flex-direction:column;gap:10px}.diagram-upload .diagram-step{display:flex;align-items:center;gap:8px}.diagram-upload .diagram-arrow{font-size:22px;line-height:1}"
}
```

```an-api title="O ponto final de upload" method="POST" path="/_agent-native/file-upload"
{
  "method": "POST",
  "path": "/_agent-native/file-upload",
  "summary": "Faça upload de um arquivo por meio do provedor ativo e receba de volta um URL público.",
  "description": "Dispatches to the first configured provider in resolution order. Check the active provider at `GET /_agent-native/file-upload/status`.",
  "request": { "contentType": "multipart/form-data" },
  "responses": [
    { "status": "200", "description": "{ url, id?, provider } — the public URL and which provider handled it." }
  ]
}
```

## Padrão: substituto SQL {#sql-fallback}

Quando nenhum provedor está configurado, os arquivos são armazenados como dados base64 no banco de dados SQL por meio do sistema de recursos. Isso funciona imediatamente para desenvolvimento local, mas não é recomendado para produção: arquivos grandes sobrecarregam o banco de dados e não há CDN.

Um aviso único é registrado quando o substituto é usado.

## Hospedagem Builder.io {#builder-hosting}

Quando seu aplicativo está conectado ao Builder.io, os uploads de arquivos são automaticamente roteados para a hospedagem de ativos do Builder. Os arquivos são servidos a partir de um CDN sem necessidade de configuração. Esta é a configuração de produção recomendada.

## Provedores personalizados {#custom-providers}

Registre um provedor personalizado em um plug-in de servidor para usar qualquer back-end de armazenamento (S3, Cloudflare R2, GCS etc.):

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

## Carregar API {#upload-api}

A interface `FileUploadProvider`:

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

Use `uploadFile()` de `@agent-native/core/file-upload` em actions ou código do servidor:

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
  // No provider configured — handle fallback SQL yourself, or skip
}
```
