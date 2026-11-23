import { checkDataFavorites } from "../data-favorites";
import { test } from "./fixtures";

test("report TEST-A2-DATA-FAVORITES-FIXTURE: DATA-FAVORITES sample table persists across reload and opens the exact table", async ({
  daily,
}) => {
  // oracle-change: the unchanged persistence, reload, and exact-table assertions moved to ../data-favorites.ts.
  await checkDataFavorites(daily.page, daily.server.base, {
    navigate: (path) => daily.open(path),
    onVerified: () => daily.check(),
  });
});
