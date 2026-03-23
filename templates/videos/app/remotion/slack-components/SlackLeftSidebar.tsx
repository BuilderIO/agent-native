/**
 * SlackLeftSidebar - Left navigation sidebar with app logo and nav items
 */
import React from "react";
import { SlackNavItem } from "./SlackNavItem";

interface SlackLeftSidebarProps {
  height: number;
  activeNav?: string;
  navHoverStates?: Record<string, number>;
}

export const SlackLeftSidebar: React.FC<SlackLeftSidebarProps> = ({
  height,
  activeNav = "home",
  navHoverStates = {},
}) => {
  const navItems = [
    {
      id: "home",
      icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/9373ffc5818d27d9209df837578bf8fcb54420c1",
      label: "Home",
    },
    {
      id: "dms",
      icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/f5ed0c5f733675cdfecd86a10b38c946191903b6",
      label: "DMs",
    },
    {
      id: "activity",
      icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/a0522d4f6d842d43f921979715bf93fa8ce44652",
      label: "Activity",
    },
    {
      id: "later",
      icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/7ccacca6ce3f50b962ee145b4d3f4286138e7f32",
      label: "Later",
    },
    {
      id: "more",
      icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/d619e88db5bb5f128097528c2c74c0862f2190a2",
      label: "More",
    },
  ];

  return (
    <div
      style={{
        width: 100,
        height,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 8px 22px 8px",
      }}
    >
      {/* Top section - Logo + Nav */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* Logo */}
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 11,
            background: "rgba(34, 23, 49, 1)",
            border: "1px solid rgba(75, 49, 109, 1)",
            marginBottom: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <img
            src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fcd42ff265932419eab766453529f970a?format=webp&width=800&height=1200"
            alt="Logo"
            style={{
              width: 44,
              height: 44,
              objectFit: "contain",
            }}
          />
        </div>

        {/* Nav items */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
          }}
        >
          {navItems.map((item) => (
            <SlackNavItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              isActive={activeNav === item.id}
              hoverProgress={navHoverStates[item.id] || 0}
            />
          ))}
        </div>
      </div>

      {/* Bottom section - User avatar */}
      <div style={{ position: "relative", width: 57, height: 119 }}>
        <div
          style={{
            borderRadius: 24,
            background: "rgba(239, 225, 245, 0.25)",
            width: 49,
            height: 49,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/20a21218b52620103bbef7ae2da41e68f76ca21f"
            alt=""
            style={{ width: 27, height: 27 }}
          />
        </div>
        <img
          src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/316cb3c8e5942d3ecd8c58cbba3a3092596d7f10"
          alt=""
          style={{
            width: 58,
            height: 59,
            position: "absolute",
            right: -7,
            bottom: -5,
          }}
        />
      </div>
    </div>
  );
};
