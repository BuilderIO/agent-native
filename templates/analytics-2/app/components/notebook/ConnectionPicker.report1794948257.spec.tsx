import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { ConnectionPicker } from "./ConnectionPicker";

it("report 1794948257.991429 shows the source when it is the only connection", () => {
  const html = renderToStaticMarkup(
    <ConnectionPicker
      connections={[{ id: "source", name: "Warehouse" }]}
      value="source"
      onSelect={() => {}}
    />,
  );
  expect(html).toContain('<span class="nb-connection-name">Warehouse</span>');
});
