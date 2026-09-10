export const CLIP_INTAKE_RESOURCE_KIND = "clip-intake";
export const CLIP_INTAKE_TOKEN_PARAM = "clip_intake";
export const CLIP_INTAKE_ID_PARAM = "clip_intake_id";
export const CLIP_INTAKE_DEFAULT_TTL_SECONDS = 60 * 60;
export const CLIP_INTAKE_MAX_TTL_SECONDS = 4 * 60 * 60;

export interface ClipIntakeParams {
  intakeId: string;
  token: string;
}

function queryValue(params: URLSearchParams, key: string): string | null {
  const value = params.get(key)?.trim() ?? "";
  return value || null;
}

export function parseClipIntakeParams(
  params: URLSearchParams,
): ClipIntakeParams | null {
  const intakeId = queryValue(params, CLIP_INTAKE_ID_PARAM);
  const token = queryValue(params, CLIP_INTAKE_TOKEN_PARAM);
  if (!intakeId || !token) return null;
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(intakeId)) return null;
  if (token.length > 4096 || /[\r\n]/.test(token)) return null;
  return { intakeId, token };
}

export function buildClipIntakeUrl(
  path: string,
  params: ClipIntakeParams & {
    recordingId: string;
    operation: "chunk" | "abort";
  },
): string {
  const url = new URL(path, "https://clips-intake.invalid");
  url.searchParams.set("recordingId", params.recordingId);
  url.searchParams.set("operation", params.operation);
  url.searchParams.set(CLIP_INTAKE_ID_PARAM, params.intakeId);
  url.searchParams.set(CLIP_INTAKE_TOKEN_PARAM, params.token);
  return `${url.pathname}${url.search}`;
}
