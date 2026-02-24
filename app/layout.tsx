import type { Metadata } from "next";
import { Suspense } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Breadcrumb } from "@/components/navigation/Breadcrumb";
import "./globals.css";

export const metadata: Metadata = {
  title: "Harmonia - Music Theory Learning App",
  description: "Learn music theory with interactive piano-roll visualization",
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Suspense fallback={null}>
            <Breadcrumb />
          </Suspense>
          {children}
        </div>
      </body>
    </html>
  );
}

