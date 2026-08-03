import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAppProductionUrl: vi.fn(() => "https://clips.example"),
  sendEmail: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return {
    ...actual,
    getAppProductionUrl: mocks.getAppProductionUrl,
    sendEmail: mocks.sendEmail,
  };
});

import {
  formatClipDuration,
  normalizeEmailDisplayName,
  renderClipsTransactionalEmail,
  renderRecapSubject,
  sendClipsTransactionalEmail,
  type ClipsTransactionalEmailInput,
} from "./transactional-email-templates.js";

const renderOptions = { appUrl: "https://clips.example" };

function render(input: ClipsTransactionalEmailInput) {
  return renderClipsTransactionalEmail(input, renderOptions);
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("renderClipsTransactionalEmail", () => {
  it.each([
    {
      input: {
        kind: "first-view" as const,
        to: "owner@example.test",
        recordingId: "rec-1",
        title: "Product tour",
        viewerEmail: "jane.doe@example.test",
      },
      subject: "Your Clip “Product tour” got its first view",
      heading: "Someone watched your Clip",
      cta: "See Clip activity: https://clips.example/r/rec-1",
    },
    {
      input: {
        kind: "unviewed-reminder" as const,
        to: "viewer@example.test",
        recordingId: "rec-2",
        title: "Launch notes",
        senderEmail: "alex@example.test",
      },
      subject: "Still need to watch “Launch notes”?",
      heading: "Alex shared a Clip with you",
      cta: "Watch the Clip Manually: https://clips.example/r/rec-2",
    },
    {
      input: {
        kind: "first-import" as const,
        to: "owner@example.test",
        recordingId: "rec-3",
        title: "Imported demo",
      },
      subject: "Your first imported video is now Agent-Native",
      heading: "Your video is ready for more than playback",
      cta: "Open your Agent-Native Clip: https://clips.example/r/rec-3",
    },
    {
      input: {
        kind: "two-clips" as const,
        to: "viewer@example.test",
        generatedSummary:
          "Alex shared a product walkthrough, and Sam sent a launch update.",
      },
      subject: "You've received two Clips. What would you create?",
      heading: "You’ve received two Agent-Native Clips",
      cta: "Record an Agent-Native Clip: https://clips.example/record",
    },
  ])(
    "renders the approved $input.kind subject, heading, and CTA",
    (testCase) => {
      const result = render(testCase.input);

      expect(result.subject).toBe(testCase.subject);
      expect(result.html).toContain(testCase.heading);
      expect(result.text).toContain(testCase.heading);
      expect(result.text).toContain(testCase.cta);
    },
  );

  it("uses light high-contrast CTA buttons in every email", () => {
    const variants: ClipsTransactionalEmailInput[] = [
      {
        kind: "first-view",
        to: "owner@example.test",
        recordingId: "rec-1",
      },
      {
        kind: "unviewed-reminder",
        to: "viewer@example.test",
        recordingId: "rec-2",
      },
      {
        kind: "first-import",
        to: "owner@example.test",
        recordingId: "rec-3",
      },
      {
        kind: "two-clips",
        to: "viewer@example.test",
      },
    ];

    for (const input of variants) {
      const { html } = render(input);
      expect(html).toContain("background:#fafafa;");
      expect(html).toContain("color:#0a0a0c;");
    }
  });

  it("builds absolute URLs without losing or duplicating an app base path", () => {
    const input: ClipsTransactionalEmailInput = {
      kind: "first-view",
      to: "owner@example.test",
      recordingId: "rec/with space",
      title: "A Clip",
    };

    expect(
      renderClipsTransactionalEmail(input, {
        appUrl: "https://workspace.example",
        appBasePath: "/clips/",
      }).text,
    ).toContain(
      "See Clip activity: https://workspace.example/clips/r/rec%2Fwith%20space",
    );

    expect(
      renderClipsTransactionalEmail(input, {
        appUrl: "https://workspace.example/clips",
        appBasePath: "clips",
      }).text,
    ).toContain(
      "See Clip activity: https://workspace.example/clips/r/rec%2Fwith%20space",
    );
  });

  it("uses conservative display-name, viewer, sender, title, and summary fallbacks", () => {
    expect(normalizeEmailDisplayName("jane.doe@example.test", "Someone")).toBe(
      "Jane Doe",
    );
    expect(
      normalizeEmailDisplayName("team+clips@example.test", "Someone"),
    ).toBe("team+clips@example.test");
    expect(normalizeEmailDisplayName(undefined, "Someone")).toBe("Someone");

    const firstView = render({
      kind: "first-view",
      to: "owner@example.test",
      recordingId: "rec-1",
      title: "  ",
    });
    expect(firstView.subject).toBe(
      "Your Clip “Untitled Clip” got its first view",
    );
    expect(firstView.text).toContain(
      "Someone registered the first view of Untitled Clip.",
    );
    expect(firstView.text).toContain(
      "Clips tracks advanced analytics on your viewers' activity, and can even tell you whether your recipient took AI actions with your link. Come back to Clips to view analytics, or configure Clips AI to take agentic actions on your behalf.",
    );

    const reminder = render({
      kind: "unviewed-reminder",
      to: "viewer@example.test",
      recordingId: "rec-2",
    });
    expect(reminder.html).toContain("Someone shared a Clip with you");

    const twoClips = render({
      kind: "two-clips",
      to: "viewer@example.test",
    });
    expect(twoClips.text).toContain("Two people shared Clips with you");
  });

  it("includes the relevant Agent-Native benefit in every email", () => {
    const firstView = render({
      kind: "first-view",
      to: "owner@example.test",
      recordingId: "rec-1",
    });
    expect(firstView.text).toMatch(/advanced analytics/i);
    expect(firstView.text).toMatch(/AI actions/i);

    const reminder = render({
      kind: "unviewed-reminder",
      to: "viewer@example.test",
      recordingId: "rec-2",
    });
    expect(reminder.text).toMatch(/own AI agent/i);
    expect(reminder.text).toMatch(/summary/i);

    const firstImport = render({
      kind: "first-import",
      to: "owner@example.test",
      recordingId: "rec-3",
    });
    expect(firstImport.text).toMatch(/agent-readable context/i);
    expect(firstImport.text).toMatch(/speech/i);
    expect(firstImport.text).toMatch(/on-screen/i);

    const twoClips = render({
      kind: "two-clips",
      to: "viewer@example.test",
    });
    expect(twoClips.text).toMatch(/human viewing/i);
    expect(twoClips.text).toMatch(/AI agent use/i);
  });

  it("places treated Clip URLs around CTAs as requested", () => {
    const reminder = render({
      kind: "unviewed-reminder",
      to: "viewer@example.test",
      recordingId: "rec-2",
      title: "Launch notes",
      senderEmail: "alex@example.test",
      senderName: "Alex Rivera",
      brandLogoUrl: "/brand/org-logo.png",
    });
    const reminderIntro =
      "Don't have a moment to spare? Share the below link with your own AI agent and ask it for a summary:";
    expect(reminder.text).toContain(reminderIntro);
    expect(reminder.html).toContain("Alex Rivera shared a Clip with you");
    expect(reminder.html).toContain(
      'src="https://clips.example/brand/org-logo.png"',
    );
    expect(reminder.html.indexOf(reminderIntro)).toBeLessThan(
      reminder.html.indexOf("Watch the Clip Manually"),
    );
    expect(reminder.html).toContain(
      "border:1px solid #3f3f46; border-radius:10px; background:#0a0a0c;",
    );
    expect(reminder.html).toContain(">https://clips.example/r/rec-2</a>");
    expect(
      reminder.html.match(/href="https:\/\/clips\.example\/r\/rec-2"/g),
    ).toHaveLength(2);

    const firstImport = render({
      kind: "first-import",
      to: "owner@example.test",
      recordingId: "rec-3",
      title: "Imported demo",
    });
    const importIntro = "Or just feed this link to your own AI agent:";
    expect(firstImport.text).toContain(importIntro);
    expect(firstImport.html.indexOf(importIntro)).toBeGreaterThan(
      firstImport.html.indexOf("Open your Agent-Native Clip"),
    );
    expect(firstImport.html).toContain(">https://clips.example/r/rec-3</a>");
  });

  it("names the reading agent and falls back when it is unidentified", () => {
    const named = render({
      kind: "first-agent-view",
      to: "owner@example.test",
      recordingId: "rec-4",
      title: "Deploy walkthrough",
      agentName: "Claude",
    });
    expect(named.subject).toBe("An AI agent “watched” your Clip");
    expect(named.text).toContain(
      "Claude accessed Deploy walkthrough today — the full transcript and the frames, not just the title.",
    );
    expect(named.text).toMatch(/two formats/i);
    expect(named.text).toMatch(/answers questions without you/i);
    expect(named.html).toContain('href="https://clips.example/r/rec-4"');

    const unidentified = render({
      kind: "first-agent-view",
      to: "owner@example.test",
      recordingId: "rec-4",
      title: "Deploy walkthrough",
    });
    expect(unidentified.text).toContain(
      "An AI agent accessed Deploy walkthrough today",
    );
  });

  it("offers both the analytics and import calls to action", () => {
    const result = render({
      kind: "first-agent-view",
      to: "owner@example.test",
      recordingId: "rec-4",
      title: "Deploy walkthrough",
      agentName: "Claude",
    });

    expect(result.text).toContain(
      "You can even import videos from other screen recording apps to give them agentic readability.",
    );
    expect(result.html).toContain("See Clip Analytics");
    expect(result.html).toContain("Import a video");
    expect(result.html).toContain('href="https://clips.example/r/rec-4"');
    expect(result.html).toContain('href="https://clips.example/record"');
  });

  it("builds the recap subject around whichever audience showed up", () => {
    expect(renderRecapSubject(9, 4, "2026-07")).toBe(
      "9 people and 4 agents watched your clips in July",
    );
    expect(renderRecapSubject(1, 1, "2026-07")).toBe(
      "1 person and 1 agent watched your clips in July",
    );
    expect(renderRecapSubject(9, 0, "2026-07")).toBe(
      "9 people watched your clips in July",
    );
    expect(renderRecapSubject(0, 4, "2026-07")).toBe(
      "4 agents read your clips in July",
    );
  });

  it("formats clip durations as minutes and padded seconds", () => {
    expect(formatClipDuration(0)).toBe("0:00");
    expect(formatClipDuration(9_000)).toBe("0:09");
    expect(formatClipDuration(252_000)).toBe("4:12");
  });

  it("renders the recap card, both numbers, and both calls to action", () => {
    const result = render({
      kind: "monthly-recap",
      to: "owner@example.test",
      month: "2026-07",
      humanViewers: 9,
      agentSessions: 4,
      topClip: {
        recordingId: "rec-top",
        title: "Deploy walkthrough",
        thumbnailUrl: "https://cdn.example/thumb.jpg",
        durationMs: 252_000,
        recordedAt: "2026-07-12T00:00:00.000Z",
        humanViewers: 9,
        agentSessions: 4,
      },
      copy: {
        heroLine: "9 people watched your clip. 4 agents read it.",
        agentBreakdown: "3 from Claude · 1 from ChatGPT",
        completionNote: "71% average completion · most stopped at 4:12",
      },
    });

    expect(result.subject).toBe(
      "9 people and 4 agents watched your clips in July",
    );
    expect(result.html).toContain(
      "9 people watched your clip. 4 agents read it.",
    );
    expect(result.html).toContain('src="https://cdn.example/thumb.jpg"');
    expect(result.html).toContain("Deploy walkthrough");
    expect(result.html).toContain("Jul 12 · 4:12");
    expect(result.html).toContain("Watched");
    expect(result.html).toContain("Read");
    expect(result.html).toContain(
      "71% average completion · most stopped at 4:12",
    );
    expect(result.html).toContain("3 from Claude · 1 from ChatGPT");
    expect(result.html).toContain("Here’s your top Clip of the month:");
    expect(result.html).not.toContain("Record the next one");
    expect(result.html).toContain('href="https://clips.example/r/rec-top"');
    expect(result.html).toContain('href="https://clips.example/record"');
    expect(result.text).toContain("View more Clips Analytics");
    expect(result.text).toContain("Record a new Clip");
  });

  it("omits the thumbnail rather than emitting a broken image", () => {
    const result = render({
      kind: "monthly-recap",
      to: "owner@example.test",
      month: "2026-07",
      humanViewers: 0,
      agentSessions: 2,
      topClip: {
        recordingId: "rec-top",
        title: "Deploy walkthrough",
        thumbnailUrl: null,
        durationMs: 60_000,
        recordedAt: "2026-07-12T00:00:00.000Z",
        humanViewers: 0,
        agentSessions: 2,
      },
      copy: {
        heroLine: "2 agents read your clip.",
        agentBreakdown: "Claude 2",
        completionNote: "No human viewers yet",
      },
    });

    expect(result.subject).toBe("2 agents read your clips in July");
    expect(result.html).not.toContain('alt="Deploy walkthrough"');
    expect(result.html).toContain("Deploy walkthrough");
  });

  it("escapes hostile AI recap copy instead of trusting it as HTML", () => {
    const result = render({
      kind: "monthly-recap",
      to: "owner@example.test",
      month: "2026-07",
      humanViewers: 1,
      agentSessions: 1,
      topClip: {
        recordingId: "rec-top",
        title: "</a><script>bad()</script>",
        thumbnailUrl: 'https://cdn.example/t.jpg" onerror="steal()',
        durationMs: 1_000,
        recordedAt: "2026-07-12T00:00:00.000Z",
        humanViewers: 1,
        agentSessions: 1,
      },
      copy: {
        heroLine: "1 person watched.",
        agentBreakdown: '<img src=x onerror="steal()">',
        completionNote: "50% completion",
      },
    });

    expect(result.html).not.toContain("<script>bad()</script>");
    expect(result.html).not.toContain("<img src=x");
    expect(result.html).not.toContain('onerror="steal()"');
    expect(result.html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
  });

  it("escapes a hostile generated summary instead of trusting it as HTML", () => {
    const hostile =
      'Alex shared </strong><img src=x onerror="steal()"><script>bad()</script>.';
    const result = render({
      kind: "two-clips",
      to: "viewer@example.test",
      generatedSummary: hostile,
    });

    expect(result.html).not.toContain("<img src=x");
    expect(result.html).not.toContain("<script>bad()</script>");
    expect(result.html).not.toContain('onerror="steal()"');
    expect(result.html).toContain(
      "&lt;img src=x onerror=&quot;steal()&quot;&gt;",
    );
    expect(result.text).toContain(hostile);
  });
});

describe("sendClipsTransactionalEmail", () => {
  it("renders with the production URL/base path and sends the result", async () => {
    mocks.getAppProductionUrl.mockReturnValue("https://workspace.example");
    vi.stubEnv("APP_BASE_PATH", "/clips");

    await sendClipsTransactionalEmail({
      kind: "first-import",
      to: "owner@example.test",
      recordingId: "rec-1",
      title: "Imported demo",
    });

    expect(mocks.getAppProductionUrl).toHaveBeenCalledOnce();
    expect(mocks.sendEmail).toHaveBeenCalledWith({
      to: "owner@example.test",
      subject: "Your first imported video is now Agent-Native",
      html: expect.stringContaining(
        'href="https://workspace.example/clips/r/rec-1"',
      ),
      text: expect.stringContaining(
        "Open your Agent-Native Clip: https://workspace.example/clips/r/rec-1",
      ),
      from: '"Agent-Native Clips" <Clips@Agent-Native.com>',
      replyTo: "hello@agent-native.com",
      timeoutMs: 60_000,
    });
  });

  it("sends reminders from the originator identity with their Reply-To", async () => {
    mocks.getAppProductionUrl.mockReturnValue("https://workspace.example");

    await sendClipsTransactionalEmail({
      kind: "unviewed-reminder",
      to: "viewer@example.test",
      recordingId: "rec-2",
      title: "Launch notes",
      senderEmail: "alex@example.com",
      senderName: "Alex Rivera",
      brandLogoUrl: "/api/media/org-logo.png",
    });

    expect(mocks.sendEmail).toHaveBeenCalledWith({
      to: "viewer@example.test",
      subject: "Still need to watch “Launch notes”?",
      html: expect.stringContaining(
        'src="https://workspace.example/api/media/org-logo.png"',
      ),
      text: expect.stringContaining("Alex Rivera shared a Clip with you"),
      from: '"Alex Rivera (via Agent-Native Clips)" <Clips@Agent-Native.com>',
      replyTo: "alex@example.com",
      timeoutMs: 60_000,
    });
  });

  it("sends the first-agent-view note under the Clips sender name", async () => {
    mocks.getAppProductionUrl.mockReturnValue("https://workspace.example");

    await sendClipsTransactionalEmail({
      kind: "first-agent-view",
      to: "owner@example.test",
      recordingId: "rec-4",
      title: "Deploy walkthrough",
      agentName: "Claude",
    });

    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.test",
        subject: "An AI agent “watched” your Clip",
        from: '"Agent-Native Clips" <Clips@Agent-Native.com>',
        replyTo: "hello@agent-native.com",
      }),
    );
  });
});
