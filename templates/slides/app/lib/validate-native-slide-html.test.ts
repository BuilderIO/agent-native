import { describe, expect, it } from "vitest";

import { validateNativeSlideHtml } from "./validate-native-slide-html";

const mediaUrl = `/_agent-native/creative-context/media?mediaId=ccm_${"a".repeat(28)}`;

describe("validateNativeSlideHtml", () => {
  it("accepts compiler-shaped editable markup with a private relative asset", () => {
    const html = `<div class="fmd-slide google-slides-native" data-source-slide-id="slide-1" style="position:relative;width:960px;height:540px;overflow:hidden"><div class="gslide-element gslide-image" data-source-object-id="image-1" style="position:absolute;left:0;top:0;width:100px;height:100px"><img src="${mediaUrl}" alt="" style="width:100%;height:100%"/></div></div>`;
    expect(validateNativeSlideHtml(html)).toBe(html);
  });

  it.each([
    "<script>alert(1)</script>",
    '<img src="https://attacker.example/pixel.png" alt="" style="width:1px"/>',
    '<div onclick="alert(1)">click</div>',
    '<div style="background:url(https://attacker.example/a.png)">x</div>',
    '<iframe src="/_agent-native/creative-context/media?mediaId=ccm_aaaaaaaaaaaaaaaaaaaaaaaaaaaa"></iframe>',
  ])("rejects tampered persisted artifact markup: %s", (payload) => {
    const html = `<div class="fmd-slide google-slides-native" data-source-slide-id="slide-1" style="position:relative;width:960px;height:540px">${payload}</div>`;
    expect(() => validateNativeSlideHtml(html)).toThrow();
  });
});
