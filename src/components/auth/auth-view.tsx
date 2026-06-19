'use client'

import { useState, useMemo } from 'react'
import { signIn } from 'next-auth/react'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Store,
  Loader2,
  Crown,
  Zap,
  Shield,
  BarChart3,
  Smartphone,
  ArrowRight,
  Users,
  Receipt,
  Lock,
  Check,
  X,
  Eye,
  EyeOff,
  UserPlus,
  ChevronRight,
} from 'lucide-react'

/* ─── Feature badges (desktop left side) ─── */
const featureBadges = [
  { icon: Zap, label: 'Transaksi Cepat' },
  { icon: BarChart3, label: 'Laporan Real-time' },
  { icon: Shield, label: 'Data Aman' },
  { icon: Smartphone, label: 'Multi-Platform' },
]

/* ─── Animation variants ─── */
const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: [0.25, 0.4, 0.25, 1] },
  }),
}

const cardEntrance = {
  hidden: { opacity: 0, y: 24, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.6, ease: [0.25, 0.4, 0.25, 1] },
  },
}

const formVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 60 : -60,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.35, ease: [0.25, 0.4, 0.25, 1] },
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -60 : 60,
    opacity: 0,
    transition: { duration: 0.25, ease: [0.25, 0.4, 0.25, 1] },
  }),
}

const badgeFadeUp = {
  hidden: { opacity: 0, x: -16, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    y: 0,
    transition: {
      delay: 0.4 + i * 0.12,
      duration: 0.5,
      ease: [0.25, 0.4, 0.25, 1],
    },
  }),
}

/* ─── Input classes ─── */
const inputClasses =
  'bg-zinc-800/50 border-zinc-700/50 text-zinc-100 placeholder:text-zinc-500 h-12 text-sm rounded-xl focus-visible:theme-ring focus-visible:theme-border transition-all duration-200'

/* ─── Password strength checker ─── */
const getPasswordStrength = (password: string) => {
  if (!password) return { score: 0, label: '', color: '', textColor: '', checks: [] }
  const checks = [
    { label: 'Minimal 8 karakter', met: password.length >= 8 },
    { label: 'Huruf besar (A-Z)', met: /[A-Z]/.test(password) },
    { label: 'Huruf kecil (a-z)', met: /[a-z]/.test(password) },
    { label: 'Angka (0-9)', met: /[0-9]/.test(password) },
    { label: 'Simbol (!@#$...)', met: /[^A-Za-z0-9]/.test(password) },
  ]
  const score = checks.filter(c => c.met).length
  if (score <= 1) return { score, label: 'Sangat Lemah', color: 'bg-red-500', textColor: 'text-red-400', checks }
  if (score === 2) return { score, label: 'Lemah', color: 'bg-orange-500', textColor: 'text-orange-400', checks }
  if (score === 3) return { score, label: 'Cukup', color: 'bg-amber-500', textColor: 'text-amber-400', checks }
  if (score === 4) return { score, label: 'Kuat', color: 'theme-bg-light', textColor: 'theme-text', checks }
  return { score, label: 'Sangat Kuat', color: 'theme-bg', textColor: 'theme-text', checks }
}

export default function AuthView() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [loading, setLoading] = useState(false)

  // Login form state
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  // Register form state
  const [regOutletName, setRegOutletName] = useState('')
  const [regOwnerName, setRegOwnerName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [showRegPassword, setShowRegPassword] = useState(false)

  const [direction, setDirection] = useState(0)

  const passwordStrength = useMemo(() => getPasswordStrength(regPassword), [regPassword])

  const toggleMode = () => {
    const newDirection = mode === 'login' ? 1 : -1
    setDirection(newDirection)
    setMode(mode === 'login' ? 'register' : 'login')
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await signIn('credentials', {
        email: loginEmail,
        password: loginPassword,
        redirect: false,
      })
      if (result?.error) {
        toast.error(result.error)
      } else {
        toast.success('Login successful')
      }
    } catch {
      toast.error('Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!regOutletName || !regOwnerName || !regEmail || !regPassword) {
      toast.error('Semua field wajib diisi')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outletName: regOutletName,
          ownerName: regOwnerName,
          email: regEmail,
          password: regPassword,
          accountType: 'free',
        }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success('Registrasi berhasil! Silakan masuk.')
        setMode('login')
        setLoginEmail(regEmail)
        setLoginPassword('')
      } else {
        toast.error(data.error || 'Registrasi gagal')
      }
    } catch {
      toast.error('Registrasi gagal. Coba lagi.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative min-h-screen bg-zinc-950 flex flex-col items-center justify-center overflow-hidden px-4 py-8 sm:py-12">
      {/* ── Background radial bloom (centered behind card) ── */}
      <div
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-40 blur-[120px]"
        style={{
          background: `radial-gradient(circle, color-mix(in srgb, var(--theme-500) 25%, transparent) 0%, transparent 70%)`,
        }}
      />

      {/* ── Secondary bloom — top-right on desktop only ── */}
      <div
        className="pointer-events-none absolute -top-32 right-0 w-[360px] h-[360px] rounded-full opacity-30 blur-[100px] hidden lg:block"
        style={{
          background: `radial-gradient(circle, color-mix(in srgb, var(--theme-400) 20%, transparent) 0%, transparent 70%)`,
        }}
      />

      {/* ── Desktop feature badges — LEFT side of card ── */}
      <div className="hidden lg:flex absolute left-[calc(50%-380px)] flex-col gap-3 items-end">
        {featureBadges.map((badge, i) => (
          <motion.div
            key={badge.label}
            custom={i}
            initial="hidden"
            animate="visible"
            variants={badgeFadeUp}
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl theme-bg-very-light border theme-border-light backdrop-blur-sm select-none"
          >
            <badge.icon className="w-4 h-4 theme-text shrink-0" />
            <span className="text-sm font-medium text-zinc-200 whitespace-nowrap">
              {badge.label}
            </span>
          </motion.div>
        ))}
      </div>

      {/* ── Logo section (above card) ── */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.25, 0.4, 0.25, 1] }}
        className="flex flex-col items-center mb-6"
      >
        <div className="w-10 h-10 rounded-xl bg-zinc-800/80 border border-zinc-700/50 flex items-center justify-center overflow-hidden mb-3">
          <Image src="/logo.png" alt="Aether POS" width={24} height={24} className="object-contain" priority />
        </div>
        <h1 className="text-lg font-bold text-zinc-50 tracking-tight">
          Aether POS
        </h1>
        <p className="text-xs text-zinc-500 font-medium mt-0.5">
          Point of Sale System
        </p>
      </motion.div>

      {/* ── Auth Card ── */}
      <motion.div
        variants={cardEntrance}
        initial="hidden"
        animate="visible"
        className="w-full max-w-[420px] relative z-10"
      >
        <Card className="bg-zinc-900/70 backdrop-blur-xl border-zinc-800/60 rounded-3xl overflow-hidden shadow-2xl shadow-black/40">
          {/* Top accent line */}
          <div className="h-[2px] theme-gradient" />

          <CardHeader className="px-8 pt-8 pb-0">
            {/* ── Pill-style tabs ── */}
            <div className="flex rounded-xl bg-zinc-800/50 p-1 mb-6 border border-zinc-700/40">
              <button
                type="button"
                onClick={() => {
                  if (mode !== 'login') {
                    setDirection(-1)
                    setMode('login')
                  }
                }}
                className={cn(
                  'relative flex-1 text-sm font-medium py-2.5 rounded-[10px] transition-colors duration-200',
                  mode === 'login' ? 'text-zinc-50' : 'text-zinc-500 hover:text-zinc-400'
                )}
              >
                {mode === 'login' && (
                  <motion.div
                    layoutId="auth-tab"
                    className="absolute inset-0 rounded-[10px] theme-bg-medium border theme-border-light"
                    transition={{ type: 'spring', bounce: 0.18, duration: 0.55 }}
                  />
                )}
                <span className="relative z-10 flex items-center justify-center gap-2">
                  <Lock className="w-3.5 h-3.5" />
                  Masuk
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (mode !== 'register') {
                    setDirection(1)
                    setMode('register')
                  }
                }}
                className={cn(
                  'relative flex-1 text-sm font-medium py-2.5 rounded-[10px] transition-colors duration-200',
                  mode === 'register' ? 'text-zinc-50' : 'text-zinc-500 hover:text-zinc-400'
                )}
              >
                {mode === 'register' && (
                  <motion.div
                    layoutId="auth-tab"
                    className="absolute inset-0 rounded-[10px] theme-bg-medium border theme-border-light"
                    transition={{ type: 'spring', bounce: 0.18, duration: 0.55 }}
                  />
                )}
                <span className="relative z-10 flex items-center justify-center gap-2">
                  <UserPlus className="w-3.5 h-3.5" />
                  Daftar
                </span>
              </button>
            </div>

            {/* Title */}
            <CardTitle className="text-xl font-bold text-zinc-50 tracking-tight text-center">
              {mode === 'login' ? 'Selamat Datang 👋' : 'Buat Akun Baru'}
            </CardTitle>
            <p className="text-sm text-zinc-400 mt-1.5 text-center">
              {mode === 'login'
                ? 'Masuk ke dashboard outlet Anda'
                : 'Daftarkan outlet baru untuk memulai'}
            </p>
          </CardHeader>

          <CardContent className="px-8 pb-8 pt-5">
            {/* ── Animated form ── */}
            <AnimatePresence mode="wait" custom={direction}>
              {mode === 'login' ? (
                <motion.form
                  key="login-form"
                  custom={direction}
                  variants={formVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  onSubmit={handleLogin}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="login-email" className="text-sm font-medium text-zinc-300">
                      Email
                    </Label>
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="anda@email.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      required
                      className={inputClasses}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="login-password" className="text-sm font-medium text-zinc-300">
                      Password
                    </Label>
                    <Input
                      id="login-password"
                      type="password"
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                      className={inputClasses}
                    />
                  </div>

                  <motion.div whileTap={{ scale: 0.985 }}>
                    <Button
                      type="submit"
                      className="w-full theme-gradient hover:opacity-90 text-white h-12 text-sm font-semibold rounded-xl shadow-lg theme-shadow-lg transition-all duration-200 mt-2"
                      disabled={loading}
                    >
                      {loading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowRight className="mr-2 h-4 w-4" />
                      )}
                      Masuk
                    </Button>
                  </motion.div>
                </motion.form>
              ) : (
                <motion.form
                  key="register-form"
                  custom={direction}
                  variants={formVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  onSubmit={handleRegister}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="reg-outlet" className="text-sm font-medium text-zinc-300">
                      Nama Outlet
                    </Label>
                    <Input
                      id="reg-outlet"
                      type="text"
                      placeholder="Nama Toko Anda"
                      value={regOutletName}
                      onChange={(e) => setRegOutletName(e.target.value)}
                      required
                      className={inputClasses}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reg-owner" className="text-sm font-medium text-zinc-300">
                      Nama Pemilik
                    </Label>
                    <Input
                      id="reg-owner"
                      type="text"
                      placeholder="Nama lengkap pemilik"
                      value={regOwnerName}
                      onChange={(e) => setRegOwnerName(e.target.value)}
                      required
                      className={inputClasses}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reg-email" className="text-sm font-medium text-zinc-300">
                      Email
                    </Label>
                    <Input
                      id="reg-email"
                      type="email"
                      placeholder="pemilik@email.com"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      required
                      className={inputClasses}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reg-password" className="text-sm font-medium text-zinc-300">
                      Password
                    </Label>
                    <div className="relative">
                      <Input
                        id="reg-password"
                        type={showRegPassword ? 'text' : 'password'}
                        placeholder="Minimal 8 karakter"
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        required
                        minLength={8}
                        className={cn(inputClasses, 'pr-11')}
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegPassword(!showRegPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                        aria-label={showRegPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                      >
                        {showRegPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>

                    {/* Password Strength Meter */}
                    {regPassword && (
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center gap-2.5">
                          <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                              transition={{ duration: 0.3, ease: 'easeOut' }}
                              className={cn('h-full rounded-full', passwordStrength.color)}
                            />
                          </div>
                          <span className={cn('text-[10px] font-semibold min-w-[76px] text-right', passwordStrength.textColor)}>
                            {passwordStrength.label}
                          </span>
                        </div>
                        <div className="space-y-1">
                          {passwordStrength.checks.map((check) => (
                            <div key={check.label} className="flex items-center gap-1.5">
                              {check.met ? (
                                <Check className="h-3 w-3 theme-text shrink-0" />
                              ) : (
                                <X className="h-3 w-3 text-zinc-600 shrink-0" />
                              )}
                              <span className={cn('text-[11px]', check.met ? 'theme-text' : 'text-zinc-600')}>
                                {check.label}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Account Type — Free, disabled */}
                  <div className="space-y-2">
                    <Label htmlFor="reg-account-type" className="text-sm font-medium text-zinc-300">
                      Tipe Akun
                    </Label>
                    <div className="relative">
                      <Input
                        id="reg-account-type"
                        type="text"
                        value="Free"
                        disabled
                        readOnly
                        className="bg-zinc-800/60 border-zinc-700 text-zinc-500 cursor-not-allowed pl-11 h-12 text-sm rounded-xl"
                      />
                      <Crown className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 theme-text" />
                    </div>
                    <p className="text-xs text-zinc-500">
                      Mulai gratis dengan fitur dasar POS
                    </p>
                  </div>

                  <motion.div whileTap={{ scale: 0.985 }}>
                    <Button
                      type="submit"
                      className="w-full theme-gradient hover:opacity-90 text-white h-12 text-sm font-semibold rounded-xl shadow-lg theme-shadow-lg transition-all duration-200 mt-1"
                      disabled={loading}
                    >
                      {loading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ChevronRight className="mr-2 h-4 w-4" />
                      )}
                      Daftar Sekarang
                    </Button>
                  </motion.div>
                </motion.form>
              )}
            </AnimatePresence>

            <Separator className="my-6 bg-zinc-800/60" />

            {/* Toggle link */}
            <div className="text-center">
              <p className="text-sm text-zinc-500">
                {mode === 'login' ? 'Belum punya akun?' : 'Sudah punya akun?'}
                <button
                  type="button"
                  onClick={toggleMode}
                  className="ml-1.5 text-sm font-medium theme-text hover:theme-text transition-colors duration-200 inline-flex items-center gap-0.5"
                >
                  {mode === 'login' ? 'Daftar sekarang' : 'Masuk di sini'}
                </button>
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Footer ── */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.5 }}
        className="text-center text-xs text-zinc-600 mt-8"
      >
        © 2026 Aether POS
      </motion.p>
    </main>
  )
}