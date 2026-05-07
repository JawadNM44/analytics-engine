"use client";
import { useEffect, useState } from "react";
import {
  BitcoinIcon, EthereumIcon, SolanaIcon, CardanoIcon,
  DogecoinIcon, XrpIcon, ChainlinkIcon, PolkadotIcon,
} from "./crypto-icons";
import { cn } from "@/lib/cn";

/**
 * Three concentric orbits of cryptocurrency icons rotating around a
 * central logo, with one animated line connecting the centre to a
 * "currently active" icon that cycles every few seconds.
 *
 * Active assets (BTC, ETH, SOL) are drawn in full opacity. The rest are
 * rendered dimmed to telegraph "this pipeline can extend to these next."
 */

interface AssetIconProps { size?: number; className?: string }
type IconComponent = (p: AssetIconProps) => React.ReactElement;

interface AssetEntry {
  symbol: string;
  Icon: IconComponent;
  active: boolean;
}

// Inner orbit: the three actively traded assets
const INNER_ORBIT: AssetEntry[] = [
  { symbol: "BTC", Icon: BitcoinIcon, active: true },
  { symbol: "ETH", Icon: EthereumIcon, active: true },
  { symbol: "SOL", Icon: SolanaIcon, active: true },
];

// Outer orbit: planned-extension assets (visually dimmed)
const OUTER_ORBIT: AssetEntry[] = [
  { symbol: "ADA", Icon: CardanoIcon, active: false },
  { symbol: "DOGE", Icon: DogecoinIcon, active: false },
  { symbol: "XRP", Icon: XrpIcon, active: false },
  { symbol: "LINK", Icon: ChainlinkIcon, active: false },
  { symbol: "DOT", Icon: PolkadotIcon, active: false },
];

const INNER_RADIUS = 110;
const OUTER_RADIUS = 200;

export function OrbitSection() {
  // The "active" inner-orbit asset cycles every 3.5 seconds — gives us
  // an animated line drawn from the centre to a different symbol over time.
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setActiveIndex((i) => (i + 1) % INNER_ORBIT.length);
    }, 3500);
    return () => clearInterval(t);
  }, []);

  // Position helpers — angle in degrees → x,y on a circle of radius r
  const pos = (angle: number, r: number) => {
    const rad = (angle - 90) * (Math.PI / 180);
    return { x: Math.cos(rad) * r, y: Math.sin(rad) * r };
  };

  const innerActive = pos(
    (360 / INNER_ORBIT.length) * activeIndex,
    INNER_RADIUS,
  );

  return (
    <section className="mb-20">
      <div className="mb-6 max-w-3xl">
        <div className="mb-2 text-xs uppercase tracking-widest text-accent">
          Asset Orchestration
        </div>
        <h2 className="font-display text-3xl font-medium leading-tight sm:text-4xl">
          One pipeline, ready for many assets.
        </h2>
        <p className="mt-3 max-w-2xl text-white/65 [html.light_&]:text-zinc-600">
          Three assets are tracked live today. The architecture is asset-agnostic —
          every additional symbol on the outer ring would plug in by adding it
          to the producer's subscription list and the dataset's allow-list.
        </p>
      </div>

      <div className="relative mx-auto flex h-[520px] w-full max-w-2xl items-center justify-center">
        {/* Background glow */}
        <div className="absolute h-[420px] w-[420px] rounded-full bg-accent-glow opacity-25 blur-3xl" />

        {/* Concentric guide rings */}
        <div className="absolute h-[220px] w-[220px] rounded-full border border-white/10 [html.light_&]:border-black/10" />
        <div className="absolute h-[400px] w-[400px] rounded-full border border-white/[0.06] [html.light_&]:border-black/[0.06]" />

        {/* Animated connection line — SVG, full overlay */}
        <svg
          className="absolute inset-0 h-full w-full pointer-events-none"
          viewBox="-260 -260 520 520"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <linearGradient id="orbit-line" x1="0" y1="0" x2={innerActive.x} y2={innerActive.y} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#20a4d8" stopOpacity="0.9" />
              <stop offset="1" stopColor="#20a4d8" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line
            x1="0" y1="0" x2={innerActive.x} y2={innerActive.y}
            stroke="url(#orbit-line)" strokeWidth="1.5"
            strokeLinecap="round"
            style={{ transition: "all 700ms cubic-bezier(0.4, 0, 0.2, 1)" }}
          />
          <circle
            cx={innerActive.x} cy={innerActive.y} r="3"
            fill="#20a4d8"
            style={{ transition: "all 700ms cubic-bezier(0.4, 0, 0.2, 1)" }}
          >
            <animate attributeName="r" values="3;6;3" dur="1.5s" repeatCount="indefinite" />
          </circle>
        </svg>

        {/* Outer orbit (rotates slowly clockwise) */}
        <div className="absolute h-[400px] w-[400px] animate-orbit-cw">
          {OUTER_ORBIT.map((asset, i) => {
            const angle = (360 / OUTER_ORBIT.length) * i;
            const { x, y } = pos(angle, OUTER_RADIUS);
            return (
              <OrbitChip
                key={asset.symbol}
                asset={asset}
                x={x}
                y={y}
                counterRotate
              />
            );
          })}
        </div>

        {/* Inner orbit (rotates slowly counter-clockwise) */}
        <div className="absolute h-[220px] w-[220px] animate-orbit-ccw">
          {INNER_ORBIT.map((asset, i) => {
            const angle = (360 / INNER_ORBIT.length) * i;
            const { x, y } = pos(angle, INNER_RADIUS);
            return (
              <OrbitChip
                key={asset.symbol}
                asset={asset}
                x={x}
                y={y}
                highlighted={i === activeIndex}
                counterRotate
              />
            );
          })}
        </div>

        {/* Centre logo */}
        <div className="relative z-10">
          <div className="absolute inset-0 -m-3 rounded-full bg-accent-glow opacity-40 blur-2xl" />
          <div
            className={cn(
              "relative flex h-24 w-24 items-center justify-center rounded-full",
              "border border-white/15 bg-white/[0.04] backdrop-blur-xl",
              "[html.light_&]:border-black/10 [html.light_&]:bg-white/70",
              "shadow-[0_8px_40px_rgba(32,164,216,0.25)]",
              "animate-spin-slow",
            )}
          >
            <CenterGlyph />
          </div>
        </div>
      </div>
    </section>
  );
}

function OrbitChip({
  asset, x, y, highlighted, counterRotate,
}: {
  asset: AssetEntry;
  x: number;
  y: number;
  highlighted?: boolean;
  counterRotate?: boolean;
}) {
  const { Icon } = asset;
  return (
    <div
      className="absolute left-1/2 top-1/2"
      style={{ transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))` }}
    >
      {/* Counter-rotate so the chip stays upright while the parent spins */}
      <div className={cn(counterRotate && (asset.active ? "animate-orbit-ccw-cancel" : "animate-orbit-cw-cancel"))}>
        <div
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-2xl",
            "border backdrop-blur-xl transition-all duration-500",
            asset.active
              ? "border-white/20 bg-white/10 [html.light_&]:border-black/15 [html.light_&]:bg-white/80"
              : "border-white/10 bg-white/[0.03] opacity-50 [html.light_&]:border-black/10 [html.light_&]:bg-white/40",
            highlighted && "scale-110 border-accent shadow-[0_0_24px_rgba(32,164,216,0.5)]",
          )}
        >
          <Icon size={22} className={cn(asset.active ? "text-white [html.light_&]:text-zinc-900" : "text-white/40 [html.light_&]:text-zinc-400")} />
        </div>
        {asset.active && (
          <div className="mt-1 text-center text-[10px] font-medium uppercase tracking-widest text-white/60 [html.light_&]:text-zinc-600">
            {asset.symbol}
          </div>
        )}
      </div>
    </div>
  );
}

function CenterGlyph() {
  // Stylised "data hub" glyph — bars + central dot, in the project's
  // accent colours. Counter-rotates against the parent so it stays upright.
  return (
    <div className="animate-spin-slow-cancel">
      <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="hub-grad" x1="0" y1="0" x2="44" y2="44" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#20a4d8" />
            <stop offset="1" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        <circle cx="22" cy="22" r="6" fill="url(#hub-grad)" />
        <circle cx="22" cy="22" r="3" fill="#fff" opacity="0.9" />
        <path d="M22 4 V12 M22 32 V40 M4 22 H12 M32 22 H40" stroke="url(#hub-grad)" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}
