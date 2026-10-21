/**
 * Validações de cadastro (clientes e catálogo), usadas na interface e no servidor.
 */

import { CustomerInput } from './types';

export const onlyDigits = (v: string | null | undefined) => (v || '').replace(/\D/g, '');

export function isValidCPF(cpf: string): boolean {
  const c = onlyDigits(cpf);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digit(9) === Number(c[9]) && digit(10) === Number(c[10]);
}

export function isValidCNPJ(cnpj: string): boolean {
  const c = onlyDigits(cnpj);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const digit = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(c[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return digit(12) === Number(c[12]) && digit(13) === Number(c[13]);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export function formatDocument(doc: string | null | undefined): string {
  const d = onlyDigits(doc);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc || '';
}

export function formatPhone(phone: string | null | undefined): string {
  const d = onlyDigits(phone);
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return phone || '';
}

export type FieldErrors = Record<string, string>;

export const UF_LIST = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

/** Campos obrigatórios: tipo, nome e ao menos um contato. Documento é opcional, mas validado se informado. */
export function validateCustomer(c: Partial<CustomerInput>): FieldErrors {
  const e: FieldErrors = {};
  if (c.person_type !== 'PF' && c.person_type !== 'PJ') e.person_type = 'Selecione o tipo de pessoa.';
  if (!c.name || c.name.trim().length < 3) e.name = 'Informe o nome completo ou razão social.';
  const doc = onlyDigits(c.document);
  if (doc) {
    if (c.person_type === 'PF' && !isValidCPF(doc)) e.document = 'CPF inválido.';
    if (c.person_type === 'PJ' && !isValidCNPJ(doc)) e.document = 'CNPJ inválido.';
  }
  if (c.email && !isValidEmail(c.email)) e.email = 'E-mail inválido.';
  if (!onlyDigits(c.phone) && !onlyDigits(c.whatsapp) && !c.email?.trim()) {
    e.phone = 'Informe ao menos um contato: telefone, WhatsApp ou e-mail.';
  }
  for (const f of ['phone', 'whatsapp'] as const) {
    const d = onlyDigits(c[f]);
    if (d && (d.length < 10 || d.length > 11)) e[f] = 'Telefone deve ter DDD + número (10 ou 11 dígitos).';
  }
  const cep = onlyDigits(c.postal_code);
  if (cep && cep.length !== 8) e.postal_code = 'CEP deve ter 8 dígitos.';
  if (c.state && !UF_LIST.includes(c.state)) e.state = 'UF inválida.';
  return e;
}

/** Dados exigidos para documento definitivo (proposta emitida ao cliente). */
export function missingDefinitiveData(c: Partial<CustomerInput>): string[] {
  const missing: string[] = [];
  if (!onlyDigits(c.document)) missing.push(c.person_type === 'PJ' ? 'CNPJ' : 'CPF');
  if (!c.street || !c.street_number || !c.city || !c.state) missing.push('Endereço completo');
  if (!onlyDigits(c.phone) && !onlyDigits(c.whatsapp) && !c.email) missing.push('Contato');
  return missing;
}
