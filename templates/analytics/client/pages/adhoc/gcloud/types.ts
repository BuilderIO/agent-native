export interface CloudRunService {
  name: string;
  uid: string;
  displayName: string;
  uri: string;
  region: string;
  createTime: string;
  updateTime: string;
  launchStage?: string;
}

export interface CloudFunction {
  name: string;
  displayName: string;
  state: string;
  environment: string;
  region: string;
  runtime?: string;
  updateTime: string;
}

export interface MetricPoint {
  timestamp: string;
  value: number;
}

export interface MetricTimeSeries {
  metric: string;
  labels: Record<string, string>;
  points: MetricPoint[];
}

export interface LogEntry {
  timestamp: string;
  severity: string;
  textPayload?: string;
  jsonPayload?: Record<string, unknown>;
  resource: {
    type: string;
    labels: Record<string, string>;
  };
  logName: string;
  insertId: string;
}

export type TimePeriod = "1h" | "6h" | "24h" | "7d";

export type ServiceType = "cloud_run" | "cloud_function";

export interface SelectedService {
  name: string;
  type: ServiceType;
}
