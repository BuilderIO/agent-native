// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  applyOptimisticImagePreview,
  captureOptimisticImagePreview,
  createPlaceholderImageTarget,
  hasOptimisticImagePreview,
  imageOccurrenceInRenderedSlide,
  insertDroppedImageIntoSlideHtml,
  insertImageIntoSlideHtml,
  normalizeImageObjectPosition,
  replaceOptimisticImagePreview,
  replaceImageTargetInSlideHtml,
  stripOptimisticImagePreviews,
  updateImageFitInSlideHtml,
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

  it("keeps a queued slide edit when upload completion beats the next render", () => {
    const preview = {
      previewSrc: "blob:preview",
      replaceSrc: null,
      alt: "preview.png",
      position: { x: 200, y: 120 },
      objectId: "preview-object",
    };
    const latest = `<div class="fmd-slide"><h1>Edited while uploading</h1></div>`;
    const withPreview = applyOptimisticImagePreview(latest, preview);
    const completed = replaceOptimisticImagePreview(
      withPreview,
      preview.previewSrc,
      "/uploads/final.png",
    );

    expect(completed).toContain("Edited while uploading");
    expect(completed).toContain('src="/uploads/final.png"');
    expect(hasOptimisticImagePreview(completed, "blob:preview")).toBe(false);
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

  it("keeps moved and resized geometry when the upload replaces a preview", () => {
    const preview = {
      previewSrc: "blob:edited",
      replaceSrc: null,
      objectId: "preview-object",
      position: { x: 200, y: 120 },
    };
    const editedContent = `<div class="fmd-slide"><img src="blob:edited" alt="photo.png" data-slide-object-id="preview-object" style="position: absolute; left: 123px; top: 87px; width: 512px; height: 300px; object-fit: contain;"></div>`;
    const editedPreview = captureOptimisticImagePreview(editedContent, preview);
    const withoutPreview = stripOptimisticImagePreviews(editedContent, [
      editedPreview,
    ]);
    const completed = replaceOptimisticImagePreview(
      applyOptimisticImagePreview(withoutPreview, editedPreview),
      "blob:edited",
      "/uploads/photo.png",
    );
    const image = firstImage(completed);

    expect(withoutPreview).not.toContain("blob:edited");
    expect(image?.getAttribute("src")).toBe("/uploads/photo.png");
    expect(image?.getAttribute("style")).toContain("left: 123px");
    expect(image?.getAttribute("style")).toContain("top: 87px");
    expect(image?.getAttribute("style")).toContain("width: 512px");
    expect(image?.getAttribute("style")).toContain("height: 300px");
  });

  it("keeps placeholder uploads resolvable after edited content is persisted", () => {
    const replaceSrc = createPlaceholderImageTarget(0, "Hero image");
    const preview = {
      previewSrc: "blob:placeholder",
      replaceSrc,
      alt: "hero.png",
    };
    const editedContent = `<div class="fmd-slide"><img src="blob:placeholder" alt="hero.png" data-slide-object-id="placeholder-object" style="position: absolute; left: 123px; top: 87px; width: 512px; height: 300px; object-fit: contain;"></div>`;
    const editedPreview = captureOptimisticImagePreview(editedContent, preview);
    const persisted = stripOptimisticImagePreviews(editedContent, [
      editedPreview,
    ]);
    const withPreview = applyOptimisticImagePreview(persisted, editedPreview);
    const completed = replaceOptimisticImagePreview(
      withPreview,
      preview.previewSrc,
      "/uploads/hero.png",
    );
    const image = firstImage(completed);

    expect(persisted).toContain('class="fmd-img-placeholder"');
    expect(persisted).toContain("Hero image");
    expect(persisted).not.toContain("blob:placeholder");
    expect(image?.getAttribute("src")).toBe("/uploads/hero.png");
    expect(image?.getAttribute("data-slide-object-id")).toBe(
      "placeholder-object",
    );
    expect(image?.getAttribute("style")).toContain("left: 123px");
    expect(image?.getAttribute("style")).toContain("width: 512px");
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

  it("updates fit and position when the image URL contains escaped query params", () => {
    const src = "https://cdn.example.com/chart.png?width=800&height=400";
    const html = `<div class="fmd-slide"><img src="https://cdn.example.com/chart.png?width=800&amp;height=400" style="width: 100%; height: 100%; object-fit: contain;"></div>`;
    const updated = updateImageFitInSlideHtml(html, src, {
      objectFit: "cover",
      objectPosition: "right bottom",
    });
    const img = firstImage(updated);

    expect(img?.getAttribute("src")).toBe(src);
    expect(img?.style.objectFit).toBe("cover");
    expect(img?.style.objectPosition).toBe("right bottom");
  });

  it("keeps HTML image ranges intact when quoted attributes contain greater-than text", () => {
    const src = "https://cdn.example.com/chart.png";
    const html = `<div class="fmd-slide"><img src="${src}" alt="Revenue &gt; target > margin" style="object-fit: contain;"></div>`;
    const img = firstImage(
      updateImageFitInSlideHtml(html, src, { objectFit: "cover" }),
    );

    expect(img?.getAttribute("alt")).toBe("Revenue > target > margin");
    expect(img?.style.objectFit).toBe("cover");
    expect(img?.parentElement?.tagName).toBe("DIV");
  });

  it("updates the selected duplicate image", () => {
    const src = "https://cdn.example.com/shared.png";
    const html = `<div class="fmd-slide"><img src="${src}" style="object-fit: contain;"><img src="${src}" style="object-fit: contain;"></div>`;
    const doc = new DOMParser().parseFromString(
      updateImageFitInSlideHtml(
        html,
        src,
        { objectFit: "cover", objectPosition: "right bottom" },
        1,
      ),
      "text/html",
    );
    const images = doc.querySelectorAll("img");

    expect(images[0]?.style.objectFit).toBe("contain");
    expect(images[1]?.style.objectFit).toBe("cover");
    expect(images[1]?.style.objectPosition).toBe("right bottom");
  });

  it("persists fit and position for a Markdown image", () => {
    const src = "https://cdn.example.com/chart.png?width=800&height=400";
    const updated = updateImageFitInSlideHtml(`![Chart](${src})`, src, {
      objectFit: "cover",
      objectPosition: "right bottom",
    });
    const img = firstImage(updated);

    expect(img?.getAttribute("src")).toBe(src);
    expect(img?.getAttribute("alt")).toBe("Chart");
    expect(img?.getAttribute("data-markdown-image")).toBe("true");
    expect(img?.style.display).toBe("block");
    expect(img?.style.width).toBe("100%");
    expect(img?.style.aspectRatio).toBe("16 / 9");
    expect(img?.style.objectFit).toBe("cover");
    expect(img?.style.objectPosition).toBe("right bottom");
  });

  it("counts duplicate rendered images across both two-column panes", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="slide-content"><img src="/shared.png"></div>' +
      '<div class="slide-content"><img src="/shared.png"></div>';
    const secondImage = root.querySelectorAll<HTMLImageElement>("img")[1];

    expect(imageOccurrenceInRenderedSlide(root, secondImage!)).toBe(1);
  });

  it("adds cover when only a Markdown image crop position changes", () => {
    const src = "https://cdn.example.com/chart.png";
    const img = firstImage(
      updateImageFitInSlideHtml(`![Chart](${src})`, src, {
        objectPosition: "left top",
      }),
    );

    expect(img?.style.objectFit).toBe("cover");
    expect(img?.style.objectPosition).toBe("left top");
  });

  it("matches entity-encoded and escaped Markdown destinations", () => {
    const entitySrc = "https://cdn.example.com/chart.png?width=800&height=400";
    const entityImage = firstImage(
      updateImageFitInSlideHtml(
        `![Chart](https://cdn.example.com/chart.png?width=800&amp;height=400)`,
        entitySrc,
        { objectFit: "cover" },
      ),
    );
    const escapedSrc = "https://cdn.example.com/chart(1).png";
    const escapedImage = firstImage(
      updateImageFitInSlideHtml(
        String.raw`![Chart](https://cdn.example.com/chart\(1\).png)`,
        escapedSrc,
        { objectFit: "cover" },
      ),
    );

    expect(entityImage?.getAttribute("src")).toBe(entitySrc);
    expect(escapedImage?.getAttribute("src")).toBe(escapedSrc);
  });

  it("matches Markdown destinations with balanced parentheses", () => {
    const src = "https://cdn.example.com/chart_(final).png";
    const img = firstImage(
      updateImageFitInSlideHtml(`![Chart](${src})`, src, {
        objectFit: "cover",
        objectPosition: "right bottom",
      }),
    );

    expect(img?.getAttribute("src")).toBe(src);
    expect(img?.style.objectFit).toBe("cover");
    expect(img?.style.objectPosition).toBe("right bottom");
  });

  it.each([
    ["full reference", "![Chart][revenue]"],
    ["collapsed reference", "![revenue][]"],
    ["shortcut reference", "![revenue]"],
  ])("matches %s Markdown images", (_label, imageMarkdown) => {
    const src = "https://cdn.example.com/chart.png";
    const img = firstImage(
      updateImageFitInSlideHtml(`${imageMarkdown}\n\n[revenue]: ${src}`, src, {
        objectFit: "cover",
        objectPosition: "left top",
      }),
    );

    expect(img?.getAttribute("src")).toBe(src);
    expect(img?.style.objectFit).toBe("cover");
    expect(img?.style.objectPosition).toBe("left top");
  });

  it("matches Markdown images with escaped brackets in their alt text", () => {
    const src = "https://cdn.example.com/chart.png";
    const img = firstImage(
      updateImageFitInSlideHtml(
        String.raw`![Quarterly \[draft\]](${src})`,
        src,
        { objectFit: "cover" },
      ),
    );

    expect(img?.getAttribute("src")).toBe(src);
    expect(img?.style.objectFit).toBe("cover");
  });

  it("ignores image syntax in code and HTML attributes when counting duplicates", () => {
    const src = "https://cdn.example.com/shared.png";
    const html = [
      "```markdown",
      `![Fenced example](${src})`,
      `<img src="${src}" alt="Fenced example">`,
      "```",
      `\`![Inline example](${src}) <img src="${src}" alt="Inline example">\``,
      `<span data-example="![Attribute example](${src}) <img src='${src}' alt='Attribute example'>">Text</span>`,
      `<code>![HTML code example](${src}) <img src="${src}" alt="HTML code example"></code>`,
      `<pre>![HTML pre example](${src}) <img src="${src}" alt="HTML pre example"></pre>`,
      `![Rendered image](${src})`,
    ].join("\n");
    const updated = updateImageFitInSlideHtml(
      html,
      src,
      { objectFit: "cover", objectPosition: "right bottom" },
      0,
    );

    expect(updated).toContain(`![Fenced example](${src})`);
    expect(updated).toContain(`<img src="${src}" alt="Fenced example">`);
    expect(updated).toContain(
      `\`![Inline example](${src}) <img src="${src}" alt="Inline example">\``,
    );
    expect(updated).toContain(`<img src="${src}" alt="Inline example">`);
    expect(updated).toContain(
      `<span data-example="![Attribute example](${src}) <img src='${src}' alt='Attribute example'>">Text</span>`,
    );
    expect(updated).toContain(
      `<code>![HTML code example](${src}) <img src="${src}" alt="HTML code example"></code>`,
    );
    expect(updated).toContain(
      `<pre>![HTML pre example](${src}) <img src="${src}" alt="HTML pre example"></pre>`,
    );
    expect(updated).toContain(
      `<img data-markdown-image="true" src="${src}" alt="Rendered image"`,
    );
  });

  it("does not let HTML-like attribute text hide a following HTML image", () => {
    const src = "https://cdn.example.com/shared.png";
    const html = `<span data-example="<code>![Attribute example](${src})">Text</span><img src="${src}" alt="Rendered image">`;
    const updated = updateImageFitInSlideHtml(html, src, {
      objectFit: "cover",
    });

    expect(updated).toContain(
      `<span data-example="<code>![Attribute example](${src})">Text</span>`,
    );
    expect(updated).toContain(
      `<img src="${src}" alt="Rendered image" style="object-fit: cover;">`,
    );
  });

  it("keeps Markdown and HTML duplicate occurrences in rendered order", () => {
    const src = "https://cdn.example.com/shared.png";
    const html = `![First](${src})<img src="${src}" alt="Raw" style="object-fit: contain;">![Third](${src})`;
    const updatedRaw = updateImageFitInSlideHtml(
      html,
      src,
      { objectFit: "cover" },
      1,
    );
    const updatedMarkdown = updateImageFitInSlideHtml(
      html,
      src,
      { objectFit: "cover" },
      2,
    );

    expect(updatedRaw).toContain(`![First](${src})`);
    expect(updatedRaw).toContain(
      `<img src="${src}" alt="Raw" style="object-fit: cover;">`,
    );
    expect(updatedRaw).toContain(`![Third](${src})`);
    expect(updatedMarkdown).toContain(
      `<img data-markdown-image="true" src="${src}" alt="Third"`,
    );
    expect(updatedMarkdown).toContain("aspect-ratio: 16 / 9");
  });

  it.each([
    ["top left", "left top"],
    ["top right", "right top"],
    ["bottom left", "left bottom"],
    ["bottom right", "right bottom"],
  ])("normalizes vertical-first position %s", (value, expected) => {
    expect(normalizeImageObjectPosition(value)).toBe(expected);
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
