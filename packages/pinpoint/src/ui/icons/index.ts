// @agent-native/pinpoint — SVG icons from Tabler Icons (MIT)
// https://github.com/tabler/tabler-icons
//
// All icons: 24x24 viewBox, stroke-width 2, stroke-linecap round,
// stroke-linejoin round. Rendered at 16x16 for our UI.

const S =
  'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

export const icons = {
  pin: `<svg ${S}><path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4"/><path d="M9 15l-4.5 4.5"/><path d="M14.5 4l5.5 5.5"/></svg>`,

  mapPin: `<svg ${S}><path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/><path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0"/></svg>`,

  crosshair: `<svg ${S}><path d="M4 8v-2a2 2 0 0 1 2 -2h2"/><path d="M4 16v2a2 2 0 0 0 2 2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M16 20h2a2 2 0 0 0 2 -2v-2"/><path d="M9 12l6 0"/><path d="M12 9l0 6"/></svg>`,

  send: `<svg ${S}><path d="M10 14l11 -11"/><path d="M21 3l-6.5 18a.55 .55 0 0 1 -1 0l-3.5 -7l-7 -3.5a.55 .55 0 0 1 0 -1l18 -6.5"/></svg>`,

  copy: `<svg ${S}><path d="M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z"/><path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1"/></svg>`,

  trash: `<svg ${S}><path d="M4 7l16 0"/><path d="M10 11l0 6"/><path d="M14 11l0 6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"/></svg>`,

  settings: `<svg ${S}><path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065"/><path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/></svg>`,

  x: `<svg ${S}><path d="M18 6l-12 12"/><path d="M6 6l12 12"/></svg>`,

  chevronDown: `<svg ${S}><path d="M6 9l6 6l6 -6"/></svg>`,

  check: `<svg ${S}><path d="M5 12l5 5l10 -10"/></svg>`,

  messageSquare: `<svg ${S}><path d="M8 9h8"/><path d="M8 13h6"/><path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12"/></svg>`,

  eye: `<svg ${S}><path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"/></svg>`,

  fileCode: `<svg ${S}><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2"/><path d="M10 13l-1 2l1 2"/><path d="M14 13l1 2l-1 2"/></svg>`,

  history: `<svg ${S}><path d="M12 8l0 4l2 2"/><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5"/></svg>`,

  minus: `<svg ${S}><path d="M5 12l14 0"/></svg>`,

  // Draw mode icons
  pencil: `<svg ${S}><path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4"/><path d="M13.5 6.5l4 4"/></svg>`,
  arrowUpRight: `<svg ${S}><path d="M17 7l-10 10"/><path d="M8 7l9 0l0 9"/></svg>`,
  circle: `<svg ${S}><circle cx="12" cy="12" r="9"/></svg>`,
  square: `<svg ${S}><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`,
  typography: `<svg ${S}><path d="M4 20l3 0"/><path d="M14 20l7 0"/><path d="M6.9 15l6.9 0"/><path d="M10.2 6.3l5.8 13.7"/><path d="M5 20l6 -16l2 0l7 16"/></svg>`,
  undo: `<svg ${S}><path d="M9 14l-4 -4l4 -4"/><path d="M5 10h11a4 4 0 1 1 0 8h-1"/></svg>`,
  palette: `<svg ${S}><path d="M12 21a9 9 0 0 1 0 -18c4.97 0 9 3.582 9 8c0 1.06 -.474 2.078 -1.318 2.828c-.844 .75 -1.989 1.172 -3.182 1.172h-2.5a2 2 0 0 0 -1 3.75a1.3 1.3 0 0 1 -1 2.25"/><circle cx="8.5" cy="10.5" r="1"/><circle cx="12.5" cy="7.5" r="1"/><circle cx="16.5" cy="10.5" r="1"/></svg>`,
  lineWeight: `<svg ${S}><path d="M4 6h16"/><path d="M4 12h16" stroke-width="3"/><path d="M4 18h16" stroke-width="5"/></svg>`,

  // Voice icon
  microphone: `<svg ${S}><path d="M9 2m0 3a3 3 0 0 1 3 -3h0a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3z"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M8 21l8 0"/><path d="M12 17l0 4"/></svg>`,
  microphoneOff: `<svg ${S}><path d="M3 3l18 18"/><path d="M9 5a3 3 0 0 1 6 0v5a3 3 0 0 1 -.13 .874m-2 2a3 3 0 0 1 -3.87 -2.872v-1"/><path d="M5 10a7 7 0 0 0 10.846 5.85m2 -2a6.967 6.967 0 0 0 1.152 -3.85"/><path d="M8 21l8 0"/><path d="M12 17l0 4"/></svg>`,

  // Queue & batch icons
  plus: `<svg ${S}><path d="M12 5l0 14"/><path d="M5 12l14 0"/></svg>`,
  stack: `<svg ${S}><path d="M12 2l-8 4l8 4l8 -4l-8 -4"/><path d="M4 10l8 4l8 -4"/><path d="M4 14l8 4l8 -4"/></svg>`,
  checkSquare: `<svg ${S}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2l4 -4"/></svg>`,
  squareEmpty: `<svg ${S}><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`,
  bolt: `<svg ${S}><path d="M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11"/></svg>`,
  checkCircle: `<svg ${S}><circle cx="12" cy="12" r="9"/><path d="M9 12l2 2l4 -4"/></svg>`,
} as const;

export type IconName = keyof typeof icons;
