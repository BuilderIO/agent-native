export type RemoteCommandKind =
  | "create-run"
  | "list-runs"
  | "get-run"
  | "append-followup"
  | "approve"
  | "deny"
  | "stop"
  | "status";

export type RemoteCommandStatus =
  | "pending"
  | "claimed"
  | "running"
  | "completed"
  | "failed";

export type RemoteDeviceStatus = "active" | "inactive";

export interface RemoteDevice {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  label: string;
  deviceTokenHash: string;
  lastSeenAt: number | null;
  status: RemoteDeviceStatus;
  createdAt: number;
  updatedAt: number;
}

export interface PublicRemoteDevice {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  label: string;
  lastSeenAt: number | null;
  status: RemoteDeviceStatus;
  createdAt: number;
  updatedAt: number;
}

export interface RemoteCommand {
  id: string;
  deviceId: string;
  ownerEmail: string;
  orgId: string | null;
  kind: RemoteCommandKind;
  params: unknown;
  status: RemoteCommandStatus;
  result: unknown;
  platform: string | null;
  externalThreadId: string | null;
  attempts: number;
  nextCheckAt: number;
  claimedAt: number | null;
  completedAt: number | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RemoteRunEvent {
  deviceId: string;
  remoteRunId: string;
  seq: number;
  event: unknown;
  createdAt: number;
}
