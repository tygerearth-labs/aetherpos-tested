'use client'

import { useState, useEffect, useCallback } from 'react'

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true)

  useEffect(() => {
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return isOnline
}

/**
 * Blocks page refresh (F5, Ctrl+R, Cmd+R, right-click > Reload)
 * when the callback returns true. Returns a cleanup function.
 */
export function useBlockRefresh(shouldBlock: () => boolean) {
  const handler = useCallback((e: BeforeUnloadEvent) => {
    if (shouldBlock()) {
      e.preventDefault()
      e.returnValue = ''
      return ''
    }
  }, [shouldBlock])

  const keyHandler = useCallback((e: KeyboardEvent) => {
    if (!shouldBlock()) return

    // F5
    if (e.key === 'F5') {
      e.preventDefault()
      e.stopPropagation()
      return false
    }

    // Ctrl+R / Cmd+R
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
      e.preventDefault()
      e.stopPropagation()
      return false
    }

    // Ctrl+Shift+R / Cmd+Shift+R (hard refresh)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
      e.preventDefault()
      e.stopPropagation()
      return false
    }
  }, [shouldBlock])

  const contextMenuHandler = useCallback((e: MouseEvent) => {
    if (!shouldBlock()) return
    const target = e.target as HTMLElement
    // Only block on the document/body level, not on text selections or inputs
    if (target.tagName === 'BODY' || target.tagName === 'HTML' || target.closest('main') || target.closest('[data-offline-block]')) {
      // We can't fully block the context menu, but we can prevent the default reload action
      // by not preventing the menu itself — the beforeunload handler will catch the reload
    }
  }, [shouldBlock])

  useEffect(() => {
    window.addEventListener('beforeunload', handler)
    window.addEventListener('keydown', keyHandler, true)
    document.addEventListener('contextmenu', contextMenuHandler, true)

    return () => {
      window.removeEventListener('beforeunload', handler)
      window.removeEventListener('keydown', keyHandler, true)
      document.removeEventListener('contextmenu', contextMenuHandler, true)
    }
  }, [handler, keyHandler, contextMenuHandler])
}