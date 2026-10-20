import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const queries = vi.hoisted(
  () =>
    [] as Array<{
      name: string;
      params: unknown;
      options?: { enabled?: boolean };
    }>,
);

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(),
  useActionMutation: vi.fn(),
  useActionQuery: (
    name: string,
    params: unknown,
    options?: { enabled?: boolean },
  ) => {
    queries.push({ name, params, options });
    return {
      data: options?.enabled
        ? { content: `<div data-an-shader-effect="fetched"></div>` }
        : undefined,
      isLoading: false,
      error: null,
    };
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { useScreenGlslShaders } from "./GlslShaderPanel";

beforeEach(() => {
  queries.length = 0;
});

function readMounts(context: Parameters<typeof useScreenGlslShaders>[0]) {
  let shaderIds: string[] = [];
  function Probe() {
    shaderIds = useScreenGlslShaders(context).mounts.map(
      (mount) => mount.shaderId,
    );
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return shaderIds;
}

it("reads shader mounts from the screen source the editor holds instead of fetching it", () => {
  const shaderIds = readMounts({
    designId: "design-1",
    fileId: "screen-1",
    content: `<div data-agent-native-node-id="a" data-an-shader-effect="held"></div>`,
  });

  expect(shaderIds).toEqual(["held"]);
  expect(queries.map(({ options }) => options?.enabled)).toEqual([false]);
});

it("fetches the screen source when the editor does not hold it", () => {
  const shaderIds = readMounts({ designId: "design-1", fileId: "screen-1" });

  expect(shaderIds).toEqual(["fetched"]);
  expect(queries.map(({ options }) => options?.enabled)).toEqual([true]);
});
