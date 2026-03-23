/**
 * JiraHeader - Top navigation header for Jira interface
 */

import React from "react";

interface JiraHeaderProps {
  width: number;
  height: number;
}

export const JiraHeader: React.FC<JiraHeaderProps> = ({ width, height }) => {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        backgroundColor: "rgba(36, 37, 40, 1)",
        display: "flex",
        alignItems: "center",
        padding: "0 50px",
        gap: "36px",
      }}
    >
      {/* Left icons */}
      <div style={{ display: "flex", alignItems: "center", gap: "28px" }}>
        <img
          src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/eecee9a245c4713c4e645e0ba8bc419aca173ca1?placeholderIfAbsent=true"
          alt="Menu"
          style={{ width: 24, height: 24, objectFit: "contain" }}
        />
        <img
          src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/8ecb097dd5e5d2a52e6e2a9784d1f73c8a4b49c5?placeholderIfAbsent=true"
          alt="Apps"
          style={{ width: 24, height: 24, objectFit: "contain" }}
        />
      </div>

      {/* Logo and title */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <img
          src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/58c335d7c1ceafd62834c48e9aedab2347315f20?placeholderIfAbsent=true"
          alt="Jira"
          style={{ width: 36, height: 36, objectFit: "contain" }}
        />
        <div
          style={{
            fontFamily: "Segoe UI, sans-serif",
            fontSize: 28,
            fontWeight: 700,
            color: "rgba(208, 208, 208, 1)",
            lineHeight: 1.05,
          }}
        >
          Jira
        </div>
      </div>
    </div>
  );
};
