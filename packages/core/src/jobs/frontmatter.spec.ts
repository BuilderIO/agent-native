import { describe, expect, it } from "vitest";

import {
  buildJobResourceContent,
  classifyJobResource,
  parseJobResource,
  type JobFrontmatter,
} from "./frontmatter.js";

describe("job resource frontmatter", () => {
  it("round-trips the complete recurring-job and automation field set", () => {
    const meta: JobFrontmatter = {
      schedule: "0 9 * * 1-5",
      enabled: true,
      triggerType: "schedule",
      event: "calendar.booking.created",
      condition: 'attendee says "yes"\nwith context',
      mode: "agentic",
      domain: "calendar",
      delegatedPolicyId: "calendar-safe:v1",
      createdBy: "alice@example.com",
      orgId: "org-1",
      runAs: "creator",
      lastRun: "2026-07-29T16:00:00.000Z",
      lastStatus: "error",
      lastError: 'Provider said "no"\nretry later',
      nextRun: "2026-07-30T16:00:00.000Z",
      originScopeId: "scope-1",
      deliveryPlatform: "slack",
      deliveryDestination: "C012345",
      deliveryThreadRef: "1785343277.030909",
      deliveryTenantId: "T012345",
      model: "claude-sonnet-4-5",
      mcpTools: ["mcp__calendar__list_events"],
    };

    const content = buildJobResourceContent(meta, "Run the automation.");
    const parsed = parseJobResource(content);

    expect(parsed.meta).toEqual(meta);
    expect(parsed.body).toBe("Run the automation.");
    expect(parsed.classification).toEqual({
      kind: "automation",
      hasExplicitTriggerType: true,
      triggerType: "schedule",
    });
  });

  it("round-trips a canonical manual automation without automatic trigger fields", () => {
    const content = buildJobResourceContent(
      {
        schedule: "",
        enabled: true,
        triggerType: "manual",
        mode: "agentic",
        createdBy: "alice@example.com",
        runAs: "creator",
      },
      "Run only when requested.",
    );

    expect(content).toContain("triggerType: manual");
    expect(content).not.toMatch(/^(event|condition|nextRun):/m);
    expect(parseJobResource(content)).toMatchObject({
      meta: {
        schedule: "",
        enabled: true,
        triggerType: "manual",
      },
      body: "Run only when requested.",
      classification: {
        kind: "automation",
        hasExplicitTriggerType: true,
        triggerType: "manual",
      },
    });
  });

  it("distinguishes legacy jobs from explicit scheduled automations", () => {
    const legacy = `---
schedule: "0 9 * * *"
enabled: true
---

Run the job.`;
    const automation = `---
schedule: "0 9 * * *"
enabled: true
triggerType: schedule
mode: agentic
---

Run the automation.`;

    expect(classifyJobResource(legacy)).toEqual({
      kind: "job",
      hasExplicitTriggerType: false,
      triggerType: "schedule",
    });
    expect(classifyJobResource(automation)).toEqual({
      kind: "automation",
      hasExplicitTriggerType: true,
      triggerType: "schedule",
    });
    expect(
      classifyJobResource(
        automation.replace("schedule\nmode", "unknown\nmode"),
      ),
    ).toEqual({
      kind: "automation",
      hasExplicitTriggerType: true,
      triggerType: "schedule",
    });
  });

  it("surfaces malformed persisted MCP capabilities", () => {
    expect(() =>
      parseJobResource(`---
schedule: "0 9 * * *"
enabled: true
mcpTools: ["https://example.com/not-a-tool"]
---

Run the job.`),
    ).toThrow(/mcpTools must contain only framework MCP tool names/);
  });
});
