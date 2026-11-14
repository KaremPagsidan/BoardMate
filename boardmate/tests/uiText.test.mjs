import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { uiText } from '../src/lib/uiText.js';
const corrupt = value => new TextDecoder('windows-1252').decode(new TextEncoder().encode(value));
test('repair mixed and double-encoded UI text without changing valid Unicode', () => {
  for (const text of ['Restoring your session…', 'Please wait…', 'Owner’s profile · Approved — ✓', '← Back × ⋮', 'Photo 📷']) {
    assert.equal(uiText(corrupt(text)), text);
    assert.equal(uiText(corrupt(corrupt(text))), text);
    assert.equal(uiText(text), text);
  }
  const multilingual = 'Café, José, São Paulo, 中文, العربية, 😀';
  assert.equal(uiText(multilingual), multilingual);
  assert.equal(uiText(`Welcome ${corrupt('…')} 中文`), 'Welcome … 中文');
  assert.equal(uiText(null), null);
});
test('all UI source files are valid UTF-8 and contain no repairable corrupted sequences', async () => {
  const inspect = async directory => {
    for (const file of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(file.name + (file.isDirectory() ? '/' : ''), directory);
      if (file.isDirectory()) await inspect(url);
      else if (/\.(jsx?|css)$/.test(file.name)) {
        const value = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(url));
        assert.equal(uiText(value), value, url.pathname);
        assert.ok(!value.includes('\uFFFD'), url.pathname);
      }
    }
  };
  await inspect(new URL('../src/', import.meta.url));
  for (const entry of ['index.html', 'admin.html']) assert.match(await readFile(new URL(`../${entry}`, import.meta.url), 'utf8'), /charset="UTF-8"/i);
});
