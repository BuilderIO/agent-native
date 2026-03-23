/**
 * JiraBreadcrumb - Navigation breadcrumb for Jira task
 */

import React from "react";

interface JiraBreadcrumbProps {
  x?: number;
  y?: number;
}

export const JiraBreadcrumb: React.FC<JiraBreadcrumbProps> = ({ x, y }) => {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        fontFamily: "Segoe UI, sans-serif",
        fontSize: 18,
        color: "rgba(169, 171, 175, 1)",
        fontWeight: 400,
        lineHeight: 1.33,
      }}
    >
      <div>Spaces</div>
      <div>/</div>
      <div>Engineering</div>
      <div>/</div>
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <img
          src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/68fb8ff1fddf9e400c114f7aaddb24c9639517fb?placeholderIfAbsent=true"
          alt="Issue"
          style={{ width: 24, height: 24, objectFit: "contain" }}
        />
        <div>ENG-1456</div>
      </div>
    </div>
  );
};
