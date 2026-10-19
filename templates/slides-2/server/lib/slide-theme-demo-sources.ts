function restoreSourceTemplateEscapes(value: string): string {
  return value.replaceAll("\\`", "`").replaceAll("\\${", "${");
}

const AERO_DEMO_SOURCE = restoreSourceTemplateEscapes(String.raw`import {
  type DesignSystem,
  type Page,
  useIsActivePage,
  useSlidePageNumber,
} from '@open-slide/core';
import type { CSSProperties, ReactNode } from 'react';

export const design: DesignSystem = {
  palette: { bg: '#4B1DFF', text: '#FFFFFF', accent: '#D8FF2E' }, // guard:allow-raw-color — authored slide theme demo color, not app chrome.
  fonts: {
    display: '"Barlow Condensed", "Arial Narrow", system-ui, sans-serif',
    body: '"Barlow", system-ui, sans-serif',
  },
  typeScale: { hero: 320, body: 30 },
  radius: 0,
};

const INK = '#0B0A14'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const CORAL = '#FF4A3D'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const DEEP = '#2A0FA3'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const LAV = '#D3CAFF'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const WHITE_A = (a: number) => \`rgba(255,255,255,\${a})\`; // guard:allow-raw-color — authored slide theme demo color, not app chrome.

const KEYFRAMES = \`
@keyframes ae-run { from { transform: translateX(0) } to { transform: translateX(calc(var(--tile) * -1)) } }
@keyframes ae-in { from { opacity: 0; transform: translateX(-56px) } to { opacity: 1; transform: none } }
@keyframes ae-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes ae-pace { to { stroke-dashoffset: -1000 } }
\`;

const ANGLE = 12;
const T = 0.21255656167;
const SKEW = \`skewX(-\${ANGLE}deg)\`;

const cut = (h: number) => {
  const d = (h * T).toFixed(2);
  return \`polygon(\${d}px 0, 100% 0, calc(100% - \${d}px) 100%, 0 100%)\`;
};

const BAND_RATIO = 12;
const BAND_PCT = ((T / BAND_RATIO) * 100).toFixed(4);
const BAND_CLIP = \`polygon(\${BAND_PCT}% 0, 100% 0, \${(100 - Number(BAND_PCT)).toFixed(4)}% 100%, 0 100%)\`;

const SNAP = 'cubic-bezier(0.16, 1, 0.3, 1)';

type Tone = 'uv' | 'volt' | 'ink';

const TONES: Record<Tone, { bg: string; fg: string; dim: string; hi: string; hiFg: string }> = {
  uv: { bg: 'var(--osd-bg)', fg: 'var(--osd-text)', dim: LAV, hi: 'var(--osd-accent)', hiFg: INK },
  volt: {
    bg: 'var(--osd-accent)',
    fg: INK,
    dim: 'rgba(11,10,20,0.66)', // guard:allow-raw-color — authored slide theme demo color, not app chrome.
    hi: INK,
    hiFg: 'var(--osd-accent)',
  },
  ink: {
    bg: INK,
    fg: 'var(--osd-text)',
    dim: 'rgba(255,255,255,0.6)', // guard:allow-raw-color — authored slide theme demo color, not app chrome.
    hi: 'var(--osd-accent)',
    hiFg: INK,
  },
};

const DISPLAY: CSSProperties = {
  fontFamily: 'var(--osd-font-display)',
  fontStyle: 'italic',
  fontWeight: 900,
  textTransform: 'uppercase',
  lineHeight: 0.84,
  letterSpacing: '-0.012em',
  margin: 0,
};

const NUM: CSSProperties = {
  ...DISPLAY,
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '-0.015em',
};

const LABEL: CSSProperties = {
  fontFamily: 'var(--osd-font-body)',
  fontSize: 20,
  fontWeight: 600,
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  lineHeight: 1.2,
};

const BODY: CSSProperties = {
  fontFamily: 'var(--osd-font-body)',
  fontSize: 30,
  fontWeight: 500,
  lineHeight: 1.4,
  margin: 0,
};

const abs = (left: number, top: number, extra?: CSSProperties): CSSProperties => ({
  position: 'absolute',
  left,
  top,
  ...extra,
});

const pad = (n: number) => String(n).padStart(2, '0');

const Title = ({
  children,
  size = 132,
  x = 116,
  y = 160,
  style,
}: {
  children: ReactNode;
  size?: number;
  x?: number;
  y?: number;
  style?: CSSProperties;
}) => <h2 style={{ ...DISPLAY, ...abs(x, y), fontSize: size, ...style }}>{children}</h2>;

const Footer = ({
  tone,
  brand = 'Tempo',
  title = 'Season plan',
  meta = '2027 · Confidential',
}: {
  tone: Tone;
  brand?: string;
  title?: string;
  meta?: string;
}) => {
  const { current, total } = useSlidePageNumber();
  const t = TONES[tone];
  return (
    <div
      style={{
        ...LABEL,
        position: 'absolute',
        left: 120,
        right: 120,
        top: 1004,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        fontSize: 17,
        color: t.dim,
        zIndex: 5,
      }}
    >
      <span
        style={{
          ...NUM,
          width: 64,
          height: 32,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: t.hi,
          color: t.hiFg,
          clipPath: cut(32),
          fontSize: 24,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: 0,
        }}
      >
        {pad(current)}
      </span>
      <span style={{ fontVariantNumeric: 'tabular-nums', marginLeft: -8 }}>/ {pad(total)}</span>
      <span style={{ color: t.fg, marginLeft: 14 }}>{brand}</span>
      <span>{title}</span>
      <span style={{ marginLeft: 'auto' }}>{meta}</span>
    </div>
  );
};

const Stage = ({
  tone = 'uv',
  footer = true,
  children,
}: {
  tone?: Tone;
  footer?: boolean;
  children: ReactNode;
}) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      position: 'relative',
      overflow: 'hidden',
      isolation: 'isolate',
      background: TONES[tone].bg,
      color: TONES[tone].fg,
      fontFamily: 'var(--osd-font-body)',
    }}
  >
    {children}
    {footer && <Footer tone={tone} />}
  </div>
);

const Kicker = ({
  tag,
  children,
  tone = 'uv',
  x = 120,
  y = 104,
}: {
  tag: string;
  children: ReactNode;
  tone?: Tone;
  x?: number;
  y?: number;
}) => {
  const t = TONES[tone];
  return (
    <div
      style={abs(x, y, { ...LABEL, display: 'flex', alignItems: 'center', gap: 18, color: t.fg })}
    >
      <span
        style={{
          ...LABEL,
          height: 32,
          padding: '0 18px',
          display: 'inline-flex',
          alignItems: 'center',
          background: t.hi,
          color: t.hiFg,
          clipPath: cut(32),
          fontWeight: 700,
          fontSize: 17,
        }}
      >
        {tag}
      </span>
      {children}
    </div>
  );
};

const Mark = ({ color, h = 34 }: { color: string; h?: number }) => (
  <div style={{ display: 'flex', gap: h * 0.16 }}>
    <div style={{ width: h * 0.3, height: h, background: color, transform: SKEW }} />
    <div style={{ width: h * 0.3, height: h, background: color, transform: SKEW, opacity: 0.7 }} />
    <div style={{ width: h * 0.3, height: h, background: color, transform: SKEW, opacity: 0.4 }} />
  </div>
);

const Wordmark = ({
  x,
  y,
  brand = 'Tempo',
  color = 'var(--osd-text)',
  mark = 'var(--osd-accent)',
}: {
  x: number;
  y: number;
  brand?: string;
  color?: string;
  mark?: string;
}) => (
  <div style={abs(x, y, { display: 'flex', alignItems: 'center', gap: 18, zIndex: 4 })}>
    <Mark color={mark} />
    <span style={{ ...DISPLAY, fontSize: 46, letterSpacing: '0.02em', color, lineHeight: 1 }}>
      {brand}
    </span>
  </div>
);

const Streak = ({
  y,
  h,
  tile,
  dash,
  color,
  dur,
  shift = 0,
  live,
}: {
  y: number;
  h: number;
  tile: number;
  dash: number;
  color: string;
  dur: number;
  shift?: number;
  live: boolean;
}) => (
  <div
    style={{
      position: 'absolute',
      left: -80,
      top: y,
      width: 2080,
      height: h,
      overflow: 'hidden',
      transform: SKEW,
    }}
  >
    <div
      style={
        {
          '--tile': \`\${tile}px\`,
          width: 2080 + tile,
          height: h,
          backgroundImage: \`linear-gradient(90deg, \${color} 0 \${dash}px, transparent \${dash}px)\`,
          backgroundSize: \`\${tile}px \${h}px\`,
          backgroundRepeat: 'repeat-x',
          backgroundPosition: \`\${shift}px 0\`,
          animation: live ? \`ae-run \${dur}s linear infinite\` : undefined,
        } as CSSProperties
      }
    />
  </div>
);

const VoltBand = ({ x, y, w }: { x: number; y: number; w: number }) => (
  <div
    style={{
      position: 'absolute',
      left: x,
      top: y,
      width: w,
      height: w / BAND_RATIO,
      background: 'var(--osd-accent)',
      clipPath: BAND_CLIP,
    }}
  />
);

const CutBar = ({
  x,
  y,
  w,
  h,
  color,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}) => (
  <div
    style={{
      position: 'absolute',
      left: x,
      top: y,
      width: w,
      height: h,
      background: color,
      clipPath: cut(h),
    }}
  />
);

const SkewRule = ({
  x,
  y,
  h,
  w = 6,
  color = 'var(--osd-accent)',
}: {
  x: number;
  y: number;
  h: number;
  w?: number;
  color?: string;
}) => (
  <div
    style={abs(x, y, {
      width: w,
      height: h,
      background: color,
      transform: SKEW,
      transformOrigin: '0 100%',
    })}
  />
);

const Chip = ({
  children,
  bg = CORAL,
  fg = INK,
  h = 34,
}: {
  children: ReactNode;
  bg?: string;
  fg?: string;
  h?: number;
}) => (
  <span
    style={{
      ...LABEL,
      fontSize: 18,
      fontWeight: 700,
      letterSpacing: '0.14em',
      height: h,
      padding: '0 16px',
      display: 'inline-flex',
      alignItems: 'center',
      background: bg,
      color: fg,
      clipPath: cut(h),
    }}
  >
    {children}
  </span>
);

const SpecChip = ({ children }: { children: ReactNode }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 22 }}>
    <span style={{ width: 4, height: 22, background: 'var(--osd-accent)', transform: SKEW }} />
    {children}
  </span>
);

const COVER_STREAKS = [
  { y: 152, h: 6, tile: 560, dash: 300, color: DEEP, dur: 2.6, shift: 0 },
  { y: 184, h: 2, tile: 380, dash: 140, color: WHITE_A(0.3), dur: 1.7, shift: -90 },
  { y: 236, h: 16, tile: 920, dash: 560, color: DEEP, dur: 3.4, shift: -300 },
  { y: 310, h: 3, tile: 460, dash: 180, color: WHITE_A(0.22), dur: 2.1, shift: -200 },
  { y: 372, h: 28, tile: 1180, dash: 720, color: DEEP, dur: 4.2, shift: -520 },
  { y: 462, h: 3, tile: 340, dash: 120, color: WHITE_A(0.3), dur: 1.5, shift: -40 },
  { y: 512, h: 10, tile: 760, dash: 380, color: DEEP, dur: 3, shift: -610 },
  { y: 590, h: 2, tile: 300, dash: 90, color: WHITE_A(0.36), dur: 1.3, shift: -150 },
  { y: 628, h: 20, tile: 980, dash: 520, color: DEEP, dur: 3.8, shift: -120 },
  { y: 880, h: 8, tile: 640, dash: 260, color: DEEP, dur: 2.4, shift: -330 },
  { y: 958, h: 14, tile: 840, dash: 420, color: DEEP, dur: 3.2, shift: -700 },
];

const Cover: Page = () => {
  const live = false;
  const enter = (delay: number): CSSProperties =>
    live ? { animation: \`ae-in 0.8s \${SNAP} \${delay}s both\` } : {};
  return (
    <Stage footer={false}>
      {COVER_STREAKS.map((s) => (
        <Streak key={s.y} {...s} live={live} />
      ))}

      <Wordmark x={120} y={92} />
      <div style={abs(1100, 104, { ...LABEL, width: 700, textAlign: 'right', color: LAV })}>
        Partners + leadership
      </div>

      <h1
        style={{
          ...DISPLAY,
          ...abs(96, 156),
          fontSize: 'var(--osd-size-hero)',
          lineHeight: 0.8,
          letterSpacing: '-0.02em',
          whiteSpace: 'nowrap',
          ...enter(0.05),
        }}
      >
        Run <span style={{ color: 'var(--osd-accent)' }}>27</span>
      </h1>

      <VoltBand x={60} y={700} w={1800} />
      <div
        style={abs(196, 700, {
          height: 150,
          width: 1528,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: INK,
          ...enter(0.18),
        })}
      >
        <span style={{ ...DISPLAY, fontSize: 92, lineHeight: 1 }}>Season plan</span>
        <Mark color={INK} h={64} />
        <span style={{ ...NUM, fontSize: 92, lineHeight: 1 }}>Spring 2027</span>
      </div>

      <div
        style={abs(120, 920, {
          ...LABEL,
          fontSize: 22,
          display: 'flex',
          gap: 40,
          color: 'var(--osd-text)',
          fontVariantNumeric: 'tabular-nums',
        })}
      >
        <span>4 drops</span>
        <SpecChip>6 race cities</SpecChip>
        <SpecChip>38 markets</SpecChip>
        <SpecChip>1 line</SpecChip>
      </div>
      <div style={abs(1380, 896, { width: 420, textAlign: 'right' })}>
        <div style={{ ...LABEL, fontSize: 17, color: LAV }}>Kick-off</div>
        <div style={{ ...NUM, fontSize: 64, fontWeight: 800, marginTop: 6 }}>09·04·27</div>
      </div>
    </Stage>
  );
};

const Content: Page = () => (
  <Stage>
    <Kicker tag="Market">Where we stand</Kicker>
    <div style={abs(1300, 102, { width: 500, display: 'flex', justifyContent: 'flex-end' })}>
      <Chip>Ahead of plan</Chip>
    </div>

    <div style={abs(120, 176)}>
      <div style={{ ...NUM, fontSize: 300 }}>2.6×</div>
      <p style={{ ...BODY, marginTop: 26, color: LAV, width: 560 }}>
        Category growth in three seasons.
      </p>
    </div>
    <SkewRule x={830} y={176} h={300} />
    <div style={abs(980, 176)}>
      <div style={{ ...NUM, fontSize: 300 }}>€1.8B</div>
      <p style={{ ...BODY, marginTop: 26, color: LAV, width: 640 }}>
        Retail value this season. Still accelerating.
      </p>
    </div>

    <div style={abs(120, 604, { ...LABEL, color: LAV })}>Our share of category</div>

    <div style={abs(120, 650, { height: 115, display: 'flex', alignItems: 'center' })}>
      <div>
        <div style={{ ...NUM, fontSize: 52, fontWeight: 800 }}>2026</div>
        <div style={{ ...LABEL, fontSize: 15, color: LAV, marginTop: 4 }}>Today</div>
      </div>
    </div>
    <CutBar x={300} y={650} w={753} h={115} color={DEEP} />
    <div style={abs(1088, 650, { height: 115, display: 'flex', alignItems: 'center' })}>
      <span style={{ ...NUM, fontSize: 104 }}>6%</span>
    </div>

    <div style={abs(120, 795, { height: 115, display: 'flex', alignItems: 'center' })}>
      <div>
        <div style={{ ...NUM, fontSize: 52, fontWeight: 800, color: 'var(--osd-accent)' }}>
          2027
        </div>
        <div style={{ ...LABEL, fontSize: 15, color: LAV, marginTop: 4 }}>Target</div>
      </div>
    </div>
    <VoltBand x={300} y={795} w={1380} />
    <div
      style={abs(340, 795, {
        height: 115,
        width: 1290,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        color: INK,
      })}
    >
      <span style={{ ...LABEL, fontSize: 18, fontWeight: 700 }}>+5 pts · end of 2027</span>
      <span style={{ ...NUM, fontSize: 104 }}>11%</span>
    </div>
  </Stage>
);

const StartLane = ({ i }: { i: number }) => (
  <div
    style={abs(i * 240, 800, {
      width: 3,
      height: 300,
      background: WHITE_A(0.45),
      transform: SKEW,
      transformOrigin: '0 0',
    })}
  />
);

const StartNum = ({ n }: { n: number }) => (
  <div
    style={abs((n - 1) * 240 + 60, 880, {
      ...NUM,
      width: 120,
      textAlign: 'center',
      fontSize: 120,
      color: n === 4 ? 'var(--osd-accent)' : WHITE_A(0.9),
    })}
  >
    {n}
  </div>
);

const LANES = [1, 2, 3, 4, 5, 6, 7, 8];

const Closer: Page = () => {
  const live = false;
  const enter = (delay: number): CSSProperties =>
    live ? { animation: \`ae-in 0.8s \${SNAP} \${delay}s both\` } : {};
  return (
    <Stage footer={false}>
      <Wordmark x={120} y={92} />
      <Title size={196} x={112} y={186} style={enter(0.05)}>
        See you at
        <br />
        the start line.
      </Title>
      <div style={abs(120, 560, { ...enter(0.18) })}>
        <div style={{ ...DISPLAY, fontSize: 48, lineHeight: 1 }}>Sam Rivera</div>
        <div style={{ ...BODY, color: LAV, marginTop: 12 }}>
          Head of Marketing · sam@example.com
        </div>
      </div>
      <div style={abs(1380, 560, { width: 420, textAlign: 'right' })}>
        <div style={{ ...LABEL, fontSize: 17, color: LAV }}>Kick-off</div>
        <div
          style={{
            ...NUM,
            fontSize: 72,
            fontWeight: 800,
            marginTop: 6,
            color: 'var(--osd-accent)',
          }}
        >
          09·04·27
        </div>
      </div>

      <div style={abs(0, 800, { width: 1920, height: 280, background: DEEP })} />
      {LANES.map((n) => (
        <StartLane key={n} i={n} />
      ))}
      {LANES.map((n) => (
        <StartNum key={n} n={n} />
      ))}
      <div style={abs(-40, 770, { width: 2000, height: 34, background: 'var(--osd-accent)' })} />
    </Stage>
  );
};

export default [Cover, Content, Closer] satisfies Page[];
`);

const FIELDWORK_DEMO_SOURCE = restoreSourceTemplateEscapes(String.raw`import {
  type Page,
  type SlideTransition,
  useIsActivePage,
  useSlidePageNumber,
} from '@open-slide/core';
import { type CSSProperties, type ReactNode } from 'react';

const KEYFRAMES = \`
@keyframes fw-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
@keyframes fw-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes fw-rise { from { transform: scaleY(0) } to { transform: scaleY(1) } }
@keyframes fw-grow { from { transform: scaleX(0) } to { transform: scaleX(1) } }
\`;

const SANS = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif';
const SERIF = '"Newsreader", "Iowan Old Style", Georgia, serif';

const BG = '#FFFEFC'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const INK = '#191919'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const CORAL = '#E8553B'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const BODY = '#5F5E5B'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const SOFT = '#9B9A97'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const RULE = 'rgba(25,25,25,0.12)'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.

const YELLOW = '#F8DA7E'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const BLUE = '#8DBDEB'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const PINK = '#F6C3CF'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const GREEN = '#A6D4B2'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.

const TINT_YELLOW = '#FBF3DB'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const TINT_BLUE = '#E7F3F8'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const TINT_GREEN = '#EDF3EC'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.

const X0 = 120;

const EASE_OUT = 'cubic-bezier(0, 0, 0.2, 1)';
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';

export const transition: SlideTransition = {
  duration: 240,
  exit: { duration: 240, easing: EASE_IN, keyframes: [{ opacity: 1 }, { opacity: 1 }] },
  enter: {
    duration: 240,
    easing: EASE_OUT,
    keyframes: [
      { opacity: 0, transform: 'translateY(5px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ],
  },
};

const abs = (left: number, top: number, width?: number, height?: number): CSSProperties => ({
  position: 'absolute',
  left,
  top,
  width,
  height,
});

const root: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  background: BG,
  color: INK,
  fontFamily: SANS,
  fontVariantNumeric: 'tabular-nums',
  WebkitFontSmoothing: 'antialiased',
};

const Title = ({ children }: { children: ReactNode }) => (
  <h1
    style={{
      margin: 0,
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif',
      fontSize: 150,
      fontWeight: 780,
      lineHeight: 1,
      letterSpacing: '-0.04em',
      wordSpacing: '0.08em',
      color: /* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ '#191919',
    }}
  >
    {children}
  </h1>
);

const Heading = ({ children, size = 104 }: { children: ReactNode; size?: number }) => (
  <h2
    style={{
      margin: 0,
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif',
      fontSize: size,
      fontWeight: 780,
      lineHeight: 1,
      letterSpacing: size >= 100 ? '-0.04em' : '-0.03em',
      wordSpacing: '0.08em',
      color: /* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ '#191919',
    }}
  >
    {children}
  </h2>
);

const Eyebrow = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif',
      fontSize: 26,
      fontWeight: 650,
      letterSpacing: '-0.01em',
      color: /* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ '#E8553B',
    }}
  >
    {children}
  </div>
);

const Mark = ({ size = 24 }: { size?: number }) => (
  <svg
    aria-hidden="true"
    width={size * 0.8}
    height={size}
    viewBox="0 0 20 25"
    style={{ display: 'block' }}
  >
    <path
      d="M10 24C8.5 20 1.5 15 1.5 9.5a8.5 8.5 0 0 1 17 0C18.5 15 11.5 20 10 24Z"
      fill={/* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ "#191919"}
    />
    <circle cx="10" cy="9.5" r="3.4" fill={/* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ "#FFFEFC"} />
  </svg>
);

const Footer = ({
  brand = 'Fieldwork',
  label = 'Operating plan',
}: {
  brand?: string;
  label?: string;
}) => {
  const { current, total } = useSlidePageNumber();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return (
    <div
      style={{
        position: 'absolute',
        left: 120,
        right: 120,
        top: 1000,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif',
        fontSize: 21,
        color: /* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ '#9B9A97',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Mark size={24} />
        <span style={{ color: /* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ '#191919', fontWeight: 720, letterSpacing: '-0.02em' }}>{brand}</span>
        <span style={{ marginLeft: 12 }}>{label}</span>
      </span>
      <span>
        {pad2(current)} / {pad2(total)}
      </span>
    </div>
  );
};

const Highlight = ({ children, color = /* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ '#FCE38A' }: { children: ReactNode; color?: string }) => (
  <span
    style={{
      background: color,
      borderRadius: '6px 12px 8px 14px',
      padding: '0 6px',
      margin: '0 -2px',
      color: /* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ '#191919',
      WebkitBoxDecorationBreak: 'clone',
      boxDecorationBreak: 'clone',
    }}
  >
    {children}
  </span>
);

const TintCard = ({
  tint = /* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ '#E7F3F8',
  style,
  children,
}: {
  tint?: string;
  style?: CSSProperties;
  children: ReactNode;
}) => (
  <div
    style={{
      position: 'relative',
      boxSizing: 'border-box',
      borderRadius: 24,
      background: tint,
      padding: '34px 44px 32px',
      ...style,
    }}
  >
    {children}
  </div>
);

const Ink = ({
  width,
  height,
  viewBox,
  style,
  children,
}: {
  width: number;
  height: number;
  viewBox?: string;
  style?: CSSProperties;
  children: ReactNode;
}) => {
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={viewBox ?? \`0 0 \${width} \${height}\`}
      fill="none"
      stroke={/* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ "#191919"}
      strokeWidth={3.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', overflow: 'visible', ...style }}
    >
      {children}
    </svg>
  );
};

const Stroke = ({
  d,
  live,
  delay = 0.3,
  dur = 0.7,
  color = /* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ '#191919',
  width = 3.2,
}: {
  d: string;
  live: boolean;
  delay?: number;
  dur?: number;
  color?: string;
  width?: number;
}) => (
  <path
    d={d}
    pathLength={1}
    strokeDasharray={1}
    stroke={color}
    strokeWidth={width}
    fill="none"
    style={{
      animation: live ? \`fw-draw \${dur}s cubic-bezier(0, 0, 0.2, 1) \${delay}s both\` : undefined,
    }}
  />
);

const loopPath = (w: number, h: number) => {
  const p = (x: number, y: number) => \`\${((x * w) / 100).toFixed(1)} \${((y * h) / 100).toFixed(1)}\`;
  return \`M\${p(30, 8)}C\${p(55, 2)} \${p(90, 8)} \${p(96, 40)}C\${p(100, 70)} \${p(72, 94)} \${p(42, 93)}C\${p(14, 92)} \${p(2, 74)} \${p(4, 50)}C\${p(6, 26)} \${p(26, 10)} \${p(56, 5)}\`;
};

const CircleDoodle = ({
  x,
  y,
  w,
  h,
  live,
  color = /* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ '#E8553B',
  delay = 0.4,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  live: boolean;
  color?: string;
  delay?: number;
}) => (
  <Ink width={w} height={h} style={{ position: 'absolute', left: x, top: y }}>
    <Stroke d={loopPath(w, h)} color={color} width={3.6} live={live} delay={delay} dur={0.8} />
  </Ink>
);

const Sparkle = ({
  x,
  y,
  s = 1,
  fill = /* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ '#F8DA7E',
}: {
  x: number;
  y: number;
  s?: number;
  fill?: string;
}) => (
  <path
    transform={\`translate(\${x} \${y}) scale(\${s})\`}
    d="M0 -20Q3 -3 20 0Q3 3 0 20Q-3 3 -20 0Q-3 -3 0 -20Z"
    fill={fill}
    strokeWidth={3 / s}
  />
);

const pinPath = (cx: number, cy: number, r: number) =>
  \`M\${cx} \${cy + 2.4 * r}C\${cx - 0.25 * r} \${cy + 1.7 * r} \${cx - r} \${cy + 1.1 * r} \${cx - r} \${cy}A\${r} \${r} 0 1 1 \${cx + r} \${cy}C\${cx + r} \${cy + 1.1 * r} \${cx + 0.25 * r} \${cy + 1.7 * r} \${cx} \${cy + 2.4 * r}Z\`;

const CoverArt = () => (
  <Ink width={880} height={700} style={abs(940, 150)}>
    <circle cx="470" cy="330" r="250" fill={YELLOW} stroke="none" />
    <g transform="translate(150 40) scale(1.1)">
      <rect
        x="170"
        y="110"
        width="250"
        height="310"
        rx="6"
        fill={/* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ "#FFFFFF"}
        transform="rotate(-9 295 265)"
      />
      <rect
        x="170"
        y="110"
        width="250"
        height="310"
        rx="6"
        fill={/* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ "#FFFFFF"}
        transform="rotate(6 295 265)"
      />
      <g transform="rotate(-2 300 280)">
        <rect x="170" y="120" width="260" height="320" rx="6" fill={/* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ "#FFFFFF"} />
        <path
          d="M170 170H430M170 220H430M170 270H430M170 320H430M170 370H430M250 120V440M340 120V440"
          strokeWidth={2.4}
        />
        <rect x="252" y="172" width="86" height="46" fill={PINK} stroke="none" />
        <path d="M190 196h40M270 246h50M360 296h46M190 346h36M272 396h44" strokeWidth={2.6} />
      </g>
      <g transform="translate(372 410) rotate(-38)">
        <rect x="0" y="-13" width="210" height="26" rx="3" fill={BLUE} />
        <path d="M0 -13L-36 0L0 13Z" fill={/* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ "#FFFFFF"} />
        <path d="M-36 0L-24 -4.3L-24 4.3Z" fill={INK} />
        <rect x="210" y="-13" width="28" height="26" rx="5" fill={PINK} />
        <path d="M206 -13V13" />
      </g>
    </g>
    <path d={pinPath(690, 120, 52)} fill={CORAL} />
    <circle cx="690" cy="120" r="19" fill={/* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ "#FFFFFF"} />
    <Sparkle x={790} y={250} s={1.1} />
    <Sparkle x={250} y={110} s={0.7} fill={/* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ "#FFFFFF"} />
    <Sparkle x={190} y={540} s={0.9} />
    <path d="M60 640Q300 635 560 639T860 638" />
  </Ink>
);

const House = ({ x, y, fill = /* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ '#FFFFFF' }: { x: number; y: number; fill?: string }) => (
  <g transform={\`translate(\${x} \${y})\`}>
    <path d="M-32 0L-32 -40L0 -66L32 -40L32 0Z" fill={fill} />
    <path d="M-9 0L-9 -22L9 -22L9 0" />
  </g>
);

const BranchesArt = () => (
  <Ink width={300} height={200}>
    <path d="M150 92L62 140M150 92L150 132M150 92L238 140" strokeDasharray="0.1 11" />
    <House x={56} y={186} />
    <House x={150} y={186} fill={YELLOW} />
    <House x={244} y={186} />
    <path d={pinPath(150, 36, 22)} fill={CORAL} />
    <circle cx="150" cy="36" r="8" fill={/* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ "#FFFFFF"} />
  </Ink>
);

const PaymentsArt = () => (
  <Ink width={300} height={200}>
    <rect x="70" y="24" width="96" height="168" rx="18" fill={/* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ "#FFFFFF"} />
    <path d="M104 42h28" />
    <circle cx="118" cy="112" r="24" fill={GREEN} />
    <path d="M107 112l7 7 14-15" strokeWidth={3.4} />
    <g transform="rotate(-14 222 84)">
      <rect x="166" y="52" width="118" height="72" rx="10" fill={YELLOW} />
      <path d="M166 74h118" strokeWidth={6} />
      <path d="M184 104h34" />
    </g>
  </Ink>
);

const OfflineArt = () => (
  <Ink width={300} height={200}>
    <rect x="60" y="24" width="96" height="168" rx="18" fill={/* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ "#FFFFFF"} />
    <path d="M94 42h28" />
    <path d="M80 82h56M80 104h44M80 126h52" strokeWidth={2.6} />
    <rect x="80" y="144" width="56" height="26" rx="6" fill={PINK} />
    <path d="M196 118Q190 92 216 90Q226 66 252 76Q278 72 278 98Q296 102 290 120Z" fill={/* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ "#FFFFFF"} />
    <path d="M196 140L292 66" stroke={CORAL} strokeWidth={4} />
  </Ink>
);

const ToolboxArt = () => (
  <Ink width={720} height={500} style={abs(1080, 300)}>
    <circle cx="370" cy="260" r="215" fill={YELLOW} stroke="none" />
    <path d="M180 214Q180 170 236 168Q292 170 292 212" />
    <path d="M202 216Q202 190 236 189Q270 190 270 214" />
    <path d="M122 250L470 246L462 420Q461 432 449 432L136 434Q124 434 123 422Z" fill={CORAL} />
    <path d="M110 216L482 212L478 252L114 255Z" fill={CORAL} />
    <rect x="276" y="244" width="44" height="30" rx="5" fill={/* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ "#FFFFFF"} />
    <g transform="translate(440 178) scale(1.2)">
      <path d="M110 70Q100 58 110 46Q120 34 110 22M146 72Q136 60 146 48Q156 36 146 24" />
      <path
        d="M70 92Q69 87.5 74 87.5L177 87Q182 87 181.5 92L176.5 196Q175.5 214 157 214L95 214.5Q76.5 214.5 75.5 197Z"
        fill={/* guard:allow-raw-color — authored slide theme demo color, not app chrome. */ "#FFFFFF"}
      />
      <path d="M73.4 142L179 141L178 161.5L74.4 162.5Z" fill={BLUE} stroke="none" />
      <path d="M70 92Q69 87.5 74 87.5L177 87Q182 87 181.5 92L176.5 196Q175.5 214 157 214L95 214.5Q76.5 214.5 75.5 197Z" />
      <path d="M181 116Q214 113 213.5 142Q213 171 177.5 171.5M180 130Q199 129.5 199 143Q198.5 157 178.5 158" />
    </g>
    <path d="M40 436Q300 431 560 435T710 434" />
  </Ink>
);

const Cover: Page = () => (
  <div style={root}>
    <div style={{ ...abs(X0, 100), display: 'flex', alignItems: 'center', gap: 14 }}>
      <Mark size={32} />
      <span style={{ fontSize: 30, fontWeight: 760, letterSpacing: '-0.03em' }}>Fieldwork</span>
    </div>
    <div style={abs(X0, 262)}>
      <Title>
        The annual
        <br />
        operating
        <br />
        plan.
      </Title>
    </div>
    <p style={{ ...abs(X0, 772, 760), margin: 0, fontSize: 34, lineHeight: 1.45, color: BODY }}>
      Where we are, where we are going, and <Highlight>who owns each step</Highlight>.
    </p>
    <div style={{ ...abs(X0, 906), fontSize: 24, color: SOFT }}>
      All-hands pre-read · Planning team
    </div>
    <CoverArt />
    <Footer />
  </div>
);

const BetCard = ({
  x,
  tint,
  index,
  art,
  title,
  body,
  metric,
  from,
  to,
}: {
  x: number;
  tint: string;
  index: string;
  art: ReactNode;
  title: string;
  body: string;
  metric: string;
  from: string;
  to: string;
}) => (
  <TintCard
    tint={tint}
    style={{ ...abs(x, 330, 536, 610), display: 'flex', flexDirection: 'column' }}
  >
    <div style={{ marginLeft: -8 }}>{art}</div>
    <div style={{ marginTop: 28, fontSize: 22, fontWeight: 700, color: SOFT }}>{index}</div>
    <div style={{ marginTop: 8 }}>
      <Heading size={54}>{title}</Heading>
    </div>
    <p style={{ margin: '20px 0 0', fontSize: 28, lineHeight: 1.45, color: BODY }}>{body}</p>
    <div style={{ marginTop: 'auto', fontSize: 22, color: SOFT }}>{metric}</div>
    <div
      style={{
        marginTop: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        fontSize: 40,
        fontWeight: 760,
      }}
    >
      <span style={{ color: SOFT, fontWeight: 500 }}>{from}</span>
      <span style={{ color: SOFT, fontWeight: 400 }}>→</span>
      <span style={{ letterSpacing: '-0.03em' }}>{to}</span>
    </div>
  </TintCard>
);

const Content: Page = () => {
  const live = false;
  return (
    <div style={root}>
      <div style={abs(X0, 116)}>
        <Eyebrow>Strategy</Eyebrow>
      </div>
      <div style={abs(X0, 160)}>
        <Heading>Three bets this year.</Heading>
      </div>
      <div style={{ ...abs(1220, 196, 580), fontSize: 28, lineHeight: 1.45, color: BODY }}>
        Each answers a lesson from last year, and <Highlight>each moves one number</Highlight>.
      </div>
      <BetCard
        x={120}
        tint={TINT_BLUE}
        index="01"
        art={<BranchesArt />}
        title="Expansion"
        body="One workspace across every site, with a shared team pool."
        metric="Net revenue retention · Product"
        from="109%"
        to="116%"
      />
      <BetCard
        x={692}
        tint={TINT_GREEN}
        index="02"
        art={<PaymentsArt />}
        title="Payments"
        body="Collect on the spot, so invoices stop sitting for 30 days."
        metric="Payments attach rate · Finance"
        from="22%"
        to="40%"
      />
      <BetCard
        x={1264}
        tint={TINT_YELLOW}
        index="03"
        art={<OfflineArt />}
        title="Offline"
        body="Forms and photos work with no signal, then sync."
        metric="Crash-free sessions · Engineering"
        from="99.2%"
        to="99.8%"
      />
      <CircleDoodle x={710} y={834} w={300} h={104} live={live} delay={0.5} />
      <Footer />
    </div>
  );
};

const Closer: Page = () => {
  const live = false;
  return (
    <div style={root}>
      <div style={abs(X0, 140)}>
        <Heading size={130}>
          Thanks for
          <br />
          reading.
        </Heading>
      </div>
      <Ink width={540} height={40} style={abs(X0, 398)}>
        <Stroke d="M6 22C120 10 260 30 400 16S510 12 532 16" color={CORAL} live={live} />
      </Ink>
      <div style={{ ...abs(X0, 460), fontSize: 34, color: BODY }}>
        Comments stay open until the plan locks.
      </div>
      <div style={{ ...abs(X0, 548, 900), borderTop: \`1.5px solid \${RULE}\` }} />
      <blockquote
        style={{
          ...abs(X0, 590, 900),
          margin: 0,
          fontFamily: SERIF,
          fontStyle: 'italic',
          fontSize: 66,
          lineHeight: 1.16,
          letterSpacing: '-0.01em',
        }}
      >
        “Write the plan so the newest person on the team could run it.”
      </blockquote>
      <div style={{ ...abs(X0, 790), fontSize: 26, color: BODY }}>
        <span style={{ color: INK, fontWeight: 650 }}>Planning team</span>, house rule
      </div>
      <ToolboxArt />
      <Footer label="Thank you" />
    </div>
  );
};

export default [Cover, Content, Closer];
`);

const POMMI_DEMO_SOURCE = restoreSourceTemplateEscapes(String.raw`import {
  type DesignSystem,
  type Page,
  useIsActivePage,
  useSlidePageNumber,
} from '@open-slide/core';
import { type CSSProperties, type ReactNode } from 'react';

export const design: DesignSystem = {
  palette: { bg: '#FFF3DF', text: '#151313', accent: '#FF5A2C' }, // guard:allow-raw-color — authored slide theme demo color, not app chrome.
  fonts: {
    display: '"Gabarito", system-ui, sans-serif',
    body: '"Gabarito", system-ui, sans-serif',
  },
  typeScale: { hero: 300, body: 30 },
  radius: 28,
};

const CREAM = 'var(--osd-bg)';
const INK = 'var(--osd-text)';
const TOMATO = 'var(--osd-accent)';
const BUTTER = '#FFD23F'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const MINT = '#7EDDB0'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const PERI = '#98A6FF'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const PINK = '#FFB0D0'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const PAPER = '#FFFCF6'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const MUTED = 'rgba(21, 19, 19, 0.6)'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.
const FAINT = 'rgba(21, 19, 19, 0.16)'; // guard:allow-raw-color — authored slide theme demo color, not app chrome.

const BORDER = \`4px solid \${INK}\`;
const shadow = (n = 8) => \`\${n}px \${n}px 0 \${INK}\`;

const DISPLAY: CSSProperties = {
  fontFamily: 'var(--osd-font-display)',
  fontWeight: 900,
  letterSpacing: '-0.035em',
  lineHeight: 1,
  margin: 0,
};

const MONO: CSSProperties = {
  fontFamily: '"DM Mono", ui-monospace, monospace',
  fontWeight: 500,
  fontSize: 17,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  lineHeight: 1.2,
};

const BODY: CSSProperties = {
  fontFamily: 'var(--osd-font-body)',
  fontWeight: 500,
  fontSize: 'var(--osd-size-body)',
  lineHeight: 1.32,
  margin: 0,
  textWrap: 'pretty',
};

const NUM: CSSProperties = { ...DISPLAY, fontVariantNumeric: 'tabular-nums' };

const abs = (left: number, top: number, extra?: CSSProperties): CSSProperties => ({
  position: 'absolute',
  left,
  top,
  ...extra,
});

const pad = (n: number) => String(n).padStart(2, '0');

const BOUNCY = 'cubic-bezier(0.2, 0.8, 0.3, 1)';
const SNAPPY = 'cubic-bezier(0.2, 0.8, 0.3, 1)';
const DROP = 'cubic-bezier(0.2, 0.8, 0.3, 1)';
const DROP_LAND = 1 / (1 + 0.6 + 0.18);
const SLAP = 'cubic-bezier(0.2, 0.8, 0.3, 1)';

const CSS = \`
@keyframes pm-rise { from { opacity: 0; transform: translateY(var(--pm-rise, 32px)) } to { opacity: 1; transform: translateY(0) } }
@keyframes pm-in-l { from { opacity: 0; transform: translateX(-90px) } to { opacity: 1; transform: translateX(0) } }
@keyframes pm-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes pm-drop { from { transform: translateY(var(--pm-from, -320px)) } to { transform: translateY(0) } }
@keyframes pm-pop { from { opacity: 0; transform: scale(0) } to { opacity: 1; transform: scale(1) } }
@keyframes pm-pop-b { from { opacity: 0; transform: translateY(20px) scale(0.55) } to { opacity: 1; transform: translateY(0) scale(1) } }
@keyframes pm-squash { 0% { transform: scale(1, 1) } 26% { transform: scale(1.14, 0.82) } 56% { transform: scale(0.96, 1.05) } 100% { transform: scale(1, 1) } }
@keyframes pm-slap {
  0% { opacity: 0; transform: rotate(calc(var(--r) - 24deg)) scale(1.9) }
  42% { opacity: 1; transform: rotate(calc(var(--r) + 4deg)) scale(0.88, 0.84) }
  70% { opacity: 1; transform: rotate(calc(var(--r) - 1.5deg)) scale(1.04) }
  100% { opacity: 1; transform: rotate(var(--r)) scale(1) }
}
@keyframes pm-wobble { 0%, 100% { transform: rotate(0deg) } 50% { transform: rotate(2.6deg) } }
@keyframes pm-bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-12px) } }
@keyframes pm-twinkle { 0%, 100% { transform: scale(1) rotate(0deg) } 50% { transform: scale(0.7) rotate(25deg) } }
@keyframes pm-thunk { 0% { transform: scale(1) } 24% { transform: scale(1.07) rotate(-1.4deg) } 58% { transform: scale(0.985) rotate(0.4deg) } 100% { transform: scale(1) } }

@media (prefers-reduced-motion: reduce) {
  .pm-root *, .pm-root *::before, .pm-root *::after { animation: none !important; transition: none !important; }
}
\`;

const anim = (live: boolean, value: string): CSSProperties => (live ? { animation: value } : {});

const rise = (live: boolean, delay = 0, dist = 32): CSSProperties =>
  live
    ? ({
        animation: \`pm-rise 820ms \${SNAPPY} \${delay}ms both\`,
        '--pm-rise': \`\${dist}px\`,
      } as CSSProperties)
    : {};

const useLive = () => false;
const useCount = (target: number, _live: boolean, _delay: number, _dur = 1700) => target;

const Mark = ({ size = 56 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    aria-hidden="true"
    style={{ display: 'block', overflow: 'visible' }}
  >
    <path
      d="M36.5 13.5 C 38.5 6, 46.5 2.5, 55 4.5 C 53 12, 45 16, 36.5 13.5 Z"
      style={{ fill: MINT, stroke: INK, strokeWidth: 3.5, strokeLinejoin: 'round' }}
    />
    <path
      d="M32 19 C 32 13, 33 9, 36 6"
      style={{ fill: 'none', stroke: INK, strokeWidth: 4, strokeLinecap: 'round' }}
    />
    <path
      d="M32 19 C 23 13, 6 15, 6 34 C 6 50, 17 60, 25 60 C 28 60, 30 58.5, 32 58.5 C 34 58.5, 36 60, 39 60 C 47 60, 58 50, 58 34 C 58 15, 41 13, 32 19 Z"
      style={{ fill: TOMATO, stroke: INK, strokeWidth: 4, strokeLinejoin: 'round' }}
    />
    <path
      d="M26.5 58.6 V 47 A 5.5 5.5 0 0 1 37.5 47 V 58.6"
      style={{ fill: CREAM, stroke: INK, strokeWidth: 3.5, strokeLinejoin: 'round' }}
    />
    <path
      d="M15 30 C 15.5 25.5, 18.5 22.5, 22.5 21.5"
      style={{ fill: 'none', stroke: PAPER, strokeWidth: 3.5, strokeLinecap: 'round' }}
    />
  </svg>
);

const Title = ({
  children,
  live,
  x = 120,
  y = 168,
  size = 88,
  width = 1680,
  delay = 70,
}: {
  children: ReactNode;
  live: boolean;
  x?: number;
  y?: number;
  size?: number;
  width?: number;
  delay?: number;
}) => (
  <h2 style={{ ...DISPLAY, ...abs(x, y), width, fontSize: size, ...rise(live, delay, 40) }}>
    {children}
  </h2>
);

const Footer = ({
  brand = 'pommi',
  label = 'Company update · 2026',
  note = 'Confidential',
}: {
  brand?: string;
  label?: string;
  note?: string;
}) => {
  const { current, total } = useSlidePageNumber();
  return (
    <div
      style={abs(120, 996, {
        width: 1680,
        height: 44,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        zIndex: 8,
      })}
    >
      <Mark size={34} />
      <span style={{ ...DISPLAY, fontSize: 30, letterSpacing: '-0.04em' }}>{brand}</span>
      <span style={{ ...MONO, color: MUTED, marginLeft: 18 }}>{label}</span>
      <span style={{ ...MONO, color: MUTED, marginLeft: 'auto', marginRight: 10 }}>{note}</span>
      <span
        style={{
          ...MONO,
          height: 38,
          padding: '0 16px',
          borderRadius: 999,
          background: INK,
          color: CREAM,
          display: 'inline-flex',
          alignItems: 'center',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {pad(current)} / {pad(total)}
      </span>
    </div>
  );
};

const Eyebrow = ({
  n,
  children,
  live,
  x = 120,
  y = 96,
  color = BUTTER,
}: {
  n: string;
  children: ReactNode;
  live: boolean;
  x?: number;
  y?: number;
  color?: string;
}) => (
  <div
    style={abs(x, y, {
      display: 'flex',
      alignItems: 'stretch',
      height: 46,
      border: \`3px solid \${INK}\`,
      borderRadius: 999,
      background: color,
      boxShadow: shadow(4),
      overflow: 'hidden',
      ...rise(live, 0, 20),
    })}
  >
    <span
      style={{
        ...MONO,
        fontSize: 18,
        padding: '0 14px 0 16px',
        display: 'flex',
        alignItems: 'center',
        background: INK,
        color: CREAM,
      }}
    >
      {n}
    </span>
    <span
      style={{
        ...MONO,
        fontSize: 18,
        padding: '0 20px 0 16px',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      {children}
    </span>
  </div>
);

const Stage = ({ footer = true, children }: { footer?: boolean; children: ReactNode }) => (
  <div
    className="pm-root"
    style={{
      width: '100%',
      height: '100%',
      position: 'relative',
      overflow: 'hidden',
      isolation: 'isolate',
      background: CREAM,
      color: INK,
      fontFamily: 'var(--osd-font-body)',
    }}
  >
    {children}
    {footer && <Footer />}
  </div>
);

const Footnote = ({
  x = 120,
  y,
  width = 1680,
  children,
}: {
  x?: number;
  y: number;
  width?: number;
  children: ReactNode;
}) => (
  <p style={{ ...BODY, ...abs(x, y), width, fontSize: 18, lineHeight: 1.4, color: MUTED }}>
    {children}
  </p>
);

const Sticker = ({
  x,
  y,
  r,
  live,
  delay,
  bg,
  children,
  round,
  pad: padding = '14px 26px',
  z = 6,
}: {
  x: number;
  y: number;
  r: number;
  live: boolean;
  delay: number;
  bg: string;
  children: ReactNode;
  round?: number;
  pad?: string;
  z?: number;
}) => (
  <div
    style={
      {
        ...abs(x, y),
        '--r': \`\${r}deg\`,
        transform: \`rotate(\${r}deg)\`,
        zIndex: z,
        ...anim(live, \`pm-slap 760ms \${SLAP} \${delay}ms both\`),
      } as CSSProperties
    }
  >
    <div
      style={{
        ...anim(live, \`pm-wobble 5.2s ease-in-out \${delay + 900}ms infinite\`),
        background: bg,
        border: BORDER,
        boxShadow: shadow(6),
        borderRadius: round ? '50%' : 22,
        width: round,
        height: round,
        padding: round ? 0 : padding,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
      }}
    >
      {children}
    </div>
  </div>
);

const Sparkle = ({
  x,
  y,
  size,
  color = BUTTER,
  live,
  delay,
}: {
  x: number;
  y: number;
  size: number;
  color?: string;
  live: boolean;
  delay: number;
}) => (
  <div
    style={{
      ...abs(x, y),
      width: size,
      height: size,
      ...anim(live, \`pm-pop 700ms \${BOUNCY} \${delay}ms both\`),
    }}
  >
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      style={{
        display: 'block',
        overflow: 'visible',
        ...anim(live, \`pm-twinkle 2.8s ease-in-out \${delay + 700}ms infinite\`),
      }}
    >
      <path
        d="M20 2 C 22 14, 26 18, 38 20 C 26 22, 22 26, 20 38 C 18 26, 14 22, 2 20 C 14 18, 18 14, 20 2 Z"
        style={{ fill: color, stroke: INK, strokeWidth: 3, strokeLinejoin: 'round' }}
      />
    </svg>
  </div>
);

const Chip = ({ children }: { children: ReactNode }) => (
  <span
    style={{
      height: 52,
      padding: '0 22px',
      border: \`3px solid \${INK}\`,
      borderRadius: 999,
      display: 'inline-flex',
      alignItems: 'center',
      fontSize: 24,
      fontWeight: 700,
      background: PAPER,
    }}
  >
    {children}
  </span>
);

const StatRow = ({
  x = 120,
  y,
  n,
  color,
  live,
  delay,
  children,
}: {
  x?: number;
  y: number;
  n: string;
  color: string;
  live: boolean;
  delay: number;
  children: ReactNode;
}) => (
  <div
    style={abs(x, y, {
      width: 1000,
      height: 132,
      display: 'flex',
      border: BORDER,
      borderRadius: 28,
      background: PAPER,
      boxShadow: shadow(8),
      overflow: 'hidden',
      boxSizing: 'border-box',
      ...anim(live, \`pm-in-l 900ms \${SNAPPY} \${delay}ms both\`),
    })}
  >
    <div
      style={{
        width: 250,
        flex: 'none',
        background: color,
        borderRight: BORDER,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 30,
        boxSizing: 'border-box',
      }}
    >
      <span style={{ ...NUM, fontSize: 76, letterSpacing: '-0.045em' }}>{n}</span>
    </div>
    <p style={{ ...BODY, padding: '0 36px', alignSelf: 'center' }}>{children}</p>
  </div>
);

const TiltCard = ({
  x,
  y,
  r,
  color,
  n,
  title,
  live,
  delay,
  width = 360,
  height = 420,
  children,
}: {
  x: number;
  y: number;
  r: number;
  color: string;
  n: string;
  title: string;
  live: boolean;
  delay: number;
  width?: number;
  height?: number;
  children: ReactNode;
}) => (
  <div
    style={
      {
        ...abs(x, y),
        '--r': \`\${r}deg\`,
        transform: \`rotate(\${r}deg)\`,
        width,
        height,
        boxSizing: 'border-box',
        padding: 28,
        background: color,
        border: BORDER,
        borderRadius: 34,
        boxShadow: shadow(10),
        display: 'flex',
        flexDirection: 'column',
        ...anim(live, \`pm-slap 760ms \${SLAP} \${delay}ms both\`),
      } as CSSProperties
    }
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <span
        style={{
          ...MONO,
          fontSize: 18,
          width: 52,
          height: 52,
          flex: 'none',
          borderRadius: '50%',
          background: INK,
          color: CREAM,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {n}
      </span>
      <span style={{ ...DISPLAY, fontSize: 64 }}>{title}</span>
    </div>
    <p style={{ ...BODY, fontSize: 28, marginTop: 24, lineHeight: 1.3 }}>{children}</p>
  </div>
);

const DropWord = ({
  text,
  size,
}: {
  text: string;
  size: number;
  live: boolean;
  delay?: number;
}) => (
  <div
    style={{
      ...DISPLAY,
      fontSize: size,
      letterSpacing: '-0.055em',
      lineHeight: 1,
      display: 'flex',
      whiteSpace: 'nowrap',
    }}
  >
    {text}
  </div>
);

const Cover: Page = () => {
  const live = useLive();
  return (
    <Stage footer={false}>
      <div
        style={abs(120, 92, {
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          ...rise(live, 0, 16),
        })}
      >
        <Mark size={50} />
        <span style={{ ...MONO, fontSize: 18 }}>Company update · October 2026</span>
      </div>

      <div
        style={abs(1160, 96, {
          width: 640,
          height: 1100,
          background: PERI,
          border: BORDER,
          borderRadius: 48,
          ...rise(live, 40, 120),
        })}
      />
      <TiltCard
        x={1220}
        y={290}
        r={-4}
        width={480}
        height={210}
        color={TOMATO}
        n="01"
        title="Bold"
        live={live}
        delay={700}
      >
        Huge type that takes up the whole room.
      </TiltCard>
      <TiltCard
        x={1270}
        y={500}
        r={3}
        width={480}
        height={210}
        color={BUTTER}
        n="02"
        title="Bright"
        live={live}
        delay={850}
      >
        Cream paper, ink lines, five loud fills.
      </TiltCard>
      <TiltCard
        x={1200}
        y={710}
        r={-2}
        width={480}
        height={210}
        color={MINT}
        n="03"
        title="Bouncy"
        live={live}
        delay={1000}
      >
        Things drop, squash and slap into place.
      </TiltCard>

      <div style={abs(104, 236)}>
        <DropWord text="hello" size={300} live={live} delay={220} />
      </div>

      <p
        style={{
          ...DISPLAY,
          ...abs(120, 600),
          width: 960,
          fontSize: 64,
          fontWeight: 800,
          lineHeight: 1.08,
          letterSpacing: '-0.03em',
          ...rise(live, 900, 30),
        }}
      >
        A loud, happy theme
        <br />
        for consumer brands.
      </p>
      <div
        style={abs(120, 800, {
          display: 'flex',
          gap: 12,
          ...rise(live, 1040, 24),
        })}
      >
        <Chip>Gabarito + DM Mono</Chip>
        <Chip>Seven colours</Chip>
        <Chip>Hard shadows</Chip>
      </div>
      <div style={{ ...MONO, ...abs(120, 984), color: MUTED, ...rise(live, 1160, 12) }}>
        Theme preview · Cream, ink and tomato
      </div>

      <Sticker x={1440} y={200} r={7} live={live} delay={1250} bg={BUTTER}>
        <span style={{ ...DISPLAY, fontSize: 52, letterSpacing: '-0.03em' }}>New theme</span>
      </Sticker>
      <Sticker x={1380} y={950} r={-6} live={live} delay={1650} bg={PAPER} pad="12px 24px">
        <span style={{ ...DISPLAY, fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em' }}>
          Made to be shown
        </span>
      </Sticker>
      <Sparkle x={1360} y={170} size={46} live={live} delay={1800} />
      <Sparkle x={1716} y={150} size={30} color={PINK} live={live} delay={1900} />
      <Sparkle x={1770} y={470} size={34} color={PAPER} live={live} delay={2000} />
    </Stage>
  );
};

const Content: Page = () => {
  const live = useLive();
  const count = useCount(412, live, 600, 1600);
  return (
    <Stage>
      <Eyebrow n="01" live={live}>
        Highlights
      </Eyebrow>
      <Title live={live} size={96} width={1100}>
        This quarter,
        <br />
        in three numbers.
      </Title>
      <StatRow y={420} n="3.4×" color={TOMATO} live={live} delay={260}>
        more weekly active users than at the same point last year
      </StatRow>
      <StatRow y={576} n="61%" color={BUTTER} live={live} delay={380}>
        of new sign-ups arrived through a friend's invite link
      </StatRow>
      <StatRow y={732} n="4 s" color={PERI} live={live} delay={500}>
        median time to finish the core action, down from eleven
      </StatRow>
      <Footnote y={898} width={1000}>
        Illustrative figures for the theme preview. Swap in your own numbers and sources.
      </Footnote>

      <div
        style={abs(1220, 330, {
          width: 580,
          height: 520,
          boxSizing: 'border-box',
          padding: '40px 44px',
          background: PAPER,
          border: BORDER,
          borderRadius: 34,
          boxShadow: shadow(10),
          display: 'flex',
          flexDirection: 'column',
          ...rise(live, 160, 60),
        })}
      >
        <span style={{ ...MONO, color: MUTED }}>Monthly active homes</span>
        <span
          style={{
            ...NUM,
            fontSize: 200,
            lineHeight: 0.86,
            letterSpacing: '-0.05em',
            marginTop: 24,
            transformOrigin: '0% 80%',
            ...anim(live, 'pm-thunk 620ms ease-out 2200ms both'),
          }}
        >
          {Number(count.toFixed(0))}k
        </span>
        <p style={{ ...BODY, fontWeight: 700, marginTop: 26 }}>
          households open the app at least once a month.
        </p>
        <div
          style={{
            marginTop: 'auto',
            paddingTop: 22,
            borderTop: \`3px dashed \${FAINT}\`,
            display: 'flex',
            alignItems: 'baseline',
            gap: 14,
          }}
        >
          <span style={{ ...NUM, fontSize: 44, letterSpacing: '-0.03em' }}>+3.1×</span>
          <span style={{ ...MONO, fontSize: 16, color: MUTED }}>Year on year</span>
        </div>
      </div>
      <Sticker x={1600} y={286} r={6} live={live} delay={2300} bg={MINT} pad="10px 20px">
        <span style={{ fontSize: 24, fontWeight: 800 }}>64% organic</span>
      </Sticker>
      <Sparkle x={1180} y={296} size={40} live={live} delay={2450} />
    </Stage>
  );
};

const Closer: Page = () => {
  const live = useLive();
  return (
    <Stage footer={false}>
      <div style={abs(104, 150)}>
        <DropWord text="thanks" size={250} live={live} delay={150} />
      </div>
      <p
        style={{
          ...DISPLAY,
          ...abs(120, 470),
          width: 1000,
          fontSize: 72,
          fontWeight: 800,
          lineHeight: 1.06,
          letterSpacing: '-0.035em',
          ...rise(live, 800, 30),
        }}
      >
        Questions, ideas and
        <br />
        high fives welcome.
      </p>
      <div style={abs(120, 720, { display: 'flex', gap: 12, ...rise(live, 1000, 24) })}>
        <Chip>hello@example.com</Chip>
        <Chip>example.com/deck</Chip>
      </div>
      <div style={{ ...MONO, ...abs(120, 984), color: MUTED, ...rise(live, 1500, 12) }}>
        Pommi theme · open-slide
      </div>

      <div
        style={abs(1180, 96, {
          width: 620,
          height: 888,
          background: BUTTER,
          border: BORDER,
          borderRadius: 48,
          boxShadow: shadow(12),
          ...rise(live, 60, 80),
        })}
      />
      <div
        style={abs(1290, 250, {
          width: 400,
          height: 400,
          ...anim(live, \`pm-pop 900ms \${BOUNCY} 500ms both\`),
        })}
      >
        <div style={{ ...anim(live, 'pm-bob 3.6s ease-in-out 1400ms infinite') }}>
          <Mark size={400} />
        </div>
      </div>
      <div
        style={abs(1230, 740, {
          width: 520,
          textAlign: 'center',
          ...rise(live, 900, 20),
        })}
      >
        <div style={{ ...MONO, fontSize: 18 }}>Find us at</div>
        <div style={{ ...DISPLAY, fontSize: 54, marginTop: 10, letterSpacing: '-0.03em' }}>
          example.com
        </div>
      </div>
      <Sticker x={1110} y={150} r={-9} live={live} delay={1500} bg={TOMATO} pad="12px 26px">
        <span style={{ ...DISPLAY, fontSize: 50, letterSpacing: '-0.03em' }}>Thank you!</span>
      </Sticker>
      <Sticker x={1560} y={600} r={8} live={live} delay={1700} bg={MINT} pad="10px 22px">
        <span style={{ fontSize: 28, fontWeight: 800 }}>See you soon</span>
      </Sticker>
      <Sparkle x={1700} y={170} size={44} color={PAPER} live={live} delay={1850} />
      <Sparkle x={1250} y={620} size={32} color={PINK} live={live} delay={1950} />
    </Stage>
  );
};

export default [Cover, Content, Closer] satisfies Page[];
`);

const themeDemoSources = {
  aero: AERO_DEMO_SOURCE,
  fieldwork: FIELDWORK_DEMO_SOURCE,
  pommi: POMMI_DEMO_SOURCE,
} as const;

const themeDemoPages = {
  aero: ["Cover", "Content", "Closer"],
  fieldwork: ["Cover", "Content", "Closer"],
  pommi: ["Cover", "Content", "Closer"],
} as const;

export function getBuiltInSlideThemeDemoSource(
  id: string,
  pageIndex: number,
): string | undefined {
  const source = themeDemoSources[id as keyof typeof themeDemoSources];
  const pages = themeDemoPages[id as keyof typeof themeDemoPages];
  if (!source || !pages || !Number.isInteger(pageIndex)) return undefined;
  const page = pages[pageIndex];
  if (!page) return undefined;
  return source.replace(
    /export default \[Cover, Content, Closer\](?: satisfies Page\[\])?;/,
    `export default ${page};`,
  );
}
