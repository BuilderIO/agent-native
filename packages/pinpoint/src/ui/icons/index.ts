// @agent-native/pinpoint — SVG icons
// MIT License
//
// All icons: 24x24 viewBox, rendered at 16x16, strokeWidth 1.5,
// strokeLinecap round, strokeLinejoin round. Consistent optical weight.

const S = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

export const icons = {
  // Pin/marker icon
  pin: `<svg ${S}><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`,

  // Crosshair/target for selection mode
  crosshair: `<svg ${S}><circle cx="12" cy="12" r="8"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>`,

  // Send/paper plane
  send: `<svg ${S}><path d="M9.875 14.125L12.35 19.695a.88.88 0 0 0 1.66-.076L18.814 6.46a.88.88 0 0 0-1.113-1.114L4.543 10.15a.88.88 0 0 0-.076 1.66l5.408 2.315z"/><path d="M9.875 14.125l3.5-3.5"/></svg>`,

  // Copy (two overlapping rectangles)
  copy: `<svg ${S}><path d="M4.75 11.25c0-.828.672-1.5 1.5-1.5h6.5c.828 0 1.5.672 1.5 1.5v6.5c0 .828-.672 1.5-1.5 1.5h-6.5c-.828 0-1.5-.672-1.5-1.5v-6.5z"/><path d="M9.75 6.75v-.5c0-.828.672-1.5 1.5-1.5h6.5c.828 0 1.5.672 1.5 1.5v6.5c0 .828-.672 1.5-1.5 1.5h-.5"/></svg>`,

  // Trash can
  trash: `<svg ${S}><path d="M4 7h16"/><path d="M6 7v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`,

  // Settings gear
  settings: `<svg ${S}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,

  // Close X
  x: `<svg ${S}><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>`,

  // Chevron down
  chevronDown: `<svg ${S}><path d="m6 9 6 6 6-6"/></svg>`,

  // Checkmark
  check: `<svg ${S}><path d="M20 6 9 17l-5-5"/></svg>`,

  // Chat/message bubble
  messageSquare: `<svg ${S}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,

  // Eye
  eye: `<svg ${S}><path d="M3.92 12.75a1 1 0 0 1 0-.7C5.06 9.73 7.73 5.5 12 5.5s6.94 4.23 8.08 6.55a1 1 0 0 1 0 .7C18.94 14.27 16.27 18.5 12 18.5S5.06 14.27 3.92 12.75z"/><circle cx="12" cy="12" r="3"/></svg>`,

  // File with code brackets
  fileCode: `<svg ${S}><path d="M10 12.5 8 15l2 2.5"/><path d="m14 12.5 2 2.5-2 2.5"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/></svg>`,

  // History/clock
  history: `<svg ${S}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>`,
} as const;

export type IconName = keyof typeof icons;
