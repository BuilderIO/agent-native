import { describe, expect, it } from "vitest";

import { buildNewKeyOptions } from "./vault.js";

describe("buildNewKeyOptions", () => {
  it("excludes catalog entries explicitly marked non-secret", () => {
    const options = buildNewKeyOptions(
      [],
      [
        {
          appName: "Marketing",
          integrations: [
            {
              key: "ENABLE_BUILDER",
              label: "Enable Builder.io",
              required: false,
              secret: false,
            },
            { key: "RESEND_API_KEY", label: "Resend API key", required: false },
          ],
        },
      ],
      new Set(),
    );

    expect(options.map((o) => o.key)).toEqual(["RESEND_API_KEY"]);
  });

  it("keeps catalog entries with an unspecified secret flag", () => {
    const options = buildNewKeyOptions(
      [],
      [
        {
          appName: "Marketing",
          integrations: [
            { key: "HUBSPOT_ACCESS_TOKEN", label: "HubSpot", required: false },
          ],
        },
      ],
      new Set(),
    );

    expect(options.map((o) => o.key)).toEqual(["HUBSPOT_ACCESS_TOKEN"]);
  });

  it("still excludes keys already in the vault or registered as api-key secrets", () => {
    const options = buildNewKeyOptions(
      [{ key: "SLACK_TOKEN", label: "Slack", kind: "api-key" }],
      [
        {
          appName: "Marketing",
          integrations: [
            { key: "SLACK_TOKEN", label: "Slack", required: false },
            { key: "ALREADY_STORED", label: "Stored", required: false },
          ],
        },
      ],
      new Set(["ALREADY_STORED"]),
    );

    expect(options.map((o) => o.key)).toEqual(["SLACK_TOKEN"]);
  });
});
