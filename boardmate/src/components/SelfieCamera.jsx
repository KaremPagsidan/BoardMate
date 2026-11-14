import { useEffect, useRef, useState } from 'react';
import ErrorDialog from './ErrorDialog';
import VerificationFilePreview from './VerificationFilePreview';
import ImageCropDialog from './ImageCropDialog';

export default function SelfieCamera({ onCapture, captured, disabled = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [crop, setCrop] = useState(null);
  useEffect(() => () => { if (crop) URL.revokeObjectURL(crop.url); }, [crop]);
  const finishCrop = file => { if (file) onCapture(file); setCrop(null); };
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    let active = true;
    if (!navigator.mediaDevices?.getUserMedia) return undefined;

    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user' },
    }).then(stream => {
      if (!active) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    }).catch(error => {
      if (!active) return;
      const reason = error.name === 'NotAllowedError'
        ? 'Allow camera access in your browser settings, then try again.'
        : error.name === 'NotFoundError'
          ? 'No front-facing camera was found on this device.'
          : `Could not start the camera: ${error.message}`;
      setCameraError(reason);
    });

    return () => {
      active = false;
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    };
  }, [isOpen]);

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setCameraError('The camera is still starting. Please wait a moment and try again.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob) {
        setCameraError('The photo could not be captured. Please try again.');
        return;
      }
      const file = new File([blob], `selfie-${Date.now()}.jpg`, { type: 'image/jpeg' });
      setCrop({ file, url: URL.createObjectURL(file) });
      setIsOpen(false);
    }, 'image/jpeg', 0.9);
  };

  const openCamera = () => {
    if (disabled) return;
    setCameraError(navigator.mediaDevices?.getUserMedia
      ? ''
      : 'Camera access is unavailable. Open this page over HTTPS on a device with a camera.');
    setIsOpen(true);
  };

  return (
    <>
      {captured ? <VerificationFilePreview file={captured} label="Selfie" onRemove={() => onCapture(null)} onRetake={openCamera} disabled={disabled} /> : <button
        type="button"
        disabled={disabled}
        onClick={openCamera}
        className="border-2 border-dashed border-gray-300 bg-[#EFECE1] rounded-2xl p-6 text-center flex flex-col items-center justify-center cursor-pointer hover:border-[#82AB85] w-full"
      >
        <i className="fa-solid fa-camera text-3xl text-[#82AB85] mb-2"></i>
        <span className="text-xs font-bold text-gray-700">
          {captured ? `Retake selfie: ${captured.name}` : 'Tap to take a selfie'}
        </span>
        {captured && <span className="text-[10px] text-green-600 mt-1">Photo captured</span>}
      </button>}

      {isOpen && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4" role="presentation">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 space-y-3" role="dialog" aria-modal="true" aria-label="Take a selfie">
            <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-xl bg-black aspect-[3/4] object-cover" />
            <div className="flex gap-2">
              <button type="button" onClick={() => setIsOpen(false)} className="flex-1 rounded-xl bg-gray-200 py-3 text-sm font-semibold">
                Cancel
              </button>
              <button type="button" onClick={capturePhoto} disabled={disabled || Boolean(cameraError)} className="flex-1 rounded-xl bg-[#82AB85] py-3 text-sm font-semibold text-white disabled:opacity-50">
                Capture selfie
              </button>
            </div>
          </div>
        </div>
      )}
      {crop && <ImageCropDialog file={crop.file} previewUrl={crop.url} onApply={finishCrop} onClose={() => finishCrop(null)} onRemove={() => finishCrop(null)} onKeepOriginal={() => finishCrop(crop.file)} />}
      <ErrorDialog message={cameraError} onClose={() => { setCameraError(''); setIsOpen(false); }} />
    </>
  );
}
