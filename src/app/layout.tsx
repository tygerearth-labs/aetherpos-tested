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
  title: "Aether POS — Point of Sale System",
  description: "High-performance POS for MSME. Modern, fast, and reliable point-of-sale system for small and medium businesses.",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.png",
    apple: "/logo.png",
  },
  openGraph: {
    title: "Aether POS",
    description: "High-performance POS for MSME",
    type: "website",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "AetherPOS",
    "application-name": "AetherPOS",
    "msapplication-TileColor": "#09090b",
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
          <meta name="theme-color" content="#059669" />
          <link rel="apple-touch-icon" href="/logo.png" />
        </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-950 text-zinc-100 overflow-x-hidden`}
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
