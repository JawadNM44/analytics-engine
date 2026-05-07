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
  title: {
    default: "Crypto Analytics — Live · by Jawad NM",
    template: "%s · Crypto Analytics by Jawad NM",
  },
  description:
    "Live cryptocurrency trade analytics with statistical and ML-based anomaly detection. Coinbase WebSocket → Pub/Sub → BigQuery → ML. Built by Jawad NM.",
  authors: [{ name: "Jawad NM", url: "https://github.com/JawadNM44" }],
  creator: "Jawad NM",
  publisher: "Jawad NM",
  robots: { index: true, follow: true },
  metadataBase: new URL("https://crypto-dashboard-jiuqt3hfoq-uc.a.run.app"),
  openGraph: {
    type: "website",
    title: "Crypto Analytics — Live · by Jawad NM",
    description:
      "Live BTC/ETH/SOL trade analytics + ML anomaly forecasting. A personal portfolio project by Jawad NM.",
    siteName: "Crypto Analytics by Jawad NM",
  },
  twitter: {
    card: "summary",
    title: "Crypto Analytics — Live · by Jawad NM",
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
