import { describe, expect, it } from "vitest";

import {
  describeSourceConfigIssues,
  isSlackDirectMessageRef,
  isValidGitHubRepoRef,
  isValidSlackChannelRef,
  normalizeGitHubRepoRef,
  parseSourceListInput,
  sourceListValues,
  validateGitHubRepoInput,
  validateSlackChannelInput,
  validateSourceConfig,
} from "./source-config-validation.js";

const GARBLED_PASTE = "http://slack.com/channel](http://slack.com/channel)";

describe("slack channel refs", () => {
  it("accepts conversation IDs and #names", () => {
    for (const value of [
      "C0123456789",
      "G01ABCDEFGH",
      "#product",
      "product",
      "eng-team_2",
      "#日本語",
      "команда",
    ]) {
      expect(isValidSlackChannelRef(value), value).toBe(true);
    }
  });

  it("rejects the reported markdown paste artifact", () => {
    expect(isValidSlackChannelRef(GARBLED_PASTE)).toBe(false);
  });

  it("rejects URLs, whitespace, punctuation, uppercase names, and overlong names", () => {
    for (const value of [
      "https://slack.com/channel",
      "slack.com/channel",
      "my channel",
      "#Product",
      "channel,name",
      "<#C0123456789>",
      "a".repeat(81),
      "#",
      "@someone",
    ]) {
      expect(isValidSlackChannelRef(value), value).toBe(false);
    }
  });

  it("rejects direct-message IDs, which the connector drops as unusable", () => {
    expect(isValidSlackChannelRef("D0123456789")).toBe(false);
    expect(isSlackDirectMessageRef("D0123456789")).toBe(true);
    expect(isSlackDirectMessageRef("#d0123456789")).toBe(true);
    expect(isSlackDirectMessageRef("C0123456789")).toBe(false);

    const issues = validateSourceConfig("slack", {
      channelIds: ["D0123456789"],
    });
    expect(issues[0]?.code).toBe("slack_direct_message");
    expect(describeSourceConfigIssues(issues)).toContain("not DMs");
  });

  it("rejects emoji and symbols, which no Slack channel name can contain", () => {
    for (const value of ["🚀-launches", "team✅", "a+b", "price$"]) {
      expect(isValidSlackChannelRef(value), value).toBe(false);
    }
  });

  it("reports the line each bad entry came from", () => {
    const issues = validateSlackChannelInput(
      `C0123456789\n${GARBLED_PASTE}\n#product\nmy channel`,
    );

    expect(issues).toEqual([
      {
        field: "slackChannels",
        code: "invalid_slack_channel",
        value: GARBLED_PASTE,
        line: 2,
      },
      {
        field: "slackChannels",
        code: "invalid_slack_channel",
        value: "my channel",
        line: 4,
      },
    ]);
  });

  it("returns no issues for a clean allow-list", () => {
    expect(
      validateSlackChannelInput("C0123456789\n#product\n#launches\n"),
    ).toEqual([]);
  });
});

describe("github repo refs", () => {
  it("accepts owner/repo and github.com URLs", () => {
    expect(normalizeGitHubRepoRef("BuilderIO/agent-native")).toBe(
      "BuilderIO/agent-native",
    );
    expect(
      normalizeGitHubRepoRef("https://github.com/BuilderIO/agent-native.git"),
    ).toBe("BuilderIO/agent-native");
    expect(
      normalizeGitHubRepoRef("git@github.com:BuilderIO/agent-native"),
    ).toBe("BuilderIO/agent-native");
  });

  it("rejects values that are not repository references", () => {
    for (const value of [
      "agent-native",
      "owner repo",
      GARBLED_PASTE,
      "https://example.com/owner/repo",
      "",
    ]) {
      expect(isValidGitHubRepoRef(value), value).toBe(false);
    }
  });

  it("normalizes the bare-host form instead of reading the host as the owner", () => {
    expect(normalizeGitHubRepoRef("github.com/BuilderIO/agent-native")).toBe(
      "BuilderIO/agent-native",
    );
    expect(
      normalizeGitHubRepoRef("www.github.com/BuilderIO/agent-native"),
    ).toBe("BuilderIO/agent-native");
  });

  it("rejects a non-GitHub host rather than reading it as the owner", () => {
    expect(normalizeGitHubRepoRef("example.com/owner/repo")).toBeNull();
    expect(normalizeGitHubRepoRef("https://example.com/owner/repo")).toBeNull();
  });

  it("keeps the connector's tolerance for deep-linked repository paths", () => {
    expect(
      normalizeGitHubRepoRef(
        "https://github.com/BuilderIO/agent-native/tree/main",
      ),
    ).toBe("BuilderIO/agent-native");
  });

  it("flags bad rows instead of dropping them", () => {
    expect(
      validateGitHubRepoInput("BuilderIO/agent-native\nagent-native"),
    ).toEqual([
      {
        field: "githubRepositories",
        code: "invalid_github_repository",
        value: "agent-native",
        line: 2,
      },
    ]);
  });
});

describe("parseSourceListInput", () => {
  it("keeps the typed line for comma-separated entries and skips blanks", () => {
    expect(parseSourceListInput("a, b\n\n c \n")).toEqual([
      { value: "a", line: 1 },
      { value: "b", line: 1 },
      { value: "c", line: 3 },
    ]);
  });

  it("strips a leading # when producing config values", () => {
    expect(sourceListValues("#product\nC0123456789")).toEqual([
      "product",
      "C0123456789",
    ]);
  });
});

describe("validateSourceConfig", () => {
  it("rejects a slack config carrying the garbled entry", () => {
    expect(
      validateSourceConfig("slack", { channelIds: [GARBLED_PASTE] }),
    ).toHaveLength(1);
  });

  it("reads slack aliases and nested config", () => {
    expect(
      validateSourceConfig("slack", { allowedChannels: "my channel" }),
    ).toHaveLength(1);
    expect(
      validateSourceConfig("slack", { slack: { channels: [GARBLED_PASTE] } }),
    ).toHaveLength(1);
  });

  it("rejects a github config carrying a non-repository entry", () => {
    expect(
      validateSourceConfig("github", { repositories: ["agent-native"] }),
    ).toHaveLength(1);
  });

  it("ignores providers and patches that do not carry a list field", () => {
    expect(validateSourceConfig("slack", { pollMinutes: 60 })).toEqual([]);
    expect(validateSourceConfig("manual", { channelIds: ["nope!"] })).toEqual(
      [],
    );
    expect(
      validateSourceConfig("github", { channelIds: [GARBLED_PASTE] }),
    ).toEqual([]);
  });

  it("accepts a valid config", () => {
    expect(
      validateSourceConfig("slack", {
        channelIds: ["C0123456789", "product"],
        pollMinutes: 60,
      }),
    ).toEqual([]);
  });
});

describe("action and drawer parity", () => {
  const cases: Array<[string, unknown[], string]> = [
    ["blank string entry", [""], ""],
    ["whitespace-only entry", ["   "], "   "],
    ["hash-only entry", ["#"], "#"],
    ["bracket artifact", ["]"], "]"],
    ["number entry", [123], ""],
    ["null entry", [null], ""],
    ["object entry", [{ id: "C0123456789" }], ""],
  ];

  for (const [label, values, drawerText] of cases) {
    it(`rejects a ${label} on both paths`, () => {
      expect(
        validateSourceConfig("slack", { channelIds: values }),
        "action path",
      ).toHaveLength(1);
      expect(
        validateSourceConfig("github", { repositories: values }),
        "action path",
      ).toHaveLength(1);
      if (drawerText.trim()) {
        expect(
          validateSlackChannelInput(drawerText),
          "drawer path",
        ).toHaveLength(1);
      }
    });
  }

  it("flags a non-string entry with its own code, not a format error", () => {
    const issues = validateSourceConfig("github", { repositories: [123] });
    expect(issues[0]?.code).toBe("not_a_string");
  });

  it("does not drop a valid entry sitting beside an invalid one", () => {
    expect(
      validateSourceConfig("slack", { channelIds: ["C0123456789", ""] }),
    ).toHaveLength(1);
    expect(
      validateSourceConfig("github", {
        repositories: ["BuilderIO/agent-native", 7],
      }),
    ).toHaveLength(1);
  });

  it("still treats a delimited string like the textarea", () => {
    expect(
      validateSourceConfig("slack", { channelIds: "product,,launches" }),
    ).toEqual([]);
    expect(validateSlackChannelInput("product,,launches")).toEqual([]);
  });

  it("checks aliased and nested keys the same way", () => {
    expect(
      validateSourceConfig("slack", { allowedChannels: ["#"] }),
    ).toHaveLength(1);
    expect(
      validateSourceConfig("slack", { slack: { channels: [42] } }),
    ).toHaveLength(1);
    expect(
      validateSourceConfig("github", { github: { repos: [""] } }),
    ).toHaveLength(1);
  });
});

describe("describeSourceConfigIssues", () => {
  it("names the offending entry and the accepted format", () => {
    const message = describeSourceConfigIssues(
      validateSourceConfig("slack", { channelIds: [GARBLED_PASTE] }),
    );

    expect(message).toContain(GARBLED_PASTE);
    expect(message).toContain("C0123456789");
  });

  it("covers both fields when both are wrong", () => {
    const message = describeSourceConfigIssues([
      ...validateSourceConfig("slack", { channelIds: ["my channel"] }),
      ...validateSourceConfig("github", { repositories: ["agent-native"] }),
    ]);

    expect(message).toContain("Slack channel");
    expect(message).toContain("GitHub repository");
  });

  it("is empty for a valid config", () => {
    expect(
      describeSourceConfigIssues(
        validateSourceConfig("slack", { channelIds: ["C0123456789"] }),
      ),
    ).toBe("");
  });
});
