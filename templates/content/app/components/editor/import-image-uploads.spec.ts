import { describe, expect, it, vi } from "vitest";

import { uploadPickedImages } from "./import-image-uploads";

function deferred() {
  let resolve!: (url: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const image = (name: string) => new File(["x"], name, { type: "image/png" });

describe("uploadPickedImages", () => {
  it("uploads three images at a time and returns each url by name", async () => {
    const files = ["a.png", "b.png", "c.png", "d.png", "e.png"].map(image);
    const pending = new Map<string, ReturnType<typeof deferred>>();
    const upload = vi.fn((file: File) => {
      const next = deferred();
      pending.set(file.name, next);
      return next.promise;
    });

    const done = uploadPickedImages(files, new Map(), upload);
    expect(upload.mock.calls.map(([file]) => file.name)).toEqual([
      "a.png",
      "b.png",
      "c.png",
    ]);
    pending.get("a.png")!.resolve("/uploads/a.png");
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(4));
    for (const name of ["b.png", "c.png", "d.png"]) {
      pending.get(name)!.resolve(`/uploads/${name}`);
    }
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(5));
    pending.get("e.png")!.resolve("/uploads/e.png");

    expect(Object.fromEntries(await done)).toEqual({
      "a.png": "/uploads/a.png",
      "b.png": "/uploads/b.png",
      "c.png": "/uploads/c.png",
      "d.png": "/uploads/d.png",
      "e.png": "/uploads/e.png",
    });
  });

  it("starts nothing new after a failure, and a retry reuses uploads still running", async () => {
    const files = ["a.png", "b.png", "c.png", "d.png"].map(image);
    const pending = new Map<string, ReturnType<typeof deferred>>();
    const upload = vi.fn((file: File) => {
      const next = deferred();
      pending.set(file.name, next);
      return next.promise;
    });
    const uploads = new Map<File, Promise<string>>();

    const first = uploadPickedImages(files, uploads, upload);
    pending.get("b.png")!.reject(new Error("offline"));
    await expect(first).rejects.toThrow("offline");
    pending.get("a.png")!.resolve("/uploads/a.png");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(upload.mock.calls.map(([file]) => file.name)).toEqual([
      "a.png",
      "b.png",
      "c.png",
    ]);

    const retry = uploadPickedImages(files, uploads, upload);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(4));
    pending.get("b.png")!.resolve("/uploads/b-again.png");
    pending.get("c.png")!.resolve("/uploads/c.png");
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(5));
    pending.get("d.png")!.resolve("/uploads/d.png");

    expect(Object.fromEntries(await retry)).toEqual({
      "a.png": "/uploads/a.png",
      "b.png": "/uploads/b-again.png",
      "c.png": "/uploads/c.png",
      "d.png": "/uploads/d.png",
    });
    expect(upload.mock.calls.map(([file]) => file.name)).toEqual([
      "a.png",
      "b.png",
      "c.png",
      "b.png",
      "d.png",
    ]);
  });
});
