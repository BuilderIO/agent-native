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
  platform: string | null;
  appVersion: string | null;
  hostName: string | null;
  metadata: Record<string, unknown> | null;
  deviceTokenHash: string;
  lastSeenAt: number | null;
  status: RemoteDeviceStatus;
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PublicRemoteDevice {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  label: string;
  platform: string | null;
  appVersion: string | null;
  hostName: string | null;
  metadata: Record<string, unknown> | null;
  lastSeenAt: number | null;
  status: RemoteDeviceStatus;
  revokedAt: number | null;
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

export type RemotePushRegistrationStatus = "active" | "inactive";

export interface RemotePushRegistration {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  provider: string;
  platform: string | null;
  clientDeviceId: string | null;
  label: string | null;
  token: string;
  tokenHash: string;
  status: RemotePushRegistrationStatus;
  lastSeenAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PublicRemotePushRegistration {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  provider: string;
  platform: string | null;
  clientDeviceId: string | null;
  label: string | null;
  status: RemotePushRegistrationStatus;
  lastSeenAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface RemotePushNotification {
  id: string;
  ownerEmail: string;
  orgId: string | null;
  registrationId: string;
  payload: unknown;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  createdAt: number;
  updatedAt: number;
}
