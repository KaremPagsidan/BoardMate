import { useEffect, useRef, useState } from 'react';

function getTopScrollableElement(target) {
  let element = target instanceof Element ? target : target?.parentElement;
  while (element && element !== document.body) {
    const { overflowY } = window.getComputedStyle(element);
    if (/(auto|scroll|overlay)/.test(overflowY) && element.scrollHeight > element.clientHeight) {
      return element.scrollTop <= 0 ? element : null;
    }
    element = element.parentElement;
  }

  const documentScroller = document.scrollingElement;
  return documentScroller?.scrollTop <= 0 ? documentScroller : null;
}

export default function usePullToRefresh(onRefresh, enabled = true) {
  const [pullDistance, setPullDistance] = useState(0);
  const [status, setStatus] = useState('');
  const refreshCallback = useRef(onRefresh);
  const statusRef = useRef(status);

  useEffect(() => {
    refreshCallback.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    let gesture = null;
    let resetTimer;

    const handleTouchStart = event => {
      const mobileDevice = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
        || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) <= 1024);
      if (!window.matchMedia('(max-width: 639px)').matches && !mobileDevice
        || event.touches.length !== 1
        || statusRef.current === 'refreshing') return;
      const scrollElement = getTopScrollableElement(event.target);
      if (!scrollElement) return;
      gesture = {
        startX: event.touches[0].clientX,
        startY: event.touches[0].clientY,
        scrollElement,
        distance: 0,
      };
    };

    const handleTouchMove = event => {
      if (!gesture || event.touches.length !== 1) return;
      const deltaX = event.touches[0].clientX - gesture.startX;
      const deltaY = event.touches[0].clientY - gesture.startY;
      if (deltaY <= 0 || Math.abs(deltaX) > deltaY || gesture.scrollElement.scrollTop > 0) {
        gesture = null;
        setPullDistance(0);
        return;
      }

      if (deltaY < 8) return;
      if (event.cancelable) event.preventDefault();
      gesture.distance = Math.min((deltaY - 8) * 0.6, 90);
      setPullDistance(gesture.distance);
    };

    const handleTouchEnd = async () => {
      if (!gesture) return;
      const shouldRefresh = gesture.distance >= 60;
      gesture = null;
      setPullDistance(0);
      if (!shouldRefresh) return;

      window.clearTimeout(resetTimer);
      statusRef.current = 'refreshing';
      setStatus('refreshing');
      try {
        await refreshCallback.current();
        statusRef.current = 'refreshed';
        setStatus('refreshed');
      } catch {
        statusRef.current = 'failed';
        setStatus('failed');
      } finally {
        resetTimer = window.setTimeout(() => {
          statusRef.current = '';
          setStatus('');
        }, 1400);
      }
    };

    const handleTouchCancel = () => {
      gesture = null;
      setPullDistance(0);
    };

    document.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
    document.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
    document.addEventListener('touchend', handleTouchEnd, { capture: true, passive: true });
    document.addEventListener('touchcancel', handleTouchCancel, { capture: true, passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart, true);
      document.removeEventListener('touchmove', handleTouchMove, true);
      document.removeEventListener('touchend', handleTouchEnd, true);
      document.removeEventListener('touchcancel', handleTouchCancel, true);
      window.clearTimeout(resetTimer);
    };
  }, [enabled]);

  const isVisible = pullDistance > 0 || status.length > 0;
  if (!enabled || !isVisible) return null;

  const message = status === 'refreshing'
    ? 'Refreshing…'
    : status === 'refreshed'
      ? 'Updated'
      : status === 'failed'
        ? 'Could not refresh'
        : pullDistance >= 60
          ? 'Release to refresh'
          : 'Pull to refresh';
  const tone = status === 'failed'
    ? 'bg-red-50 text-red-800'
    : status === 'refreshed'
      ? 'bg-emerald-50 text-emerald-800'
      : 'bg-white text-gray-700';

  return (
    <div
      className={`pointer-events-none fixed left-1/2 z-[100] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold shadow-md transition-transform ${tone}`}
      role="status"
      aria-live="polite"
      style={{ top: 8, transform: `translate(-50%, ${isVisible ? `${Math.max(pullDistance, 12)}px` : '-150%'})` }}
    >
      {status === 'refreshing' && <span className="boardmate-refresh-spinner" aria-hidden="true" />}
      {status === 'refreshed' && <span aria-hidden="true">✓</span>}
      {status === 'failed' && <span aria-hidden="true">!</span>}
      {message}
    </div>
  );
}
