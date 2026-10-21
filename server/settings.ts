/**
 * Configurações do módulo de orçamentos (empresa, alçadas, política de locação).
 */

import { DB } from './db';
import { ModuleSettings } from '../shared/orcamentos/types';

export const DEFAULT_SETTINGS: ModuleSettings = {
  company: {
    name: 'Central Locadora Rio Preto',
    legal_name: 'Central BR Comércio e Locação de Equipamentos para Construção Civil Ltda',
    document: '18.492.311/0001-44',
    phone: '(17) 3234-8800',
    email: 'contato@centrallocadora.com.br',
    address: 'Av. Bady Bassitt, 4820 – Vila Imperial – São José do Rio Preto/SP – CEP 15015-700',
    logo_data: null,
  },
  default_validity_days: 15,
  discount_limits: { admin: 100, gestor: 20, vendedor: 5, estoquista: 0, financeiro: 0, tecnico: 0, consulta: 0 },
  seller_can_change_price: true,
  require_internal_approval: false,
  rental_policy: { day_count_mode: 'exclusive', days_per_month: 30, proportional: false },
  expiring_soon_days: 3,
};

export function getSettings(db: DB): ModuleSettings {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'module'").get() as { value: string } | undefined;
  if (!row) return DEFAULT_SETTINGS;
  const stored = JSON.parse(row.value) as Partial<ModuleSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    company: { ...DEFAULT_SETTINGS.company, ...stored.company },
    discount_limits: { ...DEFAULT_SETTINGS.discount_limits, ...stored.discount_limits },
    rental_policy: { ...DEFAULT_SETTINGS.rental_policy, ...stored.rental_policy },
  };
}

export function saveSettings(db: DB, settings: ModuleSettings) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('module', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(JSON.stringify(settings));
}

/** Valida e normaliza o que veio da tela. Lança Error com mensagem amigável. */
export function sanitizeSettings(input: any): ModuleSettings {
  const s = input as ModuleSettings;
  const num = (v: unknown, min: number, max: number, label: string) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label}: informe um valor entre ${min} e ${max}.`);
    return n;
  };
  const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  if (s.company?.logo_data && !/^data:image\/(png|jpeg);base64,/.test(s.company.logo_data)) {
    throw new Error('Logotipo deve ser uma imagem PNG ou JPG.');
  }
  if (s.company?.logo_data && s.company.logo_data.length > 700_000) throw new Error('Logotipo muito grande (máx. ~500 KB).');
  return {
    company: {
      name: str(s.company?.name, 120) || DEFAULT_SETTINGS.company.name,
      legal_name: str(s.company?.legal_name, 200),
      document: str(s.company?.document, 30),
      phone: str(s.company?.phone, 40),
      email: str(s.company?.email, 120),
      address: str(s.company?.address, 300),
      logo_data: s.company?.logo_data || null,
    },
    default_validity_days: Math.round(num(s.default_validity_days, 1, 365, 'Validade padrão')),
    discount_limits: {
      admin: num(s.discount_limits?.admin, 0, 100, 'Limite do administrador'),
      gestor: num(s.discount_limits?.gestor, 0, 100, 'Limite do gestor'),
      vendedor: num(s.discount_limits?.vendedor, 0, 100, 'Limite do vendedor'),
      estoquista: 0,
      financeiro: 0,
      tecnico: 0,
      consulta: 0,
    },
    seller_can_change_price: !!s.seller_can_change_price,
    require_internal_approval: !!s.require_internal_approval,
    rental_policy: {
      day_count_mode: s.rental_policy?.day_count_mode === 'inclusive' ? 'inclusive' : 'exclusive',
      days_per_month: Math.round(num(s.rental_policy?.days_per_month, 28, 31, 'Dias do mês comercial')),
      proportional: !!s.rental_policy?.proportional,
    },
    expiring_soon_days: Math.round(num(s.expiring_soon_days, 1, 60, 'Aviso de vencimento')),
  };
}
