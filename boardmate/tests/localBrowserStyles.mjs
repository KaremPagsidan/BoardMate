import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Same public runtime used by BoardMate, cached for test reliability only.
// No application data or credentials are sent to this dependency host.
export async function localBrowserStyles() {
  const cache = join(tmpdir(), 'boardmate-tailwind-browser-test-runtime.js');
  let runtime;
  try { runtime = await readFile(cache, 'utf8'); }
  catch {
    const response = await fetch('https://cdn.tailwindcss.com', { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Tailwind test dependency returned ${response.status}`);
    runtime = await response.text();
    if (runtime.length < 1000) throw new Error('Tailwind test dependency was incomplete');
    await writeFile(cache, runtime);
  }
  return {
    name: 'local-browser-test-styles',
    configureServer(server) {
      server.middlewares.use('/__boardmate_test_tailwind.js', (_request, response) => {
        response.setHeader('Content-Type', 'application/javascript'); response.end(runtime);
      });
    },
    transformIndexHtml(html) { return html.replace('https://cdn.tailwindcss.com', '/__boardmate_test_tailwind.js'); },
  };
}
