/**
 * Build para a Vercel no formato Build Output API (.vercel/output):
 * site estático (vite build) + função Node com a API empacotada (server/vercel.ts).
 */

import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const out = '.vercel/output';
const fn = `${out}/functions/api.func`;
fs.rmSync(out, { recursive: true, force: true });

execSync('npx vite build', { stdio: 'inherit' });
fs.cpSync('dist', `${out}/static`, { recursive: true });

await build({
  entryPoints: ['server/vercel.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outfile: `${fn}/index.cjs`,
  external: ['pg-native'],
  // dependências ESM (pdfkit) resolvem arquivos via import.meta.url, que não existe em CJS
  banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  define: { 'import.meta.url': '__importMetaUrl' },
  logLevel: 'warning',
});
// arquivos lidos do disco em tempo de execução: perfil de cor do pdfkit (relativo ao bundle) e logo dos PDFs (relativo ao cwd)
fs.cpSync('node_modules/pdfkit/js/data', `${fn}/data`, { recursive: true });
fs.cpSync('server/assets', `${fn}/server/assets`, { recursive: true });

fs.writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify({ runtime: 'nodejs24.x', handler: 'index.cjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30 }, null, 2)
);
fs.writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/api/(.*)$', dest: '/api?__path=$1' },
        { handle: 'filesystem' },
        { src: '/.*', dest: '/index.html' },
      ],
    },
    null,
    2
  )
);
console.log('Build da Vercel pronto em', out);
