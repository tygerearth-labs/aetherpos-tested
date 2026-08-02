'use client'

/**
 * BarcodeScannerDialog — shared scan UI for POS, Products, Inventory, and
 * Stock Opname search bars.
 *
 * Detection strategy (reliable cross-browser):
 *   1. Primary: @zxing/library MultiFormatReader (pure JS — works on all
 *      browsers incl. Firefox, iOS Safari, desktop Chrome). Captures frames
 *      from our existing <video> via canvas and decodes in the rAF loop.
 *   2. Fast-path: native BarcodeDetector API when available (Chrome/Android)
 *      — used as an acceleration layer; if it throws or is unsupported, zxing
 *      takes over seamlessly.
 *
 * UX:
 *   - Rear camera (facingMode: 'environment').
 *   - Lazy-load: camera stream acquired only after the user opens the dialog.
 *   - One stream max: tracks stopped on close/unmount.
 *   - Manual input fallback always available (collapsed by default).
 *   - On success: vibration + beep (best-effort), debounce identical 1.2s.
 *
 * Cloud sandbox caveat: no real camera in preview → falls back to manual
 * input. The camera viewport still renders for real-device users.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Camera, ScanBarcode, X, AlertTriangle, Loader2, Keyboard, Zap, ZapOff } from 'lucide-react'
import {
  MultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  RGBLuminanceSource,
  HybridBinarizer,
  BinaryBitmap,
  NotFoundException,
} from '@zxing/library'

interface BarcodeScannerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the resolved barcode/SKU string. Parent decides what to do with it. */
  onResult: (value: string) => void
  /** Dialog title. */
  title?: string
  /** Placeholder for the manual input fallback. */
  inputPlaceholder?: string
}

type CameraStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'unsupported' | 'error'

const SCAN_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.QR_CODE,
]

export function BarcodeScannerDialog({
  open,
  onOpenChange,
  onResult,
  title = 'Scan Barcode',
  inputPlaceholder = 'Ketik barcode / SKU manual...',
}: BarcodeScannerDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  /** zxing reader instance — pure-JS decoder, works on all browsers. */
  const readerRef = useRef<MultiFormatReader | null>(null)
  /** Native BarcodeDetector (Chrome/Android fast-path), null if unsupported. */
  const nativeDetectorRef = useRef<{
    detect: (source: CanvasImageSource | ImageBitmap) => Promise<Array<{ rawValue?: string }>>
  } | null>(null)
  const rafRef = useRef<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastResultRef = useRef<{ value: string; at: number } | null>(null)
  const manualValueRef = useRef<HTMLInputElement>(null)

  const [status, setStatus] = useState<CameraStatus>('idle')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [lastScan, setLastScan] = useState<string>('')
  const [manualValue, setManualValue] = useState('')
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [showManual, setShowManual] = useState(false)

  // ── Initialize the zxing reader once (pure-JS, no camera needed) ──
  const ensureReader = useCallback(() => {
    if (readerRef.current) return readerRef.current
    const hints = new Map()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, SCAN_FORMATS)
    // Try harder — slower but catches blurry/partial barcodes.
    hints.set(DecodeHintType.TRY_HARDER, true)
    const reader = new MultiFormatReader()
    reader.setHints(hints)
    readerRef.current = reader
    return reader
  }, [])

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    nativeDetectorRef.current = null
    setStatus('idle')
  }, [])

  const handleResult = useCallback(
    (value: string) => {
      const now = Date.now()
      const last = lastResultRef.current
      // Debounce identical values 1.2s.
      if (last && last.value === value && now - last.at < 1200) return
      lastResultRef.current = { value, at: now }
      setLastScan(value)
      // Best-effort haptic + audio feedback.
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(80)
      } catch { /* ignore */ }
      try {
        const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.frequency.value = 880
        gain.gain.value = 0.04
        osc.connect(gain).connect(ctx.destination)
        osc.start()
        setTimeout(() => { osc.stop(); ctx.close() }, 90)
      } catch { /* ignore */ }
      onResult(value)
    },
    [onResult],
  )

  // ── Decode a single frame using native BarcodeDetector (fast-path) ──
  const decodeNative = useCallback(async (video: HTMLVideoElement): Promise<string | null> => {
    if (!nativeDetectorRef.current) return null
    try {
      const results = await nativeDetectorRef.current.detect(video)
      if (results && results.length > 0) {
        const value = results[0].rawValue
        if (value) return value
      }
    } catch {
      // native detect errors fire constantly on dark/blurry frames — ignore
    }
    return null
  }, [])

  // ── Decode a single frame using zxing (cross-browser fallback) ──
  const decodeZxing = useCallback((video: HTMLVideoElement): string | null => {
    const reader = readerRef.current
    if (!reader) return null
    const w = video.videoWidth
    const h = video.videoHeight
    if (w === 0 || h === 0) return null
    // Reuse a single canvas across frames to avoid GC pressure.
    let canvas = canvasRef.current
    if (!canvas) {
      canvas = document.createElement('canvas')
      canvasRef.current = canvas
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    try {
      ctx.drawImage(video, 0, 0, w, h)
      const imageData = ctx.getImageData(0, 0, w, h)
      const luminanceSource = new RGBLuminanceSource(imageData.data, w, h)
      const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource))
      const result = reader.decode(binaryBitmap)
      if (result && result.getText()) return result.getText()
    } catch (err) {
      // NotFoundException is expected on every non-matching frame — ignore.
      if (!(err instanceof NotFoundException)) {
        // Swallow other transient errors silently.
      }
    }
    return null
  }, [])

  // detectLoop is self-recursive via requestAnimationFrame. To satisfy
  // react-hooks/immutability we store the latest instance in a ref and
  // schedule through the ref, not through the closure variable.
  const detectLoopRef = useRef<() => void>(() => {})

  const detectLoop = useCallback(async () => {
    const video = videoRef.current
    if (!video || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(() => detectLoopRef.current())
      return
    }
    // Try native BarcodeDetector first (faster on Chrome/Android), then
    // fall back to zxing for browsers without native support.
    let value: string | null = null
    if (nativeDetectorRef.current) {
      value = await decodeNative(video)
    }
    if (!value) {
      value = decodeZxing(video)
    }
    if (value) handleResult(value)
    rafRef.current = requestAnimationFrame(() => detectLoopRef.current())
  }, [handleResult, decodeNative, decodeZxing])

  // Keep the ref in sync with the latest closure.
  useEffect(() => {
    detectLoopRef.current = detectLoop
  }, [detectLoop])

  const startCamera = useCallback(async () => {
    // Reset dialog state at the start of each camera session.
    setShowManual(false)
    setManualValue('')
    setLastScan('')
    setStatus('requesting')
    setErrorMsg('')
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('unsupported')
        setErrorMsg('Browser tidak mendukung akses kamera.')
        setShowManual(true)
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => { /* autoplay may be blocked; video will start when metadata loads */ })
      }
      // Torch capability check (best-effort).
      try {
        const track = stream.getVideoTracks()[0]
        const caps = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean } | undefined
        if (caps && caps.torch) {
          setTorchSupported(true)
        } else {
          setTorchSupported(false)
        }
      } catch {
        setTorchSupported(false)
      }
      // ── Initialize decoders ──
      // 1. zxing (always available — pure JS)
      ensureReader()
      // 2. Native BarcodeDetector (Chrome/Android fast-path)
      const BD = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (s: CanvasImageSource) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector
      if (BD) {
        try {
          nativeDetectorRef.current = new BD({
            formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'codabar', 'itf', 'qr_code'],
          })
        } catch {
          nativeDetectorRef.current = null
        }
      } else {
        nativeDetectorRef.current = null
      }
      setStatus('active')
      // Start the detection loop — always runs, even without native BD,
      // because zxing handles the decoding.
      rafRef.current = requestAnimationFrame(detectLoop)
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string }
      if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
        setStatus('denied')
        setErrorMsg('Akses kamera ditolak. Izinkan kamera di pengaturan browser, atau ketik manual di bawah.')
      } else if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') {
        setStatus('unsupported')
        setErrorMsg('Tidak ada kamera yang terdeteksi pada perangkat ini.')
      } else if (e?.name === 'NotReadableable' || e?.name === 'NotReadableError') {
        setStatus('error')
        setErrorMsg('Kamera sedang digunakan aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.')
      } else {
        setStatus('error')
        setErrorMsg(e?.message || 'Gagal mengakses kamera.')
      }
      setShowManual(true)
    }
  }, [detectLoop, ensureReader])

  // Open → start camera; close → stop camera.
  // Camera init is a legitimate external-system side-effect that must update
  // React state (status/permissions); the synchronous setState calls here are
  // intentional and unavoidable for media-device orchestration.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void startCamera()
    } else {
      stopCamera()
    }
    return () => {
      // Cleanup on unmount
      stopCamera()
    }
  }, [open, startCamera, stopCamera])

  const toggleTorch = useCallback(async () => {
    if (!streamRef.current) return
    try {
      const track = streamRef.current.getVideoTracks()[0]
      const caps = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean } | undefined
      if (!caps?.torch) return
      const next = !torchOn
      await track.applyConstraints({ advanced: [{ torch: next } as unknown as MediaTrackConstraintSet] })
      setTorchOn(next)
    } catch {
      /* ignore */
    }
  }, [torchOn])

  const submitManual = useCallback(() => {
    // Read directly from the DOM input as a fallback when React's controlled
    // state hasn't flushed yet (e.g. programmatic native setter + immediate
    // submit). React's manualValue may lag behind the actual input value.
    const stateValue = manualValue.trim()
    const domValue = manualValueRef.current?.value.trim() ?? ''
    const v = stateValue || domValue
    if (!v) return
    handleResult(v)
    setManualValue('')
  }, [manualValue, handleResult])

  const handleClose = useCallback(() => {
    stopCamera()
    onOpenChange(false)
  }, [stopCamera, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); else onOpenChange(o) }}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden bg-nebula border-white/[0.08]" showCloseButton={false}>
        <DialogHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center">
              <ScanBarcode className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <DialogTitle className="text-sm text-white">{title}</DialogTitle>
              <DialogDescription className="text-[11px] text-slate-500">Arahkan kamera ke barcode atau ketik manual</DialogDescription>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors"
            aria-label="Tutup scanner"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogHeader>

        {/* Camera viewport */}
        <div className="relative aspect-[4/3] bg-black/60 mx-4 rounded-xl overflow-hidden border border-white/[0.06]">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            muted
            playsInline
          />
          {/* Scan frame overlay */}
          {status === 'active' && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-2/3 h-1/3 border-2 border-emerald-400/70 rounded-lg relative">
                <div className="absolute inset-x-0 top-1/2 h-0.5 bg-emerald-400/80 animate-pulse" />
                <div className="absolute -top-px -left-px w-4 h-4 border-t-2 border-l-2 border-emerald-300 rounded-tl-lg" />
                <div className="absolute -top-px -right-px w-4 h-4 border-t-2 border-r-2 border-emerald-300 rounded-tr-lg" />
                <div className="absolute -bottom-px -left-px w-4 h-4 border-b-2 border-l-2 border-emerald-300 rounded-bl-lg" />
                <div className="absolute -bottom-px -right-px w-4 h-4 border-b-2 border-r-2 border-emerald-300 rounded-br-lg" />
              </div>
            </div>
          )}

          {/* Status overlays */}
          {status === 'requesting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70">
              <Loader2 className="h-6 w-6 text-emerald-400 animate-spin" />
              <p className="text-[11px] text-slate-400">Memulai kamera...</p>
            </div>
          )}
          {(status === 'denied' || status === 'unsupported' || status === 'error') && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-4 text-center">
              <AlertTriangle className="h-6 w-6 text-amber-400" />
              <p className="text-[11px] text-slate-300 leading-relaxed">{errorMsg}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-1 h-7 text-[11px] gap-1.5 border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/[0.04]"
                onClick={() => setShowManual(true)}
              >
                <Keyboard className="h-3 w-3" />
                Ketik Manual
              </Button>
            </div>
          )}
          {status === 'idle' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70">
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30"
                onClick={() => void startCamera()}
              >
                <Camera className="h-3.5 w-3.5" />
                Mulai Kamera
              </Button>
            </div>
          )}

          {/* Torch toggle */}
          {status === 'active' && torchSupported && (
            <button
              onClick={() => void toggleTorch()}
              className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-black/60 backdrop-blur flex items-center justify-center text-slate-300 hover:text-white transition-colors"
              aria-label={torchOn ? 'Matikan senter' : 'Nyalakan senter'}
              title={torchOn ? 'Matikan senter' : 'Nyalakan senter'}
            >
              {torchOn ? <Zap className="h-4 w-4 text-amber-400" /> : <ZapOff className="h-4 w-4" />}
            </button>
          )}

          {/* Last scan feedback */}
          {lastScan && (
            <div className="absolute bottom-2 left-2 right-2 bg-emerald-500/15 border border-emerald-500/30 backdrop-blur rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
              <ScanBarcode className="h-3 w-3 text-emerald-400 shrink-0" />
              <span className="text-[11px] text-emerald-300 truncate font-mono">{lastScan}</span>
            </div>
          )}
        </div>

        {/* Manual input (collapsible) */}
        <div className="px-4 pb-4 pt-2 space-y-2">
          {showManual ? (
            <div className="flex gap-2">
              <Input
                ref={manualValueRef}
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitManual() }}
                placeholder={inputPlaceholder}
                autoFocus
                className="h-9 text-xs bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-500 rounded-lg"
              />
              <Button
                size="sm"
                onClick={submitManual}
                className="h-9 px-4 text-xs bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30"
              >
                Cari
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setShowManual(true)}
              className="text-[11px] text-slate-500 hover:text-slate-300 inline-flex items-center gap-1 transition-colors"
            >
              <Keyboard className="h-3 w-3" />
              Ketik manual
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
