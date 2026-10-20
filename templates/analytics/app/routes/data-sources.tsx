import enUSMessages from "@/i18n/en-US";
import DataSources from "@/pages/DataSources";

export function meta() {
  return [{ title: enUSMessages.routeTitles.dataSources }];
}

export default function DataSourcesRoute() {
  return <DataSources />;
}
