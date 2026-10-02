import { expect, it } from "vitest";

import { screenBodyHasElements } from "./layer-model-coverage";

it("finds a body element without parsing the screen", () => {
  expect(
    screenBodyHasElements(
      "<html><head><title>x</title></head><body><div>a</div></body></html>",
    ),
  ).toBe(true);
  expect(
    screenBodyHasElements(
      "<html><body><!-- <div> --><script>let d = '<div>'</script><p>b</p></body></html>",
    ),
  ).toBe(true);
  expect(screenBodyHasElements("<html><body>\n</body></html>")).toBe(false);
  expect(
    screenBodyHasElements(
      "<html><body><script src='x.js'></script><style>p{}</style></body></html>",
    ),
  ).toBe(false);
  expect(screenBodyHasElements("<section>fragment</section>")).toBe(true);
});
