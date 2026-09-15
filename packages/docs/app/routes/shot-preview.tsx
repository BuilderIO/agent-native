import { useEffect } from "react";

import { DesignDashboardMock } from "../components/template-landing/DesignDashboardMock";
import { DesignFlowMock } from "../components/template-landing/DesignFlowMock";
import { DesignVariantsMock } from "../components/template-landing/DesignVariantsMock";

export default function ShotPreview() {
  useEffect(() => {
    const dark = window.location.search.includes("dark");
    const apply = () => {
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.classList.toggle("light", !dark);
    };
    apply();
    const timer = window.setInterval(apply, 200);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "40px",
        padding: "40px",
      }}
    >
      <img src="/examples/dark-preview.png" alt="" width={760} />
      <DesignVariantsMock label="Variants" />
      <DesignFlowMock label="Flow" />
      <DesignDashboardMock label="Dashboard" />
    </div>
  );
}
