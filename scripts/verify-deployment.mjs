import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const origin = new URL(config.vars.APP_URL);
const expectedHtml = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const assetPaths = [...new Set([...expectedHtml.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match => match[1]))];
assert(assetPaths.some(path => path.endsWith('.js')) && assetPaths.some(path => path.endsWith('.css')), 'No se han encontrado los assets del build.');

async function get(path) {
  const response = await fetch(new URL(path, origin), { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  assert(response.ok, `${path}: HTTP ${response.status}`);
  return response;
}

// Allow a short propagation window after Wrangler reports the deployment.
for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    const health = await (await get('/api/health')).json();
    assert(health.ok === true && health.service === 'telegram-group-lists', 'Respuesta de salud inesperada.');
    const html = await (await get('/')).text();
    for (const path of assetPaths) {
      assert(html.includes(`"${path}"`), `El HTML publicado no referencia ${path}.`);
      const actual = Buffer.from(await (await get(path)).arrayBuffer());
      const expected = await readFile(new URL(`../dist${path}`, import.meta.url));
      assert(actual.equals(expected), `El contenido publicado de ${path} no coincide con este build.`);
    }
    console.log(`Despliegue verificado: health OK y ${assetPaths.length} assets coinciden con el build.`);
    break;
  } catch (error) {
    if (attempt === 5) throw error;
    console.log(`Esperando la versión publicada (${attempt}/5): ${error.message}`);
    await delay(2000);
  }
}
