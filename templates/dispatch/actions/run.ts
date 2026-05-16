import { runScript } from "@agent-native/core/scripts";
import { dispatchActions } from "@agent-native/dispatch/actions";

runScript({
  packageActions: dispatchActions,
  packageActionLabel: "Dispatch package actions",
});
