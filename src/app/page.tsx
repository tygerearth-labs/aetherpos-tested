'use client'

import { motion } from 'framer-motion'
import {
  Monitor,
  Zap,
  Package,
  Printer,
  BarChart3,
  ReceiptText,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Menu,
  X,
  Flame,
} from 'lucide-react'
import { useState, useEffect } from 'react'

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-100px' },
  transition: { duration: 0.6, ease: 'easeOut' },
}

const staggerContainer = {
  initial: {},
  whileInView: { transition: { staggerChildren: 0.12 } },
  viewport: { once: true, margin: '-80px' },
}

const staggerChild = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  transition: { duration: 0.5, ease: 'easeOut' },
}

/* ───────────── gradient text helper ───────────── */
function GradientText({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`bg-gradient-to-r from-pink-500 via-violet-500 to-cyan-500 bg-clip-text text-transparent ${className}`}
    >
      {children}
    </span>
  )
}

/* ──────────────────────── NAVBAR ──────────────────────── */
function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const links = [
    { label: 'Fitur', href: '#fitur' },
    { label: 'Harga', href: '#harga' },
    { label: 'Masuk', href: '/login' },
  ]

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-[#020617]/80 backdrop-blur-xl border-b border-white/[0.06]' : ''
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <a href="#" className="flex items-center gap-2.5">
          <img src="/logo.png" alt="Aether" className="h-8 w-8 rounded-lg" />
          <span className="text-lg font-bold tracking-tight text-white">AETHER</span>
        </a>

        {/* Desktop links */}
        <div className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="text-sm font-medium text-slate-300 transition-colors hover:text-white"
            >
              {l.label}
            </a>
          ))}
          <a
            href="/login"
            className="rounded-full bg-gradient-to-r from-pink-500 via-violet-500 to-cyan-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-all hover:shadow-violet-500/40 hover:brightness-110"
          >
            Mulai Gratis
          </a>
        </div>

        {/* Mobile toggle */}
        <button
          className="text-white md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-6 w-6" strokeWidth={1.5} /> : <Menu className="h-6 w-6" strokeWidth={1.5} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-b border-white/[0.06] bg-[#020617]/95 backdrop-blur-xl md:hidden"
        >
          <div className="flex flex-col gap-4 px-6 py-6">
            {links.map((l) => (
              <a
                key={l.label}
                href={l.href}
                onClick={() => setMobileOpen(false)}
                className="text-sm font-medium text-slate-300 transition-colors hover:text-white"
              >
                {l.label}
              </a>
            ))}
            <a
              href="/login"
              onClick={() => setMobileOpen(false)}
              className="inline-flex justify-center rounded-full bg-gradient-to-r from-pink-500 via-violet-500 to-cyan-500 px-5 py-2.5 text-sm font-semibold text-white"
            >
              Mulai Gratis
            </a>
          </div>
        </motion.div>
      )}
    </nav>
  )
}

/* ──────────────────────── HERO ──────────────────────── */
function Hero() {
  return (
    <section className="relative flex min-h-screen items-center overflow-hidden pt-16">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 top-1/4 h-[500px] w-[500px] rounded-full bg-pink-500/[0.07] blur-3xl" />
        <div className="absolute left-1/3 top-1/3 h-[400px] w-[400px] rounded-full bg-violet-500/[0.07] blur-3xl" />
        <div className="absolute -right-20 top-1/2 h-[350px] w-[350px] rounded-full bg-cyan-500/[0.06] blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center text-center">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-1.5 text-sm text-slate-300 backdrop-blur-sm"
          >
            <Flame className="h-4 w-4 text-pink-500" />
            <span>Baru — Fitur Laporan Real-Time sudah hadir</span>
          </motion.div>

          {/* Heading */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="max-w-4xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl md:text-6xl lg:text-7xl"
          >
            Kelola Toko Lebih Cepat.{' '}
            <GradientText>Tumbuh Lebih Pasti.</GradientText>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-400 sm:text-xl"
          >
            Platform POS modern untuk coffee shop, retail, dan UMKM Indonesia.
            Stok, transaksi, pelanggan — semua dalam satu dashboard.
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-10 flex flex-col gap-4 sm:flex-row"
          >
            <a
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-pink-500 via-violet-500 to-cyan-500 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-all hover:shadow-violet-500/40 hover:brightness-110 active:scale-[0.98]"
            >
              Mulai Gratis
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="#fitur"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-8 py-3.5 text-sm font-medium text-slate-300 transition-all hover:bg-white/[0.06] hover:text-white hover:border-white/[0.12]"
            >
              Lihat Fitur
            </a>
          </motion.div>

          {/* Trust badges */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="mt-16 flex flex-wrap items-center justify-center gap-8 text-sm text-slate-500"
          >
            <span>✓ Gratis 14 hari</span>
            <span>✓ Tanpa kartu kredit</span>
            <span>✓ Setup 5 menit</span>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

/* ──────────────────────── FEATURES ──────────────────────── */
function Features() {
  const features = [
    {
      icon: Monitor,
      title: 'POS Terminal',
      desc: 'Antarmuka kasir yang cepat dan intuitif. Proses transaksi dalam hitungan detik.',
    },
    {
      icon: Package,
      title: 'Manajemen Stok',
      desc: 'Tracking stok real-time otomatis. Alert saat produk mendekati habis.',
    },
    {
      icon: BarChart3,
      title: 'Laporan & Analitik',
      desc: 'Dashboard interaktif dengan grafik penjualan, profit, dan tren bisnis.',
    },
    {
      icon: ReceiptText,
      title: 'Manajemen Pesanan',
      desc: 'Kelola pesanan dari satu tempat. Print struk otomatis untuk pelanggan.',
    },
    {
      icon: Printer,
      title: 'Print Struk',
      desc: 'Koneksi langsung ke printer thermal. Cetak struk instan tanpa konfigurasi rumit.',
    },
    {
      icon: Zap,
      title: 'Performa Cepat',
      desc: 'Dibangun untuk kecepatan. Loading instan bahkan di koneksi lambat.',
    },
  ]

  return (
    <section id="fitur" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <motion.div {...fadeInUp} className="text-center">
          <p className="text-sm font-medium uppercase tracking-widest text-violet-400">Fitur</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Semua yang Kamu Butuhkan,{' '}
            <GradientText>Dalam Satu Platform</GradientText>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-400">
            Dari kasir hingga laporan — AETHER menyediakan tools lengkap untuk mengelola bisnis UMKM kamu.
          </p>
        </motion.div>

        {/* Feature grid */}
        <motion.div
          {...staggerContainer}
          className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {features.map((f) => (
            <motion.div
              key={f.title}
              {...staggerChild}
              className="group relative rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 transition-all duration-300 hover:border-white/[0.12] hover:bg-white/[0.04]"
            >
              <div className="mb-4 inline-flex rounded-xl bg-gradient-to-br from-pink-500/10 via-violet-500/10 to-cyan-500/10 p-3">
                <f.icon className="h-6 w-6 text-violet-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}

/* ──────────────────────── PRICING ──────────────────────── */
function Pricing() {
  const plans = [
    {
      name: 'Starter',
      price: 'Gratis',
      period: '',
      desc: 'Untuk bisnis yang baru mulai',
      features: [
        { text: '1 Outlet', included: true },
        { text: '50 Produk', included: true },
        { text: 'Laporan dasar', included: true },
        { text: 'Print struk', included: true },
        { text: 'Multi-user', included: false },
        { text: 'API Access', included: false },
      ],
      cta: 'Mulai Gratis',
      highlight: false,
    },
    {
      name: 'Pro',
      price: 'Rp 99K',
      period: '/bulan',
      desc: 'Untuk bisnis yang berkembang',
      features: [
        { text: '5 Outlet', included: true },
        { text: 'Unlimited Produk', included: true },
        { text: 'Laporan lengkap', included: true },
        { text: 'Print struk', included: true },
        { text: 'Multi-user (5)', included: true },
        { text: 'API Access', included: false },
      ],
      cta: 'Coba 14 Hari',
      highlight: true,
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      period: '',
      desc: 'Untuk bisnis besar & franchise',
      features: [
        { text: 'Unlimited Outlet', included: true },
        { text: 'Unlimited Produk', included: true },
        { text: 'Laporan lengkap', included: true },
        { text: 'Print struk', included: true },
        { text: 'Unlimited Users', included: true },
        { text: 'API Access', included: true },
      ],
      cta: 'Hubungi Kami',
      highlight: false,
    },
  ]

  return (
    <section id="harga" className="relative py-24 sm:py-32">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute right-0 top-1/3 h-[400px] w-[400px] rounded-full bg-violet-500/[0.05] blur-3xl" />
        <div className="absolute left-0 bottom-1/3 h-[300px] w-[300px] rounded-full bg-cyan-500/[0.04] blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <motion.div {...fadeInUp} className="text-center">
          <p className="text-sm font-medium uppercase tracking-widest text-violet-400">Harga</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Harga yang <GradientText>Transparan</GradientText>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-400">
            Mulai gratis, upgrade kapan saja. Tanpa biaya tersembunyi.
          </p>
        </motion.div>

        {/* Pricing cards */}
        <motion.div
          {...staggerContainer}
          className="mt-16 grid gap-6 lg:grid-cols-3"
        >
          {plans.map((plan) => (
            <motion.div
              key={plan.name}
              {...staggerChild}
              className={`relative rounded-2xl border p-8 transition-all duration-300 ${
                plan.highlight
                  ? 'border-violet-500/30 bg-gradient-to-b from-violet-500/[0.08] to-transparent shadow-xl shadow-violet-500/10'
                  : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'
              }`}
            >
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-pink-500 via-violet-500 to-cyan-500 px-4 py-1 text-xs font-semibold text-white">
                  Populer
                </div>
              )}

              <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
              <p className="mt-1 text-sm text-slate-400">{plan.desc}</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-bold text-white">{plan.price}</span>
                {plan.period && <span className="text-sm text-slate-400">{plan.period}</span>}
              </div>

              <ul className="mt-8 flex flex-col gap-3">
                {plan.features.map((f) => (
                  <li key={f.text} className="flex items-center gap-3 text-sm">
                    {f.included ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    ) : (
                      <XCircle className="h-4 w-4 shrink-0 text-slate-600" />
                    )}
                    <span className={f.included ? 'text-slate-300' : 'text-slate-600'}>{f.text}</span>
                  </li>
                ))}
              </ul>

              <a
                href="/login"
                className={`mt-8 flex h-12 w-full items-center justify-center rounded-xl text-sm font-semibold transition-all active:scale-[0.98] ${
                  plan.highlight
                    ? 'bg-gradient-to-r from-pink-500 via-violet-500 to-cyan-500 text-white shadow-lg shadow-violet-500/20 hover:shadow-violet-500/40 hover:brightness-110'
                    : 'border border-white/[0.08] bg-white/[0.03] text-slate-300 hover:bg-white/[0.06] hover:text-white hover:border-white/[0.12]'
                }`}
              >
                {plan.cta}
              </a>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}

/* ──────────────────────── FOUNDER ──────────────────────── */
function FounderSection() {
  return (
    <section className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          {...fadeInUp}
          className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-white/[0.02] p-8 sm:p-12 lg:p-16"
        >
          {/* Background glow */}
          <div className="pointer-events-none absolute -right-20 -top-20 h-[300px] w-[300px] rounded-full bg-pink-500/[0.08] blur-3xl" />
          <div className="pointer-events-none absolute -left-20 -bottom-20 h-[250px] w-[250px] rounded-full bg-cyan-500/[0.06] blur-3xl" />

          <div className="relative flex flex-col items-center gap-8 text-center lg:flex-row lg:text-left">
            <motion.div {...fadeInUp} className="shrink-0">
              <img
                src="/founder.png"
                alt="Founder AETHER"
                className="h-32 w-32 rounded-2xl border border-white/[0.08] object-cover shadow-lg sm:h-40 sm:w-40 lg:h-48 lg:w-48"
              />
            </motion.div>

            <div>
              <motion.p {...fadeInUp} className="text-sm font-medium uppercase tracking-widest text-violet-400">
                Dari Founder
              </motion.p>
              <motion.h2 {...fadeInUp} className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
                &ldquo;AETHER lahir dari <GradientText>pengalaman nyata</GradientText> mengelola UMKM.&rdquo;
              </motion.h2>
              <motion.p {...fadeInUp} className="mt-4 max-w-2xl text-base leading-relaxed text-slate-400 sm:text-lg">
                Saya pernah merasakan betapa ribetnya mengelola stok manual, mencatat transaksi di buku tulis,
                dan kehilangan data penting. AETHER dibangun agar pengusaha kecil bisa fokus bertumbuh — 
                bukan sibuk operasional.
              </motion.p>
              <motion.div {...fadeInUp} className="mt-6 flex items-center gap-3">
                <div className="h-px flex-1 max-w-12 bg-gradient-to-r from-violet-500/50 to-transparent lg:max-w-8" />
                <span className="text-sm font-medium text-slate-300">Founder & CEO, AETHER</span>
              </motion.div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

/* ──────────────────────── CTA ──────────────────────── */
function CTASection() {
  return (
    <section className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          {...fadeInUp}
          className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-gradient-to-b from-violet-500/[0.08] via-pink-500/[0.05] to-cyan-500/[0.05] p-12 text-center sm:p-16 lg:p-20"
        >
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute left-1/4 top-0 h-[200px] w-[200px] rounded-full bg-pink-500/10 blur-3xl" />
            <div className="absolute right-1/4 bottom-0 h-[200px] w-[200px] rounded-full bg-cyan-500/10 blur-3xl" />
          </div>

          <div className="relative">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              Siap <GradientText>Mengelola Toko</GradientText> dengan Lebih Baik?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-slate-400">
              Bergabung dengan ribuan UMKM Indonesia yang sudah mempercayakan operasional toko mereka kepada AETHER.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <a
                href="/login"
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-pink-500 via-violet-500 to-cyan-500 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-all hover:shadow-violet-500/40 hover:brightness-110 active:scale-[0.98]"
              >
                Mulai Gratis Sekarang
                <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href="#harga"
                className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-8 py-3.5 text-sm font-medium text-slate-300 transition-all hover:bg-white/[0.06] hover:text-white"
              >
                Lihat Harga
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

/* ──────────────────────── FOOTER ──────────────────────── */
function Footer() {
  const footerLinks = [
    { label: 'Tentang', href: '#' },
    { label: 'Blog', href: '#' },
    { label: 'Karir', href: '#' },
    { label: 'Support', href: '#' },
    { label: 'Kebijakan Privasi', href: '#' },
    { label: 'Syarat Layanan', href: '#' },
  ]

  return (
    <footer className="border-t border-white/[0.06] bg-[#020617]">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-8 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Aether" className="h-7 w-7 rounded-lg" />
            <span className="text-base font-bold tracking-tight text-white">AETHER</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {footerLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-sm text-slate-500 transition-colors hover:text-slate-300"
              >
                {link.label}
              </a>
            ))}
          </div>

          <p className="text-sm text-slate-600">
            © 2025 AETHER. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}

/* ──────────────────────── PAGE ──────────────────────── */
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#020617] text-white">
      <Navbar />
      <Hero />
      <Features />
      <Pricing />
      <FounderSection />
      <CTASection />
      <Footer />
    </div>
  )
}
