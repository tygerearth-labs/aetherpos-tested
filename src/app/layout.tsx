import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/shared/theme-provider";
import { PwaRegister } from "@/components/pwa-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AETHER",
  description: "AETHER — High-performance POS for MSME. Modern, fast, and reliable point-of-sale system.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  openGraph: {
    title: "AETHER",
    description: "High-performance POS for MSME",
    type: "website",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "AETHER",
    "application-name": "AETHER",
    "msapplication-TileColor": "#020617",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover" />
          <meta name="theme-color" content="#020617" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-deep-space text-slate-100 overflow-x-hidden`}
      >
        <ThemeProvider>
          {children}
        </ThemeProvider>
        <Toaster />
        <PwaRegister />
      </body>
    </html>
  );
}
