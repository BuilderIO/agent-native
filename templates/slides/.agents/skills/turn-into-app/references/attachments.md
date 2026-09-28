# Dispatch Handoff Attachments

When calling `start-workspace-app-creation`, pass source files in the `attachments` argument rather than embedding their bytes in `prompt`.

## Uploaded files

Images and PDFs use an upload attachment with a matching base64 data URL:

```ts
{
  type: "upload",
  contentType: "image/webp" | "image/png" | "image/jpeg" | "image/gif" | "application/pdf",
  name: string,
  dataUrl: "data:<contentType>;base64,<BASE64_CONTENT>",
  size: number,
  id: string
}
```

Text and JSON files provide decoded contents instead of a data URL:

```ts
{
  type: "upload",
  contentType: "text/plain" | "application/json",
  name: string,
  dataUrl: "",
  text: string,
  size: number,
  id: string
}
```

Set `size` to the UTF-8 byte length of `text`. Use a stable or unique `id` for each attachment.

## Public URLs

For an existing public file that Builder can fetch, use:

```ts
{
  type: "url",
  value: "https://..."
}
```

Do not pass private, localhost, or internal-network URLs.

## Handoff behavior

Keep the original task in `prompt` and tell the Builder agent how each attachment should be used. Put multiple attachments in the same `attachments` array. Attachments are model context only and are not copied into the generated app's workspace.
