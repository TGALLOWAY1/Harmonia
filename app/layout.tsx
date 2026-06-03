import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Harmonia — Chord Progression Generator",
  description:
    "Generate musically coherent chord progressions in any key and mode. Hear them instantly, export as MIDI.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    shortcut: "/icon.svg",
    // iOS Safari ignores SVG icons for "Add to Home Screen"; it needs a PNG.
    apple: { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
  },
  appleWebApp: {
    capable: true,
    title: "Harmonia",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "Harmonia — Chord Progression Generator",
    description:
      "Generate musically coherent chord progressions in any key and mode. Hear them instantly, export as MIDI.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Harmonia — Chord Progression Generator",
    description:
      "Generate musically coherent chord progressions in any key and mode. Hear them instantly, export as MIDI.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} bg-background text-foreground font-sans antialiased min-h-screen`}
      >
        {children}
      </body>
    </html>
  );
}
