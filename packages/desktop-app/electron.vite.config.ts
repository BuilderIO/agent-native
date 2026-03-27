import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ["@agent-native/shared-app-config", "electron-updater"],
      }),
    ],
    resolve: {
      alias: {
        "@shared": resolve("shared"),
      },
    },
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ["@agent-native/shared-app-config"],
      }),
    ],
    resolve: {
      alias: {
        "@shared": resolve("shared"),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@shared": resolve("shared"),
        "@renderer": resolve("src/renderer"),
      },
    },
    plugins: [react()],
  },
});
