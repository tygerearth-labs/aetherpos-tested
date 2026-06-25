import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/shared/theme-provider";
import { PwaRegister } from "@/components/pwa-register";
import { QueryProvider } from "@/providers/query-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://aethergo.id"),
  title: {
    default: "AETHER POS — Software Kasir Modern & Gratis untuk UMKM Indonesia",
    template: "%s | AETHER POS",
  },
  description:
    "AETHER POS — Sistem Point of Sale modern untuk UMKM Indonesia. Kelola stok, transaksi, pelanggan, dan laporan dalam satu platform. Gratis 6 bulan. Cocok untuk coffee shop, retail, dan toko.",
  keywords: [
    "POS",
    "point of sale",
    "software kasir",
    "kasir online",
    "kasir gratis",
    "UMKM",
    "coffee shop POS",
    "retail POS",
    "sistem kasir",
    "aplikasi kasir",
    "kasir toko",
    "manajemen stok",
    "AETHER POS",
    "kasir Indonesia",
    "POS Indonesia",
  ],
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
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    title: "AETHER POS — Software Kasir Modern & Gratis untuk UMKM",
    description:
      "Kelola toko lebih cepat, tumbuh lebih pasti. POS modern untuk coffee shop, retail, dan UMKM Indonesia. Gratis 6 bulan.",
    type: "website",
    siteName: "AETHER POS",
    locale: "id_ID",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "AETHER POS — Software Kasir Modern untuk UMKM Indonesia",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AETHER POS — Software Kasir Modern & Gratis untuk UMKM",
    description:
      "Kelola toko lebih cepat, tumbuh lebih pasti. POS modern untuk coffee shop, retail, dan UMKM Indonesia.",
    images: ["/og-image.png"],
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "AETHER",
    "application-name": "AETHER POS",
    "msapplication-TileColor": "#020617",
    "google-site-verification": "VsWEaPz4cbLVlP1Q1v0m1E445vTDMRvNlvLB0HrymZ8",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className="dark" suppressHydrationWarning>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover" />
          <meta name="theme-color" content="#020617" />
          <meta name="google-site-verification" content="VsWEaPz4cbLVlP1Q1v0m1E445vTDMRvNlvLB0HrymZ8" />
          <link rel="canonical" href="https://aethergo.id" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-deep-space text-slate-100 overflow-x-hidden`}
      >
        <ThemeProvider>
          <QueryProvider>
            {children}
          </QueryProvider>
        </ThemeProvider>
        <Toaster />
        <PwaRegister />
      </body>
    </html>
  );
}