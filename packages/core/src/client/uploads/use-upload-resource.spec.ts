import { beforeEach, describe, expect, it, vi } from "vitest";

const { invalidateQueriesMock } = vi.hoisted(() => ({
  invalidateQueriesMock: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: unknown) => options,
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));

import { isNameTaken } from "../../free-name/index.js";
import { actionErrorMessage } from "../use-action.js";
import { useUploadResource } from "./use-upload-resource.js";

type UploadOptions = {
  mutationFn: (formData: FormData) => Promise<unknown>;
  onSuccess: () => void;
};

function upload(formData = new FormData()) {
  const options = useUploadResource() as unknown as UploadOptions;
  return options.mutationFn(formData);
}

describe("useUploadResource", () => {
  beforeEach(() => {
    invalidateQueriesMock.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("posts the form and returns the saved resource, then refreshes the list", async () => {
    const saved = { id: "r1", path: "/notes-2.md" };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(saved), { status: 200 }),
    );
    const formData = new FormData();
    formData.set("path", "/notes.md");

    await expect(upload(formData)).resolves.toEqual(saved);
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/_agent-native/resources/upload");
    expect(init).toMatchObject({ method: "POST", body: formData });

    (useUploadResource() as unknown as UploadOptions).onSuccess();
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["resources"],
    });
  });

  it("shows why an upload onto a taken name was refused, with the free name", async () => {
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

    const error = await upload().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'A resource named "notes.md" already exists.',
    );
    expect(actionErrorMessage(error)).toBe((error as Error).message);
    expect(error).toMatchObject({ status: 409 });
    expect(isNameTaken(error)).toBe(true);
  });

  it("names the failed upload when the server sends no message", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("<html>", { status: 502, statusText: "Bad Gateway" }),
    );

    await expect(upload()).rejects.toThrow("Upload failed: Bad Gateway");
  });
});
