// Repair UTF-8 previously decoded as Windows-1252, including mixed/double
// encoded text. Leave valid Unicode and incomplete byte sequences unchanged.
const bytes = new Map();
const western = new TextDecoder('windows-1252');
for (let i = 0; i < 256; i += 1) bytes.set(western.decode(Uint8Array.of(i)), i);
for (let i = 128; i < 160; i += 1) if (!bytes.has(String.fromCharCode(i))) bytes.set(String.fromCharCode(i), i);
const utf8 = new TextDecoder('utf-8', { fatal: true });
export function uiText(value) {
  if (typeof value !== 'string') return value;
  let result = value;
  for (let pass = 0; pass < 5; pass += 1) {
    const chars = [...result], output = [];
    for (let index = 0; index < chars.length;) {
      const first = bytes.get(chars[index]);
      const size = first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
      const candidate = chars.slice(index, index + size);
      if (size && candidate.length === size && candidate.every(char => bytes.has(char))) {
        try { output.push(utf8.decode(Uint8Array.from(candidate, char => bytes.get(char)))); index += size; continue; }
        catch { /* This is already-correct text, not an encoded byte sequence. */ }
      }
      output.push(chars[index]); index += 1;
    }
    const next = output.join('');
    if (next === result) break;
    result = next;
  }
  return result;
}
