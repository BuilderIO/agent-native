/**
 * SlackMentionAutocomplete - Autocomplete popup for @mentions
 */
import React from "react";

interface MentionOption {
  avatar: string;
  name: string;
  status?: string;
  type: "person" | "bot";
}

interface SlackMentionAutocompleteProps {
  options: MentionOption[];
  selectedIndex?: number;
  searchTerm?: string;
  opacity?: number;
  translateY?: number;
}

export const SlackMentionAutocomplete: React.FC<SlackMentionAutocompleteProps> = ({
  options,
  selectedIndex = 0,
  searchTerm = "",
  opacity = 1,
  translateY = 0,
}) => {
  return (
    <div
      style={{
        position: "absolute",
        bottom: "100%",
        left: 0,
        marginBottom: 8,
        background: "rgba(34, 37, 41, 1)",
        border: "1px solid rgba(71, 74, 81, 1)",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
        minWidth: 480,
        opacity,
        transform: `translateY(${translateY}px)`,
        transition: "all 0.2s ease",
      }}
    >
      {/* Options list */}
      <div style={{ padding: "6px 0" }}>
        {options.map((option, index) => (
          <div
            key={index}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "10px 16px",
              background: index === selectedIndex ? "rgba(29, 155, 209, 1)" : "transparent",
              cursor: "pointer",
            }}
          >
            {/* Avatar */}
            <img
              src={option.avatar}
              alt=""
              style={{
                width: 28,
                height: 28,
                borderRadius: option.type === "bot" ? 6 : 4,
                objectFit: "cover",
              }}
            />

            {/* Name and status */}
            <div style={{ flex: 1 }}>
              <div
                style={{
                  color: index === selectedIndex ? "rgba(255, 255, 255, 1)" : "rgba(248, 248, 248, 1)",
                  fontSize: 17,
                  fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
                  fontWeight: 600,
                }}
              >
                {option.name}
              </div>
              {option.status && (
                <div
                  style={{
                    color: index === selectedIndex ? "rgba(255, 255, 255, 0.8)" : "rgba(185, 186, 189, 1)",
                    fontSize: 15,
                    fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
                  }}
                >
                  {option.status}
                </div>
              )}
            </div>

            {/* Type badge */}
            {option.type === "bot" && (
              <div
                style={{
                  borderRadius: 3,
                  background: index === selectedIndex ? "rgba(255, 255, 255, 0.2)" : "rgba(248, 248, 248, 0.06)",
                  padding: "3px 8px",
                  fontSize: 12,
                  color: index === selectedIndex ? "rgba(255, 255, 255, 1)" : "rgba(185, 186, 189, 1)",
                  fontFamily: "Inter, -apple-system, Roboto, Helvetica, sans-serif",
                  fontWeight: 600,
                }}
              >
                APP
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
