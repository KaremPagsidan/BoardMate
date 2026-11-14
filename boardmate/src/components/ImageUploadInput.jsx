import { useEffect, useRef, useState } from 'react';
import ImageCropDialog from './ImageCropDialog';

// Preserve native file-input callbacks while cropping every image in a selection.
// Videos, audio and documents pass through unchanged.
export default function ImageUploadInput({ onChange, ref: forwardedRef, disabled, ...props }) {
  const [editor, setEditor] = useState(null);
  const [processing, setProcessing] = useState(false);
  const pending = useRef(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.(null); }; }, []);
  const finish = file => { pending.current?.(file); pending.current = null; setEditor(null); };
  const select = async event => {
    const input = event.target;
    const selected = Array.from(input.files || []);
    if (!selected.length) return;
    setProcessing(true);
    const files = [];
    try {
      for (const file of selected) {
        if (!mounted.current) break;
        if (!file.type.startsWith('image/')) { files.push(file); continue; }
        const url = URL.createObjectURL(file);
        try {
          const result = await new Promise(resolve => { pending.current = resolve; setEditor({ file, url }); });
          if (result) files.push(result);
        } finally { URL.revokeObjectURL(url); }
      }
      if (!mounted.current) return;
      const transfer = new DataTransfer();
      files.forEach(file => transfer.items.add(file));
      input.files = transfer.files;
      if (files.length) onChange?.({ target: input, currentTarget: input, preventDefault() {}, stopPropagation() {} });
      else input.value = '';
    } finally { if (mounted.current) setProcessing(false); }
  };
  return <><input {...props} ref={forwardedRef} disabled={disabled || processing} onChange={select} />
    {editor && <ImageCropDialog key={editor.url} file={editor.file} previewUrl={editor.url} onApply={finish} onRemove={() => finish(null)} onClose={() => finish(null)} onKeepOriginal={() => finish(editor.file)} />}
  </>;
}
