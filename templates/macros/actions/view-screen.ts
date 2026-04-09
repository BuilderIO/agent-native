import { defineAction } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "See what the user is currently viewing - their current date, daily totals, and navigation state",
  parameters: {},
  http: false,
  run: async () => {
    const navigation = await readAppState("navigation");
    return {
      navigation: navigation || { view: "entry", path: "/" },
      hint: "Use list-meals, list-exercises, or list-weights with the date from navigation to see the user's data",
    };
  },
});
