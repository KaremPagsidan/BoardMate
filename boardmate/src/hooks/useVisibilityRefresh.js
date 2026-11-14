import { useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';

// Realtime is the fast path. Poll/focus also repair missed events and reconnects.
export default function useVisibilityRefresh(refresh, enabled = true) {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;
    let running = false;
    let queued = false;
    const reload = async () => {
      if (disposed) return;
      if (running) { queued = true; return; }
      running = true;
      try { await refreshRef.current(); }
      catch { /* Callers handle fetch errors; a disconnected stream is not a suspension error. */ }
      finally {
        running = false;
        if (queued && !disposed) { queued = false; reload(); }
      }
    };
    const channel = supabase.channel(`visibility-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'boardmate_visibility_revision' }, reload)
      .subscribe(status => { if (status === 'SUBSCRIBED') reload(); });
    // Refresh immediately even when the realtime connection cannot be established.
    reload();
    const timer = window.setInterval(reload, 15_000);
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    window.addEventListener('focus', reload);
    window.addEventListener('online', reload);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', reload);
      window.removeEventListener('online', reload);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [enabled]);
}
