/**
 * JiraSidebar - Right sidebar with status, details, and other sections
 */

import React from "react";
import { JiraAvatar } from "./JiraAvatar";

interface JiraSidebarProps {
  x: number;
  y: number;
  width: number;
  height: number;
  statusButtonHovered?: boolean;
  improveTaskButtonHovered?: boolean;
  statusButtonProgress?: number;
  improveTaskButtonProgress?: number;
  // Assignee animation states
  assigneeState?: "unassigned" | "dropdown" | "typing" | "assigned";
  assigneeDropdownProgress?: number;
  typedText?: string;
}

export const JiraSidebar: React.FC<JiraSidebarProps> = ({
  x,
  y,
  width,
  height,
  statusButtonHovered = false,
  improveTaskButtonHovered = false,
  statusButtonProgress = 0,
  improveTaskButtonProgress = 0,
  assigneeState = "assigned",
  assigneeDropdownProgress = 0,
  typedText = "",
}) => {
  const statusScale = 1 + statusButtonProgress * 0.05;
  const improveScale = 1 + improveTaskButtonProgress * 0.05;

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        minHeight: height,
        backgroundColor: "rgba(31, 31, 33, 1)",
        borderTop: "1px solid rgba(41, 41, 41, 1)",
        padding: "28px",
        fontFamily: "Segoe UI, sans-serif",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        {/* Top section with Jira logo and action buttons */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            justifyContent: "space-between",
          }}
        >
          {/* Jira Logo on the left */}
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/58c335d7c1ceafd62834c48e9aedab2347315f20?placeholderIfAbsent=true"
            alt="Jira"
            style={{ width: 36, height: 36, objectFit: "contain" }}
          />

          {/* Action buttons on the right */}
          <div style={{ display: "flex", gap: "10px" }}>
            {/* Give Feedback */}
            <div
              style={{
                borderRadius: "3px",
                border: "1px solid rgba(58, 59, 61, 1)",
                padding: "12px 14px",
                display: "flex",
                alignItems: "center",
                gap: "14px",
                fontSize: 20,
                color: "rgba(169, 171, 175, 1)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/d2d7545fd73728a1dcfcd27ac7b3fc5181ab90b2?placeholderIfAbsent=true"
                alt="Feedback"
                style={{ width: 24, height: 24, objectFit: "contain" }}
              />
              <div style={{ width: 12 }}>3</div>
            </div>

            {/* Share button */}
            <div
              style={{
                borderRadius: "3px",
                border: "1px solid rgba(58, 59, 61, 1)",
                padding: "12px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/6c5c301ec24cb93fa976f8e1fcfaf21cb82cae74?placeholderIfAbsent=true"
                alt="Share"
                style={{ width: 18, height: 20, objectFit: "contain" }}
              />
            </div>

            {/* More button */}
            <div
              style={{
                borderRadius: "3px",
                border: "1px solid rgba(58, 59, 61, 1)",
                padding: "12px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/cc55eca1579cc8c94a790fb9a6c69ad697164cdd?placeholderIfAbsent=true"
                alt="More"
                style={{ width: 24, height: 6, objectFit: "contain" }}
              />
            </div>
          </div>
        </div>

        {/* Status and action buttons */}
        <div style={{ marginTop: 32 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            {/* Status button */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  borderRadius: "5px",
                  backgroundColor: "rgba(21, 88, 188, 1)",
                  minHeight: 46,
                  padding: "0 18px 0 18px",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  fontSize: 20,
                  color: "rgba(255, 255, 255, 1)",
                  fontWeight: 600,
                  cursor: "pointer",
                  transform: `scale(${statusScale})`,
                  transition: "transform 0.15s ease",
                }}
              >
                <div style={{ whiteSpace: "nowrap" }}>In Progress</div>
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/e157c3107972acf7f49bc2ca6729ac9ad0b00a0b?placeholderIfAbsent=true"
                  alt="Dropdown"
                  style={{ width: 18, height: 18, objectFit: "contain" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: 6 }}>
              {/* Vote button */}
              <div
                style={{
                  borderRadius: "5px",
                  border: "1px solid rgba(58, 59, 61, 1)",
                  padding: "12px 14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/cb25ed3a78e9f11457a0cb6eeb813dffb7af7133?placeholderIfAbsent=true"
                  alt="Vote"
                  style={{ width: 18, height: 24, objectFit: "contain" }}
                />
              </div>

              {/* Improve Task button */}
              <div
                style={{
                  borderRadius: "5px",
                  border: "1px solid rgba(58, 59, 61, 1)",
                  padding: "12px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: "14px",
                  fontSize: 20,
                  color: "rgba(214, 214, 214, 1)",
                  fontWeight: 600,
                  cursor: "pointer",
                  transform: `scale(${improveScale})`,
                  transition: "transform 0.15s ease",
                }}
              >
                <div style={{ width: 120 }}>Improve Task</div>
              </div>
            </div>
          </div>
        </div>

        {/* Details section */}
        <div
          style={{
            marginTop: 24,
            borderRadius: "7px",
            border: "1px solid rgba(44, 45, 47, 1)",
            padding: "14px 20px",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: 24,
              color: "rgba(156, 156, 156, 1)",
              fontWeight: 400,
            }}
          >
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/f4cb2532be5f5f4eecc74742424388ffb028d7d0?placeholderIfAbsent=true"
              alt="Details"
              style={{ width: 34, height: 34, objectFit: "contain" }}
            />
            <div>Details</div>
          </div>

          {/* Details content */}
          <div style={{ marginTop: 44, fontSize: 20, display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Reporter */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ color: "rgba(169, 171, 175, 1)", lineHeight: 1.33 }}>Reporter</div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", lineHeight: 1.43 }}>
                <JiraAvatar
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/b1393f38e6937677e8054a046449a106ced6cb31?placeholderIfAbsent=true"
                  size={36}
                />
                <div style={{ color: "rgba(255, 255, 255, 1)" }}>Jeanne Thomas</div>
              </div>
            </div>

            {/* Assignee */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ color: "rgba(169, 171, 175, 1)", lineHeight: 1.33 }}>Assignee</div>
              {assigneeState === "unassigned" ? (
                <div style={{
                  color: "rgba(102, 157, 241, 1)",
                  lineHeight: 1.43,
                  cursor: "pointer",
                  textDecoration: "underline"
                }}>Unassigned</div>
              ) : assigneeState === "dropdown" || assigneeState === "typing" ? (
                <div style={{ position: "relative" }}>
                  <div style={{
                    color: "rgba(102, 157, 241, 1)",
                    lineHeight: 1.43,
                    cursor: "pointer",
                    textDecoration: "underline"
                  }}>Unassigned</div>
                  {/* Dropdown */}
                  <div style={{
                    position: "absolute",
                    top: 30,
                    right: 0,
                    width: 300,
                    backgroundColor: "rgba(31, 31, 33, 1)",
                    border: "1px solid rgba(58, 59, 61, 1)",
                    borderRadius: "5px",
                    padding: "12px",
                    opacity: assigneeDropdownProgress,
                    transform: `scale(${0.95 + assigneeDropdownProgress * 0.05})`,
                    transformOrigin: "top right",
                    pointerEvents: assigneeDropdownProgress > 0 ? "auto" : "none",
                  }}>
                    {/* Search input */}
                    <div style={{
                      backgroundColor: "rgba(42, 42, 42, 1)",
                      border: "1px solid rgba(58, 59, 61, 1)",
                      borderRadius: "3px",
                      padding: "8px 12px",
                      fontSize: 16,
                      color: "rgba(255, 255, 255, 1)",
                      marginBottom: 8,
                    }}>
                      {typedText}
                      <span style={{ opacity: 0.5 }}>|</span>
                    </div>
                    {/* Dropdown options */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: 250, overflowY: "auto" }}>
                      {/* Builder.io Bot - highlighted when typing "Buil" */}
                      {typedText.length > 0 && (
                        <div style={{
                          padding: "8px",
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          cursor: "pointer",
                          borderRadius: "3px",
                          backgroundColor: "rgba(42, 42, 42, 1)",
                        }}>
                          <JiraAvatar
                            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/a00048974f859ab6824d8e80aa3d388dbdfcd90c?placeholderIfAbsent=true"
                            size={32}
                          />
                          <div>
                            <div style={{ fontSize: 16, color: "rgba(255, 255, 255, 1)" }}>Builder.io Bot</div>
                            <div style={{ fontSize: 12, color: "rgba(169, 171, 175, 1)" }}>builder@builder.io</div>
                          </div>
                        </div>
                      )}

                      {/* Show all team members when dropdown first opens (no text typed yet) */}
                      {typedText.length === 0 && (
                        <>
                          <div style={{
                            padding: "8px",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            cursor: "pointer",
                            borderRadius: "3px",
                          }}>
                            <JiraAvatar
                              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/a00048974f859ab6824d8e80aa3d388dbdfcd90c?placeholderIfAbsent=true"
                              size={32}
                            />
                            <div>
                              <div style={{ fontSize: 16, color: "rgba(255, 255, 255, 1)" }}>Builder.io Bot</div>
                              <div style={{ fontSize: 12, color: "rgba(169, 171, 175, 1)" }}>builder@builder.io</div>
                            </div>
                          </div>

                          <div style={{
                            padding: "8px",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            cursor: "pointer",
                            borderRadius: "3px",
                          }}>
                            <JiraAvatar
                              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/b1393f38e6937677e8054a046449a106ced6cb31?placeholderIfAbsent=true"
                              size={32}
                            />
                            <div>
                              <div style={{ fontSize: 16, color: "rgba(255, 255, 255, 1)" }}>Jeanne Thomas</div>
                              <div style={{ fontSize: 12, color: "rgba(169, 171, 175, 1)" }}>jthomas@acme.com</div>
                            </div>
                          </div>

                          <div style={{
                            padding: "8px",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            cursor: "pointer",
                            borderRadius: "3px",
                          }}>
                            <JiraAvatar
                              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/de43b059c7ff55947168ed77c06d48f98e7d746e?placeholderIfAbsent=true"
                              size={32}
                            />
                            <div>
                              <div style={{ fontSize: 16, color: "rgba(255, 255, 255, 1)" }}>Sarah Chen</div>
                              <div style={{ fontSize: 12, color: "rgba(169, 171, 175, 1)" }}>schen@acme.com</div>
                            </div>
                          </div>

                          <div style={{
                            padding: "8px",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            cursor: "pointer",
                            borderRadius: "3px",
                          }}>
                            <div style={{
                              width: 32,
                              height: 32,
                              borderRadius: "50%",
                              backgroundColor: "rgba(88, 101, 242, 1)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 14,
                              fontWeight: 600,
                              color: "white",
                            }}>MR</div>
                            <div>
                              <div style={{ fontSize: 16, color: "rgba(255, 255, 255, 1)" }}>Mike Rodriguez</div>
                              <div style={{ fontSize: 12, color: "rgba(169, 171, 175, 1)" }}>mrodriguez@acme.com</div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "12px", lineHeight: 1.43 }}>
                  <JiraAvatar
                    src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/a00048974f859ab6824d8e80aa3d388dbdfcd90c?placeholderIfAbsent=true"
                    size={36}
                  />
                  <div style={{ color: "rgba(255, 255, 255, 1)" }}>Builder.io Bot</div>
                </div>
              )}
            </div>

            {/* Sprint */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div style={{ color: "rgba(169, 171, 175, 1)", lineHeight: 1.33 }}>Sprint</div>
              <div style={{ color: "rgba(102, 157, 241, 1)", lineHeight: 1.43 }}>Sales Refinement</div>
            </div>

            {/* Priority */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div style={{ color: "rgba(169, 171, 175, 1)", lineHeight: 1.33 }}>Priority</div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", color: "rgba(156, 156, 156, 1)", lineHeight: 1.43 }}>
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/5499a6af148e3c5e86b2ca918e0037197e22eb9b?placeholderIfAbsent=true"
                  alt="Priority"
                  style={{ width: 24, height: 24, objectFit: "contain" }}
                />
                <div>Medium</div>
              </div>
            </div>
          </div>
        </div>

        {/* Development section */}
        <div
          style={{
            marginTop: 24,
            borderRadius: "7px",
            border: "1px solid rgba(44, 45, 47, 1)",
            padding: "14px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: 24, color: "rgba(156, 156, 156, 1)" }}>
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/ea834425960b0663ee3535cc7c0042004387ab59?placeholderIfAbsent=true"
              alt="Development"
              style={{ width: 34, height: 34, objectFit: "contain" }}
            />
            <div>Development</div>
          </div>
        </div>

        {/* More fields section */}
        <div
          style={{
            marginTop: 24,
            borderRadius: "7px",
            border: "1px solid rgba(44, 45, 47, 1)",
            padding: "14px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: 24, color: "rgba(156, 156, 156, 1)" }}>
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/ea834425960b0663ee3535cc7c0042004387ab59?placeholderIfAbsent=true"
              alt="More fields"
              style={{ width: 34, height: 34, objectFit: "contain" }}
            />
            <div>More fields</div>
          </div>
        </div>

        {/* Automation section */}
        <div
          style={{
            marginTop: 24,
            borderRadius: "7px",
            border: "1px solid rgba(44, 45, 47, 1)",
            padding: "14px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: 24, color: "rgba(156, 156, 156, 1)" }}>
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/ea834425960b0663ee3535cc7c0042004387ab59?placeholderIfAbsent=true"
              alt="Automation"
              style={{ width: 34, height: 34, objectFit: "contain" }}
            />
            <div>Automation</div>
          </div>
        </div>
      </div>

      {/* Bottom timestamps section */}
      <div style={{ marginTop: 349 }}>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 18, color: "rgba(169, 171, 175, 1)", lineHeight: 1.33 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <div>Created</div>
            <div>February 24, 2026 at 9:43 AM</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: 8 }}>
            <div>Updated</div>
            <div>3 days ago</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: 20, marginTop: 24 }}>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/3ed304f698b7135da9dd0a5d322a7bf2e1a81d03?placeholderIfAbsent=true"
            alt="Configure"
            style={{ width: 24, height: 24, objectFit: "contain" }}
          />
          <div style={{ color: "rgba(169, 171, 175, 1)" }}>Configure</div>
        </div>
      </div>
    </div>
  );
};
