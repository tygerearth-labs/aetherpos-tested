'use client'

import { useState, useMemo } from 'react'
import { signIn } from 'next-auth/react'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Loader2,
  Crown,
  Zap,
  Shield,
  BarChart3,
  Smartphone,
  ArrowRight,
  Users,
  Lock,
  Check,
  X,
  Eye,
  EyeOff,
  Rocket,
} from 'lucide-react'

const features = [
  {
    icon: Zap,
    title: 'Transaksi Cepat',
    desc: 'Proses pembayaran dalam hitungan detik',
  },
  {
    icon: BarChart3,
    title: 'Laporan Real-time',
    desc: 'Pantau performa bisnis langsung dari dashboard',
  },
  {
    icon: Smartphone,
    title: 'Multi-Platform',
    desc: 'Akses dari mana saja, kapan saja',
  },
  {
    icon: Shield,
    title: 'Data Aman',
    desc: 'Enkripsi end-to-end untuk keamanan data',
  },
]

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: [0.25, 0.4, 0.25, 1] as [number, number, number, number] },
  }),
}

const formVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.35, ease: [0.25, 0.4, 0.25, 1] as [number, number, number, number] },
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -80 : 80,
    opacity: 0,
    transition: { duration: 0.25, ease: [0.25, 0.4, 0.25, 1] as [number, number, number, number] },
  }),
}

const inputClasses =
  'bg-nebula/80 border-white/[0.06] text-white placeholder:text-slate-500 h-11 text-sm rounded-lg focus-visible:ring-1 focus-visible:ring-cyan-500/50 focus-visible:border-cyan-500/30 transition-all duration-200'

// Password strength checker
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
  if (score === 4) return { score, label: 'Kuat', color: 'bg-cyan-500', textColor: 'text-cyan-400', checks }
  return { score, label: 'Sangat Kuat', color: 'aether-gradient', textColor: 'text-cyan-300', checks }
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
    <div className="min-h-screen bg-deep-space flex">
      {/* Left Panel - Branding (hidden on mobile) */}
      <div className="hidden lg:flex lg:w-[52%] xl:w-[55%] relative overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-deep-space via-nebula to-deep-space" />

        {/* Aether gradient orbs */}
        <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full blur-[120px] opacity-[0.07]" style={{ background: 'linear-gradient(135deg, #EC4899, #8B5CF6)' }} />
        <div className="absolute bottom-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full blur-[120px] opacity-[0.07]" style={{ background: 'linear-gradient(135deg, #8B5CF6, #06B6D4)' }} />
        <div className="absolute top-[40%] left-[30%] w-[300px] h-[300px] rounded-full blur-[100px] opacity-[0.04]" style={{ background: 'linear-gradient(135deg, #EC4899, #06B6D4)' }} />

        {/* Grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
            backgroundSize: '80px 80px',
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between w-full p-12 xl:p-16">
          {/* Logo & Brand */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.25, 0.4, 0.25, 1] }}
          >
            <div className="flex items-center gap-3 mb-3">
              <img src="/logo.png" alt="AETHER" className="w-11 h-11 rounded-xl object-contain" />
              <div>
                <h1 className="text-xl font-bold text-white tracking-tight" style={{ fontFamily: 'var(--font-geist-sans)' }}>
                  AETHER
                </h1>
                <p className="text-[10px] text-slate-500 uppercase tracking-[0.2em] font-medium">
                  Mission Control
                </p>
              </div>
            </div>
          </motion.div>

          {/* Center Content */}
          <div className="flex-1 flex flex-col justify-center max-w-lg">
            <motion.div
              initial="hidden"
              animate="visible"
              className="space-y-6"
            >
              <motion.div variants={fadeUp} custom={0}>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/[0.06] bg-white/[0.02] mb-6">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-xs font-medium text-cyan-400">
                    Dipercaya oleh 1000+ bisnis di Indonesia
                  </span>
                </div>
              </motion.div>

              <motion.h2
                variants={fadeUp}
                custom={1}
                className="text-4xl xl:text-5xl font-bold text-white leading-[1.1] tracking-tight"
                style={{ fontFamily: 'var(--font-geist-sans)' }}
              >
                Kelola bisnis Anda{' '}
                <span className="aether-gradient-text">
                  dengan mudah
                </span>
              </motion.h2>

              <motion.p
                variants={fadeUp}
                custom={2}
                className="text-base text-slate-400 leading-relaxed max-w-md"
              >
                Solusi Point of Sale lengkap untuk UMKM. Cepat, mudah, dan
                terjangkau — mulai dari kasir hingga laporan keuangan.
              </motion.p>

              {/* Stats Row */}
              <motion.div
                variants={fadeUp}
                custom={3}
                className="flex items-center gap-8 pt-2"
              >
                <div>
                  <div className="text-2xl font-bold text-white">10K+</div>
                  <div className="text-xs text-slate-500 mt-0.5">Transaksi/hari</div>
                </div>
                <Separator orientation="vertical" className="h-10 bg-white/[0.06]" />
                <div>
                  <div className="text-2xl font-bold text-white">99.9%</div>
                  <div className="text-xs text-slate-500 mt-0.5">Uptime</div>
                </div>
                <Separator orientation="vertical" className="h-10 bg-white/[0.06]" />
                <div>
                  <div className="text-2xl font-bold text-white">24/7</div>
                  <div className="text-xs text-slate-500 mt-0.5">Support</div>
                </div>
              </motion.div>
            </motion.div>
          </div>

          {/* Feature Highlights */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.6, ease: [0.25, 0.4, 0.25, 1] }}
            className="grid grid-cols-2 gap-4"
          >
            {features.map((feature, i) => (
              <motion.div
                key={feature.title}
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                custom={i + 4}
                className="group rounded-xl border border-white/[0.05] bg-white/[0.01] backdrop-blur-sm p-4 transition-all duration-300 hover:border-white/[0.08] hover:bg-white/[0.03]"
              >
                <div className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center mb-3 transition-colors duration-300 group-hover:bg-white/[0.06]">
                  <feature.icon className="w-4 h-4 text-cyan-400" strokeWidth={1.5} />
                </div>
                <h3 className="text-sm font-semibold text-slate-200 mb-1">
                  {feature.title}
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {feature.desc}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Right Panel - Auth Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8 lg:p-12 relative">
        {/* Subtle background glow on right side */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none opacity-[0.04]" style={{ background: 'linear-gradient(135deg, #EC4899, #8B5CF6, #06B6D4)' }} />

        <div className="w-full max-w-[400px] relative z-10">
          {/* Mobile-only branding */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="lg:hidden flex items-center justify-center gap-3 mb-8"
          >
            <img src="/logo.png" alt="AETHER" className="w-10 h-10 rounded-xl object-contain" />
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight" style={{ fontFamily: 'var(--font-geist-sans)' }}>
                AETHER
              </h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-[0.2em] font-medium">
                Mission Control
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.25, 0.4, 0.25, 1] }}
          >
            {/* Form Card */}
            <Card className="bg-nebula/60 backdrop-blur-xl border-white/[0.06] rounded-2xl overflow-hidden shadow-2xl shadow-black/30">
              {/* Gradient accent bar */}
              <div className="h-[2px] aether-gradient" />

              <CardHeader className="text-center px-8 pt-8 pb-2">
                <CardTitle className="text-xl font-bold text-white tracking-tight" style={{ fontFamily: 'var(--font-geist-sans)' }}>
                  {mode === 'login' ? 'Selamat Datang' : 'Buat Akun Baru'}
                </CardTitle>
                <CardDescription className="text-sm text-slate-400 mt-1.5">
                  {mode === 'login'
                    ? 'Masuk ke Mission Control Anda'
                    : 'Daftarkan outlet baru untuk memulai'}
                </CardDescription>
              </CardHeader>

              <CardContent className="px-8 pb-8 pt-4">
                {/* Mode Tabs */}
                <div className="flex rounded-xl bg-white/[0.03] p-1 mb-6 border border-white/[0.05]">
                  <button
                    type="button"
                    onClick={() => {
                      if (mode !== 'login') {
                        setDirection(-1)
                        setMode('login')
                      }
                    }}
                    className={`relative flex-1 text-sm font-medium py-2 rounded-lg transition-all duration-300 ${
                      mode === 'login'
                        ? 'text-white'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {mode === 'login' && (
                      <motion.div
                        layoutId="auth-tab"
                        className="absolute inset-0 bg-white/[0.06] rounded-lg border border-white/[0.06]"
                        transition={{ type: 'spring', bounce: 0.15, duration: 0.5 }}
                      />
                    )}
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      <Lock className="w-3.5 h-3.5" strokeWidth={1.5} />
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
                    className={`relative flex-1 text-sm font-medium py-2 rounded-lg transition-all duration-300 ${
                      mode === 'register'
                        ? 'text-white'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {mode === 'register' && (
                      <motion.div
                        layoutId="auth-tab"
                        className="absolute inset-0 bg-white/[0.06] rounded-lg border border-white/[0.06]"
                        transition={{ type: 'spring', bounce: 0.15, duration: 0.5 }}
                      />
                    )}
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      <Rocket className="w-3.5 h-3.5" strokeWidth={1.5} />
                      Daftar
                    </span>
                  </button>
                </div>

                {/* Animated Form */}
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
                        <Label
                          htmlFor="login-email"
                          className="text-sm font-medium text-slate-300"
                        >
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
                        <Label
                          htmlFor="login-password"
                          className="text-sm font-medium text-slate-300"
                        >
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

                      <motion.div whileTap={{ scale: 0.98 }}>
                        <Button
                          type="submit"
                          className="w-full h-11 text-sm font-semibold rounded-lg text-white aether-gradient shadow-lg shadow-cyan-500/10 transition-all duration-200 hover:shadow-xl hover:shadow-cyan-500/20 hover:scale-[1.01] active:scale-[0.99]"
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
                        <Label
                          htmlFor="reg-outlet"
                          className="text-sm font-medium text-slate-300"
                        >
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
                        <Label
                          htmlFor="reg-owner"
                          className="text-sm font-medium text-slate-300"
                        >
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
                        <Label
                          htmlFor="reg-email"
                          className="text-sm font-medium text-slate-300"
                        >
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
                        <Label
                          htmlFor="reg-password"
                          className="text-sm font-medium text-slate-300"
                        >
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
                            className={cn(inputClasses, 'pr-10')}
                          />
                          <button
                            type="button"
                            onClick={() => setShowRegPassword(!showRegPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                          >
                            {showRegPassword ? <EyeOff className="h-4 w-4" strokeWidth={1.5} /> : <Eye className="h-4 w-4" strokeWidth={1.5} />}
                          </button>
                        </div>
                        {/* Password Strength Bar */}
                        {regPassword && (
                          <div className="space-y-2 pt-1">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                                  transition={{ duration: 0.3, ease: 'easeOut' }}
                                  className={cn('h-full rounded-full', passwordStrength.color)}
                                />
                              </div>
                              <span className={cn('text-[10px] font-semibold min-w-[72px] text-right', passwordStrength.textColor)}>
                                {passwordStrength.label}
                              </span>
                            </div>
                            <div className="space-y-1">
                              {passwordStrength.checks.map((check) => (
                                <div key={check.label} className="flex items-center gap-1.5">
                                  {check.met ? (
                                    <Check className="h-3 w-3 text-cyan-400 shrink-0" strokeWidth={2} />
                                  ) : (
                                    <X className="h-3 w-3 text-slate-600 shrink-0" strokeWidth={2} />
                                  )}
                                  <span className={cn('text-[11px]', check.met ? 'text-cyan-400' : 'text-slate-600')}>
                                    {check.label}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Account Type - Default Free */}
                      <div className="space-y-2">
                        <Label
                          htmlFor="reg-account-type"
                          className="text-sm font-medium text-slate-300"
                        >
                          Tipe Akun
                        </Label>
                        <div className="relative">
                          <Input
                            id="reg-account-type"
                            type="text"
                            value="Free"
                            disabled
                            readOnly
                            className="bg-white/[0.02] border-white/[0.04] text-slate-500 cursor-not-allowed pl-10 h-11 text-sm rounded-lg"
                          />
                          <Crown className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-cyan-400" strokeWidth={1.5} />
                        </div>
                        <p className="text-xs text-slate-500">
                          Mulai gratis dengan fitur dasar POS
                        </p>
                      </div>

                      <motion.div whileTap={{ scale: 0.98 }}>
                        <Button
                          type="submit"
                          className="w-full h-11 text-sm font-semibold rounded-lg text-white aether-gradient shadow-lg shadow-cyan-500/10 transition-all duration-200 hover:shadow-xl hover:shadow-cyan-500/20 hover:scale-[1.01] active:scale-[0.99]"
                          disabled={loading}
                        >
                          {loading ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <ArrowRight className="mr-2 h-4 w-4" />
                          )}
                          Daftar Sekarang
                        </Button>
                      </motion.div>
                    </motion.form>
                  )}
                </AnimatePresence>

                <Separator className="my-6 bg-white/[0.04]" />

                {/* Toggle mode link */}
                <div className="text-center">
                  <p className="text-sm text-slate-500">
                    {mode === 'login'
                      ? 'Belum punya akun?'
                      : 'Sudah punya akun?'}
                    <button
                      type="button"
                      onClick={toggleMode}
                      className="ml-1.5 text-sm font-medium text-cyan-400 hover:text-cyan-300 transition-colors duration-200"
                    >
                      {mode === 'login' ? 'Daftar sekarang' : 'Masuk di sini'}
                    </button>
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Desktop-only footer */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.5 }}
              className="text-center text-xs text-slate-600 mt-6 hidden lg:block"
            >
              &copy; {new Date().getFullYear()} AETHER. All rights reserved.
            </motion.p>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
