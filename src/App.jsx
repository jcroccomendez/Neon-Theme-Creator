import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Desktop, ArrowCircleDown, Sun, Moon, IconContext, XLogo, FacebookLogo, LinkedinLogo, X, CaretDown, Play, Pause, SkipBack, Repeat, Lightning, ArrowCounterClockwise, PaintBrush, Plus, Shuffle } from '@phosphor-icons/react';
import { getTokens } from './design-system/tokens';
import { Tooltip, Slider, Switch, DirectionPad, Modal } from './design-system/components';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import useSound from 'use-sound';
import { HexColorPicker } from 'react-colorful';

// --- CONFIGURATION AND UTILITIES ---
const APP_BG = '#0d0d0d'; // Unified general app background
const IS_MOBILE = typeof window !== 'undefined' && (('ontouchstart' in window) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
const MOBILE_DPR = 1;
const MOBILE_FPS = 30;
const LOOP_MS = 8000; // default animation cycle — overridable per-session via Animation panel

// Normalized easing curves (t in [0,1] → [0,1]). All map 0→0 and 1→1 so loop wrap stays continuous in position.
const easeOutBounce = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) { const x = t - 1.5 / d1; return n1 * x * x + 0.75; }
  if (t < 2.5 / d1) { const x = t - 2.25 / d1; return n1 * x * x + 0.9375; }
  const x = t - 2.625 / d1;
  return n1 * x * x + 0.984375;
};
const applyEasing = (mode, t) => {
  switch (mode) {
    case 'ease': return t * t * (3 - 2 * t);
    case 'bounce': return easeOutBounce(t);
    case 'cubic': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'quint': return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
    case 'expo': {
      if (t === 0 || t === 1) return t;
      return t < 0.5
        ? Math.pow(2, 20 * t - 10) / 2
        : (2 - Math.pow(2, -20 * t + 10)) / 2;
    }
    case 'back': {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    case 'elastic': {
      const c4 = (2 * Math.PI) / 3;
      if (t === 0 || t === 1) return t;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    }
    case 'sine': return -(Math.cos(Math.PI * t) - 1) / 2;
    default: return t;
  }
};

// iOS WebKit handles ctx.filter and large feGaussianBlur poorly. Detect once
// and use it ONLY to cap mobile/iOS rendering — desktop path stays untouched.
const IS_IOS = typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent);
// Firefox's 2D canvas is CPU-bound for complex clips and large drawImage scaling.
// Detect once so heavy paths can shed work without affecting Chromium/WebKit.
const IS_FIREFOX = typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent);
const SUPPORTS_CANVAS_FILTER = (() => {
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas').getContext('2d');
    c.filter = 'blur(2px)';
    return c.filter === 'blur(2px)';
  } catch (_e) {
    return false;
  }
})();

// Cache noise canvases per format so format changes don't re-allocate huge ImageData
const noiseCacheByFormat = new Map();

// Color Themes
const THEMES = {
  neon: {
    label: 'Neon',
    bg: '#062F2C',
    gradientStart: '#2482F1',
    gradientEnd: '#00F345',
    preview: ['#062F2C', '#2482F1', '#00F345'],
  },
  midnight: {
    label: 'Prism',
    bg: '#041050',
    gradientStart: '#0055FF',
    gradientEnd: '#5BFFC0',
    preview: ['#041050', '#0055FF', '#5BFFC0'],
  },
  ember: {
    label: 'Acid',
    bg: '#00545F',
    gradientStart: '#D6FB00',
    gradientEnd: '#ECFFB6',
    preview: ['#00545F', '#D6FB00', '#ECFFB6'],
  },
};

// Brand-inspired curated palettes for the Random theme button. Each is hand-picked
// so the dark bg + 2 gradient stops stay visually consistent (technology, social,
// medical, finance, etc.) instead of producing chaotic random hex values.
const RANDOM_PALETTES = [
  { label: 'Apple', bg: '#0B0F1A', gradientStart: '#0A84FF', gradientMid: '#5856D6', gradientEnd: '#64D2FF' },
  { label: 'Meta', bg: '#0B1F3D', gradientStart: '#1877F2', gradientMid: '#845EE5', gradientEnd: '#00C6FF' },
  { label: 'Instagram', bg: '#1F0C29', gradientStart: '#833AB4', gradientMid: '#E1306C', gradientEnd: '#FCAF45' },
  { label: 'Spotify', bg: '#0A1F0F', gradientStart: '#1DB954', gradientMid: '#B4FF39', gradientEnd: '#A0F0BC' },
  { label: 'Slack', bg: '#1A0A2E', gradientStart: '#E01E5A', gradientMid: '#36C5F0', gradientEnd: '#ECB22E' },
  { label: 'Twitch', bg: '#160A2E', gradientStart: '#6441A5', gradientMid: '#FF4DA6', gradientEnd: '#BF94FF' },
  { label: 'Stripe', bg: '#0A1733', gradientStart: '#635BFF', gradientMid: '#00C8FF', gradientEnd: '#00FFB3' },
  { label: 'Sunset', bg: '#2D0F2E', gradientStart: '#FF1B6B', gradientMid: '#FF9F45', gradientEnd: '#FFD93D' },
  { label: 'Ocean', bg: '#001D3D', gradientStart: '#003566', gradientMid: '#0077B6', gradientEnd: '#00C9FF' },
  { label: 'Aurora', bg: '#0B1426', gradientStart: '#5C6BC0', gradientMid: '#00E5BC', gradientEnd: '#FF6F9C' },
  { label: 'Volcano', bg: '#1F0A05', gradientStart: '#D32F2F', gradientMid: '#FF5722', gradientEnd: '#FFD740' },
  { label: 'Lavender', bg: '#1A0B2E', gradientStart: '#7B2CBF', gradientMid: '#FF7AC6', gradientEnd: '#C77DFF' },
  { label: 'Cyber', bg: '#0A0A23', gradientStart: '#FF00FF', gradientMid: '#A100FF', gradientEnd: '#00FFFF' },
  { label: 'Forest', bg: '#0E1F12', gradientStart: '#1B5E20', gradientMid: '#66BB6A', gradientEnd: '#DCEDC8' },
  { label: 'Rose', bg: '#2C0B14', gradientStart: '#FF1744', gradientMid: '#FF7A1F', gradientEnd: '#FFD93D' },
  { label: 'Medical', bg: '#062B26', gradientStart: '#00BFA5', gradientMid: '#80E27E', gradientEnd: '#B2FFDA' },
  { label: 'Finance', bg: '#1A1305', gradientStart: '#7B5E10', gradientMid: '#C9A227', gradientEnd: '#FFD700' },
  { label: 'Rose Gold', bg: '#1F1014', gradientStart: '#B76A6A', gradientMid: '#E0B97A', gradientEnd: '#FFDAB9' },
  { label: 'Mint', bg: '#04221F', gradientStart: '#00C9A7', gradientMid: '#4DD0E1', gradientEnd: '#A8FFD5' },
  { label: 'Berry', bg: '#1A0420', gradientStart: '#6A1B9A', gradientMid: '#F06292', gradientEnd: '#FFAB91' },
];

// Small HSL jitter helper so a random palette gets unique variation each click
// while still feeling cohesive (no hue jumps, no muddy values).
const hexToHsl = (hex) => {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h *= 60;
  }
  return [h, s * 100, l * 100];
};
const hslToHex = (h, s, l) => {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};
const jitter = (hex, dH, dS, dL) => {
  const [h, s, l] = hexToHsl(hex);
  const r = () => (Math.random() * 2 - 1);
  return hslToHex(h + r() * dH, s + r() * dS, l + r() * dL);
};
const jitterPalette = (p) => ({
  label: p.label,
  bg: jitter(p.bg, 8, 6, 3),
  gradientStart: jitter(p.gradientStart, 12, 8, 5),
  gradientMid: p.gradientMid ? jitter(p.gradientMid, 13, 9, 5) : undefined,
  gradientEnd: jitter(p.gradientEnd, 14, 10, 6),
});

const FORMATS = {
  '9:16': { width: 1080, height: 1920, label: "9:16", name: "Full Portrait" },
  '1:1': { width: 1080, height: 1080, label: "1:1", name: "Square" },
  '16:9': { width: 1920, height: 1080, label: "16:9", name: "Landscape" },
};

// --- EASING ICON ---
// Plots the easing curve so the user can compare shapes at a glance.
const EasingIcon = ({ mode, className }) => {
  const W = 32, H = 32, PAD = 6;
  const pts = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = applyEasing(mode, t);
    const px = PAD + t * (W - 2 * PAD);
    const py = (H - PAD) - ((y + 0.25) / 1.5) * (H - 2 * PAD);
    pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
  }
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none" className={className} style={{ overflow: 'visible' }}>
      <polyline points={pts.join(' ')} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

// --- TAB ICONS (use currentColor so the active state can flip white → dark) ---
const PatternIcon = (props) => (
  <svg viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    <circle cx="19" cy="19" r="2" fill="currentColor" />
    <circle opacity="0.8" cx="19" cy="25" r="2" fill="currentColor" />
    <circle opacity="0.7" cx="19" cy="31" r="2" fill="currentColor" />
    <circle opacity="0.5" cx="19" cy="37" r="2" fill="currentColor" />
    <circle opacity="0.8" cx="25" cy="19" r="2" fill="currentColor" />
    <circle opacity="0.7" cx="25" cy="25" r="2" fill="currentColor" />
    <circle opacity="0.5" cx="25" cy="31" r="2" fill="currentColor" />
    <circle opacity="0.3" cx="25" cy="37" r="2" fill="currentColor" />
    <circle opacity="0.7" cx="31" cy="19" r="2" fill="currentColor" />
    <circle opacity="0.5" cx="31" cy="25" r="2" fill="currentColor" />
    <circle opacity="0.3" cx="31" cy="31" r="2" fill="currentColor" />
    <circle opacity="0.2" cx="31" cy="37" r="2" fill="currentColor" />
    <circle opacity="0.5" cx="37" cy="19" r="2" fill="currentColor" />
    <circle opacity="0.3" cx="37" cy="25" r="2" fill="currentColor" />
    <circle opacity="0.2" cx="37" cy="31" r="2" fill="currentColor" />
    <circle opacity="0.05" cx="37" cy="37" r="2" fill="currentColor" />
  </svg>
);

const SpectrumIcon = (props) => (
  <svg viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    <rect x="18" y="16" width="4" height="24" fill="currentColor" />
    <rect opacity="0.8" x="22" y="23.2" width="4" height="16.8" fill="currentColor" />
    <rect opacity="0.6" x="26" y="26.8" width="4" height="13.2" fill="currentColor" />
    <rect opacity="0.4" x="30" y="18.4" width="4" height="21.6" fill="currentColor" />
    <rect opacity="0.2" x="34" y="26.8" width="4" height="13.2" fill="currentColor" />
  </svg>
);

const WavesIcon = (props) => (
  <svg viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    <g clipPath="url(#wavesIconClip)">
      <circle cx="16.5" cy="39.5" r="4.5" stroke="currentColor" strokeWidth="4" />
      <circle opacity="0.8" cx="16.5" cy="39.5" r="8.5" stroke="currentColor" strokeWidth="4" />
      <circle opacity="0.6" cx="16.5" cy="39.5" r="12.5" stroke="currentColor" strokeWidth="4" />
      <circle opacity="0.4" cx="16.5" cy="39.5" r="16.5" stroke="currentColor" strokeWidth="4" />
      <circle opacity="0.2" cx="16.5" cy="39.5" r="20.5" stroke="currentColor" strokeWidth="4" />
    </g>
    <defs>
      <clipPath id="wavesIconClip">
        <rect width="24" height="24" fill="white" transform="translate(16 16)" />
      </clipPath>
    </defs>
  </svg>
);

const PulseIcon = (props) => (
  <svg viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    <g clipPath="url(#pulseIconClip)">
      <circle cx="27.5" cy="41.5" r="4.5" stroke="currentColor" strokeWidth="4" />
      <circle opacity="0.8" cx="27.5" cy="41.5" r="8.5" stroke="currentColor" strokeWidth="4" />
      <circle opacity="0.6" cx="27.5" cy="41.5" r="12.5" stroke="currentColor" strokeWidth="4" />
      <circle opacity="0.4" cx="27.5" cy="41.5" r="16.5" stroke="currentColor" strokeWidth="4" />
      <circle opacity="0.2" cx="27.5" cy="41.5" r="20.5" stroke="currentColor" strokeWidth="4" />
    </g>
    <defs>
      <clipPath id="pulseIconClip">
        <rect width="24" height="24" fill="white" transform="translate(16 16)" />
      </clipPath>
    </defs>
  </svg>
);

const TABS = [
  { id: 'spectrum', label: 'Spectrum', Icon: SpectrumIcon },
  { id: 'radial', label: 'Waves', Icon: WavesIcon },
  { id: 'glass', label: 'Pulse', Icon: PulseIcon },
  { id: 'neonPattern', label: 'Pattern', Icon: PatternIcon },
];

// --- INTRO LOADER ---
// Full-screen Waves (Neon theme) background animation with a centred card
// containing the app title, a subtitle, a 0→100% progress counter and the
// neonplace logo. Fades in on mount and fades out at 100%, then calls onDone.
const NeonplaceLogo = ({ className }) => (
  <div className={`inline-flex items-center gap-1.5 ${className || ''}`}>
    <svg viewBox="0 0 20 17" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-[15px] w-auto" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M19.089 0v9.113l-6.356 6.357-6.367-6.367L0 15.47V6.357L6.356 0l6.367 6.368L19.089 0Z" fill="#24F187" />
      <path fillRule="evenodd" clipRule="evenodd" d="M6.367 15.47H4.71V14.3l1.657-1.657 1.656 1.657v1.17H6.367Z" fill="#fff" />
    </svg>
    <span className="text-white text-[14px] font-medium leading-none">neonplace</span>
  </div>
);

const Loader = ({ onDone, onFadeStart, bgColor = APP_BG }) => {
  const canvasRef = useRef(null);
  const cardRef = useRef(null);
  const overlayRef = useRef(null);
  const mousePosRef = useRef(null);
  const interactRef = useRef({ x: 0, y: 0, weight: 0 });
  const tiltRef = useRef({ trx: 0, tryY: 0, rx: 0, ry: 0 });
  const [progress, setProgress] = useState(0);
  const [shown, setShown] = useState(false);
  const [hiding, setHiding] = useState(false);

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    const card = cardRef.current;
    if (!canvas || !card) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      mousePosRef.current = null;
      tiltRef.current.trx = 0;
      tiltRef.current.tryY = 0;
      return;
    }
    const W = 669, H = 351.369;
    mousePosRef.current = { x: (x / rect.width) * W, y: (y / rect.height) * H };
    // 3D tilt: cursor offset from center → small rotation (max ±5°)
    const cardRect = card.getBoundingClientRect();
    const nx = (e.clientX - cardRect.left) / cardRect.width - 0.5;  // -0.5..0.5
    const ny = (e.clientY - cardRect.top) / cardRect.height - 0.5;
    tiltRef.current.tryY = nx * 6;   // rotateY range ±3°
    tiltRef.current.trx = -ny * 6;   // rotateX range ±3°
    startTilt();
  };
  const tiltRafRef = useRef(null);
  const startTilt = () => {
    if (tiltRafRef.current != null) return;
    const tick = () => {
      if (document.hidden) { tiltRafRef.current = requestAnimationFrame(tick); return; }
      const t = tiltRef.current;
      const dx = t.trx - t.rx;
      const dy = t.tryY - t.ry;
      if (Math.abs(dx) < 0.005 && Math.abs(dy) < 0.005) {
        t.rx = t.trx; t.ry = t.tryY;
        const el = cardRef.current;
        if (el) {
          el.style.transform = `perspective(1600px) rotateX(${t.rx.toFixed(2)}deg) rotateY(${t.ry.toFixed(2)}deg)`;
        }
        tiltRafRef.current = null;
        return;
      }
      t.rx += dx * 0.12;
      t.ry += dy * 0.12;
      const el = cardRef.current;
      if (el) {
        el.style.transform = `perspective(1600px) rotateX(${t.rx.toFixed(2)}deg) rotateY(${t.ry.toFixed(2)}deg)`;
      }
      tiltRafRef.current = requestAnimationFrame(tick);
    };
    tiltRafRef.current = requestAnimationFrame(tick);
  };
  const handleMouseLeave = () => {
    mousePosRef.current = null;
    tiltRef.current.trx = 0;
    tiltRef.current.tryY = 0;
    startTilt();
  };

  // Spring-eased 3D tilt — RAF only while in motion
  useEffect(() => {
    startTilt();
    return () => {
      if (tiltRafRef.current != null) cancelAnimationFrame(tiltRafRef.current);
      tiltRafRef.current = null;
    };
  }, []);

  // Trigger the entry fade after first paint
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Full-screen Waves animation (Neon theme).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0;

    const ctx = canvas.getContext('2d');

    // Downscaled offscreen for the heavy 170px blur.
    const DOWNSCALE = 4;
    const off = document.createElement('canvas');
    const offCtx = off.getContext('2d');

    W = 669;
    H = 351.369;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    off.width = Math.max(1, Math.ceil(W / DOWNSCALE));
    off.height = Math.max(1, Math.ceil(H / DOWNSCALE));

    // Loader shows ONLY the Neon theme — no cycling through other palettes.
    const cycleNeon = {
      ...THEMES.neon,
      gradientStart: '#1DB954',
      gradientEnd: '#00F345',
    };
    const themesCycle = [cycleNeon];
    const hexToRgb = (h) => {
      const m = h.replace('#', '');
      return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
    };
    const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    const lerpHex = (a, b, t) => {
      const ra = hexToRgb(a), rb = hexToRgb(b);
      return rgbToHex([ra[0] + (rb[0] - ra[0]) * t, ra[1] + (rb[1] - ra[1]) * t, ra[2] + (rb[2] - ra[2]) * t]);
    };

    // Noise tile (same look as the main canvas's noise overlay).
    const noiseSize = 256;
    const noiseCanvas = document.createElement('canvas');
    noiseCanvas.width = noiseSize;
    noiseCanvas.height = noiseSize;
    const noiseCtx = noiseCanvas.getContext('2d');
    const imgData = noiseCtx.createImageData(noiseSize, noiseSize);
    const nd = imgData.data;
    for (let i = 0; i < nd.length; i += 4) {
      const v = Math.random() * 255;
      nd[i] = v; nd[i + 1] = v; nd[i + 2] = v; nd[i + 3] = 255;
    }
    noiseCtx.putImageData(imgData, 0, 0);

    let raf;
    const startTime = performance.now();
    const SLOT_MS = 400;
    const FADE_MS = 250;
    const draw = (time) => {
      if (document.hidden) { raf = requestAnimationFrame(draw); return; }
      try {
        const elapsed = time - startTime;
        const mPos = mousePosRef.current;
        if (mPos) {
          interactRef.current.weight += (0.2 - interactRef.current.weight) * 0.2;
          interactRef.current.x += (mPos.x - interactRef.current.x) * 0.2;
          interactRef.current.y += (mPos.y - interactRef.current.y) * 0.2;
        } else {
          interactRef.current.weight += (0 - interactRef.current.weight) * 0.2;
        }

        // Theme cycling: hold each theme purely for SLOT_MS then crossfade
        // for FADE_MS into the next. Each segment = SLOT_MS + FADE_MS.
        const SEG_MS = SLOT_MS + FADE_MS;
        const slot = Math.floor(elapsed / SEG_MS);
        const segElapsed = elapsed - slot * SEG_MS;
        const idxA = slot % themesCycle.length;
        const idxB = (slot + 1) % themesCycle.length;
        const inFade = segElapsed > SLOT_MS;
        const blend = inFade ? (segElapsed - SLOT_MS) / FADE_MS : 0;
        const themeA = themesCycle[idxA];
        const themeB = themesCycle[idxB];
        const bgNow = lerpHex(themeA.bg, themeB.bg, blend);

        const offS = off.width / W;
        ctx.fillStyle = bgNow;
        ctx.fillRect(0, 0, W, H);

        // Sync left overlay gradient to the current theme bg color
        if (overlayRef.current) {
          const [r, g, b] = hexToRgb(bgNow);
          const rgb = `${r}, ${g}, ${b}`;
          overlayRef.current.style.background = `linear-gradient(90deg, rgb(${rgb}) 0%, rgb(${rgb}) 22%, rgba(${rgb},0.98) 32%, rgba(${rgb},0.93) 42%, rgba(${rgb},0.84) 52%, rgba(${rgb},0.7) 62%, rgba(${rgb},0.52) 72%, rgba(${rgb},0.32) 82%, rgba(${rgb},0.14) 92%, rgba(${rgb},0) 100%)`;
        }

        const spectrumCols = 9;
        const colWidth = W / spectrumCols;
        const extraLeft = 4, extraRight = 4;
        const numCols = spectrumCols + extraLeft + extraRight;
        const startX = -extraLeft * colWidth;

        const radius = Math.max(W, H) * 0.4;
        const baseBlobY = H + radius * 0.30;
        const animT = time * 0.00012;
        const numPoints = 60;

        const getWarpedX = (baseX, y) => {
          const yRatio = y / H;
          const focalX = W * 0.05;
          const spread = Math.pow(yRatio, 0.7);
          const targetX = baseX * 1.2;
          const fanX = focalX + (targetX - focalX) * spread;
          const arc = Math.sin(yRatio * Math.PI) * W * 0.035;
          const breath = Math.sin(animT) * W * 0.008 * yRatio;
          return fanX + arc + breath;
        };

        const boundaries = [];
        for (let col = 0; col <= numCols; col++) {
          const baseX = startX + col * colWidth;
          const points = [];
          for (let j = 0; j <= numPoints; j++) {
            const y = (j / numPoints) * H;
            points.push({ x: getWarpedX(baseX, y), y });
          }
          boundaries.push(points);
        }

        for (let i = 0; i < numCols; i++) {
          const colDelayMs = i * 12;
          const colDurationMs = 280;
          const rawColP = Math.max(0, Math.min((elapsed - 10 - colDelayMs) / colDurationMs, 1));
          const pColFade = Math.pow(rawColP, 2);

          ctx.save();
          const leftBound = boundaries[i];
          const rightBound = boundaries[i + 1];
          ctx.beginPath();
          ctx.moveTo(leftBound[0].x, leftBound[0].y);
          for (let j = 1; j < leftBound.length; j++) ctx.lineTo(leftBound[j].x, leftBound[j].y);
          for (let j = rightBound.length - 1; j >= 0; j--) ctx.lineTo(rightBound[j].x, rightBound[j].y);
          ctx.closePath();
          ctx.clip();

          const t = (time + i * 400) * 0.0015;
          const waveX = W / 2 + Math.sin(t * 0.5) * (W * 0.25);
          const waveY = baseBlobY + Math.cos(t * 0.8) * (H * 0.15);
          const iw = interactRef.current.weight;
          const blobX = waveX * (1 - iw) + interactRef.current.x * iw;
          const blobY = waveY * (1 - iw) + interactRef.current.y * iw;
          let rx = radius + Math.sin(t * 1.2) * (W * 0.15);
          let ry = radius + Math.cos(t * 1.5) * (H * 0.10);
          const gradScale = 0.9 + (0.1 * pColFade);
          rx *= gradScale;
          ry *= gradScale;

          // Render blurred gradient ellipse via offscreen ctx.filter blur. Lerped
          // gradient colors so the cycle transitions remain visible. Reliable
          // across browsers — no SVG sprite loading dependency.
          const fbStart = lerpHex(themeA.gradientStart, themeB.gradientStart, blend);
          const fbEnd = lerpHex(themeA.gradientEnd, themeB.gradientEnd, blend);
          offCtx.clearRect(0, 0, off.width, off.height);
          // iOS clamps large blur radii — keep effective radius ≤ 40px on iOS
          // so the loader gradient still reads as blurred, not as a hard ellipse.
          offCtx.filter = `blur(${(IS_IOS ? Math.min(40, 170 * offS) : 170 * offS)}px)`;
          const grad = offCtx.createLinearGradient(
            (blobX - rx) * offS, blobY * offS,
            (blobX + rx) * offS, blobY * offS,
          );
          grad.addColorStop(0.1529, fbStart);
          grad.addColorStop(0.8046, fbEnd);
          offCtx.fillStyle = grad;
          offCtx.beginPath();
          offCtx.ellipse(blobX * offS, blobY * offS, rx * offS, ry * offS, 0, 0, Math.PI * 2);
          offCtx.fill();
          offCtx.filter = 'none';
          ctx.globalAlpha = pColFade;
          ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, W, H);
          ctx.globalAlpha = 1;
          ctx.restore();

          if (i < numCols - 1) {
            ctx.save();
            ctx.globalAlpha = pColFade * 0.5;
            ctx.setLineDash([5, 9.3]);
            ctx.lineWidth = 1.24;
            // Tint the dashed line tip with the current theme's gradient end color
            const tipColor = lerpHex(themeA.gradientEnd, themeB.gradientEnd, blend);
            const lineGrad = ctx.createLinearGradient(0, 0, 0, H);
            lineGrad.addColorStop(0, 'rgba(255,255,255,0)');
            lineGrad.addColorStop(0.35, 'rgba(255,255,255,0)');
            lineGrad.addColorStop(1, tipColor);
            ctx.strokeStyle = lineGrad;
            const b = boundaries[i + 1];
            ctx.beginPath();
            ctx.moveTo(b[0].x, b[0].y);
            for (let j = 1; j < b.length; j++) ctx.lineTo(b[j].x, b[j].y);
            ctx.stroke();
            ctx.restore();
          }
        }
        ctx.save();
        ctx.globalAlpha = 0.025;
        const pat = ctx.createPattern(noiseCanvas, 'repeat');
        if (pat) { ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H); }
        ctx.restore();
      } catch (err) {
        // swallow per-frame errors so the rAF chain keeps running
      } finally {
        raf = requestAnimationFrame(draw);
      }
    };
    // Immediate first frame so the canvas never appears blank while waiting on rAF.
    try { draw(performance.now()); } catch (e) { /* defensive */ }
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, []);

  // 0 → 100 progress counter with ease-in-out timing. When it hits 100 we
  // pause briefly, then fade out and notify the parent.
  useEffect(() => {
    const start = performance.now();
    const duration = 700;
    let raf;
    let lastProgress = -1;
    const tick = (now) => {
      const k = Math.min(1, (now - start) / duration);
      const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const next = Math.floor(eased * 100);
      if (next !== lastProgress) {
        lastProgress = next;
        setProgress(next);
      }
      if (k < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setProgress(100);
        setTimeout(() => {
          setHiding(true);
          onFadeStart?.();
          setTimeout(() => onDone?.(), 250);
        }, 80);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{ backgroundColor: bgColor }}
      className={`fixed inset-0 z-[100] overflow-hidden flex items-center justify-center transition-opacity duration-[250ms] ease-out ${shown && !hiding ? 'opacity-100' : 'opacity-0'}`}
    >
      <div
        ref={cardRef}
        className="relative overflow-hidden flex flex-col"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{
          width: 669,
          height: 351.369,
          flexShrink: 0,
          background: '#052825',
          padding: 50,
          borderRadius: 16,
          boxShadow: '0 4px 116px rgba(0,0,0,0.24)',
          transformStyle: 'preserve-3d',
          willChange: 'transform',
        }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full block pointer-events-none"
          style={{ borderRadius: 16 }}
        />
        <div
          ref={overlayRef}
          className="absolute inset-0 pointer-events-none"
        />
        <img
          src="/glowydark.png"
          alt="Glowy"
          className="relative object-contain self-start mr-auto"
          style={{ height: 22, width: 'auto' }}
        />
        <div
          className="relative text-white mt-3"
          style={{
            fontFamily: "'Geist', sans-serif",
            fontSize: '30px',
            fontWeight: 300,
            lineHeight: '120%',
            display: 'inline-block',
          }}
        >
          Built for anyone who<br />needs a nice background
        </div>
        <div
          className="relative mt-auto rounded-full overflow-hidden"
          style={{ width: 160, height: 4, backgroundColor: 'rgba(255,255,255,0.12)' }}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${progress}%`, backgroundColor: '#FFFFFF' }}
          />
        </div>
      </div>
    </div>
  );
};

// UI primitives (Tooltip, Slider, Switch, DirectionPad) live in
// src/design-system/components — imported above.

// --- MAIN APP COMPONENT ---
export default function App() {
  // General state
  const [format, setFormat] = useState('9:16');
  const [isAnimated, setIsAnimated] = useState(false);
  const [animSpeed, setAnimSpeed] = useState(1);
  const [easing, setEasing] = useState('linear'); // 'linear' | 'ease' | 'bounce'
  const [playMode, setPlayMode] = useState('once'); // 'once' | 'loop' | 'pingpong'
  const [loopDurationMs, setLoopDurationMs] = useState(LOOP_MS);
  const [animPanelOpen, setAnimPanelOpen] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [waveAmp, setWaveAmp] = useState(1);
  const [dashedIntensity, setDashedIntensity] = useState(1);
  const fxRef = useRef({ waveAmp: 1, dashedIntensity: 1 });
  useEffect(() => {
    fxRef.current.waveAmp = waveAmp;
    fxRef.current.dashedIntensity = dashedIntensity;
    requestPreviewRedrawRef.current();
  }, [waveAmp, dashedIntensity]);
  const animOptsRef = useRef({ speed: 1, easing: 'linear', playMode: 'once', loopMs: LOOP_MS, dir: 1 });
  useEffect(() => {
    animOptsRef.current.speed = animSpeed;
    animOptsRef.current.easing = easing;
    animOptsRef.current.playMode = playMode;
    animOptsRef.current.loopMs = loopDurationMs;
  }, [animSpeed, easing, playMode, loopDurationMs]);
  const [isRecording, setIsRecording] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [svgExporting, setSvgExporting] = useState(false);
  const [svgProgress, setSvgProgress] = useState(0);
  const [loaderDone, setLoaderDone] = useState(false);
  const [shapeCount, setShapeCount] = useState(9);
  const [customTheme, setCustomTheme] = useState(null);
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const [customSlot, setCustomSlot] = useState('gradientStart');
  const [customDraft, setCustomDraft] = useState({
    bg: '#0B0F1A',
    gradientStart: '#0A84FF',
    gradientMid: '#5856D6',
    gradientEnd: '#64D2FF',
  });
  const applyCustomDraft = (next) => {
    setCustomDraft(next);
    setCustomTheme({
      label: 'Custom',
      bg: next.bg,
      gradientStart: next.gradientStart,
      gradientMid: next.gradientMid,
      gradientEnd: next.gradientEnd,
      preview: [next.gradientStart, next.gradientMid, next.gradientEnd],
    });
  };
  const [showDashed, setShowDashed] = useState(true);
  const [showNoise, setShowNoise] = useState(true);
  const sidebarCustomBtnRef = useRef(null);
  const [sidebarPickerPos, setSidebarPickerPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!sidebarCustomBtnRef.current) return;
    const update = () => {
      const r = sidebarCustomBtnRef.current?.getBoundingClientRect();
      if (r) setSidebarPickerPos({ left: r.right + 12, top: r.top });
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, []);
  const renderCustomPickerPanel = (positionStyle, open = true) => (
    <div
      className={`rounded-2xl p-3 flex flex-col gap-3 z-30 custom-color-picker transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
      style={{
        backgroundColor: ui.tabActive,
        border: 'none',
        width: 280,
        transform: `translateX(${open ? '0px' : '-16px'})`,
        ...positionStyle,
      }}
    >
      <div className="flex items-center gap-2 justify-between">
        <span className="text-[12px] font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
          Color Palette
        </span>
        <div className="flex items-center gap-2">
          {[
            { key: 'bg', label: 'Background' },
            { key: 'gradientStart', label: 'Start' },
            { key: 'gradientMid', label: 'Middle' },
            { key: 'gradientEnd', label: 'End' },
          ].map(({ key, label }) => {
            const active = customSlot === key;
            const hex = customDraft[key].replace('#', '');
            const r = parseInt(hex.slice(0, 2), 16) || 0;
            const g = parseInt(hex.slice(2, 4), 16) || 0;
            const b = parseInt(hex.slice(4, 6), 16) || 0;
            const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
            const dotColor = lum > 0.85 ? '#000' : '#fff';
            return (
              <Tooltip key={key} label={label} side="top">
                <button
                  onClick={() => setCustomSlot(key)}
                  aria-label={label}
                  className="rounded-full flex items-center justify-center"
                  style={{
                    width: 29,
                    height: 29,
                    backgroundColor: customDraft[key],
                    border: 'none',
                    cursor: 'pointer',
                    boxShadow: active ? `inset 0 0 0 2px ${dotColor}` : 'none',
                  }}
                >
                  {active && (
                    <span style={{ width: 8, height: 8, borderRadius: 9999, backgroundColor: dotColor }} />
                  )}
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>
      <HexColorPicker
        color={customDraft[customSlot]}
        onChange={(hex) => applyCustomDraft({ ...customDraft, [customSlot]: hex })}
        style={{ width: '100%', height: 160 }}
      />
      <div className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ backgroundColor: 'var(--sec-bg)' }}>
        <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>#</span>
        <input
          type="text"
          value={customDraft[customSlot].replace('#', '').toUpperCase()}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
            if (v.length === 6) applyCustomDraft({ ...customDraft, [customSlot]: `#${v}` });
            else setCustomDraft({ ...customDraft, [customSlot]: `#${v}` });
          }}
          className="flex-1 bg-transparent outline-none text-[12px] font-mono uppercase"
          style={{ color: 'var(--text-primary)' }}
          maxLength={6}
          spellCheck={false}
        />
      </div>
    </div>
  );
  const [themePref, setThemePref] = useState('system'); // 'system' | 'light' | 'dark'
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setSystemDark(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  const uiTheme = themePref === 'system' ? (systemDark ? 'dark' : 'light') : themePref;
  const isLight = uiTheme === 'light';
  const ui = getTokens(uiTheme);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', uiTheme);
  }, [uiTheme]);

  // Low-power auto-pause: prefers-reduced-motion OR battery <20% on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setIsAnimated(false); return; }
    if (navigator.getBattery) {
      navigator.getBattery().then((bat) => {
        if (cancelled) return;
        if (!bat.charging && bat.level < 0.2) setIsAnimated(false);
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, []);

  // Space toggles play/pause (ignore when typing in inputs or while exporting)
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (isRecording || svgExporting) return;
      e.preventDefault();
      setIsAnimated((v) => {
        if (v) return false;
        const cycle = animOptsRef.current.loopMs || LOOP_MS;
        if (animOptsRef.current.playMode === 'once' && timeStateRef.current.animatedTime >= cycle - 2) {
          restartAnim();
          return true;
        }
        return true;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isRecording, svgExporting]);

  // Preload all UI sounds on first paint
  useEffect(() => {
    const urls = ['/sounds/type_02.wav', '/sounds/rollover6.ogg'];
    urls.forEach((url) => {
      const a = new Audio();
      a.preload = 'auto';
      a.src = url;
      a.load();
    });
  }, []);

  // Classic Mode state
  const [direction, setDirection] = useState('left');
  const [dotSize, setDotSize] = useState(1.8);
  const [dotSpacing, setDotSpacing] = useState(28);
  const [gradientPos, setGradientPos] = useState('bottom');
  const [activeTab, setActiveTab] = useState('spectrum'); // 'spectrum' | 'radial' | 'glass' | 'neonPattern'
  const [panelOpen, setPanelOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportMenuMounted, setExportMenuMounted] = useState(false);
  useEffect(() => {
    if (exportMenuOpen) {
      setExportMenuMounted(true);
    } else if (exportMenuMounted) {
      const t = setTimeout(() => setExportMenuMounted(false), 200);
      return () => clearTimeout(t);
    }
  }, [exportMenuOpen, exportMenuMounted]);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [mobileWarningOpen, setMobileWarningOpen] = useState(IS_MOBILE);
  const exportMenuRef = useRef(null);
  useEffect(() => {
    if (!exportMenuOpen) return;
    const onDown = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) setExportMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [exportMenuOpen]);
  const [playHover] = useSound('/sounds/type_02.wav', { volume: 1, interrupt: true });
  const [playSwitch] = useSound('/sounds/rollover6.ogg', { volume: 0.4 });

  // Click on a nav: same tab → toggle the panel; different tab → switch + open
  const handleTabClick = (id) => {
    if (id === activeTab) {
      setPanelOpen((p) => !p);
    } else {
      setActiveTab(id);
      setPanelOpen(true);
    }
  };

  // Close the side panel when clicking anywhere outside the rail/panel.
  useEffect(() => {
    if (!panelOpen) return;
    const onMouseDown = (e) => {
      if (railRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      if (e.target.closest?.('.custom-color-picker')) return;
      setPanelOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [panelOpen]);

  useEffect(() => {
    if (!animPanelOpen) return;
    const onMouseDown = (e) => {
      if (animRailRef.current?.contains(e.target)) return;
      if (animPanelRef.current?.contains(e.target)) return;
      setAnimPanelOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [animPanelOpen]);

  const [colorTheme, setColorTheme] = useState('neon');
  const [uploadedImageSrc, setUploadedImageSrc] = useState(null);
  const [uploadedImageObj, setUploadedImageObj] = useState(null);
  const [imageScale, setImageScale] = useState(1.0);

  // Mirror animatedTime → React state so the transport scrubber updates while playing.
  // Throttled to 10fps + skip-if-unchanged + pause on hidden/blur. Scrubber doesn't
  // need 30fps; re-rendering App at 30fps spikes CPU.
  useEffect(() => {
    if (!isAnimated) return;
    let raf;
    let last = 0;
    let lastVal = -1;
    const tick = (now) => {
      if (now - last >= 250) {
        last = now;
        if (!document.hidden && document.hasFocus()) {
          const v = timeStateRef.current.animatedTime;
          if (Math.abs(v - lastVal) >= 1) {
            lastVal = v;
            setPlayheadMs(v);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isAnimated]);

  const seekTo = (ms) => {
    const cycle = animOptsRef.current.loopMs || LOOP_MS;
    const v = Math.max(0, Math.min(cycle - 1, ms));
    timeStateRef.current.animatedTime = v;
    loopFrame0Ref.current = null;
    setPlayheadMs(v);
    requestPreviewRedrawRef.current();
  };

  const restartAnim = () => {
    timeStateRef.current.animatedTime = 0;
    loopFrame0Ref.current = null;
    animOptsRef.current.dir = 1;
    setPlayheadMs(0);
    setIsAnimated(true);
    requestPreviewRedrawRef.current();
  };

  // Invalidate loop snapshot whenever a visual-state-affecting input changes
  useEffect(() => {
    loopFrame0Ref.current = null;
  }, [format, activeTab, colorTheme, customTheme, shapeCount, direction, dotSize, dotSpacing, gradientPos, showDashed, showNoise, isAnimated]);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const src = event.target.result;
        setUploadedImageSrc(src);
        const img = new Image();
        img.onload = () => setUploadedImageObj(img);
        img.src = src;
      };
      reader.readAsDataURL(file);
    }
  };

  // References (Refs)
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const fadeWrapRef = useRef(null);
  const noiseCanvasRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const introStartTimeRef = useRef(-1);
  const formatRef = useRef(null);
  const mousePosRef = useRef(null);
  const interactRef = useRef({ x: 0, y: 0, weight: 0 });
  const timeStateRef = useRef({ lastTime: performance.now(), animatedTime: 0 });
  const loopFrame0Ref = useRef(null); // snapshot of canvas at start of loop — used to crossfade the wrap
  const liquidCanvasRef = useRef(null);
  const blurOffscreenRef = useRef(null);
  const blobSpriteRef = useRef({});
  // Most-recent ready sprite per format. Used as fallback while a new
  // theme's sprite is still decoding so the blob never blanks on swap.
  const lastReadySpriteRef = useRef({});
  const dotsCacheRef = useRef(null);
  const wavesBufRef = useRef({ key: '', xs: null, ys: null, staticXs: null, breathFactor: null, numCols: 0, numPoints: 0, stride: 0 });
  const lineGradRef = useRef({ key: '', grad: null });
  const requestPreviewRedrawRef = useRef(() => {});
  const railRef = useRef(null);
  const panelRef = useRef(null);
  const animRailRef = useRef(null);
  const animPanelRef = useRef(null);
  const tiltRef = useRef({ trx: 0, tryY: 0, rx: 0, ry: 0 });

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const canvasAspect = canvas.width / canvas.height;
    const rectAspect = rect.width / rect.height;

    let drawWidth, drawHeight, offsetX, offsetY;
    if (canvasAspect > rectAspect) {
      drawWidth = rect.width;
      drawHeight = rect.width / canvasAspect;
      offsetX = 0;
      offsetY = (rect.height - drawHeight) / 2;
    } else {
      drawHeight = rect.height;
      drawWidth = rect.height * canvasAspect;
      offsetX = (rect.width - drawWidth) / 2;
      offsetY = 0;
    }

    const clickX = e.clientX - rect.left - offsetX;
    const clickY = e.clientY - rect.top - offsetY;

    if (clickX >= 0 && clickX <= drawWidth && clickY >= 0 && clickY <= drawHeight) {
      // Reuse single object — mousemove fires often, avoid per-event allocations
      const mp = mousePosRef.current || (mousePosRef.current = { x: 0, y: 0 });
      mp.x = (clickX / drawWidth) * canvas.width;
      mp.y = (clickY / drawHeight) * canvas.height;
      requestPreviewRedrawRef.current();
    } else {
      mousePosRef.current = null;
    }

    // 3D tilt: cursor offset from canvas-container center → small rotation (±5°)
    if (container) {
      const cr = container.getBoundingClientRect();
      const nx = (e.clientX - cr.left) / cr.width - 0.5;
      const ny = (e.clientY - cr.top) / cr.height - 0.5;
      tiltRef.current.tryY = nx * 6;
      tiltRef.current.trx = -ny * 6;
      startContainerTilt();
    }
  };

  const containerTiltRafRef = useRef(null);
  const startContainerTilt = () => {
    if (containerTiltRafRef.current != null) return;
    const tick = () => {
      if (document.hidden) { containerTiltRafRef.current = requestAnimationFrame(tick); return; }
      const t = tiltRef.current;
      const dx = t.trx - t.rx;
      const dy = t.tryY - t.ry;
      if (Math.abs(dx) < 0.005 && Math.abs(dy) < 0.005) {
        t.rx = t.trx; t.ry = t.tryY;
        const el = containerRef.current;
        if (el) {
          el.style.transform = `perspective(1600px) rotateX(${t.rx.toFixed(2)}deg) rotateY(${t.ry.toFixed(2)}deg)`;
        }
        containerTiltRafRef.current = null;
        return;
      }
      t.rx += dx * 0.12;
      t.ry += dy * 0.12;
      const el = containerRef.current;
      if (el) {
        el.style.transform = `perspective(1600px) rotateX(${t.rx.toFixed(2)}deg) rotateY(${t.ry.toFixed(2)}deg)`;
      }
      containerTiltRafRef.current = requestAnimationFrame(tick);
    };
    containerTiltRafRef.current = requestAnimationFrame(tick);
  };
  const handleMouseLeave = () => {
    mousePosRef.current = null;
    tiltRef.current.trx = 0;
    tiltRef.current.tryY = 0;
    startContainerTilt();
    // Drive the interactRef weight back to 0; preview loop needs to wake to animate that
    requestPreviewRedrawRef.current();
  };

  // Spring-eased 3D tilt on canvas container — RAF only while in motion
  useEffect(() => {
    startContainerTilt();
    return () => {
      if (containerTiltRafRef.current != null) cancelAnimationFrame(containerTiltRafRef.current);
      containerTiltRafRef.current = null;
    };
  }, []);

  // Generate noise pattern + allocate blur offscreen + invalidate dots cache
  useEffect(() => {
    const { width, height } = FORMATS[format];
    let canvas = noiseCacheByFormat.get(format);
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const imgData = ctx.createImageData(width, height);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const val = Math.random() * 255;
        data[i] = val; data[i + 1] = val; data[i + 2] = val; data[i + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);
      noiseCacheByFormat.set(format, canvas);
    }
    noiseCanvasRef.current = canvas;

    // Pre-allocate blur offscreen at 1/4 resolution.
    // ctx.filter = 'blur(170px)' on 1080x1350 ≈ 248M ops; on 270x337 ≈ 3.9M ops (~63x faster).
    // The drawImage upscale provides bilinear smoothing imperceptible against a 170px blur.
    const DOWNSCALE = 4;
    const blurCanvas = document.createElement('canvas');
    blurCanvas.width = Math.ceil(width / DOWNSCALE);
    blurCanvas.height = Math.ceil(height / DOWNSCALE);
    blurOffscreenRef.current = {
      canvas: blurCanvas,
      ctx: blurCanvas.getContext('2d'),
      scale: 1 / DOWNSCALE,
    };

    dotsCacheRef.current = null;
  }, [format]);

  const stateRef = useRef({ direction, dotSize, dotSpacing, gradientPos, isAnimated, format, isRecording, uploadedImageObj, uploadedImageSrc, activeTab, imageScale, colorTheme, shapeCount, customTheme, showDashed, showNoise });
  useEffect(() => {
    stateRef.current = { direction, dotSize, dotSpacing, gradientPos, isAnimated, format, isRecording, uploadedImageObj, uploadedImageSrc, activeTab, imageScale, colorTheme, shapeCount, customTheme, showDashed, showNoise };
    requestPreviewRedrawRef.current();
  }, [direction, dotSize, dotSpacing, gradientPos, isAnimated, format, isRecording, uploadedImageObj, uploadedImageSrc, activeTab, imageScale, colorTheme, shapeCount, customTheme, showDashed, showNoise]);

  // Intro animation only plays once when the main UI first becomes visible
  // (after loader). Tab/theme/format changes must not re-trigger it.
  useEffect(() => {
    introStartTimeRef.current = -1;
  }, [loaderDone]);

  // Prewarm the blob sprite the moment theme/format changes so its async
  // Image decode is already in flight by the time the next frame renders.
  // Cuts the visible color flash on theme swap to ~one frame.
  useEffect(() => {
    const theme = customTheme || THEMES[colorTheme] || THEMES.neon;
    getBlobSprite(theme.gradientStart, theme.gradientEnd, format, theme.gradientMid);
  }, [colorTheme, customTheme, format]);

  // Fade-in-up on the canvas wrapper for initial reveal AND tab/format
  // changes. Theme changes intentionally excluded — they update instantly
  // for fluid color swapping without re-running the entrance animation.
  useEffect(() => {
    const el = fadeWrapRef.current;
    if (!el) return;
    el.classList.remove('canvas-fade-in-up');
    void el.offsetWidth;
    el.classList.add('canvas-fade-in-up');
  }, [loaderDone, activeTab, format]);

  // Pre-render a blurred linear-gradient ellipse via SVG feGaussianBlur (works
  // on every browser, no canvas ctx.filter dependency). Sprite size matches the
  // current format's largest dimension so per-frame drawImage scaling stays
  // close to 1:1 — no pixelation when stretched to the blob's rx/ry.
  const getBlobSprite = (gradStart, gradEnd, format, gradMid) => {
    const key = `${gradStart}|${gradMid || ''}|${gradEnd}|${format}`;
    if (blobSpriteRef.current[key]) return blobSpriteRef.current[key];
    const { width, height } = FORMATS[format] || FORMATS.post;
    const SS = Math.max(width, height);
    // iOS WebKit silently clamps large stdDeviation in feGaussianBlur and
    // struggles with 2048² rasters. Cap aggressively on iOS only — desktop
    // keeps full fidelity.
    const blurSD = IS_IOS ? Math.min(120, SS * 0.10) : SS * 0.157;
    // Sprite is a heavily blurred ellipse — high raster res buys no visible gain
    // and pushes more pixels per frame across N composited draws (17 in Waves).
    // Firefox: even smaller raster — its drawImage scaling is slower than Chrome.
    const rasterPx = IS_IOS ? 768 : (IS_FIREFOX ? 512 : 640);
    const cacheCanvas = document.createElement('canvas');
    cacheCanvas.width = rasterPx;
    cacheCanvas.height = rasterPx;
    blobSpriteRef.current[key] = { canvas: cacheCanvas, ready: false };

    const midStop = gradMid ? `<stop offset='50%' stop-color='${gradMid}'/>` : '';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${rasterPx}' height='${rasterPx}' viewBox='0 0 ${SS} ${SS}'><defs><linearGradient id='g' x1='0' y1='0.5' x2='1' y2='0.5'><stop offset='15.29%' stop-color='${gradStart}'/>${midStop}<stop offset='80.46%' stop-color='${gradEnd}'/></linearGradient><filter id='b' x='-100%' y='-100%' width='300%' height='300%'><feGaussianBlur stdDeviation='${blurSD.toFixed(1)}'/></filter></defs><ellipse cx='${SS / 2}' cy='${SS / 2}' rx='${SS / 2 * 0.7}' ry='${SS / 2 * 0.7}' fill='url(%23g)' filter='url(%23b)'/></svg>`;
    const img = new Image();
    img.onload = () => {
      const cctx = cacheCanvas.getContext('2d');
      cctx.drawImage(img, 0, 0, rasterPx, rasterPx);
      blobSpriteRef.current[key].ready = true;
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + svg;
    return blobSpriteRef.current[key];
  };

  const drawBlurredGradientEllipse = (ctx, mainW, mainH, cx, cy, rx, ry, gradStart, gradEnd, alpha, gradMid) => {
    const fmt = stateRef.current.format;
    const fx = fxRef.current;
    const ampRx = rx * fx.waveAmp;
    const ampRy = ry * fx.waveAmp;
    const fxAlpha = alpha;
    const fxCx = cx, fxCy = cy;
    const sprite = getBlobSprite(gradStart, gradEnd, fmt, gradMid);
    if (sprite.ready) {
      lastReadySpriteRef.current[fmt] = sprite;
      ctx.globalAlpha = fxAlpha;
      ctx.drawImage(sprite.canvas, fxCx - ampRx, fxCy - ampRy, ampRx * 2, ampRy * 2);
      ctx.globalAlpha = 1;
      return;
    }
    // New sprite still decoding — draw the previous theme's sprite for this
    // format so the canvas doesn't blank/flash during a theme swap.
    const fallback = lastReadySpriteRef.current[fmt];
    if (fallback && fallback.ready) {
      ctx.globalAlpha = fxAlpha;
      ctx.drawImage(fallback.canvas, fxCx - ampRx, fxCy - ampRy, ampRx * 2, ampRy * 2);
      ctx.globalAlpha = 1;
      return;
    }
    // SVG sprite still loading — fall back to ctx.filter path for first frames.
    // Skip entirely on iOS / browsers without canvas filter to avoid drawing a
    // sharp ellipse that looks broken. Sprite usually loads within ~50ms.
    if (!SUPPORTS_CANVAS_FILTER || IS_IOS) return;
    const off = blurOffscreenRef.current;
    if (!off) return;
    const { canvas, ctx: offCtx, scale: s } = off;

    offCtx.clearRect(0, 0, canvas.width, canvas.height);
    offCtx.filter = `blur(${170 * s}px)`;
    const gradient = offCtx.createLinearGradient((fxCx - ampRx) * s, fxCy * s, (fxCx + ampRx) * s, fxCy * s);
    gradient.addColorStop(0.1529, gradStart);
    gradient.addColorStop(0.8046, gradEnd);
    offCtx.fillStyle = gradient;
    offCtx.beginPath();
    offCtx.ellipse(fxCx * s, fxCy * s, ampRx * s, ampRy * s, 0, 0, Math.PI * 2);
    offCtx.fill();
    offCtx.filter = 'none';
    ctx.globalAlpha = fxAlpha;
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, mainW, mainH);
    ctx.globalAlpha = 1;
  };

  // --- SPECTRUM DRAWING LOGIC ---
  // Cache the vertical white-fade gradient used by dashed borders; only depends on height + ctx
  const getCachedVerticalWhiteGradient = (ctx, height) => {
    const ref = lineGradRef.current;
    if (ref.key === `${height}` && ref.grad && ref.ctx === ctx) return ref.grad;
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    grad.addColorStop(0.35, 'rgba(255, 255, 255, 0)');
    grad.addColorStop(1, '#FFFFFF');
    lineGradRef.current = { key: `${height}`, grad, ctx };
    return grad;
  };

  const drawSpectrum = (ctx, width, height, time, state, elapsed) => {
    const theme = state.customTheme || THEMES[state.colorTheme] || THEMES.neon;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, width, height);

    const numCols = state.shapeCount || 9;
    const colWidth = width / numCols;
    const radius = Math.max(width, height) * 0.6;
    const yOffsetMultiplier = state.format === '16:9' ? 0.50 : 0.30;
    const baseBlobY = state.gradientPos === 'bottom' ? height + (radius * yOffsetMultiplier) : -(radius * yOffsetMultiplier);

    // Background and base variables
    for (let i = 0; i < numCols; i++) {
      ctx.save();

      // --- DOMINO EFFECT (INTRO) ---
      // Each column has a delay based on its index from left (0) to right (numCols-1)
      const colDelayMs = i * 120; // 120ms difference between each column
      const colDurationMs = 800;  // Time it takes for each column to appear

      // Current column appearance progress (0 to 1)
      let rawColP = Math.max(0, Math.min((elapsed - 100 - colDelayMs) / colDurationMs, 1));

      // Ease-in (quadratic)
      const pColFade = Math.pow(rawColP, 2);

      // Invisible during intro pre-fade — skip clip + blob draw entirely
      if (pColFade < 0.005) { ctx.restore(); continue; }

      // Overlap adjacent clips by 1px so AA along the shared edge double-covers
      // and no dark seam shows between columns
      ctx.beginPath();
      ctx.rect(i * colWidth - 0.5, 0, colWidth + 1, height);
      ctx.clip();

      const delayMs = i * 400;
      const currentTime = state.animatedTime !== undefined ? state.animatedTime : time;
      const t = (currentTime + delayMs) * 0.0015;

      let baseBlobX = width / 2;
      let cBlobY = baseBlobY;
      let rx = radius;
      let ry = radius;

      let animX = 0, animY = 0;
      animX = Math.sin(t * 0.5) * (width * 0.25);
      animY = Math.cos(t * 0.8) * (height * 0.15);
      rx += Math.sin(t * 1.2) * (width * 0.15);
      ry += Math.cos(t * 1.5) * (height * 0.10);

      const waveX = baseBlobX + animX;
      const waveY = cBlobY + animY;

      let blobX = waveX * (1 - interactRef.current.weight) + interactRef.current.x * interactRef.current.weight;
      let blobY = waveY * (1 - interactRef.current.weight) + interactRef.current.y * interactRef.current.weight;

      const gradScale = 0.9 + (0.1 * pColFade);
      const scaledRx = rx * gradScale;
      const scaledRy = ry * gradScale;

      drawBlurredGradientEllipse(ctx, width, height, blobX, blobY, scaledRx, scaledRy, theme.gradientStart, theme.gradientEnd, pColFade, theme.gradientMid);

      ctx.restore();

      // --- DASHED BORDER BETWEEN COLUMNS ---
      if (state.showDashed !== false && i < numCols - 1) {
        ctx.save();
        ctx.globalAlpha = pColFade * 0.55 * fxRef.current.dashedIntensity;
        ctx.setLineDash([8, 15]);
        ctx.lineWidth = 2.0;

        ctx.strokeStyle = getCachedVerticalWhiteGradient(ctx, height);
        ctx.beginPath();
        const borderX = (i + 1) * colWidth;
        ctx.moveTo(borderX, 0);
        ctx.lineTo(borderX, height);
        ctx.stroke();
        ctx.restore();
      }
    }

    // --- IMAGEN INCRUSTADA ---
    if (state.uploadedImageObj) {
      const img = state.uploadedImageObj;
      let drawWidth = img.width;
      let drawHeight = img.height;
      const maxDrawWidth = width * 0.6;
      const maxDrawHeight = height * 0.6;

      if (drawWidth > maxDrawWidth || drawHeight > maxDrawHeight) {
        const ratio = Math.min(maxDrawWidth / drawWidth, maxDrawHeight / drawHeight);
        drawWidth *= ratio;
        drawHeight *= ratio;
      }

      drawWidth *= state.imageScale;
      drawHeight *= state.imageScale;

      const drawX = (width - drawWidth) / 2;
      const drawY = (height - drawHeight) / 2;

      let imgP = Math.max(0, Math.min((elapsed - 300) / 400, 1));
      let pImgFade = Math.pow(imgP, 2);

      ctx.save();
      ctx.globalAlpha = pImgFade;
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
      ctx.restore();
    }

    if (state.showNoise !== false && noiseCanvasRef.current) {
      ctx.globalAlpha = 0.05;
      ctx.drawImage(noiseCanvasRef.current, 0, 0, width, height);
      ctx.globalAlpha = 1.0;
    }
  };

  // --- WAVES DRAWING LOGIC (Deformed Spectrum) ---
  const drawWaves = (ctx, width, height, time, state, elapsed) => {
    const theme = state.customTheme || THEMES[state.colorTheme] || THEMES.neon;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, width, height);

    const spectrumCols = state.shapeCount || 9;
    const colWidth = width / spectrumCols;
    const extraLeft = 4;
    const extraRight = 4;
    const numCols = spectrumCols + extraLeft + extraRight;
    const startX = -extraLeft * colWidth;

    const radius = Math.max(width, height) * 0.4;
    const yOffsetMultiplier = state.format === '16:9' ? 0.50 : 0.30;
    const baseBlobY = state.gradientPos === 'bottom' ? height + (radius * yOffsetMultiplier) : -(radius * yOffsetMultiplier);

    const currentTime = state.animatedTime !== undefined ? state.animatedTime : time;
    const animT = currentTime * 0.00012;
    // Cached Path2D for clips/strokes — built once per layout so per-frame
    // lineTo cost is gone. Breath wobble is sub-pixel and not worth rebuilding.
    const numPoints = 40;
    const stride = numPoints + 1;
    const totalCols = numCols + 1;

    // Reusable buffers: static layout (xs without breath) precomputed once per
    // (width, height, spectrumCols). Per frame only the breath term is added.
    const cacheKey = `${width}|${height}|${numCols}|${numPoints}`;
    let buf = wavesBufRef.current;
    if (buf.key !== cacheKey) {
      const total = totalCols * stride;
      const ys = new Float32Array(total);
      const staticXs = new Float32Array(total);
      const breathFactor = new Float32Array(stride);
      const focalX = width * 0.05;
      for (let j = 0; j <= numPoints; j++) {
        const y = (j / numPoints) * height;
        const yRatio = y / height;
        const spread = Math.pow(yRatio, 0.7);
        const arc = Math.sin(yRatio * Math.PI) * width * 0.035;
        breathFactor[j] = width * 0.008 * yRatio;
        for (let col = 0; col <= numCols; col++) {
          const baseX = startX + col * colWidth;
          const targetX = baseX * 1.2;
          const idx = col * stride + j;
          ys[idx] = y;
          staticXs[idx] = focalX + (targetX - focalX) * spread + arc;
        }
      }
      // Pre-build Path2D clip + stroke paths. Static layout means GPU caches
      // the clip rasterization across frames — big perf win across all browsers.
      const clipPaths = new Array(numCols);
      const strokePaths = new Array(totalCols);
      for (let i = 0; i < numCols; i++) {
        const lb = i * stride;
        const rb = (i + 1) * stride;
        const p = new Path2D();
        p.moveTo(staticXs[lb] - 0.5, ys[lb]);
        for (let j = 1; j < stride; j++) p.lineTo(staticXs[lb + j] - 0.5, ys[lb + j]);
        for (let j = stride - 1; j >= 0; j--) p.lineTo(staticXs[rb + j] + 0.5, ys[rb + j]);
        p.closePath();
        clipPaths[i] = p;
      }
      for (let c = 0; c < totalCols; c++) {
        const base = c * stride;
        const p = new Path2D();
        p.moveTo(staticXs[base], ys[base]);
        for (let j = 1; j < stride; j++) p.lineTo(staticXs[base + j], ys[base + j]);
        strokePaths[c] = p;
      }
      buf = { key: cacheKey, xs: new Float32Array(total), ys, staticXs, breathFactor, numCols, numPoints, stride, clipPaths, strokePaths };
      wavesBufRef.current = buf;
    }

    // Static xs — breath wobble is sub-pixel; using cached Path2D for all browsers
    // lets the GPU cache clip rasterization across frames.
    const xs = buf.staticXs;
    const ys = buf.ys;
    const clipPaths = buf.clipPaths;
    const strokePaths = buf.strokePaths;

    // Draw each warped column (same logic as spectrum)
    for (let i = 0; i < numCols; i++) {
      ctx.save();

      // Domino intro per column. Waves has 17 columns (vs Spectrum's 9), so the
      // per-column delay is ~half of Spectrum's so total intro time matches.
      const colDelayMs = i * 60;
      const colDurationMs = 800;
      let rawColP = Math.max(0, Math.min((elapsed - 100 - colDelayMs) / colDurationMs, 1));
      const pColFade = Math.pow(rawColP, 2);

      ctx.clip(clipPaths[i]);

      // Animated gradient blob (identical to spectrum)
      const delayMs = i * 400;
      const t = (currentTime + delayMs) * 0.0015;

      let baseBlobX = width / 2;
      let cBlobY = baseBlobY;
      let rx = radius;
      let ry = radius;

      let animX = Math.sin(t * 0.5) * (width * 0.25);
      let animY = Math.cos(t * 0.8) * (height * 0.15);
      rx += Math.sin(t * 1.2) * (width * 0.15);
      ry += Math.cos(t * 1.5) * (height * 0.10);

      const waveX = baseBlobX + animX;
      const waveY = cBlobY + animY;

      let blobX = waveX * (1 - interactRef.current.weight) + interactRef.current.x * interactRef.current.weight;
      let blobY = waveY * (1 - interactRef.current.weight) + interactRef.current.y * interactRef.current.weight;

      const gradScale = 0.9 + (0.1 * pColFade);
      const scaledRx = rx * gradScale;
      const scaledRy = ry * gradScale;

      drawBlurredGradientEllipse(ctx, width, height, blobX, blobY, scaledRx, scaledRy, theme.gradientStart, theme.gradientEnd, pColFade, theme.gradientMid);

      ctx.restore();

      // Dashed border along the right boundary curve
      if (state.showDashed !== false && i < numCols - 1) {
        ctx.save();
        ctx.globalAlpha = pColFade * 0.55 * fxRef.current.dashedIntensity;
        ctx.setLineDash([8, 15]);
        ctx.lineWidth = 2.0;

        ctx.strokeStyle = getCachedVerticalWhiteGradient(ctx, height);
        ctx.stroke(strokePaths[i + 1]);
        ctx.restore();
      }
    }

    // Uploaded image
    if (state.uploadedImageObj) {
      const img = state.uploadedImageObj;
      let drawWidth = img.width;
      let drawHeight = img.height;
      const maxDrawWidth = width * 0.6;
      const maxDrawHeight = height * 0.6;

      if (drawWidth > maxDrawWidth || drawHeight > maxDrawHeight) {
        const ratio = Math.min(maxDrawWidth / drawWidth, maxDrawHeight / drawHeight);
        drawWidth *= ratio;
        drawHeight *= ratio;
      }

      drawWidth *= state.imageScale;
      drawHeight *= state.imageScale;

      const drawX = (width - drawWidth) / 2;
      const drawY = (height - drawHeight) / 2;

      let imgP = Math.max(0, Math.min((elapsed - 300) / 400, 1));
      let pImgFade = Math.pow(imgP, 2);

      ctx.save();
      ctx.globalAlpha = pImgFade;
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
      ctx.restore();
    }

    if (state.showNoise !== false && noiseCanvasRef.current) {
      ctx.globalAlpha = 0.05;
      ctx.drawImage(noiseCanvasRef.current, 0, 0, width, height);
      ctx.globalAlpha = 1.0;
    }
  };

  // --- PULSE DRAWING LOGIC (centred concentric ring sectors — circular variant of Waves) ---
  const drawGlass = (ctx, width, height, time, state, elapsed) => {
    const theme = state.customTheme || THEMES[state.colorTheme] || THEMES.neon;

    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, width, height);

    // Origin: bottom-centre (or top-centre when gradientPos === 'top'). Rings
    // emanate as half-circles facing into the canvas, like ripples on a pond
    // anchored to the bottom (or top) edge.
    const cornerX = width / 2;
    const cornerY = state.gradientPos === 'bottom' ? height : 0;
    const maxDiag = Math.hypot(width / 2, height);

    const visibleRings = state.shapeCount || 13;
    const numRings = visibleRings;
    const ringStep = maxDiag / visibleRings;

    const radius = Math.max(width, height) * 0.4;
    const yOffsetMultiplier = state.format === '16:9' ? 0.50 : 0.30;
    const baseBlobY = state.gradientPos === 'bottom'
      ? height + (radius * yOffsetMultiplier)
      : -(radius * yOffsetMultiplier);

    const currentTime = state.animatedTime !== undefined ? state.animatedTime : time;

    for (let i = 0; i < numRings; i++) {
      ctx.save();

      // Domino intro per ring — same timing profile as Waves
      const ringDelayMs = i * 60;
      const ringDurationMs = 800;
      const rawColP = Math.max(0, Math.min((elapsed - 100 - ringDelayMs) / ringDurationMs, 1));
      const pColFade = Math.pow(rawColP, 2);

      // Annular clip (outer arc minus inner arc, evenodd via reverse-direction arc)
      const innerR = i * ringStep;
      const outerR = (i + 1) * ringStep;
      // Overlap adjacent rings by 0.5px on each side so AA along the shared
      // boundary double-covers — no dark seam between rings.
      ctx.beginPath();
      ctx.arc(cornerX, cornerY, outerR + 0.5, 0, Math.PI * 2, false);
      if (innerR > 0) {
        ctx.arc(cornerX, cornerY, innerR - 0.5, 0, Math.PI * 2, true);
      }
      ctx.clip();

      // Same time-shifted blob math as Spectrum/Waves
      const delayMs = i * 400;
      const t = (currentTime + delayMs) * 0.0015;

      let baseBlobX = width / 2;
      let cBlobY = baseBlobY;
      let rx = radius;
      let ry = radius;

      const animX = Math.sin(t * 0.5) * (width * 0.25);
      const animY = Math.cos(t * 0.8) * (height * 0.15);
      rx += Math.sin(t * 1.2) * (width * 0.15);
      ry += Math.cos(t * 1.5) * (height * 0.10);

      const waveX = baseBlobX + animX;
      const waveY = cBlobY + animY;

      const blobX = waveX * (1 - interactRef.current.weight) + interactRef.current.x * interactRef.current.weight;
      const blobY = waveY * (1 - interactRef.current.weight) + interactRef.current.y * interactRef.current.weight;

      const gradScale = 0.9 + (0.1 * pColFade);
      const scaledRx = rx * gradScale;
      const scaledRy = ry * gradScale;

      drawBlurredGradientEllipse(
        ctx, width, height,
        blobX, blobY, scaledRx, scaledRy,
        theme.gradientStart, theme.gradientEnd, pColFade, theme.gradientMid
      );

      ctx.restore();

      // Dashed circular border at the inner edge of each visible ring (skip i=0
      // — that would draw a degenerate dot at the corner).
      if (state.showDashed !== false && i > 0 && i <= visibleRings) {
        ctx.save();
        ctx.globalAlpha = pColFade * 0.55 * fxRef.current.dashedIntensity;
        ctx.setLineDash([8, 15]);
        ctx.lineWidth = 2.0;

        ctx.strokeStyle = getCachedVerticalWhiteGradient(ctx, height);
        ctx.beginPath();
        ctx.arc(cornerX, cornerY, innerR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Uploaded image overlay
    if (state.uploadedImageObj) {
      const img = state.uploadedImageObj;
      let drawWidth = img.width;
      let drawHeight = img.height;
      const maxDrawWidth = width * 0.6;
      const maxDrawHeight = height * 0.6;
      if (drawWidth > maxDrawWidth || drawHeight > maxDrawHeight) {
        const ratio = Math.min(maxDrawWidth / drawWidth, maxDrawHeight / drawHeight);
        drawWidth *= ratio;
        drawHeight *= ratio;
      }
      drawWidth *= state.imageScale;
      drawHeight *= state.imageScale;
      const drawX = (width - drawWidth) / 2;
      const drawY = (height - drawHeight) / 2;
      const imgP = Math.max(0, Math.min((elapsed - 300) / 400, 1));
      const pImgFade = Math.pow(imgP, 2);
      ctx.save();
      ctx.globalAlpha = pImgFade;
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
      ctx.restore();
    }

    if (state.showNoise !== false && noiseCanvasRef.current) {
      ctx.globalAlpha = 0.05;
      ctx.drawImage(noiseCanvasRef.current, 0, 0, width, height);
      ctx.globalAlpha = 1.0;
    }
  };

  // --- DRAWING LOGIC (RENDER LOOP) ---
  const drawScene = useCallback((ctx, width, height, time, injectedState) => {
    const state = injectedState || stateRef.current;

    const mPos = mousePosRef.current;
    if (mPos) {
      // The maximum attraction weight is now 0.2 (20%), and the transition speed is 0.2 (20%)
      interactRef.current.weight += (0.2 - interactRef.current.weight) * 0.2;
      // The speed with which it chases the cursor is 0.2 (20%)
      interactRef.current.x += (mPos.x - interactRef.current.x) * 0.2;
      interactRef.current.y += (mPos.y - interactRef.current.y) * 0.2;
    } else {
      // The speed with which it releases control when leaving is 0.2 (20%)
      interactRef.current.weight += (0 - interactRef.current.weight) * 0.2;
    }

    // --- INTRO ANIMATION CONTROL ---
    if (formatRef.current !== state.format) {
      introStartTimeRef.current = time;
      formatRef.current = state.format;
    }
    if (introStartTimeRef.current === -1) {
      introStartTimeRef.current = time;
    }

    let elapsed = time - introStartTimeRef.current;

    if (state.activeTab === 'spectrum') {
      drawSpectrum(ctx, width, height, time, state, elapsed);
      return;
    }

    if (state.activeTab === 'radial') {
      drawWaves(ctx, width, height, time, state, elapsed);
      return;
    }

    if (state.activeTab === 'glass') {
      drawGlass(ctx, width, height, time, state, elapsed);
      return;
    }








    // 1. Base background
    const theme = state.customTheme || THEMES[state.colorTheme] || THEMES.neon;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, width, height);

    // --- CLASSIC MODE (Dots and Oval Gradient) ---

    // Slowed sweep parameters
    const WAVE_SPEED = 900;
    const DOT_ANIM_DURATION = 600;
    const FADE_OUT_POINT = 0.60; // Los puntos se desvanecen al 60% del canvas

    const cols = Math.floor((width - state.dotSpacing) / state.dotSpacing);
    const rows = Math.floor((height - state.dotSpacing) / state.dotSpacing);
    const startX = (width - (cols * state.dotSpacing)) / 2;
    const startY = (height - (rows * state.dotSpacing)) / 2;

    // After the intro sweep finishes, the dot grid is fully static. Cache it
    // to a single offscreen canvas and replace ~1800 arc/fill calls per frame
    // with one drawImage. The cache key invalidates if any input changes.
    const introSweepDoneAt = WAVE_SPEED + DOT_ANIM_DURATION; // 3400ms
    if (elapsed >= introSweepDoneAt) {
      const cacheKey = `${state.direction}|${state.dotSize}|${state.dotSpacing}|${width}x${height}`;
      let cached = dotsCacheRef.current;
      if (!cached || cached.key !== cacheKey) {
        const off = document.createElement('canvas');
        off.width = width;
        off.height = height;
        const offCtx = off.getContext('2d');
        offCtx.fillStyle = '#FFFFFF';

        for (let x = startX; x <= width - startX + 0.1; x += state.dotSpacing) {
          for (let y = startY; y <= height - startY + 0.1; y += state.dotSpacing) {
            let fadeRatio = 0;
            if (state.direction === 'left') fadeRatio = x / width;
            else if (state.direction === 'right') fadeRatio = 1 - (x / width);
            else if (state.direction === 'top') fadeRatio = y / height;
            else if (state.direction === 'bottom') fadeRatio = 1 - (y / height);

            const opacityRatio = fadeRatio < FADE_OUT_POINT ? 1 - (fadeRatio / FADE_OUT_POINT) : 0;
            const targetOpacityBase = Math.pow(opacityRatio, 1.5);
            if (targetOpacityBase <= 0.001) continue;

            offCtx.globalAlpha = 0.25 * targetOpacityBase;
            offCtx.beginPath();
            offCtx.arc(x, y, state.dotSize, 0, Math.PI * 2);
            offCtx.fill();
          }
        }

        cached = { key: cacheKey, canvas: off };
        dotsCacheRef.current = cached;
      }
      ctx.drawImage(cached.canvas, 0, 0);
    } else {
      for (let x = startX; x <= width - startX + 0.1; x += state.dotSpacing) {
        for (let y = startY; y <= height - startY + 0.1; y += state.dotSpacing) {
          let fadeRatio = 0;
          let sweepRatio = 0;

          if (state.direction === 'left') {
            fadeRatio = x / width;
            sweepRatio = (x / width + y / height) / 2;
          } else if (state.direction === 'right') {
            fadeRatio = 1 - (x / width);
            sweepRatio = ((1 - x / width) + (1 - y / height)) / 2;
          } else if (state.direction === 'top') {
            fadeRatio = y / height;
            sweepRatio = ((1 - x / width) + y / height) / 2;
          } else if (state.direction === 'bottom') {
            fadeRatio = 1 - (y / height);
            sweepRatio = (x / width + (1 - y / height)) / 2;
          }

          const opacityRatio = fadeRatio < FADE_OUT_POINT ? 1 - (fadeRatio / FADE_OUT_POINT) : 0;
          const targetOpacityBase = Math.pow(opacityRatio, 1.5);
          if (targetOpacityBase <= 0.001) continue;

          const dotDelay = sweepRatio * WAVE_SPEED;
          const dotElapsed = elapsed - dotDelay;
          if (dotElapsed < 0) continue;

          const dotP = Math.min(dotElapsed / DOT_ANIM_DURATION, 1);
          const flashIntensity = Math.pow(opacityRatio, 0.5);
          const peakAlpha = 0.27 * flashIntensity;
          const endAlpha = 0.25 * targetOpacityBase;

          let currentAlpha;
          if (dotP < 0.2) {
            currentAlpha = peakAlpha * (dotP / 0.2);
          } else {
            const easeP = Math.pow((dotP - 0.2) / 0.8, 2);
            currentAlpha = peakAlpha + (endAlpha - peakAlpha) * easeP;
          }

          ctx.globalAlpha = currentAlpha;
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(x, y, state.dotSize, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1.0;
    }

    // Oval Gradient
    ctx.save();
    const radius = Math.max(width, height) * 0.6;
    // Moving up 10% more
    const yOffsetMultiplier = state.format === '16:9' ? 0.50 : 0.30;
    let baseBlobX = width / 2;
    let baseBlobY = state.gradientPos === 'bottom' ? height + (radius * yOffsetMultiplier) : -(radius * yOffsetMultiplier);
    let rx = radius;
    let ry = radius;

    // Organic movement (increased speed) — uses looped animatedTime so the
    // whole canvas loops every LOOP_MS for cached/encode-friendly playback.
    // Anim applied regardless of isAnimated so pause freezes current frame
    // instead of snapping blob back to center.
    const t = (state.animatedTime ?? time) * 0.0005;
    const animX = Math.sin(t * 0.5) * (width * 0.25);
    const animY = Math.cos(t * 0.8) * (height * 0.15);
    rx += Math.sin(t * 1.2) * (width * 0.15);
    ry += Math.cos(t * 1.5) * (height * 0.10);

    const waveX = baseBlobX + animX;
    const waveY = baseBlobY + animY;

    let blobX = waveX * (1 - interactRef.current.weight) + interactRef.current.x * interactRef.current.weight;
    let blobY = waveY * (1 - interactRef.current.weight) + interactRef.current.y * interactRef.current.weight;

    // Gradient Intro Animation
    // Appears progressively very smoothly over 1200ms
    let rawGradP = Math.max(0, Math.min((elapsed - 100) / 1200, 1));
    const pGradFade = (1 - Math.cos(rawGradP * Math.PI)) / 2; // Ease-in-out for greater smoothness

    const gradScale = 0.9 + (0.1 * pGradFade);
    const scaledRx = rx * gradScale;
    const scaledRy = ry * gradScale;

    drawBlurredGradientEllipse(ctx, width, height, blobX, blobY, scaledRx, scaledRy, theme.gradientStart, theme.gradientEnd, pGradFade);

    ctx.restore();

    // --- IMAGEN INCRUSTADA ---
    if (state.uploadedImageObj) {
      const img = state.uploadedImageObj;
      let drawWidth = img.width;
      let drawHeight = img.height;
      const maxDrawWidth = width * 0.6;
      const maxDrawHeight = height * 0.6;

      if (drawWidth > maxDrawWidth || drawHeight > maxDrawHeight) {
        const ratio = Math.min(maxDrawWidth / drawWidth, maxDrawHeight / drawHeight);
        drawWidth *= ratio;
        drawHeight *= ratio;
      }
      // Apply user scaling
      drawWidth *= state.imageScale;
      drawHeight *= state.imageScale;

      const drawX = (width - drawWidth) / 2;
      const drawY = (height - drawHeight) / 2;

      // Faster fade-in for the uploaded image (appears in 400ms)
      let imgP = Math.max(0, Math.min((elapsed - 300) / 400, 1));
      let pImgFade = Math.pow(imgP, 2);

      ctx.save();
      ctx.globalAlpha = pImgFade;
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
      ctx.restore();
    }

    if (state.showNoise !== false && noiseCanvasRef.current) {
      ctx.globalAlpha = 0.05;
      ctx.drawImage(noiseCanvasRef.current, 0, 0, width, height);
      ctx.globalAlpha = 1.0;
    }
  }, []);

  // --- MAIN LOOP ---
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    const logical = FORMATS[stateRef.current.format];
    const logicalW = logical.width;
    const logicalH = logical.height;

    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.objectFit = 'contain';

    let scaleX = 1;
    let scaleY = 1;
    const applySize = () => {
      // Cap DPR — full DPR doubles pixel work for negligible visual gain
      // against the heavy blur sprite which is already lo-res relative to display.
      // Firefox: cap at 1.0 because its compositor + canvas pipeline is much
      // slower at upscaling large backbuffers than Chromium/WebKit.
      // DPR 1.25 — sharper than 1.0 on retina, ~36% fewer pixels than 1.5.
      // Combined with 20fps idle below, net per-second pixel work ≈ DPR 1.0 @ 24fps.
      const dpr = 1;
      const cssW = container.clientWidth;
      if (cssW <= 0) return;
      const desired = Math.min((cssW * dpr) / logicalW, 1);
      const targetW = Math.max(1, Math.round(logicalW * desired));
      const targetH = Math.max(1, Math.round(logicalH * desired));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      // Use exact ratios so fillRect(0,0,logicalW,logicalH) fully covers the
      // backbuffer — Math.round above can leave a sub-pixel transparent strip
      // that the browser samples as a dark fringe at the rounded border.
      scaleX = targetW / logicalW;
      scaleY = targetH / logicalH;
    };
    applySize();
    const ro = new ResizeObserver(applySize);
    ro.observe(container);

    let animFrame = null;
    let forceRender = false;
    let windowFocused = typeof document !== 'undefined' ? document.hasFocus() : true;
    let canvasVisible = true;
    const loop = (time) => {
      // Stop entirely while hidden, window blurred, canvas off-screen, or while video export runs.
      // Restart hooks (visibilitychange + focus + IntersectionObserver + isRecording state change) call requestRedraw.
      if (document.hidden || !windowFocused || !canvasVisible || stateRef.current.isRecording) { animFrame = null; return; }

      // Adaptive frame budget. Firefox always 30 fps — its render path has
      // higher per-frame variance, so the 24 fps idle target produces visible
      // judder. Chromium/WebKit keep 24 fps when only the auto anim drives
      // motion (no mouse) — saves ~20% CPU and stays smooth there.
      // Track idle window for adaptive fps
      const interacting = !!mousePosRef.current || interactRef.current.weight > 0.001;
      const ts = timeStateRef.current;
      if (interacting) ts.idleSince = time;
      else if (ts.idleSince == null) ts.idleSince = time;
      const idleMs = time - ts.idleSince;
      // 30fps interacting · 20fps idle <3s · 15fps idle >3s. Crossfade 800ms keeps wrap smooth even at 15fps.
      const frameBudget = IS_FIREFOX ? 32 : interacting ? 32 : idleMs > 3000 ? 66 : 50;
      const sinceLast = time - timeStateRef.current.lastTime;
      if (!forceRender && sinceLast < frameBudget) { animFrame = requestAnimationFrame(loop); return; }

      let dt = sinceLast;
      if (dt > 100) dt = 16;
      timeStateRef.current.lastTime = time;

      const state = stateRef.current;
      if (state.isAnimated) {
        const opts = animOptsRef.current;
        const cycle = opts.loopMs || LOOP_MS;
        const effDt = dt * opts.speed;
        const prevAnim = timeStateRef.current.animatedTime;
        let nextAnim;
        if (opts.playMode === 'pingpong') {
          let v = prevAnim + opts.dir * effDt;
          if (v >= cycle) { v = cycle - (v - cycle); opts.dir = -1; loopFrame0Ref.current = null; }
          else if (v <= 0) { v = -v; opts.dir = 1; loopFrame0Ref.current = null; }
          nextAnim = v;
        } else if (opts.playMode === 'once') {
          const raw = prevAnim + effDt;
          if (raw >= cycle) {
            nextAnim = cycle - 1;
            setIsAnimated(false);
          } else {
            nextAnim = raw;
          }
        } else {
          // loop
          nextAnim = (prevAnim + effDt) % cycle;
          if (nextAnim < prevAnim) loopFrame0Ref.current = null;
        }
        timeStateRef.current.animatedTime = nextAnim;
      }

      // Fully static: stop the rAF chain entirely. Restart on input or state change
      // via requestPreviewRedrawRef. This drops idle CPU near-zero vs. burning ~60Hz
      // wake-ups on a short-circuit return.
      const introAge = introStartTimeRef.current >= 0 ? time - introStartTimeRef.current : 0;
      const introSettled = introAge > 1200;
      const noInteraction = interactRef.current.weight < 0.001 && !mousePosRef.current;
      if (!state.isAnimated && introSettled && noInteraction && !forceRender) {
        animFrame = null;
        return;
      }
      forceRender = false;

      ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      ctx.clearRect(0, 0, logicalW, logicalH);
      // Mutate ref in place — avoids a per-frame object spread alloc.
      // Apply easing remap to the time consumed by the scene (raw cycle position kept in timeStateRef).
      {
        const rawT = timeStateRef.current.animatedTime;
        const easingMode = animOptsRef.current.easing;
        const cycle = animOptsRef.current.loopMs || LOOP_MS;
        stateRef.current.animatedTime = easingMode === 'linear'
          ? rawT
          : applyEasing(easingMode, rawT / cycle) * cycle;
      }
      drawScene(ctx, logicalW, logicalH, time);

      // Loop wrap crossfade — blend last 500ms of loop toward stored t=0 frame
      // so the discontinuity at modulo wrap is invisible.
      if (state.isAnimated) {
        const at = timeStateRef.current.animatedTime;
        // Capture t=0 frame in first 50ms of each loop
        if (loopFrame0Ref.current == null && at < 50) {
          const snap = document.createElement('canvas');
          snap.width = canvas.width;
          snap.height = canvas.height;
          snap.getContext('2d').drawImage(canvas, 0, 0);
          loopFrame0Ref.current = snap;
        }
        const FADE = 800;
        const cycle = animOptsRef.current.loopMs || LOOP_MS;
        // Only crossfade when wrapping (loop / pingpong); once-mode has no wrap so skip the blend.
        if (animOptsRef.current.playMode !== 'once' && loopFrame0Ref.current && at > cycle - FADE) {
          const k = (at - (cycle - FADE)) / FADE;
          const eased = k * k * (3 - 2 * k); // smoothstep
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = eased;
          ctx.drawImage(loopFrame0Ref.current, 0, 0);
          ctx.restore();
        }
      }

      animFrame = requestAnimationFrame(loop);
    };

    const requestRedraw = () => {
      forceRender = true;
      if (animFrame != null) return;
      timeStateRef.current.lastTime = performance.now();
      animFrame = requestAnimationFrame(loop);
    };
    requestPreviewRedrawRef.current = requestRedraw;

    // Prevent a large dt spike when returning to the tab
    const onVisibilityChange = () => {
      if (!document.hidden) {
        timeStateRef.current.lastTime = performance.now();
        requestRedraw();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Pause RAF when window loses focus (user in another app/window).
    const onFocus = () => {
      windowFocused = true;
      timeStateRef.current.lastTime = performance.now();
      requestRedraw();
    };
    const onBlur = () => { windowFocused = false; };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);

    // Pause RAF when canvas is scrolled / clipped off-screen.
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        canvasVisible = entry.isIntersecting;
        if (canvasVisible) {
          timeStateRef.current.lastTime = performance.now();
          requestRedraw();
        }
      }
    }, { threshold: 0.01 });
    io.observe(canvas);

    requestRedraw();

    return () => {
      requestPreviewRedrawRef.current = () => {};
      if (animFrame) cancelAnimationFrame(animFrame);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      io.disconnect();
      ro.disconnect();
    };
  }, [drawScene, format]);

  // --- BUILD SVG STRING (shared by SVG + PNG export) ---
  const buildSvgString = () => {
    const state = stateRef.current;
    const theme = state.customTheme || THEMES[state.colorTheme] || THEMES.neon;
    const { width, height } = FORMATS[state.format];
    const FADE_OUT_POINT = 0.60;

    const radius = Math.max(width, height) * 0.6;
    const yOffsetMultiplier = state.format === '16:9' ? 0.50 : 0.30;
    const blobY = state.gradientPos === 'bottom' ? height + (radius * yOffsetMultiplier) : -(radius * yOffsetMultiplier);
    // Apply pattern-tab blob animation at current animatedTime so export
    // matches the paused preview frame.
    const patT = timeStateRef.current.animatedTime * 0.0005;
    const patAnimX = Math.sin(patT * 0.5) * (width * 0.25);
    const patAnimY = Math.cos(patT * 0.8) * (height * 0.15);
    const rx = radius + Math.sin(patT * 1.2) * (width * 0.15);
    const ry = radius + Math.cos(patT * 1.5) * (height * 0.10);
    const patBlobX = width / 2 + patAnimX;
    const patBlobY = blobY + patAnimY;

    let imageHtml = '';
    if (state.uploadedImageSrc && state.uploadedImageObj) {
      const img = state.uploadedImageObj;
      let drawWidth = img.width;
      let drawHeight = img.height;
      const maxDrawWidth = width * 0.6;
      const maxDrawHeight = height * 0.6;
      if (drawWidth > maxDrawWidth || drawHeight > maxDrawHeight) {
        const ratio = Math.min(maxDrawWidth / drawWidth, maxDrawHeight / drawHeight);
        drawWidth *= ratio;
        drawHeight *= ratio;
      }
      drawWidth *= state.imageScale;
      drawHeight *= state.imageScale;

      const drawX = (width - drawWidth) / 2;
      const drawY = (height - drawHeight) / 2;
      imageHtml = `<image href="${state.uploadedImageSrc}" x="${drawX}" y="${drawY}" width="${drawWidth}" height="${drawHeight}" />`;
    }

    let contentHtml = '';

    if (state.activeTab === 'neonPattern') {
      let dotsHtml = '';

      const cols = Math.floor((width - state.dotSpacing) / state.dotSpacing);
      const rows = Math.floor((height - state.dotSpacing) / state.dotSpacing);
      const startX = (width - (cols * state.dotSpacing)) / 2;
      const startY = (height - (rows * state.dotSpacing)) / 2;

      for (let x = startX; x <= width - startX + 0.1; x += state.dotSpacing) {
        for (let y = startY; y <= height - startY + 0.1; y += state.dotSpacing) {
          let posRatio = 0;
          if (state.direction === 'left') posRatio = x / width;
          else if (state.direction === 'right') posRatio = 1 - (x / width);
          else if (state.direction === 'top') posRatio = y / height;
          else if (state.direction === 'bottom') posRatio = 1 - (y / height);

          let opacityRatio = posRatio < FADE_OUT_POINT ? 1 - (posRatio / FADE_OUT_POINT) : 0;
          let opacityBase = Math.pow(opacityRatio, 1.5);
          let finalAlpha = opacityBase * 0.25;

          if (finalAlpha > 0.001) {
            dotsHtml += `<circle cx="${x}" cy="${y}" r="${state.dotSize}" fill="#FFFFFF" opacity="${finalAlpha.toFixed(3)}" />`;
          }
        }
      }

      contentHtml = `
        <g>
          ${dotsHtml}
        </g>
        ${imageHtml}
        <ellipse cx="${patBlobX}" cy="${patBlobY}" rx="${rx}" ry="${ry}" fill="url(#blobGrad)" filter="url(#blurFilter)" />
      `;
    } else if (state.activeTab === 'spectrum') {
      let colsHtml = '';
      const numCols = state.shapeCount || 9;
      const colWidth = width / numCols;
      const exportTime = timeStateRef.current.animatedTime;
      for (let i = 0; i < numCols; i++) {
        const delayMs = i * 400;
        const t = (exportTime + delayMs) * 0.0015;

        let cBlobX = width / 2;
        let cBlobY = blobY;
        let cRx = rx;
        let cRy = ry;

        cBlobX += Math.sin(t * 0.5) * (width * 0.25);
        cBlobY += Math.cos(t * 0.8) * (height * 0.15);
        cRx += Math.sin(t * 1.2) * (width * 0.15);
        cRy += Math.cos(t * 1.5) * (height * 0.10);

        colsHtml += `
          <g clip-path="url(#clipCol${i})">
            <ellipse cx="${cBlobX}" cy="${cBlobY}" rx="${cRx}" ry="${cRy}" fill="url(#blobGrad)" filter="url(#blurFilter)" />
          </g>
        `;

        if (state.showDashed !== false && i < numCols - 1) {
          const borderX = (i + 1) * colWidth;
          colsHtml += `
            <line x1="${borderX}" y1="0" x2="${borderX}" y2="${height}"
                  stroke="url(#borderGrad)"
                  stroke-width="2.0"
                  stroke-dasharray="8,15"
                  opacity="0.5" />
          `;
        }
      }

      let defsClips = '';
      for (let i = 0; i < numCols; i++) {
        defsClips += `
          <clipPath id="clipCol${i}">
            <rect x="${i * colWidth}" y="0" width="${colWidth}" height="${height}" />
          </clipPath>
        `;
      }

      contentHtml = `
        <defs>
          ${defsClips}
        </defs>
        ${colsHtml}
        ${imageHtml}
      `;

    } else if (state.activeTab === 'radial') {
      // Waves — vector: warped column clip paths + blurred ellipse per column + dashed boundary curves
      const spectrumCols = state.shapeCount || 9;
      const colWidth = width / spectrumCols;
      const extraLeft = 4, extraRight = 4;
      const numColsW = spectrumCols + extraLeft + extraRight;
      const startXW = -extraLeft * colWidth;
      const radiusW = Math.max(width, height) * 0.4;
      const yOffW = state.format === '16:9' ? 0.50 : 0.30;
      const baseBlobYW = state.gradientPos === 'bottom' ? height + (radiusW * yOffW) : -(radiusW * yOffW);
      const exportTime = timeStateRef.current.animatedTime;
      const animTW = exportTime * 0.00012;
      const numPointsW = 60;

      const getWarpedX = (baseX, y) => {
        const yRatio = y / height;
        const focalX = width * 0.05;
        const spread = Math.pow(yRatio, 0.7);
        const targetX = baseX * 1.2;
        const fanX = focalX + (targetX - focalX) * spread;
        const arc = Math.sin(yRatio * Math.PI) * width * 0.035;
        const breath = Math.sin(animTW) * width * 0.008 * yRatio;
        return fanX + arc + breath;
      };

      const boundariesW = [];
      for (let col = 0; col <= numColsW; col++) {
        const baseX = startXW + col * colWidth;
        const pts = [];
        for (let j = 0; j <= numPointsW; j++) {
          const yy = (j / numPointsW) * height;
          pts.push({ x: getWarpedX(baseX, yy), y: yy });
        }
        boundariesW.push(pts);
      }

      const pathFromPoints = (pts) => pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
      const clipPathFromColumn = (left, right) => {
        const lp = pathFromPoints(left);
        const rp = right.slice().reverse().map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
        return `${lp} ${rp} Z`;
      };

      let defsCols = '';
      let groupsCols = '';
      let dashedCols = '';
      for (let i = 0; i < numColsW; i++) {
        const leftB = boundariesW[i];
        const rightB = boundariesW[i + 1];
        defsCols += `<clipPath id="clipW${i}"><path d="${clipPathFromColumn(leftB, rightB)}" /></clipPath>`;

        const delayMs = i * 400;
        const t = (exportTime + delayMs) * 0.0015;
        const animX = Math.sin(t * 0.5) * (width * 0.25);
        const animY = Math.cos(t * 0.8) * (height * 0.15);
        const rxx = radiusW + Math.sin(t * 1.2) * (width * 0.15);
        const ryy = radiusW + Math.cos(t * 1.5) * (height * 0.10);
        const cx = width / 2 + animX;
        const cy = baseBlobYW + animY;

        groupsCols += `<g clip-path="url(#clipW${i})"><ellipse cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" rx="${rxx.toFixed(2)}" ry="${ryy.toFixed(2)}" fill="url(#blobGrad)" filter="url(#blurFilter)" /></g>`;

        if (state.showDashed !== false && i < numColsW - 1) {
          const b = boundariesW[i + 1];
          const dStr = pathFromPoints(b);
          dashedCols += `<path d="${dStr}" stroke="url(#borderGrad)" stroke-width="2" stroke-dasharray="8,15" fill="none" opacity="0.5" />`;
        }
      }

      contentHtml = `<defs>${defsCols}</defs>${groupsCols}${dashedCols}${imageHtml}`;

    } else if (state.activeTab === 'glass') {
      // Halo — vector: annular ring clips + blurred ellipse per ring + dashed circles
      const cornerX = width / 2;
      const cornerY = state.gradientPos === 'bottom' ? height : 0;
      const maxDiag = Math.hypot(width / 2, height);
      const visibleRings = state.shapeCount || 13;
      const ringStep = maxDiag / visibleRings;
      const radiusG = Math.max(width, height) * 0.4;
      const yOffG = state.format === '16:9' ? 0.50 : 0.30;
      const baseBlobYG = state.gradientPos === 'bottom' ? height + (radiusG * yOffG) : -(radiusG * yOffG);
      const exportTime = timeStateRef.current.animatedTime;

      let defsRings = '';
      let groupsRings = '';
      let dashedRings = '';
      for (let i = 0; i < visibleRings; i++) {
        const innerR = i * ringStep;
        const outerR = (i + 1) * ringStep;
        const circ = (cx, cy, r) => `M${cx - r},${cy} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0`;
        const outerD = circ(cornerX, cornerY, outerR);
        const innerD = innerR > 0 ? ' ' + circ(cornerX, cornerY, innerR) : '';
        defsRings += `<clipPath id="clipG${i}" clipPathUnits="userSpaceOnUse"><path d="${outerD}${innerD}" fill-rule="evenodd" /></clipPath>`;

        const delayMs = i * 400;
        const t = (exportTime + delayMs) * 0.0015;
        const animX = Math.sin(t * 0.5) * (width * 0.25);
        const animY = Math.cos(t * 0.8) * (height * 0.15);
        const rxx = radiusG + Math.sin(t * 1.2) * (width * 0.15);
        const ryy = radiusG + Math.cos(t * 1.5) * (height * 0.10);
        const cx = width / 2 + animX;
        const cy = baseBlobYG + animY;
        groupsRings += `<g clip-path="url(#clipG${i})"><ellipse cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" rx="${rxx.toFixed(2)}" ry="${ryy.toFixed(2)}" fill="url(#blobGrad)" filter="url(#blurFilter)" /></g>`;

        if (state.showDashed !== false && i > 0) {
          dashedRings += `<circle cx="${cornerX}" cy="${cornerY}" r="${innerR.toFixed(2)}" fill="none" stroke="url(#borderGrad)" stroke-width="2" stroke-dasharray="8,15" opacity="0.5" />`;
        }
      }

      contentHtml = `<defs>${defsRings}</defs>${groupsRings}${dashedRings}${imageHtml}`;
    }

    const svgString = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
        <defs>
          <filter id="blurFilter" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="170" />
          </filter>
          <linearGradient id="blobGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="15.29%" stop-color="${theme.gradientStart}" />
            ${theme.gradientMid ? `<stop offset="50%" stop-color="${theme.gradientMid}" />` : ''}
            <stop offset="80.46%" stop-color="${theme.gradientEnd}" />
          </linearGradient>
          <linearGradient id="borderGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="rgba(255,255,255,0)" />
            <stop offset="35%" stop-color="rgba(255,255,255,0)" />
            <stop offset="100%" stop-color="#FFFFFF" />
          </linearGradient>

          <filter id="noiseFilter">
            <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch"/>
          </filter>
        </defs>
        
        <rect width="${width}" height="${height}" fill="${theme.bg}" />
        
        ${contentHtml}
        
        <rect width="${width}" height="${height}" opacity="0.15" filter="url(#noiseFilter)" style="mix-blend-mode: overlay; pointer-events: none;" />
      </svg>
    `;

    return { svgString, width, height, format: state.format };
  };

  // --- EXPORT SVG ---
  const handleExportSVG = async () => {
    if (svgExporting) return;
    setSvgExporting(true);
    setSvgProgress(0);
    await new Promise((r) => setTimeout(r, 30));
    for (const p of [15, 35, 55, 75]) {
      setSvgProgress(p);
      await new Promise((r) => setTimeout(r, 60));
    }
    const { svgString, format } = buildSvgString();
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Glowy-${format}.svg`;
    setSvgProgress(100);
    await new Promise((r) => setTimeout(r, 120));
    a.click();
    URL.revokeObjectURL(url);
    setShareModalOpen(true);
    setSvgExporting(false);
    setSvgProgress(0);
  };

  // --- EXPORT PNG (rasterize SVG at given scale) ---
  const handleExportPNG = async (scale) => {
    if (svgExporting) return;
    setSvgExporting(true);
    setSvgProgress(0);
    await new Promise((r) => setTimeout(r, 30));
    for (const p of [10, 25, 45]) {
      setSvgProgress(p);
      await new Promise((r) => setTimeout(r, 50));
    }
    try {
      const { svgString, width, height, format } = buildSvgString();
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.decoding = 'sync';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = svgUrl;
      });
      setSvgProgress(70);
      const outW = Math.round(width * scale);
      const outH = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, outW, outH);
      URL.revokeObjectURL(svgUrl);
      setSvgProgress(90);
      const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const url = URL.createObjectURL(pngBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Glowy-${format}-${scale}x.png`;
      setSvgProgress(100);
      await new Promise((r) => setTimeout(r, 80));
      a.click();
      URL.revokeObjectURL(url);
      setShareModalOpen(true);
    } catch (e) {
      console.error('PNG export failed:', e);
      alert('PNG export error: ' + e.message);
    } finally {
      setSvgExporting(false);
      setSvgProgress(0);
    }
  };

  // --- WebCodecs offline encode → MP4 (fast path, Chromium/WebKit) ---
  const runWebCodecsExport = async (width, height, targetShort, durationSeconds = 15) => {
    if (!window.VideoEncoder) throw new Error('WebCodecs not available');

    const codecCandidates = ['avc1.64002a', 'avc1.4d002a', 'avc1.42002a'];
    let chosenCodec = null;
    for (const c of codecCandidates) {
      try {
        const probe = await window.VideoEncoder.isConfigSupported({
          codec: c, width, height, bitrate: 40_000_000, framerate: 30,
        });
        if (probe && probe.supported) { chosenCodec = c; break; }
      } catch (_e) { /* try next */ }
    }
    if (!chosenCodec) throw new Error('No supported H.264 profile');

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width, height },
      fastStart: false,
    });

    const pendingChunks = [];
    let knownDecoderConfig = null;
    const ensureColorSpace = (cfg) => {
      if (cfg && !cfg.colorSpace) {
        cfg.colorSpace = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };
      }
      return cfg;
    };
    const flushPending = () => {
      if (!knownDecoderConfig) return;
      while (pendingChunks.length > 0) {
        const { chunk, meta } = pendingChunks.shift();
        const effectiveMeta = (meta && meta.decoderConfig)
          ? { ...meta, decoderConfig: ensureColorSpace(meta.decoderConfig) }
          : { decoderConfig: knownDecoderConfig };
        muxer.addVideoChunk(chunk, effectiveMeta);
      }
    };
    const videoEncoder = new window.VideoEncoder({
      output: (chunk, meta) => {
        if (meta && meta.decoderConfig) {
          knownDecoderConfig = ensureColorSpace({ ...meta.decoderConfig });
        }
        pendingChunks.push({ chunk, meta });
        flushPending();
      },
      error: e => console.error(e),
    });

    let encoderConfig = {
      codec: chosenCodec, width, height,
      bitrate: 40_000_000, bitrateMode: 'constant',
      framerate: 30, latencyMode: 'quality',
    };
    try { videoEncoder.configure(encoderConfig); }
    catch (_e) {
      encoderConfig.bitrateMode = 'variable';
      delete encoderConfig.latencyMode;
      videoEncoder.configure(encoderConfig);
    }

    const FPS = 30;
    const totalFrames = FPS * durationSeconds;
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = width;
    offscreenCanvas.height = height;
    const ctx = offscreenCanvas.getContext('2d');
    const baseTime = performance.now();
    introStartTimeRef.current = baseTime;

    setVideoProgress(0);
    let lastReportedPct = -1;
    for (let i = 0; i < totalFrames; i++) {
      const frameTimeMs = baseTime + (i * (1000 / FPS));
      stateRef.current.animatedTime = (i * (1000 / FPS)) % LOOP_MS;
      ctx.clearRect(0, 0, width, height);
      drawScene(ctx, width, height, frameTimeMs);
      const videoFrame = new window.VideoFrame(offscreenCanvas, { timestamp: i * (1000000 / FPS) });
      videoEncoder.encode(videoFrame, { keyFrame: i % 15 === 0 });
      videoFrame.close();
      const pct = Math.floor(((i + 1) / totalFrames) * 80);
      if (pct !== lastReportedPct) { lastReportedPct = pct; setVideoProgress(pct); }
      await new Promise(r => setTimeout(r, 0));
    }
    setVideoProgress(90);
    await videoEncoder.flush();
    flushPending();
    if (pendingChunks.length > 0) {
      throw new Error('Encoder did not provide H.264 decoder config');
    }
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    return { blob, ext: 'mp4' };
  };

  // --- MediaRecorder real-time path (Firefox + fallback) ---
  const runMediaRecorderExport = async (width, height, _targetShort, durationSeconds = 15) => {
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('MediaRecorder not supported in this browser.');
    }
    // mp4/h264 preferred, then webm vp9/vp8.
    const mimeCandidates = [
      'video/mp4;codecs=h264',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const mimeType = mimeCandidates.find(m => {
      try { return MediaRecorder.isTypeSupported(m); } catch (_e) { return false; }
    });
    if (!mimeType) throw new Error('No supported MediaRecorder mime type.');

    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = width;
    offscreenCanvas.height = height;
    const ctx = offscreenCanvas.getContext('2d');

    const FPS = 30;
    const totalFrames = FPS * durationSeconds;
    const stream = offscreenCanvas.captureStream(FPS);
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 40_000_000 });
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    const stopped = new Promise(resolve => { rec.onstop = resolve; });

    const baseTime = performance.now();
    introStartTimeRef.current = baseTime;
    // Paint first frame before start so the stream has data immediately
    drawScene(ctx, width, height, baseTime);
    rec.start();

    setVideoProgress(0);
    let lastReportedPct = -1;
    for (let i = 0; i < totalFrames; i++) {
      const targetWall = baseTime + (i * (1000 / FPS));
      const now = performance.now();
      const wait = Math.max(0, targetWall - now);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      const frameTimeMs = baseTime + (i * (1000 / FPS));
      stateRef.current.animatedTime = (i * (1000 / FPS)) % LOOP_MS;
      ctx.clearRect(0, 0, width, height);
      drawScene(ctx, width, height, frameTimeMs);
      const pct = Math.floor(((i + 1) / totalFrames) * 90);
      if (pct !== lastReportedPct) { lastReportedPct = pct; setVideoProgress(pct); }
    }
    await new Promise(r => setTimeout(r, 120));
    rec.stop();
    await stopped;
    setVideoProgress(95);
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(chunks, { type: mimeType });
    return { blob, ext };
  };

  // --- EXPORT VIDEO — orchestrator picks the best path per browser ---
  const handleExportVideo = async (targetShort = 1080, durationSeconds = Math.round(loopDurationMs / 1000)) => {
    if (isRecording) return;
    setIsRecording(true);
    if (!stateRef.current.isAnimated) setIsAnimated(true);

    const base = FORMATS[stateRef.current.format];
    const baseShort = Math.min(base.width, base.height);
    const factor = targetShort / baseShort;
    const width = Math.round((base.width * factor) / 2) * 2;
    const height = Math.round((base.height * factor) / 2) * 2;

    await new Promise(resolve => setTimeout(resolve, 50));

    let result = null;
    try {
      // Firefox's WebCodecs AVC path is unreliable (often omits decoderConfig,
      // crashing mp4-muxer). Skip it on FF and use MediaRecorder directly.
      // Chromium/WebKit: try WebCodecs first (fast offline encode → MP4),
      // fall back to MediaRecorder if anything in the pipeline fails.
      if (!IS_FIREFOX) {
        try {
          result = await runWebCodecsExport(width, height, targetShort, durationSeconds);
        } catch (e) {
          console.warn('WebCodecs export failed, using MediaRecorder fallback:', e);
        }
      }
      if (!result) {
        result = await runMediaRecorderExport(width, height, targetShort, durationSeconds);
      }

      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Glowy-${stateRef.current.format}-${targetShort}p.${result.ext}`;
      setVideoProgress(100);
      a.click();
      URL.revokeObjectURL(url);
      setShareModalOpen(true);
    } catch (e) {
      console.error('Video export failed:', e);
      alert('Video export error: ' + e.message);
    } finally {
      setIsRecording(false);
      setVideoProgress(0);
    }
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700;800&display=swap');
        body { font-family: 'Geist', sans-serif; font-weight: 500; margin: 0; background: ${ui.appBg}; transition: background-color 300ms ease; }
        @keyframes fadeInLeft {
          from { opacity: 0; transform: translateX(-16px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .tab-fade-in-left { animation: fadeInLeft 200ms cubic-bezier(0.22, 1, 0.36, 1); }
        @keyframes fadeInTop {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeOutBottom {
          from { opacity: 1; transform: translateY(0); }
          to { opacity: 0; transform: translateY(8px); }
        }
        @keyframes canvasFadeInUp {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
        .canvas-fade-in-up { animation: canvasFadeInUp 520ms cubic-bezier(0.22, 1, 0.36, 1) both; transform-origin: center bottom; }
        @keyframes loadingShimmer {
          0%   { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .loading-shimmer {
          background-image: linear-gradient(
            90deg,
            transparent 0%,
            color-mix(in srgb, currentColor 22%, transparent) 50%,
            transparent 100%
          );
          background-size: 200% 100%;
          background-repeat: no-repeat;
          animation: loadingShimmer 1.6s linear infinite;
        }
        .panel-scroll::-webkit-scrollbar { width: 4px; }
        .panel-scroll::-webkit-scrollbar-track { background: transparent; }
        .panel-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
        .panel-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.18); }
        .panel-scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent; }
        [data-theme='light'] .panel-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.28); }
        [data-theme='light'] .panel-scroll::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.45); }
        [data-theme='light'] .panel-scroll { scrollbar-color: rgba(0,0,0,0.32) transparent; }
        .app-themed .text-white { color: var(--text-primary) !important; }
        .app-themed .text-\\[\\#666\\] { color: var(--text-subtle) !important; }
        .app-themed .text-\\[\\#999\\] { color: var(--text-muted) !important; }
        .app-themed .text-\\[\\#bbb\\] { color: var(--text-primary) !important; }
        @keyframes themeFadeIn {
          from { opacity: 0; transform: scale(0.86); }
          50% { opacity: 1; }
          to { opacity: 1; transform: scale(1); }
        }
        .theme-fade-in { animation: themeFadeIn 480ms cubic-bezier(0.22, 1, 0.36, 1) both; }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--accent);
          border: none;
          cursor: pointer;
        }
        input[type="range"]::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--accent);
          border: none;
          cursor: pointer;
        }
      `}} />

      <IconContext.Provider value={{ weight: 'fill' }}>
        {!loaderDone && (
          <Loader onDone={() => setLoaderDone(true)} bgColor={ui.appBg} />
        )}

        <div
          className="app-themed flex flex-col h-screen w-screen overflow-hidden"
          style={{
            backgroundColor: ui.appBg,
            color: ui.textPrimary,
            opacity: loaderDone ? 1 : 0,
            pointerEvents: loaderDone ? 'auto' : 'none',
            transition: 'opacity 300ms cubic-bezier(0.22, 1, 0.36, 1), background-color 300ms ease',
            '--sec-bg': ui.sectionBg,
            '--text-primary': ui.textPrimary,
            '--text-muted': ui.textMuted,
            '--text-subtle': ui.textSubtle,
            '--tab-hover': ui.tabHover,
            '--tab-active': ui.tabActive,
            '--tab-active-text': ui.tabActiveText,
            '--accent': ui.accent,
            '--accent-inverse': ui.accentInverse,
            '--slider-track': ui.sliderTrack, '--slider-bg': ui.sliderBg, '--slider-bg-hover': ui.sliderBgHover, '--slider-fill': ui.sliderFill, '--slider-fill-hover': ui.sliderFillHover, '--slider-tick': ui.sliderTick, '--slider-thumb': ui.sliderThumb, '--slider-thumb-hover': ui.sliderThumbHover,
          }}
        >

          {/* TOP BAR */}
          <header className="relative flex items-center justify-between px-6 pt-4 pb-0 flex-shrink-0">
            <img src={isLight ? '/glowylight.png' : '/glowydark.png'} alt="Glowy" className="h-[22px] w-auto object-contain" />
            <div className="flex items-center gap-3">
              <div
                role="tablist"
                aria-label="UI theme"
                className="flex items-center gap-1 p-1 rounded-full"
                style={{ backgroundColor: ui.tabInactive }}
              >
                {[
                  { key: 'system', Icon: Desktop, label: 'System' },
                  { key: 'light', Icon: Sun, label: 'Light' },
                  { key: 'dark', Icon: Moon, label: 'Dark' },
                ].map(({ key, Icon, label }) => {
                  const active = themePref === key;
                  return (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={active}
                      aria-label={label}
                      onClick={() => { playSwitch(); setThemePref(key); }}
                      className="flex items-center justify-center w-7 h-7 rounded-full transition-colors duration-200"
                      style={{
                        backgroundColor: active ? ui.tabActive : 'transparent',
                        color: active ? ui.tabActiveText : ui.textSubtle,
                      }}
                      onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = ui.tabHover; }}
                      onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <Icon className="w-4 h-4" />
                    </button>
                  );
                })}
              </div>
              <div className="h-5 w-px" style={{ backgroundColor: ui.border }} />
              <div className="relative" ref={exportMenuRef}>
                <button
                  onClick={() => { playSwitch(); if (!isRecording && !svgExporting) setExportMenuOpen((v) => !v); }}
                  disabled={isRecording || svgExporting}
                  className={`relative overflow-hidden flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-200 font-medium text-[12px] disabled:cursor-not-allowed ${isLight ? 'bg-[#161616] hover:bg-[#161616]/90' : 'bg-white hover:bg-white/90'}`}
                  style={{ color: isLight ? '#FFFFFF' : '#000000' }}
                >
                  {(isRecording || svgExporting) && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 left-0 transition-[width] duration-150 ease-out loading-shimmer"
                      style={{ width: `${isRecording ? videoProgress : svgProgress}%`, backgroundColor: 'rgba(255,255,255,0.15)' }}
                    />
                  )}
                  {(isRecording || svgExporting) ? (
                    <span className="relative flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                      Exporting… {isRecording ? videoProgress : svgProgress}%
                    </span>
                  ) : (
                    <span className="relative flex items-center gap-2">
                      <ArrowCircleDown className="w-3.5 h-3.5" />
                      Export
                      <CaretDown className="w-3 h-3" />
                    </span>
                  )}
                </button>
                {exportMenuMounted && !isRecording && !svgExporting && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-[269px] rounded-2xl py-2 z-50"
                    style={{
                      backgroundColor: isLight ? '#EDEDED' : ui.sectionBg,
                      animation: `${exportMenuOpen ? 'fadeInTop' : 'fadeOutBottom'} 200ms cubic-bezier(0.22,1,0.36,1) forwards`,
                      pointerEvents: exportMenuOpen ? 'auto' : 'none',
                    }}
                  >
                    {(() => {
                      const sectionStyle = { color: ui.textSubtle };
                      const itemStyle = { color: ui.textPrimary };
                      const disabledStyle = { color: ui.textSubtle, opacity: 0.5 };
                      const Item = ({ label, onClick, disabled, hint }) => (
                        <button
                          role="menuitem"
                          onClick={onClick}
                          disabled={disabled}
                          className="w-[calc(100%-12px)] mx-1.5 rounded-full text-left px-4 py-2 text-[12px] flex items-center justify-between transition-colors disabled:cursor-not-allowed"
                          style={disabled ? disabledStyle : itemStyle}
                          onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.backgroundColor = ui.tabHover; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                          <span>{label}</span>
                          {hint && <span className="text-[10px]" style={{ color: ui.textSubtle }}>{hint}</span>}
                        </button>
                      );
                      const Divider = () => <div className="my-1.5 h-px" style={{ backgroundColor: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)' }} />;
                      const Header = ({ children }) => (
                        <div className="px-[22px] pt-1.5 pb-1 text-[10px] uppercase" style={sectionStyle}>{children}</div>
                      );
                      const run = (fn) => { playSwitch(); setExportMenuOpen(false); fn(); };
                      return (
                        <>
                          <Header>SVG Format</Header>
                          <Item label="SVG File" onClick={() => run(() => handleExportSVG())} />
                          <Divider />
                          <Header>PNG Format</Header>
                          {(() => {
                            const base = FORMATS[format];
                            const pngDims = (s) => `${Math.round(base.width * s)}×${Math.round(base.height * s)}`;
                            return (
                              <>
                                <Item label="PNG 1x" hint={pngDims(1)} onClick={() => run(() => handleExportPNG(1))} />
                                <Item label="PNG 2x" hint={pngDims(2)} onClick={() => run(() => handleExportPNG(2))} />
                                <Item label="PNG 3x" hint={pngDims(3)} onClick={() => run(() => handleExportPNG(3))} />
                              </>
                            );
                          })()}
                          <Divider />
                          <div className="px-[22px] pt-1.5 pb-1 flex items-center justify-between text-[10px] uppercase" style={sectionStyle}>
                            <span>Video Format</span>
                            <span className="normal-case">{IS_FIREFOX ? `WebM · VP9 · 30 fps · ${Math.round(loopDurationMs / 1000)} s` : `MP4 · H.264 · 30 fps · ${Math.round(loopDurationMs / 1000)} s`}</span>
                          </div>
                          {(() => {
                            const base = FORMATS[format];
                            const baseShort = Math.min(base.width, base.height);
                            const dimsFor = (target) => {
                              const f = target / baseShort;
                              const w = Math.round((base.width * f) / 2) * 2;
                              const h = Math.round((base.height * f) / 2) * 2;
                              return `${w}×${h}`;
                            };
                            return (
                              <>
                                <Item label="Video 480p" hint={dimsFor(480)} onClick={() => run(() => handleExportVideo(480))} />
                                <Item label="Video 720p" hint={dimsFor(720)} onClick={() => run(() => handleExportVideo(720))} />
                                <Item label="Video 1080p" hint={dimsFor(1080)} onClick={() => run(() => handleExportVideo(1080))} />
                                <Item label="Video 4k" disabled hint="Soon" />
                              </>
                            );
                          })()}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* MAIN AREA — relative so children can be absolutely positioned and centred */}
          <div className="flex-1 relative px-6 pb-6 overflow-hidden">

            {/* ICON RAIL — vertically centred against the viewport */}
            <div ref={railRef} className="nav-rail absolute left-6 top-1/2 -translate-y-1/2 flex flex-col gap-3 z-20">
              {TABS.map(({ id, label, Icon }) => {
                const isActive = activeTab === id;
                const isOpen = panelOpen;
                const btn = (
                  <button
                    onClick={() => { playHover(); handleTabClick(id); }}
                    aria-label={label}
                    className="nav-rail__btn w-12 h-12 rounded-[100px] transition-colors duration-200 flex items-center justify-center"
                    style={{
                      backgroundColor: isActive ? (isLight ? '#161616' : '#FFFFFF') : ui.tabInactive,
                      color: isActive ? (isLight ? '#FFFFFF' : '#000000') : ui.textPrimary,
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = ui.tabHover; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = ui.tabInactive; }}
                  >
                    <Icon className="nav-rail__icon w-[95%] h-[95%]" />
                  </button>
                );
                return isOpen ? <div key={id}>{btn}</div> : <Tooltip key={id} label={label} side="right">{btn}</Tooltip>;
              })}
            </div>

            {/* TAB PANEL — vertically centred, auto-height, hidden by default */}
            <div
              ref={panelRef}
              key={activeTab}
              className={`panel-themed tab-fade-in-left absolute left-[88px] top-0 bottom-0 my-auto w-[280px] flex flex-col rounded-[16px] overflow-hidden z-10 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${panelOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                }`}
              style={{
                backgroundColor: ui.panelBg,
                color: ui.textPrimary,
                maxHeight: 'calc(100% - 16px)',
                height: 'fit-content',
                transform: `translateX(${panelOpen ? '0px' : '-16px'})`,
                '--sec-bg': ui.sectionBg,
                '--text-primary': ui.textPrimary,
                '--text-muted': ui.textMuted,
                '--text-subtle': ui.textSubtle,
                '--tab-hover': ui.tabHover,
                '--tab-active': ui.tabActive,
                '--tab-active-text': ui.tabActiveText,
                '--accent': ui.accent,
                '--accent-inverse': ui.accentInverse,
                '--slider-track': ui.sliderTrack, '--slider-bg': ui.sliderBg, '--slider-bg-hover': ui.sliderBgHover, '--slider-fill': ui.sliderFill, '--slider-fill-hover': ui.sliderFillHover, '--slider-tick': ui.sliderTick, '--slider-thumb': ui.sliderThumb, '--slider-thumb-hover': ui.sliderThumbHover,
              }}
            >
              <div className="flex flex-col flex-1 min-h-0">

                {/* PANEL TITLE — matches the active tab */}
                <div className="px-4 pt-2 pb-1 flex items-center justify-between">
                  <h2 className="text-[14px] font-medium" style={{ color: isLight ? ui.textPrimary : '#FFFFFF' }}>
                    {TABS.find((t) => t.id === activeTab)?.label}
                  </h2>
                  {(() => {
                    const dirty = format !== '9:16' || direction !== 'left' || dotSize !== 1.8 || dotSpacing !== 28 || gradientPos !== 'bottom' || colorTheme !== 'neon' || customTheme !== null || shapeCount !== 9 || showDashed !== true || showNoise !== true || waveAmp !== 1 || dashedIntensity !== 1 || uploadedImageSrc !== null || imageScale !== 1.0;
                    const btn = (
                    <button
                      onClick={() => {
                        if (!dirty) return;
                        playSwitch();
                        setFormat('9:16');
                        setDirection('left');
                        setDotSize(1.8);
                        setDotSpacing(28);
                        setGradientPos('bottom');
                        setColorTheme('neon');
                        setCustomTheme(null);
                        setCustomPickerOpen(false);
                        setShapeCount(9);
                        setShowDashed(true);
                        setShowNoise(true);
                        setWaveAmp(1);
                        setDashedIntensity(1);
                        setUploadedImageSrc(null);
                        setUploadedImageObj(null);
                        setImageScale(1.0);
                      }}
                      aria-label="Reset"
                      tabIndex={dirty ? 0 : -1}
                      className="flex items-center justify-center w-8 h-8 rounded-full transition-colors duration-200"
                      style={{ backgroundColor: 'transparent', color: ui.textSubtle, visibility: dirty ? 'visible' : 'hidden', pointerEvents: dirty ? 'auto' : 'none' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = ui.tabHover; e.currentTarget.style.color = ui.textPrimary; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = ui.textSubtle; }}
                    >
                      <ArrowCounterClockwise className="w-4 h-4" weight="regular" />
                    </button>
                    );
                    return dirty ? <Tooltip label="Reset" side="left">{btn}</Tooltip> : btn;
                  })()}
                </div>

                {/* CONTROLS — height auto-fits content, scrolls only when overflowing the viewport */}
                <div className="panel-scroll flex flex-col overflow-y-auto px-3 pt-1 pb-3 gap-2 flex-1 min-h-0">

                  {/* PRESETS SECTION */}
                  <div className="bg-[var(--sec-bg)] rounded-[16px] p-3">
                    <label className="text-[12px] font-medium text-white mb-2 block">Presets</label>
                    <div className="flex justify-between">
                      {Object.entries(FORMATS).map(([key, { label }]) => {
                        const isActive = format === key;
                        const shapeStyle = key === '9:16'
                          ? { width: 12, height: 20 }
                          : key === '1:1'
                            ? { width: 17, height: 17 }
                            : { width: 22, height: 14 };
                        return (
                          <button
                            key={key}
                            onClick={() => { playSwitch(); setFormat(key); }}
                            className={`flex flex-col items-center justify-center gap-2 rounded-[16px] transition-colors duration-200 w-[70px] h-[70px] ${isActive
                              ? 'bg-[var(--tab-active)] text-[var(--tab-active-text)]'
                              : 'bg-transparent text-[var(--text-subtle)] hover:bg-[var(--tab-hover)] hover:text-[var(--text-muted)]'
                              }`}
                          >
                            <div className="flex items-center justify-center" style={{ height: 22 }}>
                              <div
                                className="rounded-[3px] shrink-0"
                                style={{ ...shapeStyle, backgroundColor: 'currentColor' }}
                              />
                            </div>
                            <span className="w-full text-center text-[10px] font-medium leading-none tabular-nums">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* COLOR THEME SECTION */}
                  <div className="bg-[var(--sec-bg)] rounded-[16px] p-3">
                    <label className="text-[12px] font-medium text-white mb-2 block">Color Theme</label>
                    <div className="grid grid-cols-3 gap-2 justify-items-center">
                      {Object.entries(THEMES).map(([key, t]) => {
                        const isActive = colorTheme === key && !customTheme;
                        return (
                          <button
                            key={key}
                            onClick={() => { playSwitch(); setCustomTheme(null); setCustomPickerOpen(false); setColorTheme(key); }}
                            className={`flex flex-col items-center justify-center gap-2 px-1 rounded-[16px] transition-colors duration-200 w-[70px] h-[70px] ${isActive
                              ? 'bg-[var(--tab-active)]'
                              : 'bg-transparent hover:bg-[var(--tab-hover)]'
                              }`}
                          >
                            <div className="flex justify-center">
                              {t.preview.map((c, i) => (
                                <div
                                  key={i}
                                  className="w-3.5 h-3.5 rounded-full"
                                  style={{
                                    backgroundColor: c,
                                    marginLeft: i === 0 ? 0 : -2,
                                    zIndex: 3 - i,
                                    boxShadow: 'none',
                                  }}
                                />
                              ))}
                            </div>
                            <span className={`text-[11px] font-medium text-center leading-none ${isActive ? 'text-[var(--tab-active-text)]' : 'text-[var(--text-subtle)]'
                              }`}>{t.label}</span>
                          </button>
                        );
                      })}
                      {(() => {
                        const randomActive = customTheme && customTheme.label !== 'Custom';
                        return (
                          <button
                            onClick={() => {
                              playSwitch();
                              setCustomPickerOpen(false);
                              const base = RANDOM_PALETTES[Math.floor(Math.random() * RANDOM_PALETTES.length)];
                              const j = jitterPalette(base);
                              setCustomTheme({
                                label: j.label,
                                bg: j.bg,
                                gradientStart: j.gradientStart,
                                gradientMid: j.gradientMid,
                                gradientEnd: j.gradientEnd,
                                preview: [j.gradientStart, j.gradientMid || j.gradientEnd, j.gradientEnd],
                              });
                            }}
                            className={`flex flex-col items-center justify-center gap-2 px-1 rounded-[16px] transition-colors duration-200 w-[70px] h-[70px] ${randomActive ? 'bg-[var(--tab-active)]' : 'bg-transparent hover:bg-[var(--tab-hover)]'}`}
                          >
                            <Shuffle
                              className="w-[18px] h-[18px]"
                              weight="bold"
                              style={{ color: randomActive ? 'var(--tab-active-text)' : 'var(--text-subtle)' }}
                            />
                            <span className={`text-[11px] font-medium text-center leading-none ${randomActive ? 'text-[var(--tab-active-text)]' : 'text-[var(--text-subtle)]'}`}>Random</span>
                          </button>
                        );
                      })()}
                      {(() => {
                        const customActive = customTheme && customTheme.label === 'Custom';
                        return (
                          <div className="relative w-[70px] h-[70px]">
                            <button
                              ref={sidebarCustomBtnRef}
                              onClick={() => {
                                playSwitch();
                                if (!customPickerOpen) {
                                  const r = sidebarCustomBtnRef.current?.getBoundingClientRect();
                                  if (r) setSidebarPickerPos({ left: r.right + 12, top: r.top });
                                  const src = customTheme || THEMES[colorTheme] || THEMES.neon;
                                  const mid = (a, b) => {
                                    const pa = parseInt(a.slice(1), 16);
                                    const pb = parseInt(b.slice(1), 16);
                                    const r = Math.round((((pa >> 16) & 255) + ((pb >> 16) & 255)) / 2);
                                    const g = Math.round((((pa >> 8) & 255) + ((pb >> 8) & 255)) / 2);
                                    const bl = Math.round(((pa & 255) + (pb & 255)) / 2);
                                    return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
                                  };
                                  applyCustomDraft({
                                    bg: src.bg,
                                    gradientStart: src.gradientStart,
                                    gradientMid: src.gradientMid || mid(src.gradientStart, src.gradientEnd),
                                    gradientEnd: src.gradientEnd,
                                  });
                                }
                                setCustomPickerOpen((v) => !v);
                              }}
                              className={`flex flex-col items-center justify-center gap-2 px-1 rounded-[16px] transition-colors duration-200 w-[70px] h-[70px] ${(customActive || customPickerOpen) ? 'bg-[var(--tab-active)]' : 'bg-transparent hover:bg-[var(--tab-hover)]'}`}
                            >
                              <Plus
                                className="w-[18px] h-[18px]"
                                weight="bold"
                                style={{ color: (customActive || customPickerOpen) ? 'var(--tab-active-text)' : 'var(--text-subtle)' }}
                              />
                              <span className={`text-[11px] font-medium text-center leading-none ${(customActive || customPickerOpen) ? 'text-[var(--tab-active-text)]' : 'text-[var(--text-subtle)]'}`}>Custom</span>
                            </button>
                            {panelOpen && createPortal(
                              renderCustomPickerPanel(
                                { position: 'fixed', left: sidebarPickerPos.left, top: sidebarPickerPos.top },
                                customPickerOpen
                              ),
                              document.body
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* CLASSIC MODE CONTROLS (Pattern only) */}
                  {activeTab === 'neonPattern' && (
                    <>
                      <div className="bg-[var(--sec-bg)] rounded-[16px] p-3">
                        <DirectionPad
                          label="Dot Direction"
                          direction={direction}
                          onChange={setDirection}
                        />
                      </div>

                      <div className="bg-[var(--sec-bg)] rounded-[16px] p-3">
                        <Slider
                          label="Thickness"
                          min={0.5} max={5} step={0.1}
                          value={dotSize}
                          onChange={setDotSize}
                          formatValue={(v) => v.toFixed(1) + 'px'}
                        />
                        <Slider
                          label="Density"
                          min={10} max={60} step={2}
                          value={dotSpacing}
                          onChange={setDotSpacing}
                          formatValue={(v) => v + 'px'}
                        />
                      </div>

                      <div className="bg-[var(--sec-bg)] rounded-[16px] p-3">
                        <DirectionPad
                          label="Gradient position"
                          direction={gradientPos}
                          onChange={setGradientPos}
                          disabledDirs={['left', 'right']}
                        />
                      </div>
                    </>
                  )}

                  {/* SHAPE + MOTION FX (Spectrum / Waves / Pulse) */}
                  {activeTab !== 'neonPattern' && (
                    <div className="bg-[var(--sec-bg)] rounded-[16px] p-3">
                      <Slider
                        label={activeTab === 'glass' ? 'Rings' : 'Columns'}
                        min={activeTab === 'glass' ? 5 : 4}
                        max={30}
                        step={1}
                        value={shapeCount}
                        onChange={setShapeCount}
                        formatValue={(v) => v}
                      />
                      <Slider
                        label="Wave Amplitude"
                        min={0} max={2} step={0.05}
                        value={waveAmp}
                        onChange={setWaveAmp}
                        formatValue={(v) => v.toFixed(2) + 'x'}
                      />
                      <Slider
                        label="Dashed Intensity"
                        min={0} max={2} step={0.05}
                        value={dashedIntensity}
                        onChange={setDashedIntensity}
                        formatValue={(v) => v.toFixed(2) + 'x'}
                      />
                    </div>
                  )}

                  {/* EFFECT TOGGLES */}
                  <div className="bg-[var(--sec-bg)] rounded-[16px] p-3 space-y-3">
                    <Switch
                      label="Animate Effect"
                      checked={isAnimated}
                      onChange={(on) => { if (on) restartAnim(); else setIsAnimated(false); }}
                    />
                    {activeTab !== 'neonPattern' && (
                      <Switch
                        label="Dashed Lines"
                        checked={showDashed}
                        onChange={setShowDashed}
                      />
                    )}
                    <Switch
                      label="Noise"
                      checked={showNoise}
                      onChange={setShowNoise}
                    />
                  </div>


                </div>
              </div>
            </div>

            {/* CANVAS PREVIEW — canvas itself is centred (label is absolutely
              positioned above it so it doesn't shift the centre point) */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative pointer-events-auto flex flex-col items-stretch">
                <span className="text-[13px] font-medium text-[#888] select-none" style={{ marginBottom: 8, marginLeft: 4 }}>
                  {FORMATS[format].label}
                </span>
                <div ref={fadeWrapRef} style={{ display: 'block' }}>
                  <div
                    ref={containerRef}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                    className="relative overflow-hidden"
                    style={{
                      // Explicit width/height via min() — Firefox does not size
                      // an inline-block child from `aspect-ratio + max-*` alone,
                      // so the canvas collapsed in 16:9. min() works everywhere.
                      // Reserve ≈220px of vertical chrome: header + label + transport bar + paddings.
                      width: `min(calc(100vw - 160px), calc((100vh - 220px) * ${FORMATS[format].width} / ${FORMATS[format].height}))`,
                      height: `min(calc(100vh - 220px), calc((100vw - 160px) * ${FORMATS[format].height} / ${FORMATS[format].width}))`,
                      aspectRatio: `${FORMATS[format].width} / ${FORMATS[format].height}`,
                      transformStyle: 'preserve-3d',
                      willChange: 'transform',
                      boxShadow: 'none',
                      borderRadius: 16,
                      backgroundColor: (customTheme || THEMES[colorTheme] || THEMES.neon).bg,
                    }}
                  >
                    <canvas ref={canvasRef} className="block w-full h-full transition-all" />
                  </div>
                </div>

                {/* CANVAS TRANSPORT — independent of fadeWrap so theme/format changes don't replay its enter animation */}
                <div
                  className="flex flex-col gap-2 self-center"
                  style={{
                    marginTop: 12,
                    padding: '10px 14px 12px',
                    borderRadius: 16,
                    backgroundColor: ui.tabInactive,
                    color: ui.textPrimary,
                    position: 'relative',
                    width: `min(calc(100vw - 160px), calc((100vh - 220px) * 1080 / 1920))`,
                  }}
                >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Tooltip label={isAnimated ? 'Pause (Space)' : 'Play (Space)'} side="top">
                          <button
                            onClick={() => {
                              playSwitch();
                              if (isAnimated) {
                                setIsAnimated(false);
                              } else {
                                const cycle = animOptsRef.current.loopMs || LOOP_MS;
                                if (animOptsRef.current.playMode === 'once' && timeStateRef.current.animatedTime >= cycle - 2) {
                                  restartAnim();
                                } else {
                                  setIsAnimated(true);
                                }
                              }
                            }}
                            aria-label={isAnimated ? 'Pause' : 'Play'}
                            className="flex items-center justify-center w-8 h-8 rounded-full transition-colors duration-200"
                            style={{ backgroundColor: 'transparent', color: ui.textPrimary }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = ui.tabHover; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            {isAnimated ? <Pause className="w-4 h-4" weight="fill" /> : <Play className="w-4 h-4" weight="fill" />}
                          </button>
                        </Tooltip>
                        <Tooltip label="Restart" side="top">
                          <button
                            onClick={() => { playSwitch(); restartAnim(); }}
                            aria-label="Restart"
                            className="flex items-center justify-center w-8 h-8 rounded-full transition-colors duration-200"
                            style={{ backgroundColor: 'transparent', color: ui.textPrimary }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = ui.tabHover; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            <SkipBack className="w-4 h-4" weight="fill" />
                          </button>
                        </Tooltip>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono tabular-nums" style={{ color: ui.textSubtle }}>
                          {(playheadMs / 1000).toFixed(1)}s / {(loopDurationMs / 1000).toFixed(1)}s
                        </span>
                        <Tooltip label={playMode === 'once' ? 'Loop off' : 'Loop on'} side="top">
                          <button
                            onClick={() => {
                              playSwitch();
                              setPlayMode((m) => (m === 'once' ? 'loop' : 'once'));
                            }}
                            aria-label="Toggle loop"
                            aria-pressed={playMode !== 'once'}
                            className="flex items-center justify-center w-8 h-8 rounded-full transition-colors duration-200"
                            style={{
                              backgroundColor: playMode !== 'once' ? ui.tabHover : 'transparent',
                              color: playMode !== 'once' ? ui.textPrimary : ui.textSubtle,
                            }}
                            onMouseEnter={(e) => { if (playMode === 'once') e.currentTarget.style.backgroundColor = ui.tabHover; }}
                            onMouseLeave={(e) => { if (playMode === 'once') e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            <Repeat className="w-4 h-4" weight="regular" />
                          </button>
                        </Tooltip>
                      </div>
                    </div>

                    <input
                      type="range"
                      min={0}
                      max={Math.max(1, loopDurationMs - 1)}
                      step={1}
                      value={Math.min(Math.round(playheadMs), loopDurationMs - 1)}
                      onChange={(e) => seekTo(Number(e.target.value))}
                      aria-label="Animation timeline"
                      className="w-full h-[2px] rounded-full appearance-none cursor-pointer focus:outline-none"
                      style={{
                        background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${(Math.min(playheadMs, loopDurationMs - 1) / Math.max(1, loopDurationMs - 1)) * 100}%, var(--slider-track) ${(Math.min(playheadMs, loopDurationMs - 1) / Math.max(1, loopDurationMs - 1)) * 100}%, var(--slider-track) 100%)`,
                      }}
                    />

                </div>

              </div>
            </div>

            {/* FLOATING ANIMATION RAIL (right) */}
            <div ref={animRailRef} className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col gap-3 z-20">
              {(() => {
                const isActive = animPanelOpen;
                const btn = (
                  <button
                    onClick={() => { playHover(); setAnimPanelOpen((v) => !v); }}
                    aria-label="Animation"
                    aria-pressed={isActive}
                    className="w-12 h-12 rounded-[100px] transition-colors duration-200 flex items-center justify-center"
                    style={{
                      backgroundColor: isActive ? (isLight ? '#161616' : '#FFFFFF') : ui.tabInactive,
                      color: isActive ? (isLight ? '#FFFFFF' : '#000000') : ui.textPrimary,
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = ui.tabHover; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = ui.tabInactive; }}
                  >
                    <Lightning className="w-5 h-5" weight="fill" />
                  </button>
                );
                return animPanelOpen ? <div>{btn}</div> : <Tooltip label="Animation" side="left">{btn}</Tooltip>;
              })()}
            </div>

            {/* FLOATING ANIMATION PANEL (right) */}
            <div
              ref={animPanelRef}
              className={`panel-themed absolute right-[88px] top-0 bottom-0 my-auto w-[280px] flex flex-col rounded-[16px] overflow-hidden z-10 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${animPanelOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
              style={{
                backgroundColor: ui.panelBg,
                color: ui.textPrimary,
                maxHeight: 'calc(100% - 16px)',
                height: 'fit-content',
                transform: `translateX(${animPanelOpen ? '0px' : '16px'})`,
                '--sec-bg': ui.sectionBg,
                '--text-primary': ui.textPrimary,
                '--text-muted': ui.textMuted,
                '--text-subtle': ui.textSubtle,
                '--tab-hover': ui.tabHover,
                '--tab-active': ui.tabActive,
                '--tab-active-text': ui.tabActiveText,
                '--accent': ui.accent,
                '--accent-inverse': ui.accentInverse,
                '--slider-track': ui.sliderTrack, '--slider-bg': ui.sliderBg, '--slider-bg-hover': ui.sliderBgHover, '--slider-fill': ui.sliderFill, '--slider-fill-hover': ui.sliderFillHover, '--slider-tick': ui.sliderTick, '--slider-thumb': ui.sliderThumb, '--slider-thumb-hover': ui.sliderThumbHover,
              }}
            >
              <div className="flex flex-col flex-1 min-h-0">
                <div className="px-4 pt-2 pb-1 flex items-center" style={{ minHeight: 44 }}>
                  <h2 className="text-[14px] font-medium" style={{ color: isLight ? ui.textPrimary : '#FFFFFF' }}>
                    Animation
                  </h2>
                </div>

                <div className="panel-scroll flex flex-col overflow-y-auto px-3 pt-1 pb-3 gap-2 flex-1 min-h-0">

                  <div className="bg-[var(--sec-bg)] rounded-[16px] p-3 flex items-center justify-between">
                    <span className="text-[12px] font-medium text-white">Playback</span>
                    <div className="flex items-center gap-1">
                    <Tooltip label={playMode === 'once' ? 'Loop off' : 'Loop on'} side="bottom">
                      <button
                        onClick={() => {
                          playSwitch();
                          setPlayMode((m) => (m === 'once' ? 'loop' : 'once'));
                        }}
                        aria-label="Toggle loop"
                        aria-pressed={playMode !== 'once'}
                        className="flex items-center justify-center w-8 h-8 rounded-full transition-colors duration-200"
                        style={{
                          backgroundColor: playMode !== 'once' ? ui.tabHover : 'transparent',
                          color: playMode !== 'once' ? ui.textPrimary : ui.textSubtle,
                        }}
                        onMouseEnter={(e) => { if (playMode === 'once') e.currentTarget.style.backgroundColor = ui.tabHover; }}
                        onMouseLeave={(e) => { if (playMode === 'once') e.currentTarget.style.backgroundColor = 'transparent'; }}
                      >
                        <Repeat className="w-4 h-4" weight="regular" />
                      </button>
                    </Tooltip>
                    <Tooltip label={isAnimated ? 'Pause (Space)' : 'Play (Space)'} side="bottom">
                      <button
                        onClick={() => {
                          playSwitch();
                          if (isAnimated) {
                            setIsAnimated(false);
                          } else {
                            const cycle = animOptsRef.current.loopMs || LOOP_MS;
                            if (animOptsRef.current.playMode === 'once' && timeStateRef.current.animatedTime >= cycle - 2) {
                              restartAnim();
                            } else {
                              setIsAnimated(true);
                            }
                          }
                        }}
                        aria-label={isAnimated ? 'Pause' : 'Play'}
                        className="flex items-center justify-center w-8 h-8 rounded-full transition-colors duration-200"
                        style={{ backgroundColor: 'transparent', color: ui.textPrimary }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = ui.tabHover; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      >
                        {isAnimated ? <Pause className="w-4 h-4" weight="fill" /> : <Play className="w-4 h-4" weight="fill" />}
                      </button>
                    </Tooltip>
                    </div>
                  </div>

                  <div className="bg-[var(--sec-bg)] rounded-[16px] p-3">
                    <Slider
                      label="Speed"
                      min={0.5} max={2} step={0.1}
                      value={animSpeed}
                      onChange={setAnimSpeed}
                      formatValue={(v) => v.toFixed(1) + 'x'}
                    />
                    <Slider
                      label="Duration"
                      min={2000} max={20000} step={500}
                      value={loopDurationMs}
                      onChange={(v) => {
                        setLoopDurationMs(v);
                        if (timeStateRef.current.animatedTime > v) {
                          timeStateRef.current.animatedTime = v - 1;
                          loopFrame0Ref.current = null;
                          requestPreviewRedrawRef.current();
                        }
                      }}
                      formatValue={(v) => (v / 1000).toFixed(1) + 's'}
                    />
                  </div>

                  <div className="bg-[var(--sec-bg)] rounded-[16px] p-3">
                    <label className="text-[12px] font-medium text-white mb-2 block">Easing</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'linear', label: 'Linear' },
                        { id: 'ease', label: 'Ease' },
                        { id: 'sine', label: 'Sine' },
                        { id: 'cubic', label: 'Cubic' },
                        { id: 'quint', label: 'Quint' },
                        { id: 'expo', label: 'Expo' },
                        { id: 'back', label: 'Back' },
                        { id: 'bounce', label: 'Bounce' },
                        { id: 'elastic', label: 'Elastic' },
                      ].map(({ id, label }) => {
                        const active = easing === id;
                        return (
                          <button
                            key={id}
                            onClick={() => { playSwitch(); setEasing(id); }}
                            className={`aspect-square rounded-[16px] flex flex-col items-center justify-center gap-2 transition-colors duration-200 ${active
                              ? 'bg-[var(--tab-active)] text-[var(--tab-active-text)]'
                              : 'bg-transparent text-[var(--text-subtle)] hover:bg-[var(--tab-hover)] hover:text-[var(--text-muted)]'
                              }`}
                          >
                            <EasingIcon mode={id} />
                            <span className="w-full text-center text-[10px] font-medium leading-none">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                </div>
              </div>
            </div>

          </div>
        </div>

        {mobileWarningOpen && (() => {
          const sysLight = !systemDark;
          const sysAppBg = sysLight ? '#fbfbfb' : '#141414';
          const sysText = sysLight ? '#0A0A0B' : '#FFFFFF';
          const sysSubtle = sysLight ? '#8A8A93' : '#666666';
          return (
            <div
              className="fixed inset-0 z-[300] flex items-center justify-center px-[60px]"
              style={{ backgroundColor: sysAppBg }}
            >
              <div className="w-full max-w-[380px] text-center">
                <img src="/favicon.png" alt="Glowy" className="h-[74px] w-auto object-contain mx-auto mb-4" />
                <h2 className="text-[20px] font-medium mb-3" style={{ color: sysText }}>
                  Best on desktop
                </h2>
                <p className="text-[13px] font-medium leading-relaxed" style={{ color: sysSubtle }}>
                  Glowy shines on a bigger screen. Open it on desktop for the full experience.
                </p>
              </div>
            </div>
          );
        })()}

        <Modal
          open={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
          bgColor={isLight ? '#FFFFFF' : ui.panelBg}
        >
          <button
            onClick={() => setShareModalOpen(false)}
            aria-label="Close"
            className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-200"
            style={{ color: ui.textSubtle }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = ui.tabHover; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <X className="w-4 h-4" weight="regular" />
          </button>

          <div className="text-center mb-2">
            <img src="/favicon.png" alt="Glowy" className="h-[74px] w-auto object-contain mx-auto" />
          </div>
          <h2 className="text-center text-[20px] font-medium mb-3" style={{ color: ui.textPrimary }}>
            Your file is ready!
          </h2>
          <p className="text-center text-[13px] font-medium leading-relaxed mb-6" style={{ color: ui.textSubtle }}>
            Glowy is free and built with love. If you enjoyed it, share it with your friends and fellow creators!
          </p>

          <div className="flex flex-col gap-2 mb-5">
            {[
              { key: 'x', Icon: XLogo, label: 'Share on X', url: `https://twitter.com/intent/tweet?text=${encodeURIComponent('I just designed a stunning gradient with @glowy_app — open-source, free, and ridiculously fun. Make yours in seconds ✨')}&url=${encodeURIComponent(window.location.href)}` },
              { key: 'fb', Icon: FacebookLogo, label: 'Share on Facebook', url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}&quote=${encodeURIComponent('Just made a beautiful gradient with Glowy — free, fast, and built for creators. Try it 👇')}` },
              { key: 'li', Icon: LinkedinLogo, label: 'Share on LinkedIn', url: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(window.location.href)}&summary=${encodeURIComponent('Discovered Glowy — a free creative tool that turns simple controls into bold, brand-ready visuals. Worth a look for designers and marketers alike.')}` },
            ].map(({ key, Icon, label, url }) => (
              <a
                key={key}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-3 rounded-full transition-colors duration-150"
                style={{ backgroundColor: ui.tabInactive, color: isLight ? ui.textMuted : ui.textPrimary }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = ui.tabHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ui.tabInactive; }}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="text-[13px] font-medium">{label}</span>
              </a>
            ))}
          </div>

          <div className="rounded-[12px] p-4 mb-5" style={{ backgroundColor: ui.sectionBg }}>
            <p className="text-[12px] font-medium leading-relaxed" style={{ color: ui.textSubtle }}>
              Your share keeps Glowy alive and growing — every post helps spread the glow.
            </p>
          </div>

          <div className="pt-4 text-center" style={{ borderTop: `1px solid ${isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'}` }}>
            <p className="text-[12px] font-medium" style={{ color: ui.textSubtle }}>
              Designed & built by{' '}
              <a
                href="https://x.com/javiercrocco"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
                style={{ color: ui.textPrimary }}
              >
                Javier Crocco Mendez
              </a>
            </p>
          </div>
        </Modal>
      </IconContext.Provider>
    </>
  );
}
