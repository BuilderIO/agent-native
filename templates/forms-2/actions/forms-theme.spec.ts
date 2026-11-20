import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { as, owner, startTestDb, stopTestDb } from "./_test-context.js";
import createForm from "./create-form.js";
import getForm from "./get-form.js";
import updateSettings from "./update-form-settings.js";

describe("form theme and custom CSS", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);

  it("stores the theme, keeps other settings, and strips unsafe CSS", async () => {
    const { id } = await as(owner, () => createForm.run({}));
    await as(owner, () =>
      updateSettings.run({ id, settings: { progressBar: true } }),
    );
    await as(owner, () =>
      updateSettings.run({
        id,
        settings: {
          theme: { preset: "dark", font: "Lora", accent: "#ff0000" },
          customCss: ".forms-root{color:red}</style><script>x</script>",
        },
      }),
    );
    const { settings } = await as(owner, () => getForm.run({ id }));
    expect(settings.theme).toEqual({
      preset: "dark",
      font: "Lora",
      accent: "#ff0000",
    });
    expect(settings.customCss).toBe(
      ".forms-root{color:red}/style>script>x/script>",
    );
    expect(settings.progressBar).toBe(true);
  });

  it("rejects an unknown font and a bad colour", async () => {
    const { id } = await as(owner, () => createForm.run({}));
    for (const theme of [{ font: "Papyrus" }, { accent: "red" }])
      await expect(
        as(owner, () =>
          updateSettings.run({ id, settings: { theme: theme as never } }),
        ),
      ).rejects.toThrow();
  });
});
