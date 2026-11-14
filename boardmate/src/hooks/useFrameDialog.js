import { useLayoutEffect } from 'react';
import '../frameDialog.css';

// Native modal dialogs enter the top layer, which bypasses CSS containment.
// Keep their native focus/Escape behavior, but measure their owning viewport.
export default function useFrameDialog(ref, enabled = true) {
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog || !enabled) return undefined;
    const frame = dialog.closest('.boardmate-app-shell') || document.querySelector('.boardmate-app-shell');
    if (!frame) return undefined;
    const update = () => {
      const rect = frame.getBoundingClientRect();
      const left = rect.left + frame.clientLeft;
      const top = rect.top + frame.clientTop;
      const width = frame.clientWidth;
      const height = frame.clientHeight;
      dialog.classList.add('bm-frame-dialog');
      for (const [name, value] of Object.entries({ left, top, width, height })) {
        dialog.style.setProperty(`--frame-${name}`, `${value}px`);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [ref, enabled]);
}
