import Constants from "expo-constants";
import { useCallback, useState } from "react";
import { Platform } from "react-native";

import { registerRemotePushToken } from "@/lib/remote-sessions-api";

export type PushRegistrationStatus =
  | "idle"
  | "requesting"
  | "registered"
  | "blocked"
  | "unsupported"
  | "error";

export interface PushRegistrationState {
  status: PushRegistrationStatus;
  message: string;
}

type ExpoConstantsWithEas = typeof Constants & {
  easConfig?: {
    projectId?: string;
  };
};

type ExpoExtra = {
  disableRemotePush?: boolean;
  eas?: { projectId?: string };
};

function getExpoExtra(): ExpoExtra | undefined {
  return Constants.expoConfig?.extra as ExpoExtra | undefined;
}

function isRemotePushDisabled(): boolean {
  return getExpoExtra()?.disableRemotePush === true;
}

function getProjectId(): string | undefined {
  const constants = Constants as ExpoConstantsWithEas;
  const extra = getExpoExtra();
  return extra?.eas?.projectId ?? constants.easConfig?.projectId;
}

export function useRemotePushRegistration() {
  const pushDisabled = isRemotePushDisabled();
  const [state, setState] = useState<PushRegistrationState>({
    status: pushDisabled ? "unsupported" : "idle",
    message: pushDisabled
      ? "Push alerts are disabled for this preview build."
      : "Push alerts are off for remote code-agent sessions.",
  });

  const register = useCallback(async () => {
    if (pushDisabled) {
      setState({
        status: "unsupported",
        message: "Push alerts are disabled for this preview build.",
      });
      return;
    }

    setState({
      status: "requesting",
      message: "Requesting notification permission...",
    });

    try {
      const Notifications = await import("expo-notifications");
      const existing = await Notifications.getPermissionsAsync();
      const permission =
        existing.status === "granted"
          ? existing
          : await Notifications.requestPermissionsAsync();

      if (permission.status !== "granted") {
        setState({
          status: "blocked",
          message: "Notifications are blocked for this device.",
        });
        return;
      }

      const projectId = getProjectId();
      const token = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      );
      const result = await registerRemotePushToken({
        token: token.data,
        platform: Platform.OS,
        projectId,
        deviceName: Constants.deviceName ?? undefined,
      });

      if (result.ok) {
        setState({
          status: "registered",
          message: result.data?.message ?? "Push alerts enabled.",
        });
        return;
      }

      setState({
        status: result.data?.unsupported ? "unsupported" : "error",
        message: result.error ?? "Could not register push alerts.",
      });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [pushDisabled]);

  return {
    ...state,
    register,
    registering: state.status === "requesting",
  };
}
