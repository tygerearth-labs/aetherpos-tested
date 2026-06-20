"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Zap,
  Package,
  Printer,
  BarChart3,
  X,
  Check,
  AlertTriangle,
  Coffee,
  Store,
  UtensilsCrossed,
  TrendingUp,
  ChevronRight,
  Sparkles,
  Users,
  Shield,
  Globe,
  Database,
  Brain,
  Upload,
  Headphones,
  Menu,
} from "lucide-react";

interface LandingPageProps {
  onGetStarted: () => void;
}

/* ── Animation helpers ── */
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94], delay: i * 0.1 },
  }),
};

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const viewportConfig = { once: true, margin: "-100px" } as const;

/* ── Fake dashboard preview ── */
function DashboardPreview() {
  return (
    <div className="aether-card-elevated rounded-2xl overflow-hidden w-full max-w-[540px]">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-white/10" />
          <span className="size-2.5 rounded-full bg-white/10" />
          <span className="size-2.5 rounded-full bg-white/10" />
        </div>
        <div className="flex-1 mx-4">
          <div className="h-4 bg-white/[0.04] rounded max-w-[180px]" />
        </div>
        <div className="h-4 w-4 rounded bg-white/[0.04]" />
      </div>
      {/* Body */}
      <div className="flex">
        {/* Sidebar hint */}
        <div className="hidden sm:flex flex-col gap-3 w-[140px] p-3 border-r border-white/[0.06] shrink-0">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={cn(
                "h-7 rounded-md",
                i === 1
                  ? "bg-aether-cyan/10 border border-aether-cyan/20"
                  : "bg-white/[0.03]"
              )}
            />
          ))}
        </div>
        {/* Main content */}
        <div className="flex-1 p-4 space-y-4">
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Revenue", value: "Rp 4.2M", color: "aether-cyan" },
              { label: "Orders", value: "128", color: "aether-purple" },
              { label: "Items", value: "342", color: "aether-pink" },
            ].map((s) => (
              <div key={s.label} className="bg-white/[0.03] rounded-lg p-3 space-y-2">
                <div className="text-caption text-slate-500">{s.label}</div>
                <div className={cn("text-sm font-semibold", `text-${s.color}`)}>
                  {s.value}
                </div>
                <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full", `bg-${s.color}/40`)}
                    style={{ width: `${40 + Math.random() * 50}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          {/* Chart placeholder */}
          <div className="bg-white/[0.03] rounded-lg p-3 space-y-3">
            <div className="h-3 bg-white/[0.06] rounded w-24" />
            <div className="flex items-end gap-1 h-16">
              {[40, 65, 45, 80, 55, 90, 70, 85, 60, 95, 75, 88].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-sm aether-gradient opacity-40"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
          {/* Table placeholder */}
          <div className="bg-white/[0.03] rounded-lg p-3 space-y-2">
            <div className="h-3 bg-white/[0.06] rounded w-20" />
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3 items-center">
                <div className="h-3 w-3 rounded-sm bg-white/[0.06]" />
                <div className="flex-1">
                  <div className="h-2.5 bg-white/[0.04] rounded w-3/4" />
                </div>
                <div className="h-2.5 bg-white/[0.04] rounded w-16" />
                <div className="h-2.5 bg-white/[0.04] rounded w-12" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Screenshot placeholder ── */
function ScreenshotPlaceholder({ label, variant }: { label: string; variant: "dashboard" | "pos" | "products" | "barcode" }) {
  return (
    <div className="aether-card-elevated rounded-2xl overflow-hidden group">
      <div className="relative aspect-[16/10] bg-deep-space overflow-hidden">
        {/* REPLACE: Replace this placeholder with real screenshot */}
        {/* Top chrome */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] bg-nebula/50">
          <div className="flex gap-1.5">
            <span className="size-2 rounded-full bg-white/10" />
            <span className="size-2 rounded-full bg-white/10" />
            <span className="size-2 rounded-full bg-white/10" />
          </div>
          <div className="flex-1 mx-6">
            <div className="h-3 bg-white/[0.04] rounded max-w-[140px] mx-auto" />
          </div>
        </div>
        {/* Content */}
        <div className="p-4 space-y-3">
          {variant === "dashboard" && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="aether-shimmer rounded-lg h-12" />
                ))}
              </div>
              <div className="aether-shimmer rounded-lg h-24" />
              <div className="grid grid-cols-2 gap-2">
                <div className="aether-shimmer rounded-lg h-20" />
                <div className="aether-shimmer rounded-lg h-20" />
              </div>
            </>
          )}
          {variant === "pos" && (
            <div className="flex gap-3 h-[calc(100%-2rem)]">
              <div className="flex-1 grid grid-cols-3 gap-1.5">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="aether-shimmer rounded-md" />
                ))}
              </div>
              <div className="w-[35%] space-y-2">
                <div className="aether-shimmer rounded-md h-6" />
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-5 bg-white/[0.03] rounded-md" />
                ))}
                <div className="aether-gradient rounded-md h-8 mt-4 opacity-60" />
              </div>
            </div>
          )}
          {variant === "products" && (
            <>
              <div className="flex gap-2">
                <div className="h-6 bg-white/[0.04] rounded w-40" />
                <div className="h-6 bg-white/[0.04] rounded w-24" />
                <div className="flex-1" />
                <div className="h-6 aether-gradient rounded-md w-20 opacity-60" />
              </div>
              <div className="space-y-1.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex gap-3 items-center py-1.5">
                    <div className="w-8 h-8 rounded bg-white/[0.04]" />
                    <div className="flex-1 space-y-1">
                      <div className="h-2.5 bg-white/[0.04] rounded w-2/3" />
                      <div className="h-2 bg-white/[0.03] rounded w-1/3" />
                    </div>
                    <div className="h-2.5 bg-white/[0.04] rounded w-14" />
                    <div className="h-2.5 bg-white/[0.04] rounded w-10" />
                  </div>
                ))}
              </div>
            </>
          )}
          {variant === "barcode" && (
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="aether-shimmer rounded aspect-[3/4]" />
              ))}
            </div>
          )}
        </div>
        {/* Gradient overlay at bottom */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-deep-space to-transparent pointer-events-none" />
        {/* Label */}
        <div className="absolute bottom-3 left-3 right-3">
          <div className="bg-nebula/80 backdrop-blur-md rounded-lg px-3 py-2 border border-white/[0.08] text-center">
            <span className="text-xs font-medium text-slate-300">{label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Pricing feature row ── */
function PricingFeature({ included }: { included: boolean | string }) {
  if (included === true) return <Check className="size-4 text-aether-cyan shrink-0" />;
  if (included === false) return <X className="size-4 text-slate-600 shrink-0" />;
  return <span className="text-xs text-slate-300 font-medium">{included}</span>;
}

/* ═══════════════════════════════════════════════════════════
   LANDING PAGE
   ═══════════════════════════════════════════════════════════ */
export default function LandingPage({ onGetStarted }: LandingPageProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (id: string) => {
    setMobileMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-deep-space text-slate-100 overflow-x-hidden">
      {/* ── NAV ── */}
      <nav
        className={cn(
          "fixed top-0 inset-x-0 z-50 transition-all duration-300",
          scrolled
            ? "bg-deep-space/80 backdrop-blur-xl border-b border-white/[0.06]"
            : "bg-transparent"
        )}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between h-14 px-4 sm:px-6">
          {/* Logo */}
          <button onClick={onGetStarted} className="flex items-center gap-2 shrink-0">
            <img src="/logo.png" alt="Aether" className="h-7 w-auto" />
          </button>

          {/* Center links — hidden on mobile */}
          <div className="hidden md:flex items-center gap-6">
            {[
              { label: "Fitur", id: "features" },
              { label: "Harga", id: "pricing" },
              { label: "Tentang", id: "founder" },
            ].map((link) => (
              <button
                key={link.id}
                onClick={() => scrollTo(link.id)}
                className="text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                {link.label}
              </button>
            ))}
          </div>

          {/* Right CTA */}
          <div className="flex items-center gap-3">
            <Button
              onClick={onGetStarted}
              className="theme-btn-primary text-sm font-semibold rounded-lg h-8 px-4 border-0 shadow-none"
            >
              Mulai Gratis
            </Button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-1.5 text-slate-400 hover:text-slate-200"
            >
              <Menu className="size-5" />
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="md:hidden bg-nebula/95 backdrop-blur-xl border-b border-white/[0.06] px-4 pb-4 pt-2"
          >
            {[
              { label: "Fitur", id: "features" },
              { label: "Harga", id: "pricing" },
              { label: "Tentang", id: "founder" },
            ].map((link) => (
              <button
                key={link.id}
                onClick={() => scrollTo(link.id)}
                className="block w-full text-left py-2.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                {link.label}
              </button>
            ))}
          </motion.div>
        )}
      </nav>

      {/* ═══════════════════════════════════════════════════
         SECTION 1: HERO
         ═══════════════════════════════════════════════════ */}
      <section className="relative min-h-screen flex items-center pt-14">
        {/* Radial glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.08)_0%,rgba(6,182,212,0.04)_40%,transparent_70%)]" />
        </div>

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 w-full py-16 md:py-24">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
            {/* Text */}
            <motion.div
              className="flex-1 text-center lg:text-left"
              initial="hidden"
              animate="visible"
              variants={staggerContainer}
            >
              <motion.p
                variants={fadeUp}
                custom={0}
                className="text-overline text-slate-500 mb-4"
              >
                POS Modern untuk Indonesia
              </motion.p>

              <motion.h1
                variants={fadeUp}
                custom={1}
                className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-6"
              >
                Kelola Toko Lebih Cepat.{" "}
                <br className="hidden sm:block" />
                <span className="aether-gradient-text">Tumbuh Lebih Pasti.</span>
              </motion.h1>

              <motion.p
                variants={fadeUp}
                custom={2}
                className="text-base sm:text-lg text-slate-400 max-w-xl mx-auto lg:mx-0 mb-8 leading-relaxed"
              >
                POS modern untuk coffee shop, retail, dan UMKM Indonesia. Kelola
                stok, transaksi, pelanggan, dan laporan dalam satu platform.
              </motion.p>

              <motion.div
                variants={fadeUp}
                custom={3}
                className="flex flex-col sm:flex-row items-center gap-3 justify-center lg:justify-start"
              >
                <Button
                  onClick={onGetStarted}
                  className="theme-btn-primary rounded-xl h-12 px-6 text-sm font-bold border-0 shadow-none gap-2.5 w-full sm:w-auto"
                >
                  Coba Gratis 6 Bulan
                  <ArrowRight className="size-4" />
                </Button>
                <Button
                  onClick={onGetStarted}
                  variant="outline"
                  className="rounded-xl h-12 px-6 text-sm font-medium border-white/[0.08] bg-transparent hover:bg-white/[0.04] hover:border-white/[0.12] w-full sm:w-auto"
                >
                  Daftar Sekarang
                </Button>
              </motion.div>
            </motion.div>

            {/* Dashboard preview */}
            <motion.div
              className="flex-1 w-full max-w-lg lg:max-w-none"
              initial={{ opacity: 0, y: 32, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              {/* Glow behind */}
              <div className="absolute inset-0 -z-10 blur-3xl opacity-30 aether-gradient rounded-full scale-75 translate-y-8" />
              <DashboardPreview />
            </motion.div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════
         SECTION 2: DIBANGUN DARI MASALAH NYATA
         ═══════════════════════════════════════════════════ */}
      <section className="py-24 sm:py-32">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={viewportConfig}
            variants={fadeUp}
          >
            <p className="text-overline text-slate-500 mb-3">Kenapa Aether?</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-16">
              Dibangun Dari Masalah Nyata
            </h2>
          </motion.div>

          <div className="flex flex-col md:flex-row items-center gap-10 md:gap-16">
            {/* Illustration */}
            <motion.div
              className="shrink-0 w-full md:w-auto"
              initial="hidden"
              whileInView="visible"
              viewport={viewportConfig}
              variants={fadeUp}
              custom={1}
            >
              <div className="aether-card rounded-2xl p-8 sm:p-10 flex items-center justify-center aspect-square max-w-[280px] mx-auto">
                <div className="relative">
                  <div className="aether-gradient-glow aether-gradient-border rounded-2xl p-6">
                    <div className="bg-nebula rounded-xl p-5 space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="size-3 rounded-full bg-aether-cyan/30" />
                        <div className="h-2.5 bg-white/[0.06] rounded w-24" />
                      </div>
                      <div className="h-2 bg-white/[0.04] rounded w-full" />
                      <div className="h-2 bg-white/[0.04] rounded w-3/4" />
                      <div className="grid grid-cols-2 gap-2 pt-2">
                        <div className="h-8 bg-aether-pink/10 rounded-lg" />
                        <div className="h-8 bg-aether-cyan/10 rounded-lg" />
                      </div>
                      <div className="h-2 bg-white/[0.04] rounded w-full" />
                      <div className="h-2 bg-white/[0.04] rounded w-5/6" />
                      <div className="h-8 aether-gradient rounded-lg opacity-30 mt-1" />
                    </div>
                  </div>
                  {/* Decorative dots */}
                  <div className="absolute -top-3 -right-3 size-6 rounded-full bg-aether-purple/20 blur-sm" />
                  <div className="absolute -bottom-2 -left-2 size-4 rounded-full bg-aether-cyan/20 blur-sm" />
                </div>
              </div>
            </motion.div>

            {/* Copy */}
            <motion.div
              className="flex-1 space-y-6"
              initial="hidden"
              whileInView="visible"
              viewport={viewportConfig}
              variants={staggerContainer}
            >
              <motion.p variants={fadeUp} className="text-lg text-slate-300 leading-relaxed">
                Sebagai kasir dan supervisor toko, saya tahu persis bagaimana rasanya:
              </motion.p>
              <motion.ul variants={staggerContainer} className="space-y-4">
                {[
                  "Stok tidak sinkron antara kasir dan gudang",
                  "Cetak barcode satu per satu, membuang waktu berjam-jam",
                  "Laporan harian berantakan di spreadsheet",
                ].map((item) => (
                  <motion.li
                    key={item}
                    variants={fadeUp}
                    className="flex items-start gap-3 text-slate-300"
                  >
                    <div className="mt-1.5 size-1.5 rounded-full bg-aether-cyan/60 shrink-0" />
                    {item}
                  </motion.li>
                ))}
              </motion.ul>
              <motion.p variants={fadeUp} className="text-base text-slate-500 leading-relaxed">
                Karena itu Aether dibangun dari pengalaman nyata di lapangan.
              </motion.p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════
         SECTION 3: FITUR YANG MENGHEMAT WAKTU
         ═══════════════════════════════════════════════════ */}
      <section id="features" className="py-24 sm:py-32">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <motion.div
            className="text-center mb-16"
            initial="hidden"
            whileInView="visible"
            viewport={viewportConfig}
            variants={fadeUp}
          >
            <p className="text-overline text-slate-500 mb-3">Fitur</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Fitur yang Menghemat Waktu
            </h2>
          </motion.div>

          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
            initial="hidden"
            whileInView="visible"
            viewport={viewportConfig}
            variants={staggerContainer}
          >
            {[
              {
                icon: Zap,
                title: "POS Cepat",
                desc: "Transaksi hanya beberapa klik. Scan barcode, pilih produk, bayar — selesai.",
                accent: "text-aether-cyan",
                bg: "bg-aether-cyan/10",
              },
              {
                icon: Package,
                title: "Inventory",
                desc: "Pantau stok real-time. Tahu kapan harus restock sebelum terlambat.",
                accent: "text-aether-purple",
                bg: "bg-aether-purple/10",
              },
              {
                icon: Printer,
                title: "Batch Barcode",
                desc: "Cetak puluhan label sekaligus. Hemat waktu, hindari human error.",
                accent: "text-aether-pink",
                bg: "bg-aether-pink/10",
              },
              {
                icon: BarChart3,
                title: "Analytics",
                desc: "Lihat produk terlaris, stock kritis, dan profit harian dalam satu dashboard.",
                accent: "text-aether-cyan",
                bg: "bg-aether-cyan/10",
              },
            ].map((feature) => (
              <motion.div
                key={feature.title}
                variants={fadeUp}
                className="aether-card touch-card rounded-xl p-6 transition-all duration-300 hover:border-white/[0.1] hover:translate-y-[-2px]"
              >
                <div className={cn("inline-flex p-2.5 rounded-lg mb-4", feature.bg)}>
                  <feature.icon className={cn("size-5", feature.accent)} />
                </div>
                <h3 className="text-base font-semibold text-slate-100 mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">{feature.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════
         SECTION 4: SEBELUM VS SESUDAH
         ═══════════════════════════════════════════════════ */}
      <section className="py-24 sm:py-32">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <motion.div
            className="text-center mb-16"
            initial="hidden"
            whileInView="visible"
            viewport={viewportConfig}
            variants={fadeUp}
          >
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Sebelum vs Sesudah
            </h2>
          </motion.div>

          <motion.div
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
            initial="hidden"
            whileInView="visible"
            viewport={viewportConfig}
            variants={staggerContainer}
          >
            {/* Sebelum */}
            <motion.div
              variants={fadeUp}
              className="aether-card rounded-xl p-6 sm:p-8 border-red-500/[0.08] hover:border-red-500/[0.15] transition-colors"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="size-9 rounded-full bg-red-500/10 flex items-center justify-center">
                  <AlertTriangle className="size-4 text-red-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-100">Sebelum</h3>
              </div>
              <ul className="space-y-4">
                {[
                  "Catatan stok berantakan",
                  "Salah hitung profit",
                  "Cetak barcode satu per satu",
                  "Laporan manual di spreadsheet",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm text-slate-400">
                    <X className="size-4 text-red-400/60 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>

            {/* Sesudah */}
            <motion.div
              variants={fadeUp}
              custom={1}
              className="aether-card rounded-xl p-6 sm:p-8 border-aether-cyan/[0.08] hover:border-aether-cyan/[0.15] transition-colors"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="size-9 rounded-full bg-aether-cyan/10 flex items-center justify-center">
                  <Check className="size-4 text-aether-cyan" />
                </div>
                <h3 className="text-lg font-semibold text-slate-100">Sesudah</h3>
              </div>
              <ul className="space-y-4">
                {[
                  "Semua transaksi tercatat otomatis",
                  "Profit terlihat jelas di dashboard",
                  "Barcode cetak massal dalam sekejap",
                  "Laporan real-time, kapan saja",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm text-slate-300">
                    <Check className="size-4 text-aether-cyan shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════
         SECTION 5: UNTUK SIAPA?
         ═══════════════════════════════════════════════════ */}
      <section className="py-24 sm:py-32">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <motion.div
            className="text-center mb-16"
            initial="hidden"
            whileInView="visible"
            viewport={viewportConfig}
            variants={fadeUp}
          >
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Untuk Siapa?
            </h2>
          </motion.div>

          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
            initial="hidden"
            whileInView="visible"
            viewport={viewportConfig}
            variants={staggerContainer}
          >
            {[
              {
                icon: Coffee,
                title: "Coffee Shop",
                desc: "Kasir cepat untuk antrian pagi yang ramai.",
                accent: "text-amber-400",
                bg: "bg-amber-400/10",
              },
              {
                icon: Store,
                title: "Retail Store",
                desc: "Kelola ribuan SKU dengan barcode scanner.",
                accent: "text-aether-cyan",
                bg: "bg-aether-cyan/10",
              },
              {
                icon: UtensilsCrossed,
                title: "F&B",
                desc: "Menu dinamis, split bill, dan tracking bahan baku.",
                accent: "text-aether-pink",
                bg: "bg-aether-pink/10",
              },
              {
                icon: TrendingUp,
                title: "UMKM",
                desc: "Mulai dari yang sederhana, tumbuh tanpa batas.",
                accent: "text-aether-purple",
                bg: "bg-aether-purple/10",
              },
            ].map((card) => (
              <motion.div
                key={card.title}
                variants={fadeUp}
                className="aether-card touch-card rounded-xl p-6 text-center transition-all duration-300 hover:border-white/[0.1]"
              >
                <div
                  className={cn(
                    "inline-flex p-2.5 rounded-lg mb-4",
                    card.bg
                  )}
                >
                  <card.icon className={cn("size-5", card.accent)} />
                </div>
                <h3 className="text-base font-semibold text-slate-100 mb-2">
                  {card.title}
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">{card.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════
         SECTION 6: SCREENSHOT HALAMAN
         ═══════════════════════════════════════════════════ */}
      <section className="py-24 sm:py-32">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <motion.div
            className="text-center mb-16"
            initial="hidden"
            whileInView="visible"
            viewport={viewportConfig}
            variants={fadeUp}
          >
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
              Tampilan Aplikasi
            </h2>
            <p className="text-sm text-slate-500">
              Bukan mockup. Ini tampilan asli Aether.
            </p>
          </motion.div>

          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
            initial="hidden"
            whileInView="visible"
            viewport={viewportConfig}
            variants={staggerContainer}
          >
            {[
              { label: "Dashboard", variant: "dashboard" as const },
              { label: "POS Terminal", variant: "pos" as const },
              { label: "Manajemen Produk", variant: "products" as const },
              { label: "Batch Barcode", variant: "barcode" as const },
            ].map((shot) => (
              <motion.div key={shot.label} variants={fadeUp}>
                <ScreenshotPlaceholder label={shot.label} variant={shot.variant} />
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════
         SECTION 7: PRICING TABLE
         ═══════════════════════════════════════════════════ */}
      <section id="pricing" className="py-24 sm:py-32">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <motion.div
            className="text-center mb-4"
            initial="hidden"
            whileInView="visible"
            viewport={viewportConfig}
            variants={fadeUp}
          >
            <p className="text-overline text-slate-500 mb-3">Harga</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Pricing
            </h2>
          </motion.div>
          <motion.p
            className="text-center text-sm text-aether-cyan mb-16"
            initial="hidden"
            whileInView="visible"
            viewport={viewportConfig}
            variants={fadeUp}
            custom={1}
          >
            Free 6 Bulan untuk Plan Enterprise
          </motion.p>

          <motion.div
            className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start"
            initial="hidden"
            whileInView="visible"
            viewport={viewportConfig}
            variants={staggerContainer}
          >
            {/* FREE */}
            <motion.div variants={fadeUp} className="aether-card rounded-xl p-6 sm:p-8">
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-slate-100 mb-1">Free</h3>
                <p className="text-3xl font-bold text-slate-100">Gratis</p>
              </div>
              <ul className="space-y-3 mb-8">
                {[
                  "50 Produk, 5 Kategori",
                  "2 Crew",
                  "100 Customer, Loyalty",
                  "500 Transaksi/bulan",
                  "POS Offline",
                  "Dashboard Analytics",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-slate-400">
                    <Check className="size-3.5 text-aether-cyan shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                onClick={onGetStarted}
                variant="outline"
                className="w-full rounded-xl h-10 border-white/[0.08] bg-transparent hover:bg-white/[0.04] text-sm font-medium"
              >
                Mulai Gratis
              </Button>
            </motion.div>

            {/* PRO */}
            <motion.div variants={fadeUp} custom={1} className="aether-card rounded-xl p-6 sm:p-8">
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-slate-100 mb-1">Pro</h3>
                <p className="text-3xl font-bold text-slate-100">Coming Soon</p>
              </div>
              <ul className="space-y-3 mb-8">
                {[
                  "Unlimited Produk & Kategori",
                  "Unlimited Crew + Permissions",
                  "Unlimited Customer",
                  "Unlimited Transaksi",
                  "Semua fitur Free +",
                  "AI Insights & Forecasting",
                  "Bulk Upload Excel",
                  "Priority Support",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-slate-400">
                    <Check className="size-3.5 text-aether-cyan shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                disabled
                className="w-full rounded-xl h-10 bg-white/[0.04] text-slate-500 text-sm font-medium border-0 cursor-not-allowed"
              >
                Segera Hadir
              </Button>
            </motion.div>

            {/* ENTERPRISE */}
            <motion.div variants={fadeUp} custom={2} className="relative">
              <div className="aether-card aether-gradient-border rounded-xl p-6 sm:p-8 relative overflow-hidden">
                {/* Badge */}
                <div className="absolute top-4 right-4">
                  <span className="aether-gradient text-[10px] font-bold uppercase tracking-wider text-white px-2.5 py-1 rounded-full">
                    Gratis 6 Bulan
                  </span>
                </div>
                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-slate-100 mb-1">Enterprise</h3>
                  <p className="text-3xl font-bold text-slate-100">Kontak Kami</p>
                </div>
                <ul className="space-y-3 mb-8">
                  {[
                    "Everything in Pro +",
                    "Multi-Outlet",
                    "Transaction Summary",
                    "API Access",
                  ].map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm text-slate-300">
                      <Check className="size-3.5 text-aether-cyan shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  onClick={onGetStarted}
                  className="theme-btn-primary w-full rounded-xl h-10 border-0 text-sm font-bold shadow-none"
                >
                  Hubungi Kami
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════
         SECTION 8: FOUNDER STORY
         ═══════════════════════════════════════════════════ */}
      <section id="founder" className="py-24 sm:py-32">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={viewportConfig}
            variants={staggerContainer}
          >
            <motion.p
              variants={fadeUp}
              className="text-overline text-slate-500 mb-12"
            >
              Dari Lantai Toko
            </motion.p>

            {/* Avatar / icon */}
            <motion.div variants={fadeUp} custom={1} className="mb-10 flex justify-center">
              <div className="relative">
                <div className="aether-gradient-border size-20 rounded-full">
                  <div className="w-full h-full rounded-full bg-nebula flex items-center justify-center">
                    <Sparkles className="size-8 text-aether-purple" />
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Quote lines */}
            <motion.div variants={staggerContainer} className="space-y-4">
              <motion.p
                variants={fadeUp}
                custom={2}
                className="text-xl sm:text-2xl font-semibold text-slate-200 leading-relaxed"
              >
                &ldquo;Saya bukan software engineer.&rdquo;
              </motion.p>
              <motion.p
                variants={fadeUp}
                custom={3}
                className="text-xl sm:text-2xl font-semibold text-slate-200 leading-relaxed"
              >
                &ldquo;Saya berasal dari lantai toko sebagai{" "}
                <span className="aether-gradient-text">Kasir Ritel</span>.&rdquo;
              </motion.p>
              <motion.p
                variants={fadeUp}
                custom={4}
                className="text-base sm:text-lg text-slate-400 leading-relaxed pt-2"
              >
                &ldquo;Aether lahir dari masalah yang saya alami sendiri setiap hari.&rdquo;
              </motion.p>
            </motion.div>

            {/* Decorative gradient line */}
            <motion.div
              variants={fadeUp}
              custom={5}
              className="mt-12 flex justify-center"
            >
              <div className="h-px w-32 aether-gradient opacity-40" />
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════
         FOOTER
         ═══════════════════════════════════════════════════ */}
      <footer className="border-t border-white/[0.04] py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Aether" className="h-5 w-auto opacity-60" />
            <span className="text-xs text-slate-500">
              &copy; 2025 Aether POS. Dibangun di Indonesia.
            </span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => scrollTo("features")}
              className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
            >
              Fitur
            </button>
            <button
              onClick={() => scrollTo("pricing")}
              className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
            >
              Harga
            </button>
            <button
              onClick={() => scrollTo("founder")}
              className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
            >
              Tentang
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}