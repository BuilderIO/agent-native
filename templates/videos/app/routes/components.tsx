import ComponentLibrary from "@/pages/ComponentLibrary";
import enUS from "@/i18n/en-US";

export function meta() {
  return [{ title: enUS.raw.routes.components }];
}

export default function ComponentsRoute() {
  return <ComponentLibrary />;
}
