import { firstPartyAppUrl } from "../components/deployment-links";

const FORMS_ORIGIN = firstPartyAppUrl("https://forms.agent-native.com");
const COMMUNITY_FORM_SLUG = "community-app-submission";
const SCREENSHOT_FIELD_ID = "screenshots";

export type CommunityUploadedFile = {
  url: string;
  name: string;
  type: string;
  size: number;
  id?: string;
  provider?: string;
};

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error("community form request failed");
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") {
    throw new Error("community form response was invalid");
  }
  return payload as T;
}

export async function uploadCommunityScreenshot(
  file: File,
): Promise<CommunityUploadedFile> {
  const body = new FormData();
  body.append("fieldId", SCREENSHOT_FIELD_ID);
  body.append("file", file);
  const response = await fetch(
    `${FORMS_ORIGIN}/api/upload/${COMMUNITY_FORM_SLUG}`,
    { method: "POST", body },
  );
  const uploaded = await readResponse<Partial<CommunityUploadedFile>>(response);
  if (
    typeof uploaded.url !== "string" ||
    !/^https?:\/\//i.test(uploaded.url) ||
    typeof uploaded.name !== "string" ||
    typeof uploaded.type !== "string" ||
    typeof uploaded.size !== "number"
  ) {
    throw new Error("community form upload response was invalid");
  }
  return uploaded as CommunityUploadedFile;
}

export async function submitCommunityApp(input: {
  data: Record<string, unknown>;
  pageUrl: string;
  idempotencyKey: string;
  pageLoadTime: number;
}): Promise<{ success: boolean; id?: string }> {
  const response = await fetch(
    `${FORMS_ORIGIN}/api/submit/${COMMUNITY_FORM_SLUG}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        data: input.data,
        _t: input.pageLoadTime,
        _meta: { pageUrl: input.pageUrl },
      }),
    },
  );
  return readResponse<{ success: boolean; id?: string }>(response);
}
