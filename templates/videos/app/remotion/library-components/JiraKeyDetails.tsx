/**
 * JiraKeyDetails - Key details section with icon and description
 */

import React from "react";

interface JiraKeyDetailsProps {
  x: number;
  y: number;
  width: number;
  description: string;
}

export const JiraKeyDetails: React.FC<JiraKeyDetailsProps> = ({
  x,
  y,
  width,
  description,
}) => {
  return (
    <div
      style={{
        position: "relative",
        width,
        maxWidth: 1100,
        fontFamily: "Segoe UI, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "14px",
          fontSize: 24,
          color: "rgba(231, 231, 231, 1)",
          fontWeight: 700,
          lineHeight: 1.25,
        }}
      >
        <img
          src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/de14cdd03cf62231f58d54ee6297338c101de124?placeholderIfAbsent=true"
          alt="Key details"
          style={{ width: 18, height: 18, objectFit: "contain" }}
        />
        <div>Key details</div>
      </div>

      {/* Description */}
      <div
        style={{
          marginTop: 18,
          color: "rgba(226, 226, 226, 1)",
          fontSize: 20,
          fontWeight: 400,
          lineHeight: "32px",
        }}
      >
        {description}
      </div>
    </div>
  );
};
