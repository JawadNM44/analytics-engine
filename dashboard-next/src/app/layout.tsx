import type { Metadata } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { TopBar } from "@/components/top-bar";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-instrument-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Crypto Analytics — Live",
  description:
    "Live cryptocurrency trade analytics with statistical and ML-based anomaly detection. Coinbase WebSocket → Pub/Sub → BigQuery → ML.",
  robots: { index: true, follow: true },
  metadataBase: new URL("https://crypto-dashboard-jiuqt3hfoq-uc.a.run.app"),
  openGraph: {
    type: "website",
    title: "Crypto Analytics — Live",
    description: "Live BTC/ETH/SOL trade analytics + ML anomaly forecasting.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${instrumentSerif.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans">
        <ThemeProvider>
          <TopBar />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
