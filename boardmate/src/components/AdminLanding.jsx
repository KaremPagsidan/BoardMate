import { useState } from 'react';

export default function AdminLanding({ onEnter }) {
  const [isEntering, setIsEntering] = useState(false);

  const handleEnter = () => {
    if (isEntering) return;

    setIsEntering(true);
    window.setTimeout(onEnter, 400);
  };

  return (
    <main className={`admin-landing ${isEntering ? 'admin-landing-entering' : ''}`}>
      <header className="admin-landing-header">
        <a className="admin-brand" href="#admin-home" aria-label="BoardMate Admin home">
          <span className="admin-brand-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M10.707 2.293a1 1 0 0 1 1.414 0l7 7A1 1 0 0 1 19 11h-1v7a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-7H5a1 1 0 0 1-.707-1.707l7-7z" />
            </svg>
          </span>
          <span>Board<span>Mate</span><small>ADMIN PORTAL</small></span>
        </a>
        <span className="admin-landing-secure"><span /> Secure administration</span>
      </header>

      <section className="admin-landing-hero" id="admin-home">
        <div className="admin-landing-copy">
          <p className="admin-eyebrow">THE BOARDMATE CONTROL CENTER</p>
          <h1>Better oversight.<br /><span>Better places to call home.</span></h1>
          <p className="admin-landing-description">
            A clear view of your community, with the tools to review listings,
            verify members, and keep every connection safer.
          </p>
          <button type="button" className="admin-enter-button" onClick={handleEnter} disabled={isEntering}>
            Access admin portal <span aria-hidden="true">→</span>
          </button>
          <p className="admin-landing-note">Authorized administrators only</p>
        </div>

        <div className="admin-landing-visual" aria-hidden="true">
          <div className="admin-visual-orbit admin-visual-orbit-one" />
          <div className="admin-visual-orbit admin-visual-orbit-two" />
          <div className="admin-preview-card">
            <div className="admin-preview-heading">
              <span className="admin-preview-mark">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10.707 2.293a1 1 0 0 1 1.414 0l7 7A1 1 0 0 1 19 11h-1v7a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-7H5a1 1 0 0 1-.707-1.707l7-7z" />
                </svg>
              </span>
              <span><b>BoardMate</b><small>ADMIN OVERVIEW</small></span>
              <i />
            </div>
            <div className="admin-preview-welcome">Good morning, Administrator</div>
            <div className="admin-preview-stats">
              <div><small>Members</small><b>—</b><span>Live data after sign in</span></div>
              <div><small>Listings</small><b>—</b><span>Live data after sign in</span></div>
              <div><small>To review</small><b>—</b><span>Live data after sign in</span></div>
            </div>
            <div className="admin-preview-activity">
              <div><span>Review activity</span><small>Administrator view</small></div>
              <div className="admin-activity-row"><i /><span>Sign in to load current account and post queues</span></div>
            </div>
          </div>
          <div className="admin-visual-badge"><span>✓</span> Community-first management</div>
        </div>
      </section>

      <footer className="admin-landing-footer">
        <span>BoardMate <b>·</b> An accommodation and roommate finder</span>
        <span>Thoughtful tools for a safer community</span>
      </footer>
    </main>
  );
}
