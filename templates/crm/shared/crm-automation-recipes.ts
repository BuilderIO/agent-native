export const CLIPS_CALL_EVIDENCE_RECIPE_ID = "clips-call-evidence-review";

const CLIPS_PAGE_PATH = /\/(?:share|r)\/[^/]+\/?$/i;
const UNSAFE_CLIPS_QUERY_KEY =
  /^(?:access|expires|password|signature|sig|token)$/i;
const MEDIA_PATH =
  /\/(?:api\/video|api\/agent-transcript|api\/public-recording)\b|\.(?:m4a|mov|mp3|mp4|wav|webm)(?:\/)?$/i;

export interface CrmAutomationRecipe {
  id: typeof CLIPS_CALL_EVIDENCE_RECIPE_ID;
  title: string;
  description: string;
  enabledByDefault: false;
  triggerEvent: "clip.created";
  automationName: string;
  recordId: string;
  handoff: {
    sourceApp: "clips";
    artifactType: "call-evidence";
    requiresExplicitRecordSelection: true;
    requiresDurablePageUrl: true;
    excludes: readonly ["event url", "media", "transcript"];
  };
  agentContext: string;
}

export function isDurableClipsEvidenceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      MEDIA_PATH.test(url.pathname) ||
      !CLIPS_PAGE_PATH.test(url.pathname)
    ) {
      return false;
    }
    return ![...url.searchParams.keys()].some((key) =>
      UNSAFE_CLIPS_QUERY_KEY.test(key),
    );
  } catch {
    return false;
  }
}

function automationNameForRecord(recordId: string): string {
  const suffix = recordId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `crm-clips-review-${suffix || "record"}`;
}

function xmlText(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  );
}

function jsonForXml(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

export function buildClipsCallEvidenceRecipe(input: {
  recordId: string;
  recordLabel?: string;
}): CrmAutomationRecipe {
  const automationName = automationNameForRecord(input.recordId);
  const recordLabel = xmlText(
    input.recordLabel?.trim() || "the selected CRM record",
  );
  const recordId = xmlText(input.recordId);
  const automationBody = `Setting up CRM-to-Clips call automations isn't available yet. Do not define or enable a call automation for CRM record ${JSON.stringify(input.recordId)}.`;
  const activationCall = {
    agent: "clips",
    message: `The ${automationName} setup request is unavailable. ${automationBody}`,
  };
  return {
    id: CLIPS_CALL_EVIDENCE_RECIPE_ID,
    title: "Review new Clips calls",
    description:
      "Setting up CRM-to-Clips call automations isn't available yet.",
    enabledByDefault: false,
    triggerEvent: "clip.created",
    automationName,
    recordId: input.recordId,
    handoff: {
      sourceApp: "clips",
      artifactType: "call-evidence",
      requiresExplicitRecordSelection: true,
      requiresDurablePageUrl: true,
      excludes: ["event url", "media", "transcript"],
    },
    agentContext: `<crm-automation-recipe id="${CLIPS_CALL_EVIDENCE_RECIPE_ID}">
The user selected ${recordLabel} (CRM record ID: ${recordId}) for a Clips call-evidence review recipe.

Setting up CRM-to-Clips call automations isn't available yet. Tell the user this and stop setup.

Do not delegate setup through call-agent, define or enable an automation, or direct the user to set it up manually. This remains unavailable if the user approves or asks again.

Unavailable setup context only. Do not send this request:

${jsonForXml(activationCall)}
</crm-automation-recipe>`,
  };
}
