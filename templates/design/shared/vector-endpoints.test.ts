import { describe, expect, it } from "vitest";

import {
  defaultVectorEndpoint,
  vectorEndpointFromMarkerValue,
  vectorEndpointMarkerShape,
  vectorEndpointMarkerUrl,
  VECTOR_ENDPOINT_OPTIONS,
} from "./vector-endpoints.js";

describe("vector endpoint markers", () => {
  it("matches Figma's default line and arrow endpoints", () => {
    expect(defaultVectorEndpoint("line", "start")).toBe("none");
    expect(defaultVectorEndpoint("line", "end")).toBe("none");
    expect(defaultVectorEndpoint("arrow", "start")).toBe("none");
    expect(defaultVectorEndpoint("arrow", "end")).toBe("line-arrow");
  });

  it("round-trips every endpoint through its local SVG marker URL", () => {
    for (const endpoint of VECTOR_ENDPOINT_OPTIONS) {
      const url = vectorEndpointMarkerUrl("node-1", endpoint);
      expect(vectorEndpointFromMarkerValue(url, "node-1")).toBe(endpoint);
    }
  });

  it("keeps unknown marker references from becoming a false endpoint", () => {
    expect(
      vectorEndpointFromMarkerValue("url(#foreign-marker)", "node-1", "none"),
    ).toBe("none");
    expect(
      vectorEndpointFromMarkerValue("url(#foreign-marker)", "node-1", "round"),
    ).toBe("round");
  });

  it("provides a stroked chevron for the line arrow and filled shapes for heads", () => {
    expect(vectorEndpointMarkerShape("line-arrow")).toMatchObject({
      fill: "none",
      stroke: true,
    });
    expect(vectorEndpointMarkerShape("triangle-arrow")).toMatchObject({
      fill: "stroke",
      stroke: false,
    });
  });
});
