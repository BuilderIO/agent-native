import { afterEach, describe, expect, it } from "vitest";

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import {
  documentBuildId,
  documentBuildIdMetaTag,
  documentReleaseId,
} from "./document-build-id.js";

afterEach(() => resetAppConfigForTests());

describe("document release meta", () => {
  it("reads the build id from the app config when no bundler define exists", () => {
    defineAppConfig({ observability: { buildId: "  deploy-42 " } });

    expect(documentBuildId()).toBe("deploy-42");
  });

  it("names the workspace commit over a per-app content build id", () => {
    defineAppConfig({
      observability: { buildId: "content-abc", buildSha: " 1234abcd " },
    });

    expect(documentReleaseId()).toBe("1234abcd");
  });

  it("falls back to the build id when no commit is known", () => {
    defineAppConfig({ observability: { buildId: "deploy-42" } });

    expect(documentReleaseId()).toBe("deploy-42");
  });

  it("writes an escaped meta tag and nothing when the release is unknown", () => {
    defineAppConfig({ observability: { buildSha: 'a"<b>&c' } });
    expect(documentBuildIdMetaTag()).toBe(
      '<meta name="agent-native-build-sha" content="a&quot;&lt;b&gt;&amp;c"/>',
    );

    resetAppConfigForTests();
    defineAppConfig({});
    expect(documentBuildIdMetaTag()).toBe("");
  });
});
