'use client'

import { useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { Eye, EyeOff, Mail, Lock, User, ArrowRight, Loader2 } from 'lucide-react'

/* ------------------------------------------------------------------ */
/*  Animation variants                                                  */
/* ------------------------------------------------------------------ */
const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94], delay: i * 0.08 },
  }),
}

const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.6 } },
}

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 40 : -40,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 40 : -40,
    opacity: 0,
  }),
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                      */
/* ------------------------------------------------------------------ */
export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  // Login form
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  // Register form
  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regConfirm, setRegConfirm] = useState('')

  const [slideDir, setSlideDir] = useState(0)

  const toggleMode = () => {
    setSlideDir(isLogin ? -1 : 1)
    setIsLogin(!isLogin)
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!loginEmail || !loginPassword) {
      toast.error('Mohon isi semua field')
      return
    }
    setLoading(true)
    // Simulate login
    setTimeout(() => {
      toast.success('Login berhasil! Mengalihkan ke dashboard...')
      setLoading(false)
    }, 1500)
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!regName || !regEmail || !regPassword || !regConfirm) {
      toast.error('Mohon isi semua field')
      return
    }
    if (regPassword !== regConfirm) {
      toast.error('Password tidak cocok')
      return
    }
    if (regPassword.length < 8) {
      toast.error('Password minimal 8 karakter')
      return
    }
    setLoading(true)
    // Simulate register
    setTimeout(() => {
      toast.success('Akun berhasil dibuat! Silakan login.')
      setSlideDir(-1)
      setIsLogin(true)
      setLoginEmail(regEmail)
      setLoginPassword('')
      setRegName('')
      setRegEmail('')
      setRegPassword('')
      setRegConfirm('')
      setLoading(false)
    }, 1500)
  }

  const features = [
    'POS Terminal modern & cepat',
    'Manajemen stok otomatis',
    'Laporan real-time',
  ]

  return (
    <div className="min-h-screen flex bg-[#020617] font-[family-name:var(--font-geist-mono)]">
      {/* ============================================================ */}
      {/*  LEFT PANEL — Branding (desktop only)                        */}
      {/* ============================================================ */}
      <section
        className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col justify-center px-16 xl:px-24"
        aria-label="Brand introduction"
      >
        <motion.div
          variants={fadeIn}
          initial="hidden"
          animate="visible"
          className="pointer-events-none absolute -top-24 -right-24 h-[480px] w-[480px] rounded-full bg-gradient-to-br from-pink-500/30 via-violet-500/20 to-cyan-500/10 blur-[100px]"
          aria-hidden="true"
        />
        <motion.div
          variants={fadeIn}
          initial="hidden"
          animate="visible"
          transition={{ delay: 0.3 }}
          className="pointer-events-none absolute -bottom-32 -left-16 h-[360px] w-[360px] rounded-full bg-gradient-to-tr from-cyan-500/15 via-violet-500/10 to-transparent blur-[80px]"
          aria-hidden="true"
        />

        <div className="relative z-10 max-w-lg">
          <motion.div variants={fadeInUp} custom={0} initial="hidden" animate="visible">
            <Link href="/" className="inline-flex items-center gap-3 mb-10">
              <img src="/logo.png" alt="Aether" className="h-10 w-10 rounded-xl ring-1 ring-white/10" />
            </Link>
          </motion.div>

          <motion.h1
            variants={fadeInUp} custom={1} initial="hidden" animate="visible"
            className="text-5xl xl:text-6xl font-bold leading-[1.1] tracking-tight font-[family-name:var(--font-geist-sans)] text-white"
          >
            {isLogin ? (
              <>
                Selamat{' '}
                <span className="bg-gradient-to-r from-pink-500 via-violet-500 to-cyan-500 bg-clip-text text-transparent">
                  Datang
                </span>
              </>
            ) : (
              <>
                Buat{' '}
                <span className="bg-gradient-to-r from-pink-500 via-violet-500 to-cyan-500 bg-clip-text text-transparent">
                  Akun
                </span>
              </>
            )}
          </motion.h1>

          <motion.p
            variants={fadeInUp} custom={2} initial="hidden" animate="visible"
            className="mt-6 text-lg leading-relaxed text-slate-400 font-[family-name:var(--font-geist-mono)]"
          >
            {isLogin
              ? 'Masuk ke dashboard Aether untuk mulai kelola tokomu'
              : 'Daftar gratis dan mulai kelola tokomu sekarang'}
          </motion.p>

          <motion.div
            variants={fadeInUp} custom={3} initial="hidden" animate="visible"
            className="mt-10 flex flex-col gap-4"
          >
            {features.map((text) => (
              <div key={text} className="flex items-center gap-3 text-sm text-slate-300">
                <div className="flex h-2 w-2 shrink-0 rounded-full bg-gradient-to-r from-pink-500 via-violet-500 to-cyan-500" />
                {text}
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ============================================================ */}
      {/*  RIGHT PANEL — Form                                           */}
      {/* ============================================================ */}
      <section className="w-full lg:w-1/2 flex items-center justify-center px-4 py-12 sm:px-8 lg:px-12">
        {/* Mobile bg glow */}
        <div className="pointer-events-none fixed inset-0 lg:hidden overflow-hidden" aria-hidden="true">
          <div className="absolute -top-32 -right-32 h-[300px] w-[300px] rounded-full bg-gradient-to-br from-pink-500/20 via-violet-500/15 to-cyan-500/10 blur-[80px]" />
          <div className="absolute -bottom-24 -left-24 h-[240px] w-[240px] rounded-full bg-gradient-to-tr from-cyan-500/10 via-violet-500/10 to-transparent blur-[60px]" />
        </div>

        <motion.div
          variants={fadeInUp} custom={0} initial="hidden" animate="visible"
          className="relative z-10 w-full max-w-md"
        >
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8 shadow-2xl shadow-black/40 backdrop-blur-sm">
            {/* Mobile logo */}
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <Link href="/" className="inline-flex items-center gap-3">
                <img src="/logo.png" alt="Aether" className="h-10 w-10 rounded-xl ring-1 ring-white/10" />
              </Link>
            </div>

            {/* Title with animated transition */}
            <div className="relative min-h-[80px] overflow-hidden">
              <AnimatePresence mode="wait" custom={slideDir}>
                <motion.div
                  key={isLogin ? 'login-title' : 'register-title'}
                  custom={slideDir}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                  className="absolute inset-0"
                >
                  <h2 className="text-2xl font-semibold tracking-tight font-[family-name:var(--font-geist-sans)] text-white">
                    {isLogin ? 'Masuk ke Aether' : 'Daftar Akun Baru'}
                  </h2>
                  <p className="mt-2 text-sm text-slate-400">
                    {isLogin
                      ? 'Masukkan email dan password untuk melanjutkan'
                      : 'Isi data dirimu untuk membuat akun'}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Form with animated transition */}
            <div className="relative min-h-[280px] overflow-hidden">
              <AnimatePresence mode="wait" custom={slideDir}>
                <motion.div
                  key={isLogin ? 'login-form' : 'register-form'}
                  custom={slideDir}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                  className="absolute inset-0"
                >
                  {/* ========== LOGIN FORM ========== */}
                  {isLogin ? (
                    <form onSubmit={handleLogin} className="flex flex-col gap-4 mt-6">
                      {/* Email */}
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                        <input
                          type="email"
                          placeholder="Email"
                          value={loginEmail}
                          onChange={(e) => setLoginEmail(e.target.value)}
                          className="h-12 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30"
                          autoComplete="email"
                        />
                      </div>

                      {/* Password */}
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="Password"
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          className="h-12 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-10 pr-11 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30"
                          autoComplete="current-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                          tabIndex={-1}
                          aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>

                      {/* Forgot password */}
                      <div className="flex justify-end">
                        <button type="button" className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                          Lupa password?
                        </button>
                      </div>

                      {/* Submit */}
                      <button
                        type="submit"
                        disabled={loading}
                        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-500 via-violet-500 to-cyan-500 px-4 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-all hover:shadow-violet-500/40 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {loading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            Masuk
                            <ArrowRight className="h-4 w-4" />
                          </>
                        )}
                      </button>
                    </form>
                  ) : (
                    /* ========== REGISTER FORM ========== */
                    <form onSubmit={handleRegister} className="flex flex-col gap-4 mt-6">
                      {/* Name */}
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                        <input
                          type="text"
                          placeholder="Nama Lengkap"
                          value={regName}
                          onChange={(e) => setRegName(e.target.value)}
                          className="h-12 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30"
                          autoComplete="name"
                        />
                      </div>

                      {/* Email */}
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                        <input
                          type="email"
                          placeholder="Email"
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          className="h-12 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30"
                          autoComplete="email"
                        />
                      </div>

                      {/* Password */}
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="Password (min. 8 karakter)"
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          className="h-12 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-10 pr-11 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30"
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                          tabIndex={-1}
                          aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>

                      {/* Confirm Password */}
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="Konfirmasi Password"
                          value={regConfirm}
                          onChange={(e) => setRegConfirm(e.target.value)}
                          className="h-12 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition-all focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30"
                          autoComplete="new-password"
                        />
                      </div>

                      {/* Submit */}
                      <button
                        type="submit"
                        disabled={loading}
                        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-500 via-violet-500 to-cyan-500 px-4 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-all hover:shadow-violet-500/40 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {loading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            Daftar
                            <ArrowRight className="h-4 w-4" />
                          </>
                        )}
                      </button>
                    </form>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Toggle Login / Register */}
            <motion.div
              variants={fadeInUp} custom={5} initial="hidden" animate="visible"
              className="mt-6 text-center"
            >
              <p className="text-sm text-slate-400">
                {isLogin ? 'Belum punya akun?' : 'Sudah punya akun?'}{' '}
                <button
                  onClick={toggleMode}
                  className="font-medium text-violet-400 hover:text-violet-300 transition-colors underline underline-offset-2 decoration-violet-500/30 hover:decoration-violet-500/60"
                >
                  {isLogin ? 'Daftar sekarang' : 'Masuk'}
                </button>
              </p>
            </motion.div>
          </div>

          {/* Bottom fine print */}
          <motion.p
            variants={fadeIn} initial="hidden" animate="visible" transition={{ delay: 0.5 }}
            className="mt-6 text-center text-xs text-slate-600"
          >
            Dengan melanjutkan, Anda menyetujui{' '}
            <Link href="#" className="text-slate-500 underline underline-offset-2 hover:text-slate-400">
              Syarat Layanan
            </Link>{' '}
            &{' '}
            <Link href="#" className="text-slate-500 underline underline-offset-2 hover:text-slate-400">
              Kebijakan Privasi
            </Link>{' '}
            kami.
          </motion.p>
        </motion.div>
      </section>
    </div>
  )
}
