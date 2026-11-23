import { describe, expect, it } from "vitest";

import { appMountedHref, projectHref, projectPublicUrl } from "./projectList";

/**
 * Row 184: the link a person copies has to carry the app's mount path.
 *
 * The original copies `${protocol}//${host}/${basePath}${route}`, so a host that
 * serves the app under its own path still opens the project. Building the link
 * from the bare origin opened the host root instead (labs: root 404,
 * /analytics-2/... 200).
 */
describe("projectPublicUrl", () => {
  const ORIGIN = "https://labs.agent-native.com";

  it("keeps the app mount path between the host and the project route", () => {
    expect(projectPublicUrl("prj_sample_1", ORIGIN, "/analytics-2")).toBe(
      `${ORIGIN}/analytics-2/project/prj_sample_1/latest`,
    );
  });

  it("adds no prefix when the app is served at the host root", () => {
    expect(projectPublicUrl("prj_sample_1", ORIGIN, "")).toBe(
      `${ORIGIN}/project/prj_sample_1/latest`,
    );
  });

  it("does not double the mount path when it arrives with a trailing slash", () => {
    expect(projectPublicUrl("prj_sample_1", ORIGIN, "/analytics-2/")).toBe(
      `${ORIGIN}/analytics-2/project/prj_sample_1/latest`,
    );
  });

  it("percent-encodes the id exactly once", () => {
    expect(projectPublicUrl("prj a/b", ORIGIN, "/analytics-2")).toBe(
      `${ORIGIN}/analytics-2/project/prj%20a%2Fb/latest`,
    );
  });
});

/**
 * The same mount rule for the in-app links: a project row, its row-menu item and
 * the page a duplicate opens all navigate through `projectHref`. On the served
 * build those opened `/project/<id>/latest` (fleet "Page not found") instead of
 * `/analytics-2/project/<id>/latest`. Fails on the pre-fix helper, which took no
 * base path.
 */
describe("projectHref", () => {
  it("renders the project route under the app's mount path", () => {
    expect(projectHref("prj_sample_1", "/analytics-2")).toBe(
      "/analytics-2/project/prj_sample_1/latest",
    );
  });

  it("keeps the plain route when the app is mounted at the root", () => {
    expect(projectHref("prj_sample_1")).toBe("/project/prj_sample_1/latest");
    expect(projectHref("prj_sample_1", "")).toBe(
      "/project/prj_sample_1/latest",
    );
  });

  it("tolerates a trailing slash and never doubles the mount", () => {
    expect(projectHref("prj_sample_1", "/analytics-2/")).toBe(
      "/analytics-2/project/prj_sample_1/latest",
    );
    expect(
      appMountedHref("/analytics-2/project/x/latest", "/analytics-2"),
    ).toBe("/analytics-2/project/x/latest");
  });

  it("percent-encodes the id exactly once under a mount", () => {
    expect(projectHref("prj a/b", "/analytics-2")).toBe(
      "/analytics-2/project/prj%20a%2Fb/latest",
    );
  });
});
