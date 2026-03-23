/**
 * SlackMainContent - Main chat area with messages and input
 */
import React from "react";
import { SlackMessageCard } from "./SlackMessageCard";
import { SlackMentionAutocomplete } from "./SlackMentionAutocomplete";

interface MentionOption {
  avatar: string;
  name: string;
  status?: string;
  type: "person" | "bot";
}

interface SlackMainContentProps {
  width: number;
  height: number;
  currentFrame?: number;
  messageHoverStates?: Record<string, number>;
  typedText?: string;
  showMentionPill?: boolean;
  mentionPillSpring?: number;
  showMentionAutocomplete?: boolean;
  showDiegoMessage?: boolean;
  mentionAutocompleteOpacity?: number;
  mentionAutocompleteOptions?: MentionOption[];
  mentionSearchTerm?: string;
  diegoMessageOpacity?: number;
  diegoMessageScale?: number;
  diegoMessageY?: number;
  showThreadIndicator?: boolean;
  threadIndicatorOpacity?: number;
  threadIndicatorHoverProgress?: number;
  existingMessagesY?: number;
}

export const SlackMainContent: React.FC<SlackMainContentProps> = ({
  width,
  height,
  currentFrame = 0,
  messageHoverStates = {},
  typedText = "",
  showMentionPill = false,
  mentionPillSpring = 0,
  showMentionAutocomplete = false,
  showDiegoMessage = true,
  mentionAutocompleteOpacity = 0,
  mentionAutocompleteOptions = [],
  mentionSearchTerm = "",
  diegoMessageOpacity = 1,
  diegoMessageScale = 1,
  diegoMessageY = 0,
  showThreadIndicator = true,
  threadIndicatorOpacity = 1,
  threadIndicatorHoverProgress = 0,
  existingMessagesY = 0,
}) => {
  return (
    <div
      style={{
        width,
        height,
        background: "rgba(26, 29, 33, 1)",
        borderRight: "1px solid rgba(56, 58, 56, 1)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Channel header */}
      <div
        style={{
          padding: "20px 28px",
          borderBottom: "1px solid rgba(56, 58, 56, 1)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        {/* Left - Channel info */}
        <div style={{ display: "flex", alignItems: "start", gap: 11 }}>
          <div
            style={{
              borderRadius: 11,
              border: "1px solid rgba(121, 124, 129, 0.3)",
              width: 38,
              height: 38,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/885ac21ce0a600ad36192324c399d1e6b66dfa25"
              alt=""
              style={{ width: 27, height: 27 }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/564aa0770a3170daff4c28c43cfc1a73214b6908"
              alt=""
              style={{ width: 24, height: 24 }}
            />
            <div
              style={{
                color: "rgba(255, 255, 255, 1)",
                fontSize: 24,
                fontFamily:
                  "Inter, -apple-system, Roboto, Helvetica, sans-serif",
                fontWeight: 600,
              }}
            >
              product-dev
            </div>
          </div>
        </div>

        {/* Right - Action icons */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              borderRadius: 9,
              border: "1px solid rgba(121, 124, 129, 0.3)",
              padding: 5,
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/64b68b95d755a23fdba79554403fdb1c8bf86de0"
              alt=""
              style={{ width: 23, height: 23 }}
            />
            <div
              style={{
                color: "#e8e8e8",
                fontSize: 15,
                fontFamily:
                  "Inter, -apple-system, Roboto, Helvetica, sans-serif",
              }}
            >
              106
            </div>
          </div>
          <div
            style={{
              borderRadius: 9,
              border: "1px solid rgba(121, 124, 129, 0.3)",
              padding: 4,
            }}
          >
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/3f48874fe317a99eba5a776a8775cf8a5bbd61a2"
              alt=""
              style={{ width: 23, height: 23 }}
            />
          </div>
          <div
            style={{
              borderRadius: 9,
              background: "rgba(26, 29, 33, 1)",
              border: "1px solid rgba(121, 124, 129, 0.3)",
              padding: 5,
              width: 33,
              height: 33,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/db7d5c5f1a92252365ac7324854cb850d0156a50"
              alt=""
              style={{ width: 23, height: 23 }}
            />
          </div>
          <div
            style={{
              borderRadius: 9,
              border: "1px solid rgba(121, 124, 129, 0.3)",
              padding: 5,
            }}
          >
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/0d84df06c1196cd15972273ccc0af848abb8a486"
              alt=""
              style={{ width: 23, height: 23 }}
            />
          </div>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/5c38f12b1fb92c4f623f8c2adc178b494c43261b"
            alt=""
            style={{ width: 24, height: 24 }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 29,
          padding: "0 26px",
          borderBottom: "1px solid rgba(56, 58, 56, 1)",
          fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
          fontSize: 15,
          fontWeight: 400,
        }}
      >
        <div
          style={{
            borderBottom: "1px solid rgba(255, 255, 255, 1)",
            height: 42,
            display: "flex",
            alignItems: "center",
            gap: 5,
            color: "rgba(248, 248, 248, 1)",
          }}
        >
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/d149f11e9e95005fd0d5f269b545dbf6669f236c"
            alt=""
            style={{ width: 18, height: 18 }}
          />
          <div>Messages</div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            color: "rgba(185, 186, 189, 1)",
          }}
        >
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/5f60d22d1bc5fdb57dec00c4d342f406e0d39c26"
            alt=""
            style={{ width: 19, height: 19 }}
          />
          <div>Pins</div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            color: "rgba(185, 186, 189, 1)",
          }}
        >
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/9f820a75da7919a9394cf160070f3c631cf2dd1c"
            alt=""
            style={{ width: 19, height: 19 }}
          />
          <div>Files</div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "rgba(185, 186, 189, 1)",
          }}
        >
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/2872fa9196503b5abeb122839baf9e05b4b62cce"
            alt=""
            style={{ width: 18, height: 18 }}
          />
          <div>How to use Builder.io</div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginLeft: "auto",
            color: "rgba(185, 186, 189, 1)",
          }}
        >
          <div>More</div>
          <img
            src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/60e50d59712ec33d5f7c588a331a4d2da0dca9c4"
            alt=""
            style={{ width: 7, height: 4 }}
          />
        </div>
        <img
          src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/2be58029bd48fdb8396492b3fdc5ce9725ad0645"
          alt=""
          style={{ width: 19, height: 19 }}
        />
      </div>

      {/* Messages area */}
      <div
        style={{
          flex: 1,
          padding: "17px 23px 24px 23px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
        }}
        className="slack-scrollbar"
      >
        <style>{`
          .slack-scrollbar::-webkit-scrollbar {
            width: 8px;
          }
          .slack-scrollbar::-webkit-scrollbar-track {
            background: rgba(26, 29, 33, 0.4);
            border-radius: 4px;
          }
          .slack-scrollbar::-webkit-scrollbar-thumb {
            background: rgba(121, 124, 129, 0.4);
            border-radius: 4px;
          }
          .slack-scrollbar::-webkit-scrollbar-thumb:hover {
            background: rgba(121, 124, 129, 0.6);
          }
        `}</style>

        {/* Existing messages that spring up when Diego's message appears */}
        <div
          style={{
            transform: `translateY(${existingMessagesY}px)`,
            transition: "none",
          }}
        >
          <SlackMessageCard
            avatar="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/278c3a3a19450b3d5a7669ac7fa91cb8897e5a31"
            author="Johnathan Silva"
            timestamp="Feb 10th at 9:15 AM"
            content="Morning team! Quick reminder about the product roadmap meeting at 2pm today."
            hoverProgress={messageHoverStates["msg0"] || 0}
          />

          <SlackMessageCard
            avatar="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/862aa22e4f8bc58a7866e05b1b45847e983508cc"
            author="Kyle Denver 🏗️"
            timestamp="Feb 11th at 4:32 PM"
            content="Just pushed the new build to staging. Let me know if you see any issues!"
            reactions={[{ emoji: "👍", count: 4 }]}
            hoverProgress={messageHoverStates["msg0b"] || 0}
          />

          <SlackMessageCard
            avatar="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/142cbada6c9a1e1765e83eed51088e3cca4d3067"
            author="Amelia Gordon 🍎"
            timestamp="Feb 13th at 10:20 AM"
            content="Yesterday our dev team launched a new feature for users who needed to migrate their accounts from the old infrastructure. We are seeing massive performance improvements, up 23%. Thanks team! 🎉"
            reactions={[
              { emoji: "🎉", count: 12 },
              { emoji: "🔥", count: 5 },
            ]}
            hoverProgress={messageHoverStates["msg1"] || 0}
          />

          <SlackMessageCard
            avatar="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/278c3a3a19450b3d5a7669ac7fa91cb8897e5a31"
            author="Johnathan Silva"
            timestamp="Feb 15th at 3:24 PM"
            content="Updated our internal analytics tools, please take a look!"
            reactions={[{ emoji: "👀", count: 3 }]}
            hoverProgress={messageHoverStates["msg2"] || 0}
          />

          <SlackMessageCard
            avatar="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/862aa22e4f8bc58a7866e05b1b45847e983508cc"
            author="Kyle Denver 🏗️"
            timestamp="Feb 18th at 12:54 PM"
            content="Do we have any sales data for the quarter yet?"
            hoverProgress={messageHoverStates["msg3"] || 0}
          />

          <SlackMessageCard
            avatar="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/d98b788ade4bdaeacda5b41f4f74a2d4f11b2fe7"
            author="Jeanne Thomas 🎨"
            timestamp="Feb 23rd at 1:44 PM"
            content={
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    borderRadius: 5,
                    background: "rgba(26, 54, 69, 0.68)",
                    padding: "0 6px",
                    color: "rgba(42, 161, 201, 1)",
                  }}
                >
                  @Diego
                </div>
                <div>
                  Try asking the Builder bot to add that new feature in this
                  channel
                </div>
              </div>
            }
            threadReplies={2}
            threadPreview="Last reply 5hr ago"
            threadAvatar="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/b66cecca9f47c8e283bea7334ed7658019b2c15d"
            hoverProgress={messageHoverStates["msg4"] || 0}
          />
        </div>

        {showDiegoMessage && (
          <div
            style={{
              opacity: diegoMessageOpacity,
              transform: `translateY(${diegoMessageY}px) scale(${diegoMessageScale})`,
              transformOrigin: "center top",
            }}
          >
            <SlackMessageCard
              avatar="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/b66cecca9f47c8e283bea7334ed7658019b2c15d"
              author="Diego Hernández 👨‍💻"
              timestamp="Feb 23rd at 2:15 PM"
              content={
                <div>
                  <div
                    style={{
                      borderRadius: 5,
                      background: "rgba(26, 54, 69, 0.68)",
                      padding: "0 6px",
                      color: "rgba(42, 161, 201, 1)",
                      display: "inline-block",
                      marginRight: 6,
                    }}
                  >
                    @Builder.io
                  </div>
                  Can you help me build a dashboard for our sales attribution
                  for the Q4 2025 range with stats broken down per sales rep?
                </div>
              }
              threadReplies={showThreadIndicator ? 1 : undefined}
              threadPreview={showThreadIndicator ? "Just now" : undefined}
              threadAvatar={
                showThreadIndicator
                  ? "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/fb1e1e3359a5886deb33a4b219cc295590c17bbb"
                  : undefined
              }
              threadIndicatorOpacity={threadIndicatorOpacity}
              threadIndicatorHoverProgress={threadIndicatorHoverProgress}
              hoverProgress={messageHoverStates["msg5"] || 0}
            />
          </div>
        )}
      </div>

      {/* Message input area */}
      <div
        style={{
          position: "relative",
          borderRadius: 12,
          background: "rgba(34, 37, 41, 1)",
          border: "1px solid rgba(86, 88, 86, 1)",
          margin: "0 23px 24px 23px",
          padding: 12,
        }}
      >
        {/* Mention autocomplete */}
        {showMentionAutocomplete && (
          <SlackMentionAutocomplete
            options={mentionAutocompleteOptions}
            selectedIndex={0}
            searchTerm={mentionSearchTerm}
            opacity={mentionAutocompleteOpacity}
          />
        )}

        <div
          style={{
            color:
              typedText || showMentionPill
                ? "rgba(248, 248, 248, 1)"
                : "rgba(154, 155, 158, 1)",
            fontSize: 18,
            fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
            marginBottom: 23,
            minHeight: 20,
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {showMentionPill ? (
            <>
              {(() => {
                // Calculate shine progress from frames 163 to 170 (completes and exits by 170)
                const shineProgress =
                  currentFrame >= 163 && currentFrame <= 170
                    ? (currentFrame - 163) / (170 - 163)
                    : currentFrame > 170
                      ? 1
                      : 0;

                // Fade out in the last 50% of the animation
                const shineOpacity =
                  shineProgress > 0.5
                    ? 0.5 * (1 - (shineProgress - 0.5) / 0.5)
                    : 0.5;

                return (
                  <span
                    style={{
                      position: "relative",
                      borderRadius: 5,
                      background: "rgba(26, 54, 69, 0.68)",
                      padding: "2px 8px",
                      color: "rgba(42, 161, 201, 1)",
                      marginRight: 6,
                      display: "inline-block",
                      transform: `translateX(${(1 - mentionPillSpring) * -15}px)`,
                      opacity: mentionPillSpring,
                      overflow: "hidden",
                    }}
                  >
                    @Builder.io
                    {/* Gradient shine effect - tracks through badge and fades out as it exits */}
                    {shineProgress > 0 && shineProgress < 1 && (
                      <div
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          background: `linear-gradient(90deg,
                            transparent ${Math.max(0, shineProgress * 150 - 50)}%,
                            rgba(100, 220, 255, ${shineOpacity}) ${shineProgress * 150}%,
                            transparent ${Math.min(200, shineProgress * 150 + 50)}%)`,
                          pointerEvents: "none",
                        }}
                      />
                    )}
                  </span>
                );
              })()}
              {typedText}
            </>
          ) : (
            typedText || "Message #product-dev"
          )}
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
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/6ab43e90d4500263af1960fe06b5ec9ab2017a21"
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
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Send button - turns green when typing */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                borderRadius: 6,
                background:
                  typedText || showMentionPill ? "#007B5B" : "transparent",
                transition: "background-color 0.2s ease",
              }}
            >
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/fbfd71806d43ebea1b056bfc110d15e75deb17f3"
                alt=""
                style={{ width: 18, height: 18 }}
              />
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/8b5539b04931b92d1e984e62be65a81159f8b74b"
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
