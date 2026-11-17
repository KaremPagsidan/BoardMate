import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppDialogContext } from '../hooks/useAppDialog';
import '../appDialog.css';
import { uiText } from '../lib/uiText';
import useFrameDialog from '../hooks/useFrameDialog';

export function AppNoticeDialog({ item, onAnswer }) {
  const dialog = useRef(null);
  useFrameDialog(dialog);
  useEffect(() => {
    const node = dialog.current;
    node.showModal();
    return () => node.close();
  }, []);
  return <dialog ref={dialog} className="bm-app-dialog" role="alertdialog" aria-labelledby="app-dialog-title" aria-describedby="app-dialog-message" onCancel={event => { event.preventDefault(); onAnswer(false); }}>
    <h2 id="app-dialog-title" className={item.variant === 'success' ? 'bm-app-dialog-title-success' : ''}>{uiText(item.title)}</h2>
    <p id="app-dialog-message">{uiText(item.message)}</p>
    <div className="bm-app-dialog-actions">
      {item.confirm && <button type="button" onClick={() => onAnswer(false)}>Cancel</button>}
      <button type="button" className="bm-app-dialog-primary" onClick={() => onAnswer(true)}>{item.confirm ? 'Confirm' : 'OK'}</button>
    </div>
  </dialog>;
}

export default function AppDialogProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const pending = useRef(new Map());
  const notify = useCallback((message, title = 'Notification', variant = 'info') => {
    setQueue(current => [...current, { id: crypto.randomUUID(), message, title, variant }]);
  }, []);
  const confirm = useCallback((message, title = 'Confirm action') => new Promise(resolve => {
    const id = crypto.randomUUID();
    pending.current.set(id, resolve);
    setQueue(current => [...current, { id, message, title, confirm: true }]);
  }), []);
  useEffect(() => {
    const confirmations = pending.current;
    return () => { confirmations.forEach(resolve => resolve(false)); confirmations.clear(); };
  }, []);
  const value = useMemo(() => ({ notify, confirm }), [notify, confirm]);
  const item = queue[0];
  const answer = accepted => {
    const resolve = pending.current.get(item.id);
    pending.current.delete(item.id);
    resolve?.(accepted);
    setQueue(current => current.filter(entry => entry.id !== item.id));
  };
  return <AppDialogContext.Provider value={value}>{children}{item && <AppNoticeDialog key={item.id} item={item} onAnswer={answer} />}</AppDialogContext.Provider>;
}
