export type FileUploadStatusProbe = "configured" | "missing" | "unavailable";

export type FileUploadStatus =
  | { state: "configured" }
  | { state: "missing"; builderReauthorizationRequired: boolean }
  | { state: "unavailable" };

export async function readFileUploadStatus(
  response: Response,
): Promise<FileUploadStatus> {
  if (!response.ok) return { state: "unavailable" };

  const body = (await response.json().catch(() => null)) as {
    configured?: unknown;
    builderReauthorizationRequired?: unknown;
  } | null;
  if (typeof body?.configured !== "boolean") {
    return { state: "unavailable" };
  }
  return body.configured
    ? { state: "configured" }
    : {
        state: "missing",
        builderReauthorizationRequired:
          body.builderReauthorizationRequired === true,
      };
}

export async function readFileUploadStatusProbe(
  response: Response,
): Promise<FileUploadStatusProbe> {
  return (await readFileUploadStatus(response)).state;
}
