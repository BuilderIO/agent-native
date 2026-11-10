import { fail } from "@agent-native/core/action";

import { HUBSPOT_EMAIL_FRAME_TYPE } from "./hubspot-email.js";
import type { ScreenFrameType } from "./screen-frame-type.js";

export function assertHubSpotEmailFileType({
  fileType,
  frameType,
}: {
  fileType: string;
  frameType: ScreenFrameType | null;
}): void {
  if (frameType === HUBSPOT_EMAIL_FRAME_TYPE && fileType !== "html") {
    fail("HubSpot email frames must be HTML files.", {
      statusCode: 422,
      errorCode: "hubspot_email_html_required",
    });
  }
}
