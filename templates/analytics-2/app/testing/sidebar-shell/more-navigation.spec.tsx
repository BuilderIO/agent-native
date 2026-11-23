// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";

import { ANALYTICS_CONTROL_IDS } from "../../../shared/analytics-control-ids";
import { capabilityDecisionSchema } from "../../../shared/capabilities";
import { WorkspaceShell } from "../../components/shell/WorkspaceShell";
import { shellProps } from "./fixtures";
import { button, click, dispose, init, mount, route } from "./harness";

afterEach(dispose);
it("report 1794899298.142179 navigates from More to Library", async () => {
  init();
  await mount(<WorkspaceShell {...shellProps()} />);
  await click(button("More"));
  const library = document.querySelector(
    '[role="menuitem"][href="/home/library"]',
  );
  expect(library).toBeInstanceOf(HTMLElement);
  await click(library as HTMLElement);
  expect(route).toBe("/home/library");
});

it("report A2-CORE-LABS-SCOPE hides secondary navigation while Labs is off and keeps core destinations", async () => {
  init();
  const props = shellProps();
  await mount(
    <WorkspaceShell
      {...props}
      capabilities={[
        capabilityDecisionSchema.parse({
          controlId: ANALYTICS_CONTROL_IDS.dataBrowse,
          scope: { kind: "workspace", workspaceId: props.workspace.id },
          status: "allowed",
          target: { kind: "route", routeId: "data-browser" },
        }),
      ]}
    />,
  );
  expect(document.querySelector('a[href="/home/tasks"]')).toBeNull();
  expect(document.querySelector('a[href="/home/data"]')).not.toBeNull();
  await click(button("More"));
  expect(document.querySelector('a[href="/home/components"]')).toBeNull();
  expect(document.querySelector('a[href="/home/explorations"]')).toBeNull();
  expect(document.querySelector('a[href="/home/library"]')).not.toBeNull();
});
