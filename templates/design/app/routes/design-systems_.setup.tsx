import { useNavigate } from "react-router";

import { messagesByLocale } from "@/i18n-data";

import DesignSystemSetup from "../pages/DesignSystemSetup";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.designSystemSetup }];
}

export default function DesignSystemSetupRoute() {
  const navigate = useNavigate();
  return (
    <DesignSystemSetup
      onCreated={(id) => {
        void navigate(`/design-systems/${encodeURIComponent(id)}`);
      }}
    />
  );
}
