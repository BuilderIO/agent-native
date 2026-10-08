export type FileUploadStatusProbe = "configured" | "missing" | "unavailable";

export type FileUploadStatus =
  | { state: "configured" }
  | { state: "missing"; builderReauthorizationRequired: boolean }
  | { state: "unavailable" };

export async function readFileUploadStatus(
  response: Response,
): Promise<FileUploadStatus> {
  if (!response.ok) return { state: "unavailable" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { state: "unavailable" };
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { configured?: unknown }).configured !== "boolean"
  ) {
    return { state: "unavailable" };
  }
  const status = body as {
    configured: boolean;
    builderReauthorizationRequired?: unknown;
  };
  return status.configured
    ? { state: "configured" }
    : {
        state: "missing",
        builderReauthorizationRequired:
          status.builderReauthorizationRequired === true,
      };
}

export async function readFileUploadStatusProbe(
  response: Response,
): Promise<FileUploadStatusProbe> {
  return (await readFileUploadStatus(response)).state;
}
