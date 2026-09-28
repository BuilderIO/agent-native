import type {
  BuilderConnectFlow,
  BuilderConnectStartOptions,
} from "@agent-native/core/client/settings";

export interface BuilderConnection {
  connected: boolean;
  loading: boolean;
  connecting: boolean;
  orgName: string | null;
  start: (options?: BuilderConnectStartOptions) => void;
  connectFlow: BuilderConnectFlow;
}
