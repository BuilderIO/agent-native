/**
 * SlackThreadPanel - Right panel showing thread conversation
 */
import React from "react";

interface SlackThreadPanelProps {
  width: number;
  height: number;
  builderButtonHoverProgress?: number;
}

export const SlackThreadPanel: React.FC<SlackThreadPanelProps> = ({
  width,
  height,
  builderButtonHoverProgress = 0,
}) => {
  // Calculate button hover effects
  const buttonScale = 1 + (builderButtonHoverProgress * 0.08);
  const buttonBorderColor = builderButtonHoverProgress > 0
    ? `rgba(121, 124, 129, ${0.5 + builderButtonHoverProgress * 0.5})`
    : "rgba(121, 124, 129, 0.5)";
  const buttonBg = builderButtonHoverProgress > 0
    ? `rgba(26, 29, 33, ${1 - builderButtonHoverProgress * 0.2})`
    : "rgba(26, 29, 33, 1)";
  return (
    <div
      style={{
        width,
        height,
        background: "rgba(26, 29, 33, 1)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Thread header */}
      <div
        style={{
          background: "rgba(26, 29, 33, 1)",
          padding: "14px 27px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{
            color: "rgba(255, 255, 255, 1)",
            fontSize: 24,
            fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
            fontWeight: 600,
          }}
        >
          Thread
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 23 }}>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/00d7f157ddf9f089e6569b4abbcd7f14efa6e8a0"
            alt=""
            style={{ width: 28, height: 28 }}
          />
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/5c38f12b1fb92c4f623f8c2adc178b494c43261b"
            alt=""
            style={{ width: 27, height: 27 }}
          />
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/2db995301c8f40f320cfdd08a19422e532d7516a"
            alt=""
            style={{ width: 24, height: 24 }}
          />
        </div>
      </div>

      {/* Thread messages */}
      <div style={{ flex: 1, padding: "20px 27px 28px 27px" }}>
        {/* Original message */}
        <div style={{ display: "flex", gap: 22, marginBottom: 27 }}>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/047661ff97c39beb53acfd378c59abd220f9d8a7"
            alt=""
            style={{ width: 62, height: 62, borderRadius: 8 }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 7 }}>
              <div
                style={{
                  color: "rgba(248, 248, 248, 1)",
                  fontSize: 19,
                  fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
                  fontWeight: 600,
                }}
              >
                Diego Hernández 👨‍💻
              </div>
              <div
                style={{
                  color: "rgba(171, 171, 173, 1)",
                  fontSize: 16,
                  fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
                }}
              >
                Feb 23rd at 2:15 PM
              </div>
            </div>
            <div
              style={{
                color: "rgba(255, 255, 255, 1)",
                fontSize: 17,
                fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
                lineHeight: "26px",
              }}
            >
              <div
                style={{
                  borderRadius: 5,
                  background: "rgba(26, 54, 69, 0.68)",
                  padding: "0 6px",
                  color: "rgba(42, 161, 201, 1)",
                  display: "inline-block",
                  marginRight: 5,
                }}
              >
                @Builder.io
              </div>
              Can you help me build a dashboard for our sales attribution for the Q4 2025 range with stats broken down per sales rep?
            </div>
          </div>
        </div>

        {/* Builder.io response */}
        <div style={{ display: "flex", gap: 19 }}>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/fb1e1e3359a5886deb33a4b219cc295590c17bbb"
            alt=""
            style={{ width: 54, height: 54, borderRadius: 7 }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 13 }}>
              <div
                style={{
                  color: "rgba(248, 248, 248, 1)",
                  fontSize: 17,
                  fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
                  fontWeight: 600,
                }}
              >
                Builder.io
              </div>
              <div
                style={{
                  borderRadius: 2,
                  background: "rgba(248, 248, 248, 0.06)",
                  padding: "1px 5px 1px 3px",
                  fontSize: 12,
                  color: "rgba(185, 186, 189, 1)",
                  fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
                }}
              >
                APP
              </div>
              <div
                style={{
                  color: "rgba(171, 171, 173, 1)",
                  fontSize: 14,
                  fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
                }}
              >
                Feb 23rd at 2:15 PM
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 17 }}>
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/395fadc92fca383efa86e0d5aa901b482b5e41b5"
                alt=""
                style={{ width: 21, height: 21 }}
              />
              <div
                style={{
                  borderRadius: 8,
                  background: "rgba(34, 37, 41, 1)",
                  border: "1px solid rgba(71, 74, 81, 1)",
                  padding: "3px 10px",
                  fontSize: 14,
                  color: "rgba(232, 145, 45, 1)",
                  fontFamily: "Consolas, -apple-system, Roboto, Helvetica, sans-serif",
                }}
              >
                Sales dashboard view Q4 2025
              </div>
            </div>
            <div
              style={{
                color: "rgba(255, 255, 255, 1)",
                fontSize: 17,
                fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
                lineHeight: "26px",
                marginBottom: 17,
              }}
            >
              I created a comprehensive dashboard for the 2025 Q4 sales data.
              <br />
              <br />
              🔍 <span style={{ fontWeight: 600 }}>Breakdown of values per-agent:</span>
              <br />
              Inspect each agent's attribution for sales numbers. Search by title or value
              <br />
              <br />
              📊 <span style={{ fontWeight: 600 }}>Month-by-month breakdown</span>:
              <br />
              See how the sales team performed each month and click on each bar to inspect in detail.
            </div>
            <div style={{ display: "flex", gap: 16, marginBottom: 17 }}>
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/b3a5fb93702cc165a647cd7afd263c9b7107601a"
                alt=""
                style={{ width: 21, height: 21 }}
              />
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/fd3d1488608abca09d7af93b59a941722e14c214"
                alt=""
                style={{ width: 21, height: 21 }}
              />
            </div>
            <div
              style={{
                borderRadius: 7,
                background: buttonBg,
                border: `1px solid ${buttonBorderColor}`,
                padding: "8px 9px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "rgba(248, 248, 248, 1)",
                fontSize: 15,
                fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
                transform: `scale(${buttonScale})`,
                transition: "all 0.2s ease",
                cursor: "pointer",
              }}
            >
              View in Builder.io
            </div>
          </div>
        </div>
      </div>

      {/* Reply input */}
      <div
        style={{
          borderRadius: 12,
          background: "rgba(34, 37, 41, 1)",
          border: "1px solid rgba(86, 88, 86, 1)",
          margin: "0 23px 24px 23px",
          padding: 12,
        }}
      >
        <div
          style={{
            color: "rgba(154, 155, 158, 1)",
            fontSize: 15,
            fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
            marginBottom: 23,
          }}
        >
          Reply…
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                borderRadius: 2,
                background: "rgba(46, 49, 53, 1)",
                border: "1px solid rgba(102, 102, 102, 1)",
                width: 15,
                height: 15,
              }}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                fontSize: 14,
                color: "#e8e8e8",
                fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
              }}
            >
              <div>Also send to</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/56959e247af051c51842c1b2cfdcc316bf8dd7aa"
                  alt=""
                  style={{ width: 14, height: 14 }}
                />
                <div>product-dev</div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
              <div
                style={{
                  borderRadius: 16,
                  background: "rgba(232, 232, 232, 0.06)",
                  width: 32,
                  height: 33,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/5dc5401d2ea2dbe5bf0b55995eee95423f77f284"
                  alt=""
                  style={{ width: 21, height: 21 }}
                />
              </div>
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/8eb29395c2d040dc7d9d5577c9d4b5255a0453ec"
                alt=""
                style={{ width: 21, height: 21 }}
              />
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/8f14b93ead94eb84929a27fc1fd7ad1f64e30064"
                alt=""
                style={{ width: 21, height: 21 }}
              />
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/05ff36b56943e53e1dd91143a7f6fe6f6056ee4d"
                alt=""
                style={{ width: 21, height: 21 }}
              />
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/2714cb78a567527e16586d6e164cc72b5dc6e5e5"
                alt=""
                style={{ width: 21, height: 21 }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 17 }}>
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/fbfd71806d43ebea1b056bfc110d15e75deb17f3"
                alt=""
                style={{ width: 18, height: 18 }}
              />
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/79e2b706e971c12106093a8fe19c132a12ebf278"
                alt=""
                style={{ width: 18, height: 18 }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
