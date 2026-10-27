import { fail } from "@agent-native/core/action";

import { isHubSpotEmailHtml } from "./hubspot-email.js";

export function assertHubSpotEmailFrameContent({
  content,
  fileType,
  frameType,
  previousContent,
}: {
  content: string;
  fileType: string;
  frameType?: "hubspot-email";
  previousContent?: string;
}): void {
  const marked = isHubSpotEmailHtml(content);
  if (frameType === "hubspot-email" && !marked) {
    fail(
      'A HubSpot email frame requires <meta name="agent-native:frame-type" content="hubspot-email"> in its HTML head. Rebuild the content using the HubSpot email specification before saving.',
      { statusCode: 422, errorCode: "hubspot_email_marker_required" },
    );
  }
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
