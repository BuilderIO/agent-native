/**
 * SlackMiddleSidebar - Middle sidebar with workspace, channels, DMs, and apps
 */
import React from "react";
import { SlackChannelItem } from "./SlackChannelItem";
import { SlackDMItem } from "./SlackDMItem";

interface SlackMiddleSidebarProps {
  height: number;
  activeChannel?: string;
  channelHoverStates?: Record<string, number>;
  dmHoverStates?: Record<string, number>;
}

export const SlackMiddleSidebar: React.FC<SlackMiddleSidebarProps> = ({
  height,
  activeChannel = "product-dev",
  channelHoverStates = {},
  dmHoverStates = {},
}) => {
  return (
    <div
      style={{
        width: 380,
        height,
        borderRadius: "11px 0 0 0",
        background: "rgba(0, 0, 0, 0.21)",
        border: "1px solid rgba(105, 105, 105, 0.3)",
        padding: "20px 27px 23px 27px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* Workspace header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              color: "rgba(248, 248, 248, 1)",
              fontSize: 24,
              fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
              fontWeight: 600,
            }}
          >
            ACME Corp
          </div>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/1b94afa382e41835fb2e61cecdbbd658183bd7a0"
            alt=""
            style={{ width: 24, height: 24 }}
          />
        </div>
        <div style={{ display: "flex", gap: 27 }}>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/6dbf3ed70fb12ff518d26ab7254e2ddd2525cd2d"
            alt=""
            style={{ width: 27, height: 27 }}
          />
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/a1131914286b3cfad17f247620d19ea44e169aef"
            alt=""
            style={{ width: 28, height: 28 }}
          />
        </div>
      </div>

      {/* Navigation section */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          fontSize: 19,
          fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
          fontWeight: 400,
          lineHeight: "38px",
          gap: 8,
        }}
      >
        {/* Primary nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/d0320862a7ff00deefa5e15001a1da28a2015a8e"
            alt=""
            style={{ width: 21, height: 21 }}
          />
          <div style={{ color: "#ffffff" }}>Threads</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/0c66a735bdc99661b3214598df69bf23b447999e"
            alt=""
            style={{ width: 21, height: 21 }}
          />
          <div style={{ color: "#ffffff" }}>Drafts & sent</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/2ab3e403f88ac5e5e78a5aac56129f786b5b95bd"
            alt=""
            style={{ width: 21, height: 21 }}
          />
          <div style={{ color: "#ffffff" }}>Directories</div>
        </div>
      </div>

      {/* Secondary nav */}
      <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 26 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/eb75ec77dfb6fae9942b9074ee545969d5b36a86"
            alt=""
            style={{ width: 21, height: 21 }}
          />
          <div style={{ color: "#ffffff", fontSize: 19, lineHeight: "38px" }}>Starred</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/f822f998caa202bd86191023d8e9f054342c4a03"
            alt=""
            style={{ width: 21, height: 21 }}
          />
          <div style={{ color: "#ffffff", fontSize: 19, lineHeight: "38px" }}>External connections</div>
        </div>
      </div>

      {/* Channels section */}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 8 }}>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/b026865fa13a0fdc6521ea1a22ee98f7e63b335a"
            alt=""
            style={{ width: 21, height: 21 }}
          />
          <div style={{ color: "#ffffff", fontSize: 19, lineHeight: "38px" }}>Channels</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <SlackChannelItem
            icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/9347f54e1f68efe048dd55867511b18da39a18a4"
            name="product-dev"
            isActive={activeChannel === "product-dev"}
            hoverProgress={channelHoverStates["product-dev"] || 0}
          />
          <SlackChannelItem
            icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/8d155ab8fd5cf55f021b261a384742f79007302e"
            name="product-ui-updates"
            isActive={activeChannel === "product-ui-updates"}
            hoverProgress={channelHoverStates["product-ui-updates"] || 0}
          />
          <SlackChannelItem
            icon="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/9347f54e1f68efe048dd55867511b18da39a18a4"
            name="insights-market"
            isActive={activeChannel === "insights-market"}
            hoverProgress={channelHoverStates["insights-market"] || 0}
          />
        </div>
      </div>

      {/* Direct Messages section */}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 14 }}>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/04f0987b0e138885f36a07c9b75a4e861424bb74"
            alt=""
            style={{ width: 21, height: 21 }}
          />
          <div style={{ color: "#e3ceeb", fontSize: 19, lineHeight: "38px" }}>Direct messages</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <SlackDMItem
            avatar="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/151a7d6433e4c148d7b8654cde84721864e79b7f"
            name="Amelia Gordon 🍎"
            hoverProgress={dmHoverStates["amelia"] || 0}
          />
          <SlackDMItem
            avatar="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/aa9b59491d9930e5e178fe6257c9675225f7a2e9"
            name="Diego Hernández 👨‍💻"
            hoverProgress={dmHoverStates["diego"] || 0}
          />
          <SlackDMItem
            avatar="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/8c947d0b9db68a275f02d426984c8c30a74b0805"
            name="Jeanne Thomas 🎨"
            hoverProgress={dmHoverStates["jeanne"] || 0}
          />
          <SlackDMItem
            avatar="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/4492eadd5a272871a99343db56280d1e024269a7"
            name="Johnathan Silva"
            hoverProgress={dmHoverStates["johnathan"] || 0}
          />
        </div>
      </div>

      {/* Apps section */}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 14 }}>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/7c481c16df0ec227c32f5249e48f18aa468bd999"
            alt=""
            style={{ width: 21, height: 21 }}
          />
          <div style={{ color: "#e3ceeb", fontSize: 19, lineHeight: "38px" }}>Apps</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "0 17px" }}>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/7ce35bb5623b61d1a3c832cd44546d8c86782686"
            alt=""
            style={{ width: 21, height: 21, borderRadius: 6 }}
          />
          <div style={{ color: "#e3ceeb", fontSize: 19, lineHeight: "38px" }}>Builder.io</div>
        </div>
      </div>
    </div>
  );
};
