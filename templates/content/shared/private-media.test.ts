import { describe, expect, it } from "vitest";

import {
  privateMediaIdFromSrc,
  privateMediaIdsInContent,
  privateMediaPath,
} from "./private-media";

const A = "11111111-1111-4111-8111-111111111111";
const B = "2222abcd-2222-4222-8222-22222222abcd";

describe("private image links", () => {
  it("finds every private image a body links to, once each", () => {
    const content = [
      `![](${privateMediaPath(A)})`,
      `<img src="/api/private-media/${B}" />`,
      `![again](/api/private-media/${A})`,
    ].join("\n\n");
    expect([...privateMediaIdsInContent(content)].sort()).toEqual([A, B]);
  });

  it("ignores IDs that run on into more ID characters, and other links", () => {
    expect(
      privateMediaIdsInContent(
        `![](/api/private-media/${A}0) ![](/api/private-icons/${B}) ![](https://cdn.example.test/${A}.png)`,
      ).size,
    ).toBe(0);
    expect(privateMediaIdsInContent("").size).toBe(0);
  });

  it("reads the ID only from an exact stored link", () => {
    expect(privateMediaIdFromSrc(`/api/private-media/${A}`)).toBe(A);
    for (const src of [
      `/content/api/private-media/${A}`,
      `https://content.example.test/api/private-media/${A}`,
      `/api/private-media/${A}?download=1`,
      `/api/private-media/${B.toUpperCase()}`,
      "/api/private-media/------------------------------------",
    ]) {
      expect(privateMediaIdFromSrc(src)).toBeNull();
    }
  });
});
