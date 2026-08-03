'use client'

/**
 * AETHER CAMERA BARCODE SCANNER — shared scan UI.
 *
 * Used by POS (and ready to be reused by Product / Inventory / Stock Opname).
 *
 * ARCHITECTURE (Phases 1–9 of the AETHER CAMERA BARCODE SCANNER contract):
 *
 *  Phase 1 — Runtime telemetry overlay shown inside the scanner so a developer
 *            holding a physical phone can see exactly what is happening:
 *            permission, camera label, readyState, detector impl, supported
 *            formats, frames processed, raw + normalized barcode, lookup state,
 *            context-action state, last error.
 *
 *  Phase 2 — Camera lifecycle:
 *              - request only after the dialog opens
 *              - prefer rear camera (facingMode: 'environment')
 *              - bind stream to video.srcObject and await play()
 *              - start detection only after loadedmetadata + readyState >= 2
 *              - stop all tracks on close/unmount
 *              - cancel rAF / zxing controls on close
 *              - guard against two active streams
 *
 *  Phase 3 — Detector engine (dual-path with auto-fallback):
 *              Primary: native BarcodeDetector (Chrome/Android). Feature-detect,
 *                       call getSupportedFormats(), use only supported formats,
 *                       continuously call detect(video), prevent overlapping
 *                       detect() calls. If it throws repeatedly (≥ 5 consecutive
 *                       errors), switch to fallback.
 *              Fallback: @zxing/browser BrowserMultiFormatReader using
 *                       decodeFromStream(stream, video, callback). Retail
 *                       formats only (EAN_13, EAN_8, UPC_A/E, CODE_128/39).
 *                       Retain returned controls and call controls.stop() on
 *                       close.
 *
 *  Phase 4 — normalizeBarcode: trim, strip internal whitespace, preserve
 *            leading zeroes, NEVER convert to Number.
 *
 *  Phase 5 — Guarded async callback:
 *              - reject empty
 *              - debounce identical barcode 1.2s
 *              - processing lock (released in finally)
 *              - immediate visual feedback (overlay flash + last-scan chip)
 *              - brief vibration where supported
 *              - never swallow exceptions silently (logged to telemetry)
 *
 *  Phase 6 — Isolated test modes (dev-only, collapsible):
 *              1. Detector-only — display detected barcode, no lookup
 *              2. Manual simulate — text input runs the same handleDetected()
 *              3. Resolver-only — call resolver prop, show JSON summary
 *              4. Context-action sim — invoke onContextAction independently
 *
 *  Phase 7 — Lookup contract: delegates to optional `resolver` prop. The
 *            parent (POS) provides a resolver returning
 *              { status, entityType, productId, variantId?, barcode }.
 *            If no resolver is wired, the dialog just calls `onResult(value)`
 *            and the parent does its own lookup (Stock Opname path).
 *
 *  Phase 8 — POS adapter: POS wires resolver + onContextAction so the dialog
 *            runs detect → normalize → resolve → add-to-cart end-to-end.
 *
 *  Phase 9 — Real-device verification happens out-of-band (see final report).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ScanBarcode, X, AlertTriangle, Loader2, Keyboard,
  Zap, ZapOff, Bug, Camera, Crosshair, FlaskConical, Play,
} from 'lucide-react'
import { toast } from 'sonner'

// ──────────────────────────────────────────────────────────────────────────────
// @zxing/browser + @zxing/library — DYNAMIC-ONLY import (Phase 3 robustness)
//
// These packages are loaded via `await import('@zxing/browser')` inside
// startZxingFallback() so that the BUILD never statically resolves them.
// This makes the @zxing fallback fully optional at build time:
//   - If @zxing is installed (it is, per package.json), the fallback loads
//     on demand when the native BarcodeDetector errors out 5× in a row.
//   - If @zxing is NOT installed (e.g. a stripped deploy), the dynamic
//     import fails gracefully and the user still gets the native detector
//     (Chrome/Android/Edge) + manual input. The build ALWAYS succeeds.
//
// Local numeric constants mirror @zxing/library's BarcodeFormat +
// DecodeHintType enums (verified against @zxing/library@0.23.0):
//   CODE_39=2, CODE_128=4, EAN_8=6, EAN_13=7, UPC_A=14, UPC_E=15
//   POSSIBLE_FORMATS=2, TRY_HARDER=3
// ──────────────────────────────────────────────────────────────────────────────
const ZX_BARCODE_FORMAT = {
  CODE_39: 2,
  CODE_128: 4,
  EAN_8: 6,
  EAN_13: 7,
  UPC_A: 14,
  UPC_E: 15,
} as const
const ZX_DECODE_HINT = {
  POSSIBLE_FORMATS: 2,
  TRY_HARDER: 3,
} as const

// Minimal structural types for the dynamically-imported @zxing/browser API.
// These are NOT the real classes — they exist only so TypeScript + refs compile
// without a static import. The real classes arrive via dynamic import at runtime.
interface ZxScannerControls { stop: () => void }
interface ZxDecodeResult { getText: () => string }
interface ZxBrowserMultiFormatReader {
  decodeFromStream: (
    stream: MediaStream,
    video: HTMLVideoElement,
    cb: (result: ZxDecodeResult | null, err: unknown, controls: ZxScannerControls) => void,
  ) => Promise<ZxScannerControls>
}
interface ZxLibraryModule {
  DecodeHintType: { POSSIBLE_FORMATS: number; TRY_HARDER: number }
  BarcodeFormat: { EAN_13: number; EAN_8: number; UPC_A: number; UPC_E: number; CODE_128: number; CODE_39: number }
  NotFoundException: { new (): Error }
}
interface ZxBrowserModule {
  BrowserMultiFormatReader: new (hints?: Map<number, unknown>, options?: { delayBetweenScanAttempts?: number }) => ZxBrowserMultiFormatReader
}

// ──────────────────────────────────────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────────────────────────────────────

interface BarcodeScannerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Called with the normalized barcode string. Parent decides what to do.
   * May return a boolean (or Promise<boolean>) to signal success — when
   * `closeOnSuccess` is true and this returns `true`, the dialog closes
   * itself. Returning `void` keeps legacy behavior (parent closes manually).
   */
  onResult: (value: string) => boolean | void | Promise<boolean | void>
  /** Dialog title. */
  title?: string
  /** Placeholder for the manual input fallback. */
  inputPlaceholder?: string
  /**
   * Optional resolver (Phase 7). When provided, the dialog runs the full
   * pipeline: detect → normalize → resolve → onContextAction. Telemetry
   * tracks lookup state. If absent, dialog only calls onResult.
   */
  resolver?: (barcode: string) => Promise<LookupResult>
  /**
   * Optional context-action adapter (Phase 8). Called after a FOUND lookup.
   * Telemetry tracks context-action state. Should return `true` when the
   * action succeeded (e.g. item added to cart) so the dialog can auto-close
   * when `closeOnSuccess` is set.
   */
  onContextAction?: (lookup: LookupResult) => Promise<boolean | void> | boolean | void
  /**
   * When true, the dialog auto-closes after a SUCCESSFUL action:
   *   - Full-pipeline mode: lookup FOUND + onContextAction returns true.
   *   - Simple mode: onResult returns true.
   * The dialog NEVER auto-closes on NOT_FOUND, lookup errors, or action
   * errors (those stay open so the operator can re-scan or fix the issue).
   * Default false (continuous-scan mode — dialog stays open after success).
   */
  closeOnSuccess?: boolean
}

export interface LookupResult {
  status: 'FOUND' | 'NOT_FOUND'
  entityType?: 'PRODUCT' | 'VARIANT'
  productId?: string
  variantId?: string
  barcode: string
}

type CameraStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'unsupported' | 'error'
type DetectorImpl = 'NONE' | 'NATIVE_BARCODE_DETECTOR' | 'ZXING_FALLBACK'
type LookupState = 'IDLE' | 'LOOKING_UP' | 'FOUND' | 'NOT_FOUND' | 'ERROR'
type ContextState = 'IDLE' | 'EXECUTING' | 'SUCCESS' | 'ERROR'
type TestMode = 'OFF' | 'DETECTOR_ONLY' | 'MANUAL_SIM' | 'RESOLVER_ONLY' | 'CONTEXT_SIM'

interface Telemetry {
  permission: PermissionState | 'unknown'
  cameraLabel: string
  videoReadyState: number
  detectorImpl: DetectorImpl
  supportedFormats: string[]
  framesProcessed: number
  lastRawValue: string
  lastDetectedFormat: string
  normalizedBarcode: string
  lookupState: LookupState
  contextState: ContextState
  lastErrorName: string
  lastErrorMessage: string
}

const INITIAL_TELEMETRY: Telemetry = {
  permission: 'unknown',
  cameraLabel: '',
  videoReadyState: 0,
  detectorImpl: 'NONE',
  supportedFormats: [],
  framesProcessed: 0,
  lastRawValue: '',
  lastDetectedFormat: '',
  normalizedBarcode: '',
  lookupState: 'IDLE',
  contextState: 'IDLE',
  lastErrorName: '',
  lastErrorMessage: '',
}

// Retail barcode formats only — no QR (Phase 3 spec).
const NATIVE_FORMATS = [
  'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39',
]
const ZXING_FORMATS = [
  ZX_BARCODE_FORMAT.EAN_13,
  ZX_BARCODE_FORMAT.EAN_8,
  ZX_BARCODE_FORMAT.UPC_A,
  ZX_BARCODE_FORMAT.UPC_E,
  ZX_BARCODE_FORMAT.CODE_128,
  ZX_BARCODE_FORMAT.CODE_39,
]

// ──────────────────────────────────────────────────────────────────────────────
// NATIVE BarcodeDetector TYPE SHIM (no DOM lib types in some TS configs)
// ──────────────────────────────────────────────────────────────────────────────

interface NativeDetectedCode {
  rawValue?: string
  format?: string
}
interface NativeBarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): {
    detect: (source: CanvasImageSource | ImageBitmap) => Promise<NativeDetectedCode[]>
    getSupportedFormats?: () => Promise<string[]>
  }
  getSupportedFormats?: () => Promise<string[]>
}

function getNativeBarcodeDetectorCtor(): NativeBarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { BarcodeDetector?: NativeBarcodeDetectorCtor }
  return w.BarcodeDetector ?? null
}

// ──────────────────────────────────────────────────────────────────────────────
// NORMALIZATION (Phase 4)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * normalizeBarcode:
 *   - trim
 *   - remove accidental internal whitespace
 *   - preserve leading zeroes (NEVER convert to Number)
 *   - return empty string for blank input
 */
function normalizeBarcode(raw: string): string {
  if (typeof raw !== 'string') return ''
  return raw.trim().replace(/\s+/g, '')
}

// ──────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ──────────────────────────────────────────────────────────────────────────────

export function BarcodeScannerDialog({
  open,
  onOpenChange,
  onResult,
  title = 'Scan Barcode',
  inputPlaceholder = 'Ketik barcode / SKU manual...',
  resolver,
  onContextAction,
  closeOnSuccess = false,
}: BarcodeScannerDialogProps) {
  // Diagnostics (telemetry panel + test-mode panel) are dev-only surfaces.
  // They never ship to normal users in production builds.
  const isDev = process.env.NODE_ENV === 'development'
  // Refs — camera + detection
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const nativeDetectorRef = useRef<ReturnType<NativeBarcodeDetectorCtor['new']> | null>(null)
  const zxingReaderRef = useRef<ZxBrowserMultiFormatReader | null>(null)
  const zxingControlsRef = useRef<ZxScannerControls | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const manualValueRef = useRef<HTMLInputElement>(null)
  const lastResultRef = useRef<{ value: string; at: number } | null>(null)
  const processingLockRef = useRef<boolean>(false)
  const nativeErrorStreakRef = useRef<number>(0)
  const fallbackArmedRef = useRef<boolean>(false)
  const framesProcessedRef = useRef<number>(0)
  const detectInFlightRef = useRef<boolean>(false) // prevent overlapping native detect()

  // detectLoop stored in a ref so rAF schedules the latest closure (avoids
  // react-hooks/immutability warnings).
  const detectLoopRef = useRef<() => void>(() => {})

  // CRITICAL FIX: handleDetected stored in a ref so the ZXing callback (which
  // captures the closure once at creation time) always calls the LATEST version
  // with up-to-date resolver/onContextAction references. Without this, the ZXing
  // reader's callback would use a stale handleDetected after the first render
  // cycle, causing the pipeline (detect → resolve → context action) to silently
  // fail because the old resolver/onContextAction are no longer valid.
  const handleDetectedRef = useRef<(rawValue: string, detectedFormat?: string) => Promise<void>>()

  // React state — UI + telemetry
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [lastScan, setLastScan] = useState<string>('')
  const [manualValue, setManualValue] = useState('')
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [showTelemetry, setShowTelemetry] = useState(false)
  const [showTestPanel, setShowTestPanel] = useState(false)
  const [testMode, setTestMode] = useState<TestMode>('OFF')
  const [flash, setFlash] = useState(false)
  const [telemetry, setTelemetry] = useState<Telemetry>(INITIAL_TELEMETRY)
  const [resolverResult, setResolverResult] = useState<LookupResult | null>(null)
  const [contextActionResult, setContextActionResult] = useState<string>('')

  // Helper — patch telemetry immutably.
  const patchTelemetry = useCallback((patch: Partial<Telemetry>) => {
    setTelemetry((prev) => ({ ...prev, ...patch }))
  }, [])

  // Helper — record an error in telemetry without crashing the loop.
  const recordError = useCallback((name: string, message: string) => {
    patchTelemetry({ lastErrorName: name, lastErrorMessage: message })
  }, [patchTelemetry])

  // ────────────────────────────────────────────────────────────────────────────
  // PHASE 5 — Guarded detection callback
  // ────────────────────────────────────────────────────────────────────────────

  const handleDetected = useCallback(async (rawValue: string, detectedFormat?: string) => {
    const raw = String(rawValue ?? '')
    const normalized = normalizeBarcode(raw)

    // Reject empty.
    if (!normalized) return

    // Debounce identical barcode for 1.2 seconds.
    const now = Date.now()
    const last = lastResultRef.current
    if (last && last.value === normalized && now - last.at < 1200) return

    // TEST MODE: DETECTOR_ONLY — display only, no lookup, no callback.
    if (testMode === 'DETECTOR_ONLY') {
      lastResultRef.current = { value: normalized, at: now }
      setLastScan(normalized)
      patchTelemetry({ lastRawValue: raw, lastDetectedFormat: detectedFormat ?? '', normalizedBarcode: normalized })
      triggerFeedback()
      return
    }

    // Processing lock — prevent concurrent lookup.
    if (processingLockRef.current) return
    processingLockRef.current = true
    lastResultRef.current = { value: normalized, at: now }
    setLastScan(normalized)
    patchTelemetry({
      lastRawValue: raw,
      lastDetectedFormat: detectedFormat ?? '',
      normalizedBarcode: normalized,
      lookupState: 'IDLE',
      contextState: 'IDLE',
    })
    triggerFeedback()

    try {
      // TEST MODE: RESOLVER_ONLY — call resolver, show JSON, do NOT call onResult.
      if (testMode === 'RESOLVER_ONLY') {
        if (!resolver) {
          patchTelemetry({ lookupState: 'ERROR', lastErrorName: 'NoResolver', lastErrorMessage: 'resolver prop not wired' })
          return
        }
        patchTelemetry({ lookupState: 'LOOKING_UP' })
        const result = await resolver(normalized)
        setResolverResult(result)
        patchTelemetry({ lookupState: result.status === 'FOUND' ? 'FOUND' : 'NOT_FOUND' })
        return
      }

      // TEST MODE: CONTEXT_SIM — synthesize a FOUND lookup and invoke onContextAction only.
      if (testMode === 'CONTEXT_SIM') {
        if (!onContextAction) {
          patchTelemetry({ contextState: 'ERROR', lastErrorName: 'NoContextAdapter', lastErrorMessage: 'onContextAction prop not wired' })
          return
        }
        const synthetic: LookupResult = {
          status: 'FOUND',
          entityType: 'PRODUCT',
          productId: 'sim-product-id',
          barcode: normalized,
        }
        patchTelemetry({ lookupState: 'FOUND', contextState: 'EXECUTING' })
        try {
          await onContextAction(synthetic)
          patchTelemetry({ contextState: 'SUCCESS' })
          setContextActionResult('SUCCESS')
        } catch (e) {
          patchTelemetry({ contextState: 'ERROR', lastErrorName: (e as Error)?.name ?? 'Error', lastErrorMessage: (e as Error)?.message ?? String(e) })
          setContextActionResult('ERROR')
        }
        return
      }

      // PRODUCTION PATH (testMode OFF or MANUAL_SIM):
      // If resolver is wired, run the full pipeline (resolve → context action)
      // and handle FOUND/NOT_FOUND inline. onResult is NOT called in this path
      // to avoid double-execution (the parent's onResult would re-resolve).
      // If resolver is NOT wired (simple path), just call onResult and
      // let the parent do everything.
      if (resolver) {
        patchTelemetry({ lookupState: 'LOOKING_UP' })
        let lookup: LookupResult
        try {
          lookup = await resolver(normalized)
        } catch (e) {
          // LOOKUP ERROR — never close.
          patchTelemetry({
            lookupState: 'ERROR',
            lastErrorName: (e as Error)?.name ?? 'Error',
            lastErrorMessage: (e as Error)?.message ?? String(e),
          })
          toast.error(`Barcode "${normalized}" gagal dicari: ${(e as Error)?.message ?? 'error'}`)
          return
        }
        patchTelemetry({
          lookupState: lookup.status === 'FOUND' ? 'FOUND' : 'NOT_FOUND',
        })
        if (lookup.status === 'FOUND') {
          if (onContextAction) {
            patchTelemetry({ contextState: 'EXECUTING' })
            let actionOk = false
            try {
              const res = await onContextAction(lookup)
              actionOk = res !== false
              patchTelemetry({ contextState: actionOk ? 'SUCCESS' : 'ERROR' })
            } catch (e) {
              // CART/ACTION ERROR — never close.
              actionOk = false
              patchTelemetry({
                contextState: 'ERROR',
                lastErrorName: (e as Error)?.name ?? 'Error',
                lastErrorMessage: (e as Error)?.message ?? String(e),
              })
            }
            // Auto-close ONLY on a genuine success (FOUND + action returned true)
            // AND only when the context opted into closeOnSuccess.
            if (actionOk && closeOnSuccess) {
              onOpenChange(false)
            }
          } else {
            // FOUND but no context adapter — fall back to onResult so the
            // parent can still handle it.
            const ok = await onResult(normalized)
            if (ok !== false && closeOnSuccess) onOpenChange(false)
          }
        } else {
          // NOT_FOUND — show the contract message inline. Never close.
          toast.error(`Barcode "${normalized}" terbaca, tetapi belum terdaftar.`)
        }
      } else {
        // Simple path: delegate resolve + action to the parent's onResult.
        // The parent returns true on success so the dialog can auto-close
        // when closeOnSuccess is set; returning false/void keeps it open.
        const ok = await onResult(normalized)
        if (ok === true && closeOnSuccess) {
          onOpenChange(false)
        }
      }
    } catch (e) {
      // Never silently swallow — record in telemetry.
      recordError((e as Error)?.name ?? 'Error', (e as Error)?.message ?? String(e))
    } finally {
      // Always release the processing lock.
      processingLockRef.current = false
    }
  }, [onResult, resolver, onContextAction, closeOnSuccess, onOpenChange, testMode, patchTelemetry, recordError])

  // Keep handleDetectedRef in sync so ZXing callback always uses the latest closure.
  useEffect(() => { handleDetectedRef.current = handleDetected }, [handleDetected])

  // Visual + haptic feedback (Phase 5).
  const triggerFeedback = useCallback(() => {
    setFlash(true)
    setTimeout(() => setFlash(false), 180)
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
  }, [])

  // ────────────────────────────────────────────────────────────────────────────
  // PHASE 3 — Native BarcodeDetector decode (one frame)
  // ────────────────────────────────────────────────────────────────────────────

  const decodeNativeFrame = useCallback(async (video: HTMLVideoElement): Promise<{ rawValue: string; format: string } | null> => {
    const detector = nativeDetectorRef.current
    if (!detector) return null
    // Prevent overlapping detect() calls.
    if (detectInFlightRef.current) return null
    detectInFlightRef.current = true
    try {
      const results = await detector.detect(video)
      if (results && results.length > 0) {
        const v = results[0].rawValue
        const f = results[0].format
        if (v) {
          nativeErrorStreakRef.current = 0
          return { rawValue: v, format: f ?? '' }
        }
      }
    } catch (err) {
      nativeErrorStreakRef.current += 1
      const name = (err as Error)?.name ?? 'Error'
      // NotFoundException-like errors are expected on every non-matching frame.
      if (name !== 'NotFoundError' && name !== 'NotFoundException') {
        // Repeated non-trivial errors → arm fallback.
        if (nativeErrorStreakRef.current >= 5 && !fallbackArmedRef.current) {
          fallbackArmedRef.current = true
          patchTelemetry({
            detectorImpl: 'ZXING_FALLBACK',
            lastErrorName: name,
            lastErrorMessage: `Native detector failed ${nativeErrorStreakRef.current}× — falling back to ZXing`,
          })
        }
      }
    } finally {
      detectInFlightRef.current = false
    }
    return null
  }, [patchTelemetry])

  // ────────────────────────────────────────────────────────────────────────────
  // PHASE 3 — ZXing fallback (BrowserMultiFormatReader via decodeFromStream)
  // ────────────────────────────────────────────────────────────────────────────

  const startZxingFallback = useCallback(async () => {
    if (zxingControlsRef.current) return // already running
    if (!streamRef.current || !videoRef.current) return
    try {
      // DYNAMIC IMPORT — never statically resolved at build time.
      // If @zxing/browser or @zxing/library is not installed, the dynamic
      // import rejects and we fall through to the catch block (graceful
      // degradation: native detector + manual input remain available).
      const [zxingBrowser, zxingLibrary] = await Promise.all([
        import('@zxing/browser') as Promise<ZxBrowserModule>,
        import('@zxing/library') as Promise<ZxLibraryModule>,
      ])
      const hints = new Map<number, unknown>()
      hints.set(zxingLibrary.DecodeHintType.POSSIBLE_FORMATS, ZXING_FORMATS)
      hints.set(zxingLibrary.DecodeHintType.TRY_HARDER, true)
      const reader = new zxingBrowser.BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 })
      zxingReaderRef.current = reader
      // decodeFromStream uses our existing stream + video element. Returns
      // controls whose .stop() cancels the internal scan loop.
      // CRITICAL: Use handleDetectedRef.current instead of handleDetected directly
      // to avoid stale closure — the ZXing callback captures this closure once at
      // creation, so we must always dereference the ref to get the latest version.
      void reader.decodeFromStream(streamRef.current, videoRef.current, (result, _err, controls) => {
        if (result && result.getText()) {
          // Get ZXing barcode format name from the result
          const fmt = result.getBarcodeFormat()?.getName?.() ?? ''
          void handleDetectedRef.current?.(result.getText(), fmt)
        } else if (_err && (_err as Error)?.name !== 'NotFoundException') {
          // Swallow transient non-fatal errors silently — they fire on every
          // non-matching frame. The controls param lets us stop if needed.
          // We don't stop here; let the loop continue.
          void controls
        }
      }).then((controls) => {
        zxingControlsRef.current = controls
        patchTelemetry({ detectorImpl: 'ZXING_FALLBACK' })
      }).catch((e) => {
        patchTelemetry({
          lastErrorName: (e as Error)?.name ?? 'ZXingStartError',
          lastErrorMessage: (e as Error)?.message ?? String(e),
        })
      })
    } catch (e) {
      // Dynamic import failed OR @zxing init threw. Most common cause:
      // @zxing/browser not installed in this deploy. Log + keep native path.
      patchTelemetry({
        lastErrorName: (e as Error)?.name ?? 'ZXingUnavailable',
        lastErrorMessage: (e as Error)?.message ?? String(e),
      })
    }
  }, [patchTelemetry])

  // ────────────────────────────────────────────────────────────────────────────
  // PHASE 3 — Native detect loop (rAF) — only runs while native detector
  // is active and fallback has NOT been armed.
  // ────────────────────────────────────────────────────────────────────────────

  const nativeDetectLoop = useCallback(async () => {
    const video = videoRef.current
    if (!video || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(() => detectLoopRef.current())
      return
    }
    // Update readyState telemetry (best-effort, throttled by frame count).
    if (framesProcessedRef.current % 10 === 0) {
      patchTelemetry({ videoReadyState: video.readyState })
    }
    // If fallback was armed, stop scheduling native loop and ensure ZXing is started.
    if (fallbackArmedRef.current) {
      if (!zxingControlsRef.current && streamRef.current) {
        void startZxingFallback()
      }
      rafRef.current = null
      return
    }
    // Only decode if native detector is still our active impl.
    if (nativeDetectorRef.current && !fallbackArmedRef.current) {
      const v = await decodeNativeFrame(video)
      framesProcessedRef.current += 1
      if (framesProcessedRef.current % 10 === 0) {
        patchTelemetry({ framesProcessed: framesProcessedRef.current })
      }
      if (v) {
        void handleDetected(v.rawValue, v.format)
      }
    }
    rafRef.current = requestAnimationFrame(() => detectLoopRef.current())
  }, [decodeNativeFrame, handleDetected, patchTelemetry, startZxingFallback])

  // Keep detectLoopRef in sync with the latest closure.
  useEffect(() => {
    detectLoopRef.current = nativeDetectLoop
  }, [nativeDetectLoop])

  // ────────────────────────────────────────────────────────────────────────────
  // PHASE 2 — Camera stop (release everything)
  // ────────────────────────────────────────────────────────────────────────────

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (zxingControlsRef.current) {
      try { zxingControlsRef.current.stop() } catch { /* ignore */ }
      zxingControlsRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      try { videoRef.current.srcObject = null } catch { /* ignore */ }
    }
    nativeDetectorRef.current = null
    zxingReaderRef.current = null
    nativeErrorStreakRef.current = 0
    fallbackArmedRef.current = false
    detectInFlightRef.current = false
    framesProcessedRef.current = 0
    setStatus('idle')
  }, [])

  // ────────────────────────────────────────────────────────────────────────────
  // PHASE 2 — Camera start (request only after dialog opens; prefer rear)
  // ────────────────────────────────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    // Reset dialog state at the start of each camera session.
    // NOTE: telemetry reset is handled by the open-effect (not here) to
    // avoid wiping telemetry on startCamera identity changes.
    setShowManual(false)
    setManualValue('')
    setStatus('requesting')
    setErrorMsg('')

    // Prevent two active streams.
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('unsupported')
      setErrorMsg('Browser tidak mendukung akses kamera.')
      setShowManual(true)
      return
    }

    // Best-effort permission telemetry.
    try {
      if (navigator.permissions?.query) {
        const perm = await navigator.permissions.query({ name: 'camera' as PermissionName })
        patchTelemetry({ permission: perm.state })
        perm.onchange = () => patchTelemetry({ permission: perm.state })
      }
    } catch { /* some browsers don't support 'camera' permission name */ }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream

      // Record active camera label.
      const track = stream.getVideoTracks()[0]
      patchTelemetry({ cameraLabel: track?.label ?? '' })

      // Bind stream + await play().
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => { /* autoplay may be blocked; video will start on loadedmetadata */ })
      }

      // Wait for loadedmetadata + adequate readyState before starting detector.
      await new Promise<void>((resolve) => {
        const v = videoRef.current
        if (!v) return resolve()
        if (v.readyState >= 2) return resolve()
        const onReady = () => {
          v.removeEventListener('loadedmetadata', onReady)
          v.removeEventListener('canplay', onReady)
          resolve()
        }
        v.addEventListener('loadedmetadata', onReady)
        v.addEventListener('canplay', onReady)
        // Safety timeout — don't block forever if the camera is slow.
        setTimeout(resolve, 1500)
      })
      patchTelemetry({ videoReadyState: videoRef.current?.readyState ?? 0 })

      // Torch capability check (best-effort).
      try {
        const caps = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean } | undefined
        setTorchSupported(Boolean(caps?.torch))
      } catch {
        setTorchSupported(false)
      }

      // ── Initialize detectors ──
      // Primary: native BarcodeDetector (Chrome/Android).
      const NativeCtor = getNativeBarcodeDetectorCtor()
      if (NativeCtor) {
        try {
          // Feature-detect supported formats and intersect with our retail set.
          let supported: string[] = NATIVE_FORMATS
          if (NativeCtor.getSupportedFormats) {
            try {
              const all = await NativeCtor.getSupportedFormats()
              if (Array.isArray(all) && all.length > 0) {
                supported = NATIVE_FORMATS.filter((f) => all.includes(f))
              }
            } catch { /* ignore — use default list */ }
          }
          nativeDetectorRef.current = new NativeCtor({ formats: supported })
          patchTelemetry({
            detectorImpl: 'NATIVE_BARCODE_DETECTOR',
            supportedFormats: supported,
          })
        } catch (e) {
          nativeDetectorRef.current = null
          patchTelemetry({
            detectorImpl: 'NONE',
            lastErrorName: (e as Error)?.name ?? 'NativeInitError',
            lastErrorMessage: (e as Error)?.message ?? String(e),
          })
        }
      } else {
        patchTelemetry({ detectorImpl: 'NONE', supportedFormats: [] })
      }

      setStatus('active')

      // Start detection loop.
      if (nativeDetectorRef.current && !fallbackArmedRef.current) {
        // Native primary — start rAF loop.
        rafRef.current = requestAnimationFrame(nativeDetectLoop)
      } else {
        // No native detector — immediately start ZXing fallback.
        fallbackArmedRef.current = true
        void startZxingFallback()
      }
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string }
      if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
        setStatus('denied')
        setErrorMsg('Akses kamera ditolak. Izinkan kamera di pengaturan browser, atau ketik manual di bawah.')
        patchTelemetry({ permission: 'denied', lastErrorName: e?.name ?? 'NotAllowedError', lastErrorMessage: e?.message ?? '' })
      } else if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') {
        setStatus('unsupported')
        setErrorMsg('Tidak ada kamera yang terdeteksi pada perangkat ini.')
        patchTelemetry({ lastErrorName: e?.name ?? 'NotFoundError', lastErrorMessage: e?.message ?? '' })
      } else if (e?.name === 'NotReadableable' || e?.name === 'NotReadableError') {
        setStatus('error')
        setErrorMsg('Kamera sedang digunakan aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.')
        patchTelemetry({ lastErrorName: e?.name ?? 'NotReadableError', lastErrorMessage: e?.message ?? '' })
      } else {
        setStatus('error')
        setErrorMsg(e?.message || 'Gagal mengakses kamera.')
        patchTelemetry({ lastErrorName: e?.name ?? 'Error', lastErrorMessage: e?.message ?? '' })
      }
      setShowManual(true)
    }
  }, [nativeDetectLoop, startZxingFallback, patchTelemetry])

  // Open → start camera; close → stop camera.
  // Uses refs to avoid re-running the effect when startCamera/stopCamera
  // identities change (which happens when handleDetected deps change after
  // a cart update). This prevents telemetry from being reset mid-scan.
  const startCameraRef = useRef(startCamera)
  const stopCameraRef = useRef(stopCamera)
  useEffect(() => { startCameraRef.current = startCamera }, [startCamera])
  useEffect(() => { stopCameraRef.current = stopCamera }, [stopCamera])

  useEffect(() => {
    if (open) {
      // Reset telemetry + dialog state only on genuine open (not on every
      // startCamera identity change).
      setTelemetry(INITIAL_TELEMETRY)
      setLastScan('')
      setResolverResult(null)
      setContextActionResult('')
      void startCameraRef.current()
    } else {
      stopCameraRef.current()
    }
    return () => {
      stopCameraRef.current()
    }
  }, [open])

  // If native detector keeps failing, the nativeDetectLoop itself arms the
  // fallback and starts ZXing (no separate effect needed).

  // ────────────────────────────────────────────────────────────────────────────
  // UI handlers
  // ────────────────────────────────────────────────────────────────────────────

  const toggleTorch = useCallback(async () => {
    if (!streamRef.current) return
    try {
      const track = streamRef.current.getVideoTracks()[0]
      const caps = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean } | undefined
      if (!caps?.torch) return
      const next = !torchOn
      await track.applyConstraints({ advanced: [{ torch: next } as unknown as MediaTrackConstraintSet] })
      setTorchOn(next)
    } catch { /* ignore */ }
  }, [torchOn])

  const submitManual = useCallback(() => {
    // Read directly from DOM as a fallback when React's controlled state
    // hasn't flushed yet (programmatic native setter + immediate submit).
    const stateValue = manualValue.trim()
    const domValue = manualValueRef.current?.value.trim() ?? ''
    const v = stateValue || domValue
    if (!v) return
    setManualValue('')
    // Runs the exact same handleDetected() pipeline (Phase 6 manual simulation).
    void handleDetected(v)
  }, [manualValue, handleDetected])

  const handleClose = useCallback(() => {
    stopCamera()
    onOpenChange(false)
  }, [stopCamera, onOpenChange])

  // ────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────────────

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
          <div className="flex items-center gap-1">
            {/* Telemetry toggle — dev-only diagnostic (Phase 1) */}
            {isDev && (
              <button
                onClick={() => setShowTelemetry((v) => !v)}
                className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${showTelemetry ? 'text-amber-400 bg-amber-500/10' : 'text-slate-500 hover:text-white hover:bg-white/[0.06]'}`}
                aria-label="Toggle telemetry"
                title="Toggle telemetry (Phase 1)"
              >
                <Bug className="h-4 w-4" />
              </button>
            )}
            {/* Test-mode panel toggle — dev-only diagnostic (Phase 6) */}
            {isDev && (
              <button
                onClick={() => setShowTestPanel((v) => !v)}
                className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${showTestPanel ? 'text-fuchsia-400 bg-fuchsia-500/10' : 'text-slate-500 hover:text-white hover:bg-white/[0.06]'}`}
                aria-label="Toggle test panel"
                title="Toggle test panel (Phase 6)"
              >
                <FlaskConical className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={handleClose}
              className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors"
              aria-label="Tutup scanner"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </DialogHeader>

        {/* Camera viewport */}
        <div className="relative aspect-[4/3] bg-black/60 mx-4 rounded-xl overflow-hidden border border-white/[0.06]">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            muted
            playsInline
          />

          {/* Detection flash overlay (Phase 5 visual feedback) */}
          {flash && (
            <div className="absolute inset-0 bg-emerald-400/25 pointer-events-none animate-pulse" />
          )}

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

          {/* Detector-impl badge (top-left) */}
          {status === 'active' && (
            <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur text-[10px] font-mono text-slate-300 flex items-center gap-1">
              <Crosshair className="h-3 w-3 text-emerald-400" />
              {telemetry.detectorImpl === 'NATIVE_BARCODE_DETECTOR' && 'NATIVE'}
              {telemetry.detectorImpl === 'ZXING_FALLBACK' && 'ZXING'}
              {telemetry.detectorImpl === 'NONE' && '—'}
            </div>
          )}

          {/* Last scan feedback — shows format + rawValue */}
          {lastScan && (
            <div className="absolute bottom-2 left-2 right-2 bg-emerald-500/15 border border-emerald-500/30 backdrop-blur rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
              <ScanBarcode className="h-3 w-3 text-emerald-400 shrink-0" />
              {telemetry.lastDetectedFormat && (
                <span className="text-[10px] text-emerald-400/70 font-mono bg-emerald-500/10 px-1 rounded">{telemetry.lastDetectedFormat}</span>
              )}
              <span className="text-[11px] text-emerald-300 truncate font-mono">{lastScan}</span>
            </div>
          )}
        </div>

        {/* ── Phase 1: Telemetry overlay ── */}
        {showTelemetry && (
          <div className="mx-4 mt-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-2.5 text-[10px] font-mono text-amber-200/90 max-h-44 overflow-y-auto">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-amber-400 font-semibold tracking-wide">TELEMETRY (Phase 1)</span>
              <button
                onClick={() => setTelemetry(INITIAL_TELEMETRY)}
                className="text-[9px] text-amber-300/60 hover:text-amber-200 underline"
              >
                reset
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              <span className="text-amber-400/70">permission:</span><span>{telemetry.permission}</span>
              <span className="text-amber-400/70">cameraLabel:</span><span className="truncate">{telemetry.cameraLabel || '—'}</span>
              <span className="text-amber-400/70">readyState:</span><span>{telemetry.videoReadyState}</span>
              <span className="text-amber-400/70">detector:</span><span className="text-emerald-300">{telemetry.detectorImpl}</span>
              <span className="text-amber-400/70">formats:</span><span className="truncate">{telemetry.supportedFormats.join(',') || '—'}</span>
              <span className="text-amber-400/70">frames:</span><span>{telemetry.framesProcessed}</span>
              <span className="text-amber-400/70">rawValue:</span><span className="truncate">{telemetry.lastRawValue || '—'}</span>
              <span className="text-amber-400/70">format:</span><span className="truncate text-sky-300">{telemetry.lastDetectedFormat || '—'}</span>
              <span className="text-amber-400/70">normalized:</span><span className="truncate text-emerald-300">{telemetry.normalizedBarcode || '—'}</span>
              <span className="text-amber-400/70">lookup:</span>
              <span className={
                telemetry.lookupState === 'FOUND' ? 'text-emerald-300' :
                telemetry.lookupState === 'NOT_FOUND' ? 'text-rose-300' :
                telemetry.lookupState === 'ERROR' ? 'text-rose-400' :
                telemetry.lookupState === 'LOOKING_UP' ? 'text-sky-300' : ''
              }>{telemetry.lookupState}</span>
              <span className="text-amber-400/70">context:</span>
              <span className={
                telemetry.contextState === 'SUCCESS' ? 'text-emerald-300' :
                telemetry.contextState === 'ERROR' ? 'text-rose-400' :
                telemetry.contextState === 'EXECUTING' ? 'text-sky-300' : ''
              }>{telemetry.contextState}</span>
              <span className="text-amber-400/70">errName:</span><span className="truncate text-rose-300">{telemetry.lastErrorName || '—'}</span>
              <span className="text-amber-400/70">errMsg:</span><span className="truncate text-rose-300">{telemetry.lastErrorMessage || '—'}</span>
            </div>
          </div>
        )}

        {/* ── Phase 6: Test panel ── */}
        {showTestPanel && (
          <div className="mx-4 mt-2 rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/[0.04] p-2.5 text-[11px]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-fuchsia-300 font-semibold tracking-wide flex items-center gap-1">
                <FlaskConical className="h-3 w-3" />
                TEST MODE (Phase 6)
              </span>
              <button
                onClick={() => setTestMode('OFF')}
                className={`text-[10px] px-1.5 py-0.5 rounded ${testMode === 'OFF' ? 'bg-fuchsia-500/20 text-fuchsia-200' : 'text-fuchsia-300/60 hover:text-fuchsia-200'}`}
              >
                OFF
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1 mb-2">
              <button
                onClick={() => setTestMode('DETECTOR_ONLY')}
                className={`text-[10px] px-1.5 py-1 rounded border ${testMode === 'DETECTOR_ONLY' ? 'bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-200' : 'border-white/[0.08] text-slate-400 hover:text-white'}`}
              >
                1. Detector only
              </button>
              <button
                onClick={() => setTestMode('MANUAL_SIM')}
                className={`text-[10px] px-1.5 py-1 rounded border ${testMode === 'MANUAL_SIM' ? 'bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-200' : 'border-white/[0.08] text-slate-400 hover:text-white'}`}
              >
                2. Manual sim
              </button>
              <button
                onClick={() => setTestMode('RESOLVER_ONLY')}
                className={`text-[10px] px-1.5 py-1 rounded border ${testMode === 'RESOLVER_ONLY' ? 'bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-200' : 'border-white/[0.08] text-slate-400 hover:text-white'}`}
              >
                3. Resolver only
              </button>
              <button
                onClick={() => setTestMode('CONTEXT_SIM')}
                className={`text-[10px] px-1.5 py-1 rounded border ${testMode === 'CONTEXT_SIM' ? 'bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-200' : 'border-white/[0.08] text-slate-400 hover:text-white'}`}
              >
                4. Context sim
              </button>
            </div>
            {testMode !== 'OFF' && (
              <div className="text-[10px] text-fuchsia-300/80">
                <span className="text-fuchsia-400">ACTIVE:</span> {testMode}
                {testMode === 'RESOLVER_ONLY' && !resolver && <span className="text-rose-300 ml-1">(resolver not wired)</span>}
                {testMode === 'CONTEXT_SIM' && !onContextAction && <span className="text-rose-300 ml-1">(onContextAction not wired)</span>}
              </div>
            )}
            {resolverResult && (
              <pre className="mt-2 text-[9px] text-emerald-300 bg-black/40 rounded p-1.5 overflow-x-auto max-h-24">
                {JSON.stringify(resolverResult, null, 2)}
              </pre>
            )}
            {contextActionResult && (
              <div className="mt-1 text-[10px] text-sky-300">context-action: {contextActionResult}</div>
            )}
          </div>
        )}

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
                type="button"
                onClick={submitManual}
                className="h-9 px-4 text-xs bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30"
              >
                <Play className="h-3 w-3 mr-1" />
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
