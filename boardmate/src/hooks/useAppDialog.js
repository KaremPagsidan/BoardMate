import { createContext, useContext } from 'react';

export const AppDialogContext = createContext(null);

export default function useAppDialog() {
  const value = useContext(AppDialogContext);
  if (!value) throw new Error('App dialogs require AppDialogProvider.');
  return value;
}
