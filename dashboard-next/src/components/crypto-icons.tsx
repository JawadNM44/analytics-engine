/**
 * Inline SVG crypto-symbol marks. All use currentColor so they pick up
 * the parent text colour — works in dark + light themes without changes.
 *
 * Each icon is a 24×24 viewBox with the canonical asset glyph. Sources:
 * Wikipedia commons + recreated minimal versions, simplified for legibility
 * at small sizes.
 */

import type { SVGProps } from "react";

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function base(size: number, props: SVGProps<SVGSVGElement>) {
  return {
    width: size, height: size, viewBox: "0 0 24 24",
    fill: "none", xmlns: "http://www.w3.org/2000/svg",
    ...props,
  };
}

export function BitcoinIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size, rest)}>
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.08" />
      <path
        fill="currentColor"
        d="M16.1 10.6c.3-1.5-.85-2.3-2.4-2.85l.5-2-1.2-.3-.5 1.95-1-.25.5-1.95L10.8 5l-.5 2c-.3-.05-.55-.15-.85-.2l-1.65-.4-.3 1.3s.9.2.85.2c.5.15.55.45.55.7l-.55 2.25c.05 0 .1.05.15.05L8.4 12.7l-.8 3.1c-.05.15-.2.4-.5.3.05.05-.85-.2-.85-.2L5.7 17.3l1.55.4c.3.05.55.15.85.2l-.5 2 1.2.3.5-2 1 .3-.5 2 1.2.3.5-2c2.05.4 3.6.25 4.25-1.6.55-1.5-.05-2.4-1.15-2.95.8-.2 1.4-.7 1.55-1.8m-2.75 4c-.4 1.5-2.85.7-3.65.5l.65-2.65c.85.2 3.4.6 3 2.15m.4-4.05c-.35 1.4-2.4.7-3.05.55l.6-2.45c.65.15 2.8.45 2.45 1.9"
      />
    </svg>
  );
}

export function EthereumIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size, rest)}>
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.08" />
      <path fill="currentColor" d="M11.93 4 7.4 11.5l4.53 2.65 4.53-2.65zM7.4 12.4l4.53 6.35 4.53-6.35-4.53 2.65z" />
    </svg>
  );
}

export function SolanaIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size, rest)}>
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.08" />
      <path fill="currentColor" d="M7.5 15.4 6 17h10.5l1.5-1.6zm0-6L6 11h10.5l1.5-1.6zm10.5 3-1.5 1.6H6L7.5 12.4z" />
    </svg>
  );
}

export function CardanoIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size, rest)}>
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.08" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <circle cx="12" cy="6" r="0.9" fill="currentColor" />
      <circle cx="12" cy="18" r="0.9" fill="currentColor" />
      <circle cx="6.8" cy="9" r="0.9" fill="currentColor" />
      <circle cx="17.2" cy="9" r="0.9" fill="currentColor" />
      <circle cx="6.8" cy="15" r="0.9" fill="currentColor" />
      <circle cx="17.2" cy="15" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function DogecoinIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size, rest)}>
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.08" />
      <path
        fill="currentColor"
        d="M9 7h3.7c2.3 0 3.7 1.6 3.7 5s-1.4 5-3.7 5H9v-4H7.5v-2H9zm2 2v2h2v2h-2v2h1.7c1.1 0 1.6-.8 1.6-3s-.5-3-1.6-3z"
      />
    </svg>
  );
}

export function XrpIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size, rest)}>
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.08" />
      <path fill="currentColor" d="M7 7l3.5 3.5c.8.8 2.2.8 3 0L17 7h2.5l-4.5 4.5c-1.6 1.6-4.4 1.6-6 0L4.5 7zM7 17l3.5-3.5c.8-.8 2.2-.8 3 0L17 17h2.5l-4.5-4.5c-1.6-1.6-4.4-1.6-6 0L4.5 17z" />
    </svg>
  );
}

export function ChainlinkIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size, rest)}>
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.08" />
      <path fill="currentColor" d="M12 5l5.7 3.3v6.4L12 18l-5.7-3.3V8.3zm0 2.3-3.7 2.1v4.2l3.7 2.1 3.7-2.1V9.4z" />
    </svg>
  );
}

export function PolkadotIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...base(size, rest)}>
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity="0.08" />
      <ellipse cx="12" cy="6.5" rx="2" ry="1.4" fill="currentColor" />
      <ellipse cx="12" cy="17.5" rx="2" ry="1.4" fill="currentColor" />
      <ellipse cx="7.2" cy="9.3" rx="2" ry="1.4" fill="currentColor" transform="rotate(-60 7.2 9.3)" />
      <ellipse cx="16.8" cy="9.3" rx="2" ry="1.4" fill="currentColor" transform="rotate(60 16.8 9.3)" />
      <ellipse cx="7.2" cy="14.7" rx="2" ry="1.4" fill="currentColor" transform="rotate(60 7.2 14.7)" />
      <ellipse cx="16.8" cy="14.7" rx="2" ry="1.4" fill="currentColor" transform="rotate(-60 16.8 14.7)" />
    </svg>
  );
}
