import { fail } from "@agent-native/core/action";

import { isHubSpotEmailHtml } from "./hubspot-email.js";

export function assertHubSpotEmailFrameContent({
  content,
  fileType,
  previousContent,
}: {
  content: string;
  fileType: string;
  previousContent?: string;
}): void {
  const marked = isHubSpotEmailHtml(content);
  if (previousContent && isHubSpotEmailHtml(previousContent) && !marked) {
    fail("Preserve the HubSpot email frame marker when editing this frame.", {
      statusCode: 422,
      errorCode: "hubspot_email_marker_required",
    });
  }
  if (marked && fileType !== "html") {
    fail("HubSpot email frames must be HTML files.", {
      statusCode: 422,
      errorCode: "hubspot_email_html_required",
    });
  }
}
