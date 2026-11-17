import { useEffect, useRef } from 'react';

export default function AppViewport({ children }) {
  const viewportRef = useRef(null);
  const shellRef = useRef(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;

    const updateViewportHeight = () => {
      const mobile = window.innerWidth < 640;
      const height = Math.round(viewport.height);
      [viewportRef.current, shellRef.current].forEach(element => {
        if (!element) return;
        if (mobile && height > 0) element.style.setProperty('--bm-mobile-viewport-height', `${height}px`);
        else element.style.removeProperty('--bm-mobile-viewport-height');
      });
    };

    updateViewportHeight();
    viewport.addEventListener('resize', updateViewportHeight);
    window.addEventListener('resize', updateViewportHeight);
    return () => {
      viewport.removeEventListener('resize', updateViewportHeight);
      window.removeEventListener('resize', updateViewportHeight);
    };
  }, []);

  return <div ref={viewportRef} className="boardmate-viewport flex min-h-dvh w-full items-center justify-center bg-[#1E293B] p-0 sm:p-4 md:p-6">
    <div ref={shellRef} className="boardmate-app-shell relative flex min-h-0 w-full flex-col overflow-hidden bg-[#F8F6F0] font-sans text-gray-800">{children}</div>
  </div>;
}
