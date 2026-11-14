import { useEffect, useRef } from 'react';
export default function PortalPage({ title, onBack, children }) {
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <main className="bm-portal-page"><header className="bm-portal-page-header"><button type="button" onClick={onBack} aria-label={`Back from ${title}`}>← Back</button><h1 ref={heading} tabIndex={-1}>{title}</h1></header><div className="bm-portal-page-content">{children}</div></main>;
}
