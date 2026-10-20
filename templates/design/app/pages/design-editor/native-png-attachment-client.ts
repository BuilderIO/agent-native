export type NativePngAttachment = {
  attachmentRef: string;
  bytes: number;
};

export async function uploadNativePngAttachment(args: {
  designId: string;
  requestId: string;
  documentId: string;
  tabId: string;
  png: Blob;
  signal: AbortSignal;
}): Promise<NativePngAttachment> {
  if (
    args.png.type !== "image/png" ||
    args.png.size < 1 ||
    args.png.size > 40_000_000
  )
    throw new Error("native-png-attachment-invalid");
  const form = new FormData();
  form.append("designId", args.designId);
  form.append("requestId", args.requestId);
  form.append("documentId", args.documentId);
  form.append("tabId", args.tabId);
  form.append(
    "file",
    new File([args.png], "design-native.png", { type: "image/png" }),
  );
  const response = await fetch("/api/native-png-attachment", {
    method: "POST",
    credentials: "same-origin",
    body: form,
    signal: args.signal,
  });
  const payload: unknown = await response.json();
  if (!response.ok || !payload || typeof payload !== "object")
    throw new Error("native-png-attachment-failed");
  const { attachmentRef, bytes } = payload as {
    attachmentRef?: unknown;
    bytes?: unknown;
  };
  if (
    typeof attachmentRef !== "string" ||
    !attachmentRef ||
    attachmentRef.length > 4096 ||
    bytes !== args.png.size
  )
    throw new Error("native-png-attachment-invalid");
  return { attachmentRef, bytes };
}
