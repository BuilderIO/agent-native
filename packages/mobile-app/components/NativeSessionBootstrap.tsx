import { useEffect } from "react";
import { Platform } from "react-native";

import { bootstrapNativeSession } from "@/lib/native-auth";

export default function NativeSessionBootstrap() {
  useEffect(() => {
    if (Platform.OS === "web") return;
    void bootstrapNativeSession().catch((error) => {
      console.warn("[mobile auth] startup session check failed", {
        reason: error instanceof Error ? error.message : "unknown error",
      });
    });
  }, []);

  return null;
}
