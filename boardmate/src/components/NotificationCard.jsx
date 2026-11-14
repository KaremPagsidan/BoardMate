import { isVerificationNotification } from '../lib/verificationSettings';
import { useState } from 'react';
import { uiText } from '../lib/uiText';

export default function NotificationCard({ notification, onDelete, onHide, onOpen }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <article className="relative flex items-start justify-between gap-2 rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-950">
      <button type="button" onClick={() => onOpen?.(notification)} style={{ overflowWrap: 'anywhere' }} className="min-w-0 flex-1 text-left">
        <h3 className="font-bold">{uiText(notification.title)}</h3>
        <p className="mt-1">{uiText(notification.body)}</p>
        {isVerificationNotification(notification) && <span className="mt-2 block font-semibold underline">Open Settings &amp; Privacy → Account Verification</span>}
        <time className="mt-2 block text-[9px] text-amber-700">{new Date(notification.created_at).toLocaleString()}</time>
      </button>
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen(open => !open)}
          aria-label={`Options for ${uiText(notification.title)}`}
          aria-expanded={menuOpen}
          className="rounded px-1 text-lg leading-none text-amber-900 hover:bg-amber-100"
        >
          ⋮
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-10 mt-1 min-w-24 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-gray-800 shadow-lg">
            <button type="button" onClick={() => { setMenuOpen(false); onHide(notification.id); }} className="block w-full px-3 py-2 text-left hover:bg-gray-50">Hide</button>
            <button type="button" onClick={() => { setMenuOpen(false); onDelete(notification.id); }} className="block w-full px-3 py-2 text-left text-red-700 hover:bg-red-50">Delete</button>
          </div>
        )}
      </div>
    </article>
  );
}
