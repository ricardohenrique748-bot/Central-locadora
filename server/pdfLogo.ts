/**
 * Logotipo dos PDFs: o enviado em Configurações (company.logo_data) tem prioridade;
 * sem ele, usa a logo padrão da Central Locadora (server/assets).
 */

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_LOGO = path.resolve('server', 'assets', 'logo-central-locadora.png');
let cachedDefault: Buffer | null | undefined;

export function companyLogo(company?: { logo_data?: string | null } | null): Buffer | null {
  if (company?.logo_data) {
    try {
      return Buffer.from(company.logo_data.split(',')[1], 'base64');
    } catch {
      /* cai para a logo padrão */
    }
  }
  if (cachedDefault === undefined) cachedDefault = fs.existsSync(DEFAULT_LOGO) ? fs.readFileSync(DEFAULT_LOGO) : null;
  return cachedDefault;
}

/** Desenha a logo em (x, y) e devolve a largura ocupada (com espaço) para deslocar o texto ao lado; 0 se não houver logo. */
export function drawLogo(doc: PDFKit.PDFDocument, company: { logo_data?: string | null } | null | undefined, x: number, y: number, box: [number, number] = [90, 55]): number {
  const buf = companyLogo(company);
  if (!buf) return 0;
  try {
    doc.image(buf, x, y, { fit: box });
    return box[0] + 10;
  } catch {
    return 0;
  }
}
