/**
 * Central Locação - Regras de Cálculo Financeiro e Faturamento
 * Lynus Tecnologia / Central BR Comércio e Locação de Equipamentos
 */

export interface RentCalculationItem {
  valorPeriodo: number; // Ex: R$ 300,00 por mês (30 dias)
  periodoDias: number;  // 30 para mensal, 15 para quinzenal, 7 para semanal, 1 para diária
  dataInicio: string;   // YYYY-MM-DD
  dataFim?: string;     // YYYY-MM-DD se já devolvido ou data do corte
  quantidade: number;
}

/**
 * Calcula a quantidade de dias entre duas datas (formato YYYY-MM-DD)
 */
export function diffDays(startDateStr: string, endDateStr: string): number {
  const start = new Date(startDateStr + 'T00:00:00');
  const end = new Date(endDateStr + 'T00:00:00');
  const diffTime = end.getTime() - start.getTime();
  const days = Math.round(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, days);
}

/**
 * Adiciona dias a uma data e retorna no formato YYYY-MM-DD
 */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Calcula o valor da locação considerando política de devolução:
 * - 'proporcional': cobra proporcional aos dias corridos no ciclo atual
 * - 'ciclo_cheio': cobra no mínimo 1 ciclo completo inicial, ciclos subsequentes proporcionais ou cheios
 */
export function calculateItemRentalCost(
  item: RentCalculationItem,
  corteOuDevolucaoStr: string,
  policy: 'proporcional' | 'ciclo_cheio' = 'proporcional'
): {
  diasUtilizados: number;
  ciclosCompletos: number;
  diasRestantes: number;
  valorTotal: number;
  diariaProporcional: number;
} {
  const diasTotal = diffDays(item.dataInicio, corteOuDevolucaoStr);
  const periodo = item.periodoDias > 0 ? item.periodoDias : 30;
  const diariaProporcional = item.valorPeriodo / periodo;

  if (diasTotal === 0) {
    const valorTotal = diariaProporcional * item.quantidade;
    return {
      diasUtilizados: 1,
      ciclosCompletos: 0,
      diasRestantes: 1,
      valorTotal: Number(valorTotal.toFixed(2)),
      diariaProporcional: Number(diariaProporcional.toFixed(2)),
    };
  }

  if (policy === 'ciclo_cheio' && diasTotal <= periodo) {
    const valorTotal = item.valorPeriodo * item.quantidade;
    return {
      diasUtilizados: diasTotal,
      ciclosCompletos: 1,
      diasRestantes: 0,
      valorTotal: Number(valorTotal.toFixed(2)),
      diariaProporcional: Number(diariaProporcional.toFixed(2)),
    };
  }

  const ciclosCompletos = Math.floor(diasTotal / periodo);
  const diasRestantes = diasTotal % periodo;

  let valorCiclos = ciclosCompletos * item.valorPeriodo;
  let valorRestante = 0;

  if (diasRestantes > 0) {
    if (policy === 'ciclo_cheio' && ciclosCompletos === 0) {
      valorRestante = item.valorPeriodo;
    } else {
      valorRestante = diasRestantes * diariaProporcional;
    }
  }

  const valorUnitarioTotal = valorCiclos + valorRestante;
  const valorTotal = valorUnitarioTotal * item.quantidade;

  return {
    diasUtilizados: diasTotal,
    ciclosCompletos,
    diasRestantes,
    valorTotal: Number(valorTotal.toFixed(2)),
    diariaProporcional: Number(diariaProporcional.toFixed(2)),
  };
}

/**
 * Calcula juros e multa por atraso de pagamento
 * Conforme item 3.1: Multa contratual + juros moratórios
 */
export function calculateLateCharges(
  principalAmount: number,
  dueDateStr: string,
  calculationDateStr: string,
  finePercent = 2.0,
  dailyInterestPercent = 0.033
): {
  diasAtraso: number;
  valorMulta: number;
  valorJuros: number;
  valorTotalDevido: number;
} {
  const diasAtraso = diffDays(dueDateStr, calculationDateStr);

  if (diasAtraso <= 0) {
    return {
      diasAtraso: 0,
      valorMulta: 0,
      valorJuros: 0,
      valorTotalDevido: principalAmount,
    };
  }

  const valorMulta = (principalAmount * finePercent) / 100;
  const valorJuros = (principalAmount * (dailyInterestPercent * diasAtraso)) / 100;
  const valorTotalDevido = principalAmount + valorMulta + valorJuros;

  return {
    diasAtraso,
    valorMulta: Number(valorMulta.toFixed(2)),
    valorJuros: Number(valorJuros.toFixed(2)),
    valorTotalDevido: Number(valorTotalDevido.toFixed(2)),
  };
}

/**
 * Formata moeda BRL
 */
export function formatCurrencyBRL(val: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(val || 0);
}

/**
 * Converte valor numérico em reais por extenso (para Fatura de Locação e Contrato)
 */
export function numberToExtensoBRL(valor: number): string {
  if (valor === 0) return 'zero reais';

  const unidades = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
  const especiais = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const dezenas = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const centenas = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

  function converterCentena(n: number): string {
    if (n === 100) return 'cem';
    const c = Math.floor(n / 100);
    const d = Math.floor((n % 100) / 10);
    const u = n % 10;
    const partes: string[] = [];

    if (c > 0) partes.push(centenas[c]);

    if (d === 1) {
      partes.push(especiais[u]);
    } else {
      if (d > 1) partes.push(dezenas[d]);
      if (u > 0) partes.push(unidades[u]);
    }

    return partes.join(' e ');
  }

  const partes = [];
  const inteiro = Math.floor(valor);
  const centavos = Math.round((valor - inteiro) * 100);

  const milhares = Math.floor((inteiro % 1000000) / 1000);
  const resto = inteiro % 1000;

  if (milhares > 0) {
    if (milhares === 1) {
      partes.push('um mil');
    } else {
      partes.push(converterCentena(milhares) + ' mil');
    }
  }

  if (resto > 0) {
    partes.push(converterCentena(resto));
  }

  let resultado = partes.join(' e ');
  if (inteiro === 1) {
    resultado += ' real';
  } else if (inteiro > 1) {
    resultado += ' reais';
  }

  if (centavos > 0) {
    const textoCentavos = converterCentena(centavos);
    const sCentavos = centavos === 1 ? 'centavo' : 'centavos';
    if (inteiro > 0) {
      resultado += ` e ${textoCentavos} ${sCentavos}`;
    } else {
      resultado = `${textoCentavos} ${sCentavos} de real`;
    }
  }

  return resultado.charAt(0).toUpperCase() + resultado.slice(1);
}

/**
 * Validação de CPF brasileiro
 */
export function isValidCPF(cpf: string): boolean {
  const clean = cpf.replace(/\D/g, '');
  if (clean.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(clean)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(clean.charAt(i)) * (10 - i);
  }
  let rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(clean.charAt(9))) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(clean.charAt(i)) * (11 - i);
  }
  rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  return rev === parseInt(clean.charAt(10));
}

/**
 * Validação de CNPJ brasileiro
 */
export function isValidCNPJ(cnpj: string): boolean {
  const clean = cnpj.replace(/\D/g, '');
  if (clean.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(clean)) return false;

  let size = clean.length - 2;
  let numbers = clean.substring(0, size);
  const digits = clean.substring(size);
  let sum = 0;
  let pos = size - 7;

  for (let i = size; i >= 1; i--) {
    sum += parseInt(numbers.charAt(size - i)) * pos--;
    if (pos < 2) pos = 9;
  }

  let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (result !== parseInt(digits.charAt(0))) return false;

  size = size + 1;
  numbers = clean.substring(0, size);
  sum = 0;
  pos = size - 7;
  for (let i = size; i >= 1; i--) {
    sum += parseInt(numbers.charAt(size - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  return result === parseInt(digits.charAt(1));
}

/**
 * Formata CPF ou CNPJ com máscara
 */
export function formatCpfCnpj(val: string): string {
  const clean = val.replace(/\D/g, '');
  if (clean.length <= 11) {
    return clean
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return clean
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

/**
 * Formata CEP
 */
export function formatCEP(val: string): string {
  const clean = val.replace(/\D/g, '');
  return clean.replace(/^(\d{5})(\d)/, '$1-$2');
}
