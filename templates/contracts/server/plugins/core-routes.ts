import { createCoreRoutesPlugin } from "@agent-native/core/server";

export default createCoreRoutesPlugin({
  envKeys: [
    { key: "DATABASE_URL", label: "Database URL", required: false },
    {
      key: "DATABASE_AUTH_TOKEN",
      label: "Database Auth Token",
      required: false,
    },
  ],
});
