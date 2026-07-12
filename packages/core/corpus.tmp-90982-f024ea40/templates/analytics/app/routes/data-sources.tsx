import { messagesByLocale } from "@/i18n-data";
import DataSources from "@/pages/DataSources";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.dataSources }];
}

export default function DataSourcesRoute() {
  return <DataSources />;
}
