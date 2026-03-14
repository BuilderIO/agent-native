/**
 * ═══════════════════════════════════════════════════════════════════════════
 * APP PREVIEW HEADER MOLECULE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Header bar for the app preview area with address bar and action buttons.
 *
 * Features:
 * - Address bar with URL
 * - Action buttons (Share, Review, Send PR)
 * - Icon buttons
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";

export type AppPreviewHeaderProps = {
  url?: string;
};

export const AppPreviewHeader: React.FC<AppPreviewHeaderProps> = ({
  url = "localhost:8000",
}) => {
  return (
    <div
      style={{
        backgroundColor: "#191919",
        display: "flex",
        width: "100%",
        padding: "10px 14px",
        alignItems: "center",
        gap: "40px 130px",
        justifyContent: "flex-end",
        flexWrap: "wrap",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* Address bar */}
      <div
        style={{
          borderRadius: 5,
          backgroundColor: "#2a2a2a",
          borderColor: "transparent",
          borderStyle: "solid",
          borderWidth: 1,
          display: "flex",
          minHeight: 38,
          padding: "10px 4px",
          flexDirection: "column",
          alignItems: "center",
          fontSize: 15,
          color: "#999999",
          fontWeight: 400,
          justifyContent: "center",
          width: 250,
        }}
      >
        <div
          style={{
            display: "flex",
            width: "100%",
            maxWidth: 229,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/ca3aa2a02dfa4e2c58e3c8185ca3601b4d01aaf4?placeholderIfAbsent=true"
              alt=""
              style={{ width: 13, aspectRatio: 1, objectFit: "contain" }}
            />
            <div>{url}</div>
          </div>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/a1e15c3310f1176e6c1e9b5ff60a520650dd0d69?placeholderIfAbsent=true"
            alt=""
            style={{ width: 15, aspectRatio: 1, objectFit: "contain", cursor: "pointer" }}
          />
        </div>
      </div>

      {/* Static Avatar List */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 0,
          height: 28,
        }}
      >
        {/* First portrait */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            overflow: "hidden",
            position: "relative",
            zIndex: 4,
          }}
        >
          <img
            src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6eada205a8dc4ebd918806181f6264fc?format=webp&width=800&height=1200"
            alt="User 1"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        </div>

        {/* Second portrait */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            overflow: "hidden",
            position: "absolute",
            left: 19,
            zIndex: 3,
          }}
        >
          <img
            src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fec2ef10d3c7343589e377f53c2d1f134?format=webp&width=800&height=1200"
            alt="User 2"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        </div>

        {/* Third portrait */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            overflow: "hidden",
            position: "absolute",
            left: 38,
            zIndex: 2,
          }}
        >
          <img
            src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Ffe6b38cf28954de4a12d1f45866b7f61?format=webp&width=800&height=1200"
            alt="User 3"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        </div>

        {/* Fourth portrait */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            overflow: "hidden",
            position: "absolute",
            left: 57,
            zIndex: 1,
          }}
        >
          <img
            src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F5d0eec6c1506451d833346be322ff504?format=webp&width=800&height=1200"
            alt="User 4"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        </div>

        {/* + button circle */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            backgroundColor: "rgba(255, 255, 255, 0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            fontWeight: 600,
            color: "#ffffff",
            position: "absolute",
            left: 76,
            zIndex: 0,
          }}
        >
          +
        </div>
      </div>

      {/* Action buttons */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          fontSize: 13,
          color: "#ffffff",
          fontWeight: 500,
          textAlign: "center",
          lineHeight: 23 / 13,
        }}
      >
        <img
          src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/5a657a3a7c0c66f62298e506a1cdcd33b0fa5801?placeholderIfAbsent=true"
          alt=""
          style={{ width: 19, aspectRatio: 1, objectFit: "contain", cursor: "pointer" }}
        />
        <img
          src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/15e9b2a090b28b7953c43ca932eb877a204f19a0?placeholderIfAbsent=true"
          alt=""
          style={{ width: 19, aspectRatio: 1, objectFit: "contain", cursor: "pointer" }}
        />
        <div
          style={{
            borderRadius: 7,
            backgroundColor: "#2a2a2a",
            borderColor: "#393939",
            borderStyle: "solid",
            borderWidth: 1,
            display: "flex",
            minHeight: 37,
            padding: "6px 13px",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          Share
        </div>
        <div
          style={{
            borderRadius: 7,
            backgroundColor: "#2a2a2a",
            borderColor: "#393939",
            borderStyle: "solid",
            borderWidth: 1,
            display: "flex",
            minHeight: 37,
            padding: "6px 7px",
            flexDirection: "column",
            justifyContent: "center",
            width: 82,
            cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/346da66ecfda572528b869af00117a1ceed8d613?placeholderIfAbsent=true"
              alt=""
              style={{ width: 16, aspectRatio: 1, objectFit: "contain" }}
            />
            <div>Review</div>
          </div>
        </div>
        <div
          style={{
            borderRadius: 7,
            backgroundColor: "#2a2a2a",
            borderColor: "#393939",
            borderStyle: "solid",
            borderWidth: 1,
            display: "flex",
            minHeight: 37,
            padding: "6px",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: 112,
            cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/ed56c475c11f2e9d31876e6178773d8964a0385e?placeholderIfAbsent=true"
                alt=""
                style={{ width: 19, aspectRatio: 1, objectFit: "contain" }}
              />
              <div>Send PR</div>
            </div>
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/60c16d358ba374b573ddcbd6270c1393418fce3e?placeholderIfAbsent=true"
              alt=""
              style={{ width: 16, aspectRatio: 1, objectFit: "contain" }}
            />
          </div>
        </div>
        <img
          src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/13674a145727d75c65546b84d315a6f669744b07?placeholderIfAbsent=true"
          alt=""
          style={{ width: 19, aspectRatio: 1, objectFit: "contain", cursor: "pointer" }}
        />
      </div>
    </div>
  );
};
