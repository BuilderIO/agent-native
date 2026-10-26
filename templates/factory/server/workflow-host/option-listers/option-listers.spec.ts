import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/action", () => ({
  isAgentConnectionRequiredError: () => false,
}));
vi.mock("../../lib/provider-api.js", () => ({
  executeProviderApiRequest: vi.fn(),
}));

import { githubRepositories } from "./github-repositories.js";
import { listProviderOptions } from "./registry.js";
import { sentryOrganizations } from "./sentry-organizations.js";
import { sentryProjects } from "./sentry-projects.js";
import { slackChannels } from "./slack-channels.js";
import {
  InvalidCursorError,
  OptionListError,
  type OptionLister,
  type ProviderHttp,
  type ProviderHttpResponse,
} from "./types.js";

function answer(
  json: unknown,
  extra: Partial<ProviderHttpResponse> = {},
): ProviderHttpResponse {
  const status = extra.status ?? 200;
  return {
    status,
    ok: extra.ok ?? (status >= 200 && status < 300),
    truncated: false,
    json,
    headers: {},
    ...extra,
  };
}

function serving(...answers: ProviderHttpResponse[]) {
  const calls: { path: string; query?: Readonly<Record<string, string>> }[] =
    [];
  const queue = [...answers];
  const http: ProviderHttp = async (request) => {
    calls.push(request);
    const next = queue.shift();
    if (!next) throw new Error("No more answers.");
    return next;
  };
  return { http, calls };
}

async function failureOf(call: Promise<unknown>): Promise<OptionListError> {
  try {
    await call;
  } catch (error) {
    if (error instanceof OptionListError) return error;
    throw error;
  }
  throw new Error("Expected the list to fail.");
}

const slackOk = (channels: unknown[], next = "") =>
  answer({ ok: true, channels, response_metadata: { next_cursor: next } });

describe("slack channels", () => {
  it("lists channels by name, marks private ones and ones the bot is not in, and carries the cursor", async () => {
    const { http, calls } = serving(
      slackOk(
        [
          { id: "C2", name: "random", is_private: false, is_member: false },
          { id: "G1", name: "alerts", is_private: true, is_member: true },
          { id: "C3", name: "general", is_member: true },
        ],
        "next-page",
      ),
    );
    const page = await slackChannels.list(http, { cursor: "page-two" });
    expect(page.options).toEqual([
      { value: "G1", label: "#alerts", hint: "G1", tags: ["private"] },
      { value: "C3", label: "#general", hint: "C3" },
      { value: "C2", label: "#random", hint: "C2", tags: ["bot_not_member"] },
    ]);
    expect(page.nextCursor).toBe("next-page");
    expect(calls[0].path).toBe("/conversations.list");
    expect(calls[0].query).toMatchObject({
      limit: "100",
      exclude_archived: "true",
      cursor: "page-two",
    });
  });

  it("returns an empty list with no cursor when the bot sees no channel", async () => {
    const { http } = serving(slackOk([]));
    expect(await slackChannels.list(http, {})).toEqual({ options: [] });
  });

  it("says a missing permission, with the permission, instead of an empty list", async () => {
    const { http } = serving(
      answer({ ok: false, error: "missing_scope", needed: "groups:read" }),
    );
    const error = await failureOf(slackChannels.list(http, {}));
    expect(error).toMatchObject({
      code: "credential_missing",
      reason: "missing_scope",
      scope: "groups:read",
    });
  });

  it("treats Slack's auth words and HTTP 401 as a refused credential", async () => {
    const word = await failureOf(
      slackChannels.list(
        serving(answer({ ok: false, error: "invalid_auth" })).http,
        {},
      ),
    );
    expect(word).toMatchObject({
      code: "credential_missing",
      reason: "refused",
    });
    const status = await failureOf(
      slackChannels.list(serving(answer({}, { status: 401 })).http, {}),
    );
    expect(status).toMatchObject({
      code: "credential_missing",
      reason: "refused",
      status: 401,
    });
  });

  it("types a rate limit, with how long to wait", async () => {
    const { http } = serving(
      answer({}, { status: 429, retryAfterSeconds: 30 }),
    );
    const error = await failureOf(slackChannels.list(http, {}));
    expect(error).toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: 30,
      retryable: true,
    });
  });

  it("types any other provider error as unreadable and echoes only its plain word", async () => {
    const plain = await failureOf(
      slackChannels.list(
        serving(answer({ ok: false, error: "internal_error" })).http,
        {},
      ),
    );
    expect(plain).toMatchObject({ code: "provider_unreadable" });
    expect(plain.message).toContain("internal_error");
    const odd = await failureOf(
      slackChannels.list(
        serving(answer({ ok: false, error: "oops-1234-hidden" })).http,
        {},
      ),
    );
    expect(odd.message).not.toContain("1234");
  });

  it("refuses a list it cannot read whole or parse", async () => {
    const cut = await failureOf(
      slackChannels.list(
        serving(answer({ ok: true, channels: [] }, { truncated: true })).http,
        {},
      ),
    );
    expect(cut.code).toBe("provider_unreadable");
    const odd = await failureOf(
      slackChannels.list(serving(slackOk([{ id: "C1" }])).http, {}),
    );
    expect(odd.code).toBe("provider_unreadable");
  });
});

describe("sentry organizations and projects", () => {
  const link = (cursor: string, more: boolean) =>
    `<https://sentry.io/api/0/x/?cursor=0:0:1>; rel="previous"; results="false"; cursor="0:0:1", <https://sentry.io/api/0/x/?cursor=${cursor}>; rel="next"; results="${more}"; cursor="${cursor}"`;

  it("lists organizations by name with the slug as detail, and follows the Link header", async () => {
    const { http } = serving(
      answer(
        [
          { slug: "builder", name: "Builder" },
          { slug: "acme", name: "acme" },
        ],
        { headers: { link: link("0:100:0", true) } },
      ),
    );
    const page = await sentryOrganizations.list(http, {});
    expect(page.options).toEqual([
      { value: "builder", label: "Builder", hint: "builder" },
      { value: "acme", label: "acme" },
    ]);
    expect(page.nextCursor).toBe("0:100:0");
  });

  it("stops when the Link header says nothing follows", async () => {
    const { http } = serving(
      answer([], { headers: { link: link("0:100:0", false) } }),
    );
    expect(await sentryOrganizations.list(http, {})).toEqual({ options: [] });
  });

  it("lists projects as organization/project, in the organization it was given", async () => {
    const { http, calls } = serving(
      answer([
        { slug: "agent-native-browser", name: "Agent-Native Browser" },
        { slug: "api" },
      ]),
    );
    const page = await sentryProjects.list(http, { parent: "builder" });
    expect(page.options).toEqual([
      {
        value: "builder/agent-native-browser",
        label: "Agent-Native Browser",
        hint: "builder/agent-native-browser",
      },
      { value: "builder/api", label: "api", hint: "builder/api" },
    ]);
    expect(calls[0].path).toBe("/organizations/builder/projects/");
  });

  it("encodes the organization into the path", async () => {
    const { http, calls } = serving(answer([]));
    await sentryProjects.list(http, { parent: "a b" });
    expect(calls[0].path).toBe("/organizations/a%20b/projects/");
  });

  it("refuses a project list without an organization", async () => {
    await expect(sentryProjects.list(serving().http, {})).rejects.toThrow(
      TypeError,
    );
  });

  it("types an unauthorized token and a provider outage", async () => {
    const refused = await failureOf(
      sentryOrganizations.list(
        serving(answer({ detail: "no" }, { status: 403 })).http,
        {},
      ),
    );
    expect(refused).toMatchObject({
      code: "credential_missing",
      reason: "refused",
    });
    const down = await failureOf(
      sentryProjects.list(serving(answer({}, { status: 503 })).http, {
        parent: "builder",
      }),
    );
    expect(down).toMatchObject({
      code: "provider_unreadable",
      status: 503,
      retryable: true,
    });
  });

  it("refuses a list that is not the documented shape", async () => {
    const error = await failureOf(
      sentryOrganizations.list(serving(answer({ organizations: [] })).http, {}),
    );
    expect(error.code).toBe("provider_unreadable");
  });
});

describe("github repositories", () => {
  it("lists owner/name with private and archived marked, and asks for the next page while GitHub links one", async () => {
    const { http, calls } = serving(
      answer(
        [
          { full_name: "acme/web", private: true },
          { full_name: "acme/old", archived: true },
          { full_name: "acme/docs", private: false, archived: false },
        ],
        {
          headers: {
            link: '<https://api.github.com/user/repos?page=3>; rel="next"',
          },
        },
      ),
    );
    const page = await githubRepositories.list(http, { cursor: "2" });
    expect(page.options).toEqual([
      { value: "acme/web", label: "acme/web", tags: ["private"] },
      { value: "acme/old", label: "acme/old", tags: ["archived"] },
      { value: "acme/docs", label: "acme/docs" },
    ]);
    expect(page.nextCursor).toBe("3");
    expect(calls[0].path).toBe("/user/repos");
    expect(calls[0].query).toMatchObject({ per_page: "100", page: "2" });
  });

  it("ends with no cursor on the last page, and on an empty account", async () => {
    expect(await githubRepositories.list(serving(answer([])).http, {})).toEqual(
      { options: [] },
    );
  });

  it("types an unauthorized token and a rate limit", async () => {
    const refused = await failureOf(
      githubRepositories.list(serving(answer({}, { status: 403 })).http, {}),
    );
    expect(refused).toMatchObject({
      code: "credential_missing",
      reason: "refused",
    });
    const limited = await failureOf(
      githubRepositories.list(serving(answer({}, { status: 429 })).http, {}),
    );
    expect(limited.code).toBe("rate_limited");
  });

  it("types GitHub's primary and secondary rate limits, sent as a 403, as rate_limited", async () => {
    const primary = await failureOf(
      githubRepositories.list(
        serving(
          answer(
            { message: "API rate limit exceeded for user ID 1." },
            { status: 403 },
          ),
        ).http,
        {},
      ),
    );
    expect(primary).toMatchObject({
      code: "rate_limited",
      status: 403,
      retryable: true,
    });
    const secondary = await failureOf(
      githubRepositories.list(
        serving(
          answer(
            {
              message:
                "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
            },
            { status: 403, retryAfterSeconds: 60 },
          ),
        ).http,
        {},
      ),
    );
    expect(secondary).toMatchObject({
      code: "rate_limited",
      status: 403,
      retryAfterSeconds: 60,
    });
    const hintOnly = await failureOf(
      githubRepositories.list(
        serving(answer({}, { status: 403, retryAfterSeconds: 0 })).http,
        {},
      ),
    );
    expect(hintOnly).toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: 0,
    });
  });

  it("keeps a plain 403 and a 401 a refused credential", async () => {
    for (const [status, message] of [
      [403, "Bad credentials"],
      [403, "Resource not accessible by personal access token"],
      [401, "Bad credentials"],
    ] as const) {
      const error = await failureOf(
        githubRepositories.list(
          serving(answer({ message }, { status })).http,
          {},
        ),
      );
      expect(error).toMatchObject({
        code: "credential_missing",
        reason: "refused",
        status,
      });
    }
  });

  it("refuses a cursor that is not a page number and a repository with no owner", async () => {
    await expect(
      githubRepositories.list(serving().http, { cursor: "abc" }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
    const odd = await failureOf(
      githubRepositories.list(
        serving(answer([{ full_name: "no-owner" }])).http,
        {},
      ),
    );
    expect(odd.code).toBe("provider_unreadable");
  });
});

describe("listProviderOptions", () => {
  const paged: OptionLister = {
    provider: "slack",
    resource: "channels",
    async list(_http, { cursor }) {
      const page = Number(cursor ?? "1");
      return {
        options: [
          { value: `C${page}a`, label: `#alpha-${page}` },
          { value: `C${page}b`, label: `#beta-${page}` },
        ],
        ...(page < 8 ? { nextCursor: String(page + 1) } : {}),
      };
    },
  };
  const http = serving().http;

  it("returns one page, with its cursor, when there is no search", async () => {
    const page = await listProviderOptions(paged, http, {});
    expect(page.options).toHaveLength(2);
    expect(page.nextCursor).toBe("2");
  });

  it("scans a bounded number of pages for a search and returns where it stopped", async () => {
    const page = await listProviderOptions(paged, http, { search: "BETA" });
    expect(page.options.map((option) => option.value)).toEqual([
      "C1b",
      "C2b",
      "C3b",
      "C4b",
      "C5b",
    ]);
    expect(page.nextCursor).toBe("6");
  });

  it("matches the stored value and the detail, not only the label", async () => {
    const page = await listProviderOptions(paged, http, { search: "c2a" });
    expect(page.options.map((option) => option.value)).toEqual(["C2a"]);
  });

  it("ends a search with no cursor once the list runs out", async () => {
    const page = await listProviderOptions(paged, http, {
      search: "alpha-8",
      cursor: "7",
    });
    expect(page.options.map((option) => option.value)).toEqual(["C8a"]);
    expect(page.nextCursor).toBeUndefined();
  });
});
