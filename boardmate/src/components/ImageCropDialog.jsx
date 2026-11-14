import ProfileImage from './ProfileImage';
import { useEffect, useRef, useState } from 'react';
import { createCroppedImage, fullCrop, moveCrop } from '../lib/imageCrop';
import '../imageCrop.css';
import ViewportPortal from './ViewportPortal';
export default function ImageCropDialog(props) {
  return <ViewportPortal><ImageCropEditor {...props} /></ViewportPortal>;
}
function ImageCropEditor({ file, previewUrl, onApply, onRemove, onClose, onKeepOriginal }) {
  const [crop, setCrop] = useState(fullCrop), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const stage = useRef(null), drag = useRef(null);
  const dialog = useRef(null);
  useEffect(() => { const previous = document.activeElement; dialog.current?.focus(); return () => previous?.focus?.(); }, []);
  const dialogKeys = event => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const controls = Array.from(dialog.current.querySelectorAll('button:not(:disabled), [tabindex="0"]'));
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  const begin = (e, handle) => {
    if (busy) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { crop, handle, x: e.clientX, y: e.clientY, bounds: stage.current.getBoundingClientRect() };
  };
  const move = e => { const d = drag.current; if (d) setCrop(moveCrop(d.crop, d.handle, (e.clientX - d.x) / d.bounds.width, (e.clientY - d.y) / d.bounds.height)); };
  const keyboard = (e, handle) => {
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!dir || busy) return;
    e.preventDefault(); e.stopPropagation(); const step = e.shiftKey ? .05 : .01;
    setCrop(c => moveCrop(c, handle, dir[0] * step, dir[1] * step));
  };
  const apply = async () => { setBusy(true); setError(''); try { await onApply(await createCroppedImage(file, previewUrl, crop)); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return <div className="bm-crop-backdrop" onClick={event => event.stopPropagation()}><section ref={dialog} tabIndex={-1} onKeyDown={dialogKeys} className="bm-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="image-crop-title">
    <header><h2 id="image-crop-title">Crop photo</h2><button type="button" disabled={busy} onClick={onClose} aria-label="Cancel image editing">×</button></header>
    <p id="crop-help">Drag the frame to move it. Drag an edge or corner to resize. Focus the frame or a handle and use arrow keys for precise adjustments.</p>
    <div className="bm-crop-stage" ref={stage}>
      <ProfileImage src={previewUrl} alt="Photo to crop" draggable={false} onLoad={() => setReady(true)} onError={() => setError('This image could not be opened. Choose another image or keep the original.')} />
      {ready && <div className="bm-crop-frame" role="group" tabIndex={0} aria-label="Move crop frame" aria-describedby="crop-help"
        style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}
        onPointerDown={e => begin(e, 'move')} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onKeyDown={e => keyboard(e, 'move')}>
        {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(handle => <button key={handle} type="button" className={`bm-crop-handle bm-crop-${handle}`} aria-label={`Resize crop ${handle}`} disabled={busy} onPointerDown={e => begin(e, handle)} onKeyDown={e => keyboard(e, handle)} />)}
      </div>}
    </div>
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={onRemove || onClose}>Cancel photo</button><button type="button" disabled={busy} onClick={() => setCrop(fullCrop)}>Reset frame</button><button type="button" disabled={busy} onClick={onKeepOriginal || onClose}>Keep original</button><button type="button" className="bm-crop-apply" disabled={busy || !ready} onClick={apply}>{busy ? 'Cropping…' : 'Apply crop'}</button></footer>
  </section></div>;
}
