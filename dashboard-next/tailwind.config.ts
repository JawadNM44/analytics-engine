import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-instrument-serif)", "Georgia", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        accent: {
          DEFAULT: "#20a4d8",
          glow: "rgba(32, 164, 216, 0.35)",
        },
        good: "#10b981",
        bad: "#ef4444",
      },
      backgroundImage: {
        "hero-grad": "radial-gradient(ellipse at top, rgba(32,164,216,0.15), transparent 60%), radial-gradient(ellipse at bottom right, rgba(168,85,247,0.08), transparent 50%)",
      },
      animation: {
        "fade-in": "fadeIn 0.4s ease-out",
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0", transform: "translateY(4px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
      },
    },
  },
  plugins: [],
};

export default config;
