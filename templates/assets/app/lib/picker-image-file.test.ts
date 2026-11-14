import { describe, expect, it, vi } from "vitest";

import {
  readChosenPickerImage,
  type ChosenPickerImage,
} from "./picker-image-file";

const chosen = new Map<string, ChosenPickerImage>([
  [
    "asset-1",
    {
      url: "https://assets.example.com/api/assets/asset-1/content",
      title: "Hero",
      mimeType: "image/png",
    },
  ],
]);

function imageResponse(type = "image/png") {
  return new Response(new Blob([new Uint8Array([1, 2, 3])], { type }), {
    status: 200,
  });
}

describe("readChosenPickerImage", () => {
  it("reads the file of an image the user chose", async () => {
    const fetchImage = vi.fn(async () => imageResponse());

    const file = await readChosenPickerImage(
      chosen,
      { assetId: "asset-1" },
      fetchImage as unknown as typeof fetch,
    );

    expect(fetchImage).toHaveBeenCalledWith(
      "https://assets.example.com/api/assets/asset-1/content",
      { credentials: "omit" },
    );
    expect(file.filename).toBe("Hero");
    expect(file.mimeType).toBe("image/png");
    expect(file.blob.size).toBe(3);
  });

  it("refuses an asset the user didn't choose, without reading it", async () => {
    const fetchImage = vi.fn(async () => imageResponse());

    await expect(
      readChosenPickerImage(
        chosen,
        { assetId: "asset-2" },
        fetchImage as unknown as typeof fetch,
      ),
    ).rejects.toThrow("Only an image chosen in this picker can be read.");
    await expect(
      readChosenPickerImage(
        chosen,
        null,
        fetchImage as unknown as typeof fetch,
      ),
    ).rejects.toThrow("Only an image chosen in this picker can be read.");
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it("fails when the library refuses the read or returns something else", async () => {
    await expect(
      readChosenPickerImage(
        chosen,
        { assetId: "asset-1" },
        (async () =>
          new Response("no", { status: 401 })) as unknown as typeof fetch,
      ),
    ).rejects.toThrow("The image could not be read (401).");
    await expect(
      readChosenPickerImage(chosen, { assetId: "asset-1" }, (async () =>
        imageResponse("text/html")) as unknown as typeof fetch),
    ).rejects.toThrow("The chosen asset is not an image.");
  });
});
