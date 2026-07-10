---
"@agent-native/core": patch
---

Fix `.fig` and other binary files silently corrupting when uploaded through `index-design-system-with-builder`: `buildBuilderDesignSystemIndexFiles` always UTF-8-encoded file content even though `mimeTypeForBuilderDesignSystemFilename` already recognized `.fig` as binary (`application/octet-stream`). Add an optional per-file `encoding: "utf8" | "base64"` (defaults to `utf8`, unchanged for existing text-file callers) so binary files can be base64-encoded by the caller and decoded byte-exact here.
