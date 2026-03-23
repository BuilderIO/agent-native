/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AGENT PANEL ORGANISM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The agent/chat panel for the workspace.
 * Contains tabs, branch info, chat history, and input area.
 *
 * Features:
 * - Mode tabs (Agent, Interact, Code)
 * - Branch and project info
 * - Panel tabs (Agent, Style, Layers, Comments)
 * - Chat/History tabs
 * - Chat messages
 * - Input area with tools
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";
import { UserMessage, AgentMessage } from "./ChatMessage";

export type AgentPanelProps = {
  branchName?: string;
  projectName?: string;
  activeMode?: "agent" | "interact" | "code";
  activePanel?: "agent" | "style" | "layers" | "comments";
  activeChatTab?: "chat" | "history";
  typingProgress?: number;
  menuOpacity?: number;
  menuY?: number;
  menuSelectionProgress?: number;
  sendMessageProgress?: number;
  mentionHintOpacity?: number;
  mentionHintY?: number;
  mentionHintScale?: number;
  typingMessage?: string;
  chatHistory?: Array<{
    type: "user" | "agent";
    message: string;
    toolCards?: { icon: string; text: string }[];
  }>;
  thinkingText?: string;
};

export const AgentPanel: React.FC<AgentPanelProps> = ({
  branchName = "branch-name",
  projectName = "videos",
  activeMode = "interact",
  activePanel = "agent",
  activeChatTab = "chat",
  typingProgress = 0,
  menuOpacity = 0,
  menuY = 10,
  menuSelectionProgress = 0,
  sendMessageProgress = 0,
  mentionHintOpacity = 0,
  mentionHintY = 80,
  mentionHintScale = 0.9,
  typingMessage = "Add a @tile to the dashboard",
  chatHistory = [],
  thinkingText,
}) => {
  // Generate unique ID for scrollbar
  const scrollbarId = React.useMemo(
    () => `agent-scrollbar-${Math.random().toString(36).substr(2, 9)}`,
    [],
  );

  // Ref for chat messages container
  const chatMessagesRef = React.useRef<HTMLDivElement>(null);

  // Chat input state
  const [chatInput, setChatInput] = React.useState("");
  const [isFocused, setIsFocused] = React.useState(false);

  // Typing animation logic - use custom message or default
  const fullMessage = typingMessage;
  // Parse message to extract @mention if present
  const atIndex = fullMessage.indexOf("@");
  const messageBeforeBadge =
    atIndex >= 0 ? fullMessage.substring(0, atIndex) : fullMessage;
  const remainingText = atIndex >= 0 ? fullMessage.substring(atIndex + 1) : "";
  const spaceIndex = remainingText.indexOf(" ");
  const searchText =
    spaceIndex >= 0 ? remainingText.substring(0, spaceIndex) : remainingText;
  const messageAfterBadge =
    spaceIndex >= 0 ? remainingText.substring(spaceIndex) : "";

  // Dynamic component name from @mention
  const componentName = searchText
    ? searchText.charAt(0).toUpperCase() + searchText.slice(1) + " Component"
    : "Tile Component";
  const componentLetter = searchText ? searchText.charAt(0).toUpperCase() : "T";

  // Calculate what should be shown based on typing progress
  let textBeforeBadge = "";
  let textAfterBadge = "";
  let showBadge = false;
  let showMenu = menuOpacity > 0.1 && menuSelectionProgress < 0.9;
  let showPlaceholder = false;
  let isInputActive = false;

  // After send completes, reset to default state
  if (sendMessageProgress > 0.9) {
    showPlaceholder = true;
    isInputActive = false;
  }
  // During typing and before send
  else if (typingProgress > 0) {
    isInputActive = true;

    // If no @mention, just type the whole message straight through
    if (atIndex < 0) {
      const chars = Math.floor(typingProgress * fullMessage.length);
      textBeforeBadge = fullMessage.substring(0, chars);
    }
    // If @mention exists, use phased animation
    else {
      // Phase 1: Type text before @ (0 to 0.15)
      if (typingProgress <= 0.15) {
        const chars = Math.floor(
          (typingProgress / 0.15) * messageBeforeBadge.length,
        );
        textBeforeBadge = messageBeforeBadge.substring(0, chars);
      }
      // Phase 2: Type "@" which triggers menu (0.15 to 0.2)
      else if (typingProgress <= 0.2) {
        textBeforeBadge = messageBeforeBadge + "@";
      }
      // Phase 3: Type search text while menu is open (0.2 to 0.55)
      else if (typingProgress <= 0.55) {
        const progress = (typingProgress - 0.2) / 0.35;
        const chars = Math.floor(progress * searchText.length);
        textBeforeBadge =
          messageBeforeBadge + "@" + searchText.substring(0, chars);
      }
      // Phase 4: After selection, show badge and continue (0.55 to 1.0)
      else {
        showBadge = true;
        textBeforeBadge = messageBeforeBadge;
        const progress = (typingProgress - 0.55) / 0.45;
        const chars = Math.min(
          messageAfterBadge.length,
          Math.ceil(progress * messageAfterBadge.length),
        );
        textAfterBadge =
          progress >= 1
            ? messageAfterBadge
            : messageAfterBadge.substring(0, chars);
      }
    }
  }
  // Before any animation starts
  else {
    showPlaceholder = true;
    isInputActive = false;
  }

  // Scroll to bottom on mount and when hint message appears
  React.useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, []);

  // Keep scrolled to bottom during hint message animation
  React.useEffect(() => {
    if (chatMessagesRef.current && mentionHintOpacity > 0) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [mentionHintOpacity]);

  return (
    <>
      <style>{`
        .${scrollbarId}::-webkit-scrollbar {
          width: 8px;
        }
        .${scrollbarId}::-webkit-scrollbar-track {
          background: transparent;
        }
        .${scrollbarId}::-webkit-scrollbar-thumb {
          background: #4a4a4a;
          border-radius: 9px;
        }
        .${scrollbarId}::-webkit-scrollbar-thumb:hover {
          background: #5a5a5a;
        }
      `}</style>

      <div
        style={{
          backgroundColor: "#191919",
          position: "relative",
          display: "flex",
          width: 393,
          height: "100%",
          padding: "12px 18px 12px",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: "Inter, sans-serif",
        }}
      >
        <div
          style={{
            zIndex: 0,
            display: "flex",
            width: "100%",
            flexDirection: "column",
            flexShrink: 0,
          }}
        >
          {/* Mode tabs (Agent, Interact, Code) */}
          <div
            style={{
              borderRadius: 8,
              backgroundColor: "#2a2a2a",
              borderColor: "#393939",
              borderStyle: "solid",
              borderWidth: 1,
              alignSelf: "start",
              display: "flex",
              minHeight: 43,
              padding: "7px 13px",
              alignItems: "center",
              fontSize: 16,
              color: "#a4a4a4",
              fontWeight: 600,
              textAlign: "center",
              lineHeight: 1.38,
              gap: 13,
            }}
          >
            <div
              style={{ color: activeMode === "agent" ? "#b9b9b9" : "#a4a4a4" }}
            >
              Agent
            </div>
            <div
              style={{
                borderRadius: 6,
                backgroundColor:
                  activeMode === "interact" ? "#48a1ff" : "transparent",
                display: "flex",
                minHeight: 30,
                padding: "5px 4px",
                alignItems: "center",
                color: activeMode === "interact" ? "#151515" : "#a4a4a4",
                justifyContent: "center",
                gap: 4,
                cursor: "pointer",
              }}
            >
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/098e8cc64ad2f588bacd7b8394219d151290cc8b?placeholderIfAbsent=true"
                alt=""
                style={{ width: 18, aspectRatio: 1, objectFit: "contain" }}
              />
              <div>Interact</div>
            </div>
            <div
              style={{ color: activeMode === "code" ? "#b9b9b9" : "#a4a4a4" }}
            >
              Code
            </div>
          </div>

          {/* Branch and project info */}
          <div
            style={{
              display: "flex",
              marginTop: 8,
              width: "100%",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                color: "#999999",
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              {branchName}
            </div>
            <div
              style={{
                color: "#666666",
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              {projectName}
            </div>
          </div>

          {/* Panel tabs (Agent, Style, Layers, Comments) */}
          <div
            style={{
              alignSelf: "start",
              display: "flex",
              marginTop: 10,
              alignItems: "center",
              gap: 23,
              fontSize: 14,
              color: "#a4a4a4",
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            <div
              style={{
                borderRadius: 5,
                backgroundColor:
                  activePanel === "agent" ? "#2a2a2a" : "transparent",
                display: "flex",
                minHeight: 30,
                padding: "7px 12px",
                alignItems: "center",
                color: activePanel === "agent" ? "#b9b9b9" : "#a4a4a4",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              Agent
            </div>
            <div style={{ cursor: "pointer" }}>Style</div>
            <div style={{ cursor: "pointer" }}>Layers</div>
            <div style={{ cursor: "pointer" }}>Comments</div>
          </div>

          {/* Chat/History tabs with Clear Chat button */}
          <div
            style={{
              display: "flex",
              marginTop: 14,
              width: "100%",
              paddingTop: 16,
              alignItems: "center",
              gap: "40px 100px",
              fontWeight: 500,
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "start",
                gap: 18,
                fontSize: 14,
                lineHeight: 1.33,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  color: activeChatTab === "chat" ? "#48a1ff" : "#9c9c9c",
                }}
              >
                <div style={{ cursor: "pointer" }}>Chat</div>
                {activeChatTab === "chat" && (
                  <div
                    style={{
                      backgroundColor: "#48a1ff",
                      height: 2,
                      marginTop: 5,
                    }}
                  />
                )}
              </div>
              <div
                style={{
                  color: activeChatTab === "history" ? "#48a1ff" : "#9c9c9c",
                  cursor: "pointer",
                }}
              >
                History
              </div>
            </div>
            <div
              style={{
                borderRadius: 7,
                backgroundColor: "#191919",
                borderColor: "#393939",
                borderStyle: "solid",
                borderWidth: 1,
                display: "flex",
                minHeight: 33,
                padding: "8px 9px",
                alignItems: "center",
                fontSize: 13,
                color: "#ffffff",
                textAlign: "center",
                lineHeight: 1.45,
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              Clear Chat
            </div>
          </div>
        </div>

        {/* Chat messages area */}
        <div
          ref={chatMessagesRef}
          className={scrollbarId}
          style={{
            display: "flex",
            marginTop: 14,
            marginRight: -18,
            paddingRight: 18,
            width: "calc(100% + 18px)",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            zIndex: 0,
          }}
        >
          {chatHistory.length > 0 ? (
            chatHistory.map((msg, index) =>
              msg.type === "user" ? (
                <UserMessage key={index} text={msg.message} />
              ) : (
                <AgentMessage
                  key={index}
                  showThinking={false}
                  toolCards={msg.toolCards || []}
                  text={msg.message}
                  isCompleted={true}
                  thinkingText={thinkingText}
                />
              ),
            )
          ) : (
            <>
              <UserMessage text="This is a chat message where the user's question will display. If it is too long, a gradient and chevron overlap it, ensuring that the message is concisely shown on screen without taking upp too much space for the" />

              <AgentMessage
                showThinking={true}
                toolCards={[
                  {
                    icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/e5c48e7d9597db495f941e446ea4c08e0d78cb04?placeholderIfAbsent=true",
                    text: "Read client/remotion/compositions/Kin...",
                  },
                  {
                    icon: "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/2a3121902b0446844b18127d6b4bfa5561b73de3?placeholderIfAbsent=true",
                    text: "Todo list (1/3 completed)",
                  },
                ]}
                text="This is the agent's reply to the message above. The agent can reply with markdown, including cards that indicate when it is running skills, tools, or looking at different files."
                isCompleted={true}
                thinkingText={thinkingText}
              />
            </>
          )}

          {/* Action buttons (copy, bookmark, thumbs up/down) */}
          <div
            style={{
              display: "flex",
              width: "100%",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 19 }}>
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/5ace7f16f5b8d8aea30b383964f8e39c3e6b03de?placeholderIfAbsent=true"
                alt=""
                style={{
                  width: 21,
                  aspectRatio: 1,
                  objectFit: "contain",
                  cursor: "pointer",
                }}
              />
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/c4d9e9ce0288c2ea86fb9b3fe3c60cd672e3fe37?placeholderIfAbsent=true"
                alt=""
                style={{
                  width: 21,
                  aspectRatio: 1,
                  objectFit: "contain",
                  cursor: "pointer",
                }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 19 }}>
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/b1425581945a0423d845ecc69a44cebf807fe276?placeholderIfAbsent=true"
                alt=""
                style={{
                  width: 21,
                  aspectRatio: 1,
                  objectFit: "contain",
                  cursor: "pointer",
                }}
              />
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/8a7f9386403125b91e0cbb41562291f207d363bb?placeholderIfAbsent=true"
                alt=""
                style={{
                  width: 21,
                  aspectRatio: 1,
                  objectFit: "contain",
                  cursor: "pointer",
                }}
              />
            </div>
          </div>

          {/* Mention Hint Message */}
          {mentionHintOpacity > 0.01 && (
            <div
              style={{
                marginTop: 24,
                opacity: mentionHintOpacity,
                transform: `translateY(${mentionHintY}px) scale(${mentionHintScale})`,
                fontSize: 45,
                color: "#ffffff",
                textAlign: "left",
                fontWeight: 600,
                lineHeight: 1.2,
              }}
            >
              Mention components and files in chat
            </div>
          )}
        </div>

        {/* Bottom section */}
        <div
          style={{
            zIndex: 0,
            display: "flex",
            width: "100%",
            flexDirection: "column",
            flexShrink: 0,
          }}
        >
          {/* Input area */}
          <div
            style={{
              borderRadius: 8,
              backgroundColor: "#2a2a2a",
              borderColor:
                isInputActive && sendMessageProgress < 0.3
                  ? "#48a1ff"
                  : "transparent",
              borderStyle: "solid",
              borderWidth: 1,
              display: "flex",
              marginTop: 19,
              minHeight: 80,
              width: "100%",
              padding: "12px 15px",
              flexDirection: "column",
              gap: 12,
              transition: "border-color 0.2s ease",
              position: "relative",
            }}
          >
            {/* Contextual Menu */}
            {showMenu && (
              <div
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 8px)",
                  left: 15,
                  backgroundColor: "#2a2a2a",
                  border: "1px solid #393939",
                  borderRadius: 8,
                  padding: "8px 0",
                  minWidth: 240,
                  opacity: menuOpacity,
                  transform: `translateY(${menuY}px)`,
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                  zIndex: 10,
                }}
              >
                {/* Menu items */}
                <div
                  style={{
                    padding: "8px 16px",
                    fontSize: 14,
                    color: "#ffffff",
                    fontWeight: 600,
                    borderBottom: "1px solid #393939",
                    marginBottom: 4,
                  }}
                >
                  Components & Files
                </div>
                <div
                  style={{
                    padding: "8px 16px",
                    fontSize: 14,
                    color: typingProgress > 0.35 ? "#48a1ff" : "#999999",
                    backgroundColor:
                      typingProgress > 0.35
                        ? "rgba(72, 161, 255, 0.1)"
                        : "transparent",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 4,
                      backgroundColor: "#3B82F6",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#ffffff",
                    }}
                  >
                    {componentLetter}
                  </div>
                  <div>{componentName}</div>
                </div>
                <div
                  style={{
                    padding: "8px 16px",
                    fontSize: 14,
                    color: "#666666",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 4,
                      backgroundColor: "#666666",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#ffffff",
                    }}
                  >
                    G
                  </div>
                  <div>Grid Component</div>
                </div>
                <div
                  style={{
                    padding: "8px 16px",
                    fontSize: 14,
                    color: "#666666",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 4,
                      backgroundColor: "#666666",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#ffffff",
                    }}
                  >
                    F
                  </div>
                  <div>utils/filters.ts</div>
                </div>
              </div>
            )}

            {/* Input content */}
            <div
              style={{
                width: "100%",
                minHeight: 40,
                color:
                  textBeforeBadge || textAfterBadge ? "#ffffff" : "#999999",
                fontSize: 15,
                fontFamily: "Inter, sans-serif",
                fontWeight: 400,
                lineHeight: 1.4,
                wordBreak: "break-word",
                overflowWrap: "break-word",
                opacity:
                  sendMessageProgress > 0 && sendMessageProgress < 0.9
                    ? 1 - sendMessageProgress
                    : 1,
                transform:
                  sendMessageProgress > 0 && sendMessageProgress < 0.9
                    ? `translateY(${-sendMessageProgress * 10}px)`
                    : "translateY(0)",
              }}
            >
              <span style={{ wordBreak: "break-word" }}>
                {showPlaceholder ? "Ask Builder" : textBeforeBadge}
              </span>

              {/* Component Badge */}
              {showBadge && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    backgroundColor: "rgba(59, 130, 246, 0.2)",
                    border: "1px solid #3B82F6",
                    borderRadius: 4,
                    padding: "2px 8px",
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#48a1ff",
                    opacity: Math.min(1, (typingProgress - 0.55) * 5),
                    marginLeft: 4,
                    marginRight: 4,
                  }}
                >
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 3,
                      backgroundColor: "#3B82F6",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#ffffff",
                    }}
                  >
                    {componentLetter}
                  </div>
                  {searchText.charAt(0).toUpperCase() + searchText.slice(1)}
                </span>
              )}

              <span style={{ wordBreak: "break-word" }}>{textAfterBadge}</span>
            </div>

            {/* Controls Row */}
            <div
              style={{
                display: "flex",
                width: "100%",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div
                  style={{
                    borderRadius: 7,
                    borderColor: "#393939",
                    borderStyle: "solid",
                    borderWidth: 1,
                    display: "flex",
                    minHeight: 29,
                    padding: "6px 5px",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 29,
                    cursor: "pointer",
                  }}
                >
                  <img
                    src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/463ddbbe453cb95bc577151d9ae8f29eaa9c18fc?placeholderIfAbsent=true"
                    alt=""
                    style={{ width: 19, aspectRatio: 1, objectFit: "contain" }}
                  />
                </div>
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/177f4bcec2486c739c85f0111bcfb07e3a0a90dd?placeholderIfAbsent=true"
                  alt=""
                  style={{
                    width: 19,
                    aspectRatio: 1,
                    objectFit: "contain",
                    cursor: "pointer",
                  }}
                />
                <img
                  src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/fa924377bc54ac9a4239f0fcaf773f667946a235?placeholderIfAbsent=true"
                  alt=""
                  style={{
                    width: 19,
                    aspectRatio: 1,
                    objectFit: "contain",
                    cursor: "pointer",
                  }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 15,
                    color: "#a4a4a4",
                    fontWeight: 500,
                    textAlign: "center",
                    lineHeight: 23 / 15,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 2 }}
                  >
                    <img
                      src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/aa677b80285fcb40b5c5f0b14d76a3bf751edde3?placeholderIfAbsent=true"
                      alt=""
                      style={{
                        width: 21,
                        aspectRatio: 1,
                        objectFit: "contain",
                      }}
                    />
                    <div>Build</div>
                  </div>
                  <img
                    src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/f872b16106ef6bbaea80fcefece2392325659d2c?placeholderIfAbsent=true"
                    alt=""
                    style={{
                      width: 16,
                      aspectRatio: 1,
                      objectFit: "contain",
                      cursor: "pointer",
                    }}
                  />
                </div>
                {/* Send Button */}
                <div
                  onClick={() => {
                    if (chatInput.trim()) {
                      // Send message logic here
                      setChatInput("");
                    }
                  }}
                  style={{
                    borderRadius: 5,
                    backgroundColor: isInputActive ? "#48A1FF" : "#666666",
                    display: "flex",
                    minHeight: 29,
                    padding: "4px",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 29,
                    height: 29,
                    cursor: "pointer",
                    transition: "background-color 0.2s ease",
                    transform:
                      sendMessageProgress > 0 && sendMessageProgress < 0.9
                        ? `scale(${1 - sendMessageProgress * 0.2})`
                        : "scale(1)",
                    opacity:
                      sendMessageProgress > 0.5 && sendMessageProgress < 0.9
                        ? 0
                        : 1,
                  }}
                >
                  <img
                    src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/58080c3f8912ee73cbce06070241ac542b757b7d?placeholderIfAbsent=true"
                    alt=""
                    style={{
                      width: 21,
                      aspectRatio: 1,
                      objectFit: "contain",
                      filter: isInputActive ? "invert(1)" : "none",
                      transition: "filter 0.2s ease",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Feedback button */}
          <div
            style={{
              display: "flex",
              marginTop: 19,
              width: "100%",
              alignItems: "center",
              fontSize: 13,
              color: "#48a1ff",
              fontWeight: 400,
              justifyContent: "space-between",
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", alignItems: "start", gap: 5 }}>
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/edcdfef31a6149b2e950c1d1e9f1f0bc7405c6db?placeholderIfAbsent=true"
                alt=""
                style={{ width: 16, aspectRatio: 1, objectFit: "contain" }}
              />
              <div>Feedback</div>
            </div>
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/c53f4504fbab068ee2697ff788262aa9e260509b?placeholderIfAbsent=true"
              alt=""
              style={{ width: 19, aspectRatio: 1, objectFit: "contain" }}
            />
          </div>
        </div>

        {/* Separator line */}
        <div
          style={{
            borderColor: "#343434",
            borderStyle: "solid",
            borderWidth: 1,
            position: "absolute",
            zIndex: 0,
            maxWidth: "100%",
            width: 393,
            right: 0,
            top: 170,
            height: 0,
          }}
        />
      </div>
    </>
  );
};
