import { redirect, type LoaderFunctionArgs } from "react-router";

const TRAFFIC_DASHBOARD_PATH = "/dashboards/agent-native-templates-first-party";

function target(url: URL): string {
  return `${TRAFFIC_DASHBOARD_PATH}${url.search}${url.hash}`;
}

export function loader({ url }: LoaderFunctionArgs) {
  throw redirect(target(url));
}

export function clientLoader({ url }: LoaderFunctionArgs) {
  throw redirect(target(url));
}

export default function TrafficDashboardAliasRoute() {
  return null;
}
