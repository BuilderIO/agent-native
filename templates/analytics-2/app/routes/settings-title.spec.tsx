import { renderToString } from "react-dom/server";
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
  UNSAFE_FrameworkContext,
} from "react-router";
import { expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  Links: () => null,
  Scripts: () => null,
  ScrollRestoration: () => null,
}));
import * as root from "../root";
import * as application from "./$";

it("serves one Settings title through the router before client hydration", async () => {
  const routes = [
    {
      id: "root",
      path: "/",
      Component: () => (
        <root.Layout>
          <main />
        </root.Layout>
      ),
      children: [{ id: "application", path: "*", Component: () => null }],
    },
  ];
  const handler = createStaticHandler(routes);
  const context = await handler.query(
    new Request("https://example.test/settings/integrations"),
  );
  if (context instanceof Response)
    throw new Error(`Unexpected response ${context.status}`);
  const framework = {
    manifest: {
      entry: { imports: [], module: "" },
      routes: {},
      url: "",
      version: "",
    },
    routeModules: { root, application },
    future: {},
    ssr: true,
    isSpaMode: false,
    routeDiscovery: { mode: "initial" as const, manifestPath: "/__manifest" },
  };
  const html = renderToString(
    <UNSAFE_FrameworkContext.Provider value={framework}>
      <StaticRouterProvider
        router={createStaticRouter(routes, context)}
        context={context}
        hydrate={false}
      />
    </UNSAFE_FrameworkContext.Provider>,
  );
  expect(html.match(/<title>.*?<\/title>/g)).toEqual([
    "<title>Settings</title>",
  ]);
});
