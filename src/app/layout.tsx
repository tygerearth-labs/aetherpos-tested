import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AETHER — POS Modern untuk UMKM Indonesia",
  description:
    "Kelola stok, transaksi, pelanggan, dan laporan dalam satu platform. POS modern untuk coffee shop, retail, dan UMKM Indonesia.",
  keywords: ["AETHER", "POS", "UMKM", "coffee shop", "retail", "Point of Sale", "Indonesia"],
  authors: [{ name: "AETHER" }],
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
    title: "AETHER — POS Modern untuk UMKM Indonesia",
    description: "Kelola toko lebih cepat. Tumbuh lebih pasti.",
    siteName: "AETHER",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AETHER — POS Modern untuk UMKM Indonesia",
    description: "Kelola toko lebih cepat. Tumbuh lebih pasti.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#020617] text-white`}>
        {children}
      </body>
    </html>
  );
}
