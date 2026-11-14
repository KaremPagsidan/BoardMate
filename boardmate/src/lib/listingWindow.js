import { supabase } from '../supabaseClient';

let synchronizedUserId = null;
let authSubscription = null;
let refreshSequence = 0;
let latestExpiry = 0;

export function enableListingSessionSync(userId) {
  if (!userId || synchronizedUserId === userId || typeof supabase.auth.onAuthStateChange !== 'function') return;
  authSubscription?.unsubscribe();
  synchronizedUserId = userId;
  refreshSequence += 1;
  latestExpiry = 0;
  authSubscription = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      // Never restore a signed-out tab from a later refresh notification.
      synchronizedUserId = null;
      refreshSequence += 1;
      authSubscription?.unsubscribe();
      authSubscription = null;
      return;
    }
    if (event !== 'TOKEN_REFRESHED' || !session || session.user.id !== synchronizedUserId
      || Number(session.expires_at || 0) < latestExpiry) return;
    latestExpiry = Number(session.expires_at || 0);
    const sequence = ++refreshSequence;
    // The SDK broadcasts refresh events across tabs but custom sessionStorage
    // remains per tab. Mirror matching-account refreshes outside the auth
    // callback's lock. setSession emits SIGNED_IN, so this does not echo.
    window.setTimeout(() => {
      if (sequence !== refreshSequence || session.user.id !== synchronizedUserId) return;
      supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token }).catch(() => {});
    }, 0);
  }).data.subscription;
}

// Sessions remain in sessionStorage. A short-lived, same-origin channel hands
// the new tab its session without putting credentials in URLs/localStorage or
// leaving window.opener accessible. Context-menu/unsupported-browser opens can
// still sign in directly on the detail page.
export function prepareListingWindow(event, userId) {
  if (!userId || typeof BroadcastChannel === 'undefined') return;
  const url = new URL(event.currentTarget.href);
  if (url.origin !== window.location.origin || !url.hash.startsWith('#listing/')) return;
  enableListingSessionSync(userId);
  const ticket = crypto.randomUUID();
  let channel;
  try { channel = new BroadcastChannel(`boardmate-listing-${ticket}`); }
  catch { return; }
  let responding = false;
  const timer = window.setTimeout(() => channel.close(), 30_000);
  channel.onmessage = async ({ data }) => {
    if (responding || data?.type !== 'session-request') return;
    responding = true;
    try {
      const { data: sessionData, error } = await supabase.auth.getSession();
      if (!error && sessionData.session?.user.id === userId) {
        channel.postMessage({ type: 'session-response', userId,
          access_token: sessionData.session.access_token, refresh_token: sessionData.session.refresh_token });
      }
    } catch {
      // The child falls back to its sign-in form if the session cannot be read.
    } finally {
      window.clearTimeout(timer);
      channel.close();
    }
  };
  const hash = url.hash.split('?')[0];
  const query = new URLSearchParams(url.hash.split('?')[1]);
  query.set('handoff', ticket);
  query.set('account', userId);
  url.hash = `${hash.slice(1)}?${query}`;
  event.currentTarget.href = url.href;
}

export async function restoreListingSession(route, timeoutMs = 5000) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session) { enableListingSessionSync(data.session.user.id); return data.session; }
  if (!route.handoff || !route.account || typeof BroadcastChannel === 'undefined') return null;
  let channel;
  try { channel = new BroadcastChannel(`boardmate-listing-${route.handoff}`); }
  catch { return null; }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      settled = true;
      window.clearTimeout(timer);
      window.clearInterval(retry);
      channel.close();
    };
    const timer = window.setTimeout(() => { finish(); resolve(null); }, timeoutMs);
    const retry = window.setInterval(() => channel.postMessage({ type: 'session-request' }), 350);
    channel.onmessage = async ({ data: incoming }) => {
      if (settled || incoming?.type !== 'session-response' || incoming.userId !== route.account
        || typeof incoming.access_token !== 'string' || typeof incoming.refresh_token !== 'string') return;
      finish();
      try {
        const result = await supabase.auth.setSession({ access_token: incoming.access_token, refresh_token: incoming.refresh_token });
        if (result.error) throw result.error;
        if (result.data.session?.user.id !== route.account) throw new Error('Sign in to continue to this listing.');
        enableListingSessionSync(route.account);
        resolve(result.data.session);
      } catch (failure) { reject(failure); }
    };
    channel.postMessage({ type: 'session-request' });
  });
}
