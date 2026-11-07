import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveConnectorSecret } from "../connectors/credentials.js";
import { GitHubRequestError, createGitHubClient } from "./github-client.js";

vi.mock("../connectors/credentials.js", () => ({
  resolveConnectorSecret: vi.fn(),
}));

const mockedResolveConnectorSecret = vi.mocked(resolveConnectorSecret);

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

const repository = { owner: "acme", repo: "web" };

function clientOver(answer: () => Response | Promise<Response>) {
  const fetchImpl = vi.fn<typeof fetch>(async () => answer());
  return {
    fetchImpl,
    client: createGitHubClient({ ownerEmail: "owner@example.test", fetchImpl }),
  };
}

beforeEach(() => {
  mockedResolveConnectorSecret
    .mockReset()
    .mockImplementation(async (key) =>
      key === "GITHUB_TOKEN" ? "github-test-token" : undefined,
    );
});

describe("the GitHub client's issue writes", () => {
  it("adds labels with a POST of the list and returns the names the item carries", async () => {
    const { client, fetchImpl } = clientOver(() =>
      json([{ name: "triage" }, { name: "bug" }]),
    );

    await expect(
      client.addIssueLabels(repository, 12, ["triage", "bug"]),
    ).resolves.toEqual(["triage", "bug"]);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://api.github.com/repos/acme/web/issues/12/labels",
    );
    expect(init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ labels: ["triage", "bug"] }),
      headers: expect.objectContaining({
        Authorization: "Bearer github-test-token",
        "content-type": "application/json",
      }),
    });
    // A request that hangs ends, as an unknown outcome the caller reports.
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    // The token comes from the connector resolver, for this caller.
    expect(mockedResolveConnectorSecret).toHaveBeenCalledWith(
      "GITHUB_TOKEN",
      "owner@example.test",
      { orgId: undefined },
    );
  });

  it("never sends an empty list of labels, which GitHub reads as clearing them all", async () => {
    const { client, fetchImpl } = clientOver(() => json([]));

    await expect(client.addIssueLabels(repository, 12, [])).rejects.toThrow(
      "must not be empty",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an answer that is not a list of named labels, after the write, so it is not read as success", async () => {
    const { client } = clientOver(() => json({ message: "ok" }));

    await expect(
      client.addIssueLabels(repository, 12, ["bug"]),
    ).rejects.toThrow("label response was not an array");
  });

  it("removes a label by an encoded path, so a slash in a name cannot become a path segment", async () => {
    const { client, fetchImpl } = clientOver(() => json([{ name: "keep" }]));

    await expect(
      client.removeIssueLabel(repository, 12, "area/ui team"),
    ).resolves.toEqual({ removed: true, labels: ["keep"] });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://api.github.com/repos/acme/web/issues/12/labels/area%2Fui%20team",
    );
    expect(init?.method).toBe("DELETE");
  });

  it("reads GitHub's 404 'Label does not exist' as a label the item never had", async () => {
    const { client } = clientOver(() =>
      json({ message: "Label does not exist" }, 404),
    );

    await expect(
      client.removeIssueLabel(repository, 12, "nope"),
    ).resolves.toEqual({ removed: false, labels: null });
  });

  it("keeps any other 404 a failure: a missing issue is not a label the item lacked", async () => {
    const { client } = clientOver(() => json({ message: "Not Found" }, 404));

    await expect(
      client.removeIssueLabel(repository, 12, "triage"),
    ).rejects.toMatchObject({ name: "GitHubRequestError", status: 404 });
  });

  it("says the request never left when there is no credential", async () => {
    mockedResolveConnectorSecret.mockResolvedValue(undefined);
    const { client, fetchImpl } = clientOver(() => json([]));

    const error = await client
      .addIssueLabels(repository, 12, ["bug"])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GitHubRequestError);
    expect(error).toMatchObject({ requestAttempted: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a number that is not a positive whole one before anything is sent", async () => {
    const { client, fetchImpl } = clientOver(() => json({}));

    await expect(client.addIssueLabels(repository, -1, ["a"])).rejects.toThrow(
      "positive integer",
    );
    await expect(client.removeIssueLabel(repository, 1.5, "a")).rejects.toThrow(
      "positive integer",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
