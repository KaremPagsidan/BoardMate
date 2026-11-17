import { useId } from 'react';
import { uiText } from '../lib/uiText';

export default function ErrorDialog({ message, onClose }) {
  const dialogId = useId();
  if (!message) return null;
  const isShareSuccess = typeof message === 'string' && /^Message shared with .+\.?$/i.test(message.trim());

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/60 p-4" role={isShareSuccess ? 'dialog' : 'alertdialog'} aria-modal="true" aria-labelledby={`${dialogId}-title`} aria-describedby={`${dialogId}-message`}>
      <section className="w-full max-w-sm rounded-2xl bg-[#FAF7EE] p-5 shadow-2xl">
        <h2 id={`${dialogId}-title`} className={`text-base font-bold ${isShareSuccess ? 'text-emerald-800' : 'text-red-800'}`}>
          {isShareSuccess ? 'Message Shared Successfully' : 'Something went wrong'}
        </h2>
        <p id={`${dialogId}-message`} className="mt-2 break-words text-sm text-gray-700">{uiText(message)}</p>
        <button type="button" onClick={onClose} className="mt-4 w-full rounded-xl bg-[#6B946E] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#557a58] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#426c46]">
          OK
        </button>
      </section>
    </div>
  );
}
