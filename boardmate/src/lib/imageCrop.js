const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const fullCrop = { x: 0, y: 0, width: 1, height: 1 };
export function moveCrop(c, handle, dx, dy) {
  if (handle === 'move') return { ...c, x: clamp(c.x + dx, 0, 1 - c.width), y: clamp(c.y + dy, 0, 1 - c.height) };
  let l = c.x, t = c.y, r = l + c.width, b = t + c.height;
  if (handle.includes('w')) l = clamp(l + dx, 0, r - .04);
  if (handle.includes('e')) r = clamp(r + dx, l + .04, 1);
  if (handle.includes('n')) t = clamp(t + dy, 0, b - .04);
  if (handle.includes('s')) b = clamp(b + dy, t + .04, 1);
  return { x: l, y: t, width: r - l, height: b - t };
}
export async function createCroppedImage(file, url, crop) {
  const image = new Image(); image.src = url; await image.decode();
  const x = Math.min(image.naturalWidth - 1, Math.round(image.naturalWidth * crop.x));
  const y = Math.min(image.naturalHeight - 1, Math.round(image.naturalHeight * crop.y));
  const width = Math.max(1, Math.round(image.naturalWidth * (crop.x + crop.width)) - x);
  const height = Math.max(1, Math.round(image.naturalHeight * (crop.y + crop.height)) - y);
  const scale = Math.min(1, 2400 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not crop this image.');
  ctx.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Image cropping failed.')), 'image/png'));
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.png`, { type: 'image/png', lastModified: Date.now() });
}
