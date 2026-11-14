import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';

// Escape local scroll/stacking contexts without escaping the phone viewport.
// Outside the user portal (for example, admin), retain the browser viewport.
export default function ViewportPortal({ children }) {
  const [host, setHost] = useState(null);
  const locate = useCallback(node => {
    if (node) setHost(node.closest('.boardmate-app-shell') || document.body);
  }, []);
  return <><span ref={locate} hidden />{host && createPortal(children, host)}</>;
}
