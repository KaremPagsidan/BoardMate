import { uiText } from './uiText';
export function getAuthenticationErrorMessage(error) {
  const message = error?.message || 'An unexpected authentication error occurred.';
  if (/failed to fetch|networkerror|network request failed|err_internet_disconnected|load failed/i.test(message)) {
    return 'Could not connect to BoardMate login. Check your internet connection and try again. If you are online, check whether your network or browser is blocking access to Supabase.';
  }
  return uiText(message);
}
