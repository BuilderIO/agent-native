import DesignSystems from "@/pages/DesignSystems";
import enUS from "@/i18n/en-US";

export function meta() {
  return [{ title: enUS.raw.routes.designSystems }];
}

export default function DesignSystemsRoute() {
  return <DesignSystems />;
}
