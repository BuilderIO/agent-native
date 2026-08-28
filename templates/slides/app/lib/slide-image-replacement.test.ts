// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  applyOptimisticImagePreview,
  createPlaceholderImageTarget,
  hasOptimisticImagePreview,
  insertDroppedImageIntoSlideHtml,
  insertImageIntoSlideHtml,
  replaceOptimisticImagePreview,
  replaceImageTargetInSlideHtml,
  stripOptimisticImagePreviews,
} from "./slide-image-replacement";

function firstImage(html: string): HTMLImageElement | null {
  return new DOMParser()
    .parseFromString(html, "text/html")
    .querySelector("img");
}

describe("slide image replacement", () => {
  it("replaces only the optimistic preview image", () => {
    const html = `<div class="fmd-slide"><img src="blob:preview" alt="Preview"><img src="/placeholder.png" alt="Placeholder"><div class="fmd-img-placeholder">Image</div></div>`;

    const updated = replaceOptimisticImagePreview(
      html,
      "blob:preview",
      "/uploads/final.png",
    );
    const doc = new DOMParser().parseFromString(updated, "text/html");

    expect(doc.querySelector('img[src="/uploads/final.png"]')).not.toBeNull();
    expect(doc.querySelector('img[src="/placeholder.png"]')).not.toBeNull();
    expect(doc.querySelector(".fmd-img-placeholder")).not.toBeNull();
  });

  it("removes the optimistic preview when upload fails", () => {
    const html = `<div class="fmd-slide"><img src="blob:preview" alt="Preview"><img src="/other.png" alt="Other"></div>`;

    const updated = replaceOptimisticImagePreview(html, "blob:preview", null);

    expect(updated).not.toContain("blob:preview");
    expect(updated).toContain("/other.png");
  });

  it("is a no-op when the preview source is absent", () => {
    const html = `<div class="fmd-slide"><img src="/other.png" alt="Other"></div>`;

    expect(
      replaceOptimisticImagePreview(html, "blob:preview", "/final.png"),
    ).toBe(html);
  });

  it("rebases an optimistic preview onto the latest slide content", () => {
    const preview = {
      previewSrc: "blob:preview",
      replaceSrc: null,
      alt: "preview.png",
      position: { x: 200, y: 120 },
      objectId: "preview-object",
    };
    const latest = `<div class="fmd-slide"><h1>Edited while uploading</h1></div>`;
    const withPreview = applyOptimisticImagePreview(latest, preview);

    expect(withPreview).toContain("Edited while uploading");
    expect(hasOptimisticImagePreview(withPreview, "blob:preview")).toBe(true);
    expect(applyOptimisticImagePreview(withPreview, preview)).toBe(withPreview);
  });

  it("strips concurrent previews without dropping the latest slide edit", () => {
    const previews = [
      { previewSrc: "blob:first", replaceSrc: null },
      { previewSrc: "blob:second", replaceSrc: null },
    ];
    const withPreviews = previews.reduce(
      (content, preview) => applyOptimisticImagePreview(content, preview),
      `<div class="fmd-slide"><p>Later edit</p></div>`,
    );
    const persisted = stripOptimisticImagePreviews(withPreviews, previews);

    expect(persisted).toContain("Later edit");
    expect(persisted).not.toContain("blob:first");
    expect(persisted).not.toContain("blob:second");
  });

  it("restores an existing image while persisting edits made during replacement", () => {
    const preview = {
      previewSrc: "blob:replacement",
      replaceSrc: "/old.png",
      alt: "replacement.png",
    };
    const withPreview = applyOptimisticImagePreview(
      `<div class="fmd-slide"><p>Edited copy</p><img src="/old.png" alt="Old"></div>`,
      preview,
    );
    const persisted = stripOptimisticImagePreviews(withPreview, [preview]);

    expect(persisted).toContain("Edited copy");
    expect(persisted).toContain('src="/old.png"');
    expect(persisted).not.toContain("blob:replacement");
  });

  it("replaces a clicked placeholder target with an uploaded image", () => {
    const html = `<div class="fmd-slide"><div class="fmd-img-placeholder" style="width: 100%; height: 100%;">Hero image</div></div>`;
    const updated = replaceImageTargetInSlideHtml(
      html,
      createPlaceholderImageTarget(0, "Hero image"),
      "/uploads/user/photo.jpg",
      { alt: "photo.jpg" },
    );
    const img = firstImage(updated);

    expect(updated).not.toContain("fmd-img-placeholder");
    expect(img?.getAttribute("src")).toBe("/uploads/user/photo.jpg");
    expect(img?.getAttribute("alt")).toBe("photo.jpg");
    expect(img?.classList.contains("fmd-img-uploaded")).toBe(true);
  });

  it("replaces an existing image src", () => {
    const html = `<div class="fmd-slide"><img src="/old.png" alt="Old"></div>`;
    const updated = replaceImageTargetInSlideHtml(
      html,
      "/old.png",
      "/uploads/new.png",
      { alt: "New" },
    );
    const img = firstImage(updated);

    expect(img?.getAttribute("src")).toBe("/uploads/new.png");
    expect(img?.getAttribute("alt")).toBe("New");
  });

  it("drops into the first placeholder when no target is selected", () => {
    const html = `<div class="fmd-slide"><h1>Slide</h1><div class="fmd-img-placeholder">Image description</div></div>`;
    const updated = insertImageIntoSlideHtml(html, "/uploads/drop.png", {
      alt: "drop.png",
    });
    const img = firstImage(updated);

    expect(updated).not.toContain("fmd-img-placeholder");
    expect(img?.getAttribute("src")).toBe("/uploads/drop.png");
  });

  it("adds a positioned background layer when the slide has no placeholder at all", () => {
    const html = `<div class="fmd-slide"><h1>Slide with no image</h1></div>`;
    const updated = insertImageIntoSlideHtml(html, "/uploads/drop.png");
    const doc = new DOMParser().parseFromString(updated, "text/html");
    const img = doc.querySelector("img");
    const slideRoot = doc.querySelector(".fmd-slide") as HTMLElement | null;

    expect(img?.getAttribute("src")).toBe("/uploads/drop.png");
    // Must not become a plain flex-flow sibling of the existing content
    // (the slide is a flex column), or it visually squishes everything else.
    expect(img?.getAttribute("style")).toContain("position: absolute");
    expect(slideRoot?.getAttribute("style")).toContain("position: relative");
    expect(doc.querySelector("h1")).not.toBeNull();
  });

  it("inserts a desktop drop as an absolute object at the drop point", () => {
    const html = `<div class="fmd-slide"><h1>Slide</h1></div>`;
    const updated = insertDroppedImageIntoSlideHtml(html, "/uploads/drop.png", {
      alt: "drop.png",
      position: { x: 640, y: 360 },
    });
    const doc = new DOMParser().parseFromString(updated, "text/html");
    const img = doc.querySelector("img");

    expect(img?.getAttribute("src")).toBe("/uploads/drop.png");
    expect(img?.getAttribute("alt")).toBe("drop.png");
    expect(img?.getAttribute("data-slide-object-id")).toBeTruthy();
    expect(img?.getAttribute("style")).toContain("position: absolute");
    expect(img?.getAttribute("style")).toContain("left: 480px");
    expect(img?.getAttribute("style")).toContain("top: 270px");
    expect(img?.getAttribute("style")).toContain("width: 320px");
    expect(img?.getAttribute("style")).toContain("height: 180px");
    expect(img?.getAttribute("style")).toContain("z-index: 1");
  });

  it("keeps Markdown source intact when inserting a dropped image", () => {
    const updated = insertDroppedImageIntoSlideHtml(
      "# Slide title\n\nBody copy",
      "/uploads/drop.png",
      { position: { x: 200, y: 120 } },
    );

    expect(updated).toContain("# Slide title");
    expect(updated).toContain("Body copy");
    expect(updated).toContain('src="/uploads/drop.png"');
    expect(updated).toContain("position: absolute");
  });
});
