import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: unknown) => options,
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { isNameTaken } from "../../free-name/index.js";
import { useCreateResource } from "./use-resources.js";

type CreateOptions = {
  mutationFn: (body: {
    path: string;
    content?: string;
    uniquePath?: boolean;
  }) => Promise<unknown>;
};

function create(body: { path: string; uniquePath?: boolean }) {
  return (useCreateResource() as unknown as CreateOptions).mutationFn(body);
}

describe("useCreateResource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("asks for a free path and returns the resource stored there", async () => {
    const saved = { id: "r1", path: "notes-2.md" };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(saved), { status: 201 }),
    );

    await expect(
      create({ path: "notes.md", uniquePath: true }),
    ).resolves.toEqual(saved);
    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      path: "notes.md",
      uniquePath: true,
    });
  });

  it("shows why a create onto a taken name was refused, with the free name", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'A resource named "notes.md" already exists.',
          errorCode: "name_taken",
          details: { name: "notes.md", suggestion: "notes-2.md" },
        }),
        { status: 409, statusText: "Conflict" },
      ),
    );

    const error = await create({ path: "notes.md", uniquePath: true }).catch(
      (caught: unknown) => caught,
    );
    expect((error as Error).message).toBe(
      'A resource named "notes.md" already exists.',
    );
    expect(isNameTaken(error)).toBe(true);
  });

  it("names the failed create when the server sends no message", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("<html>", { status: 502, statusText: "Bad Gateway" }),
    );

    await expect(create({ path: "notes.md" })).rejects.toThrow(
      "Create failed: Bad Gateway",
    );
  });
});
