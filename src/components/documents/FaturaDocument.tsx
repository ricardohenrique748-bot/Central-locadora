/**
 * Central Locação - Fatura de Locação de Bens Móveis com Canhoto e PIX
 * Conforme item 3.3 do Prompt Mestre
 */

import React, { useState } from 'react';
import { Fatura, Cliente, ConfiguracoesEmpresa } from '../../types';
import { formatCurrencyBRL, numberToExtensoBRL } from '../../utils/billing';
import { Printer, ArrowLeft, Copy, Check, QrCode, CreditCard, ShieldCheck } from 'lucide-react';

interface FaturaDocumentProps {
  fatura: Fatura;
  cliente: Cliente;
  empresa: ConfiguracoesEmpresa;
  onBack: () => void;
  onMarcarPaga?: () => void;
}

export const FaturaDocument: React.FC<FaturaDocumentProps> = ({
  fatura,
  cliente,
  empresa,
  onBack,
  onMarcarPaga,
}) => {
  const [copiado, setCopiado] = useState(false);

  const handlePrint = () => {
    window.print();
  };

  const copiarPix = () => {
    navigator.clipboard.writeText(fatura.pixCopiaECola);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  };

  const valorExtenso = numberToExtensoBRL(fatura.valorTotal);

  return (
    <div className="bg-slate-100 min-h-screen p-4 md:p-8 text-slate-900 print:bg-white print:p-0">
      {/* Barra de Ações Superior */}
      <div className="max-w-4xl mx-auto mb-6 flex flex-wrap items-center justify-between gap-4 print:hidden">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 px-4 py-2 rounded-lg shadow-xs"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar
        </button>

        <div className="flex items-center gap-3">
          {fatura.status !== 'paga' && onMarcarPaga && (
            <button
              onClick={onMarcarPaga}
              className="flex items-center gap-1.5 text-sm font-semibold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 px-4 py-2 rounded-lg transition-colors"
            >
              <Check className="w-4 h-4" /> Confirmar Pagamento (Baixa)
            </button>
          )}

          <button
            onClick={handlePrint}
            className="flex items-center gap-2 text-sm font-semibold text-white bg-[#2AA3D8] hover:bg-[#1f87b3] px-5 py-2.5 rounded-lg shadow-sm"
          >
            <Printer className="w-4 h-4" /> Imprimir Fatura / Boleto
          </button>
        </div>
      </div>

      {/* Folha A4 da Fatura */}
      <div className="max-w-4xl mx-auto bg-white border border-slate-300 p-8 md:p-12 shadow-md print:shadow-none print:border-none print:p-0 print:max-w-none text-[12px] leading-relaxed">
        {/* Canhoto Destacável de Entrega da Fatura (Item 3.3) */}
        <div className="border-2 border-dashed border-slate-400 p-4 mb-8 bg-slate-50/80 rounded">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
              PROTOCOLO DE ENTREGA E RECEBIMENTO DE FATURA (CANHOTO)
            </span>
            <span className="font-mono font-bold text-slate-800 text-[11px]">
              FATURA Nº: {fatura.numeroFatura}
            </span>
          </div>

          <p className="text-[10px] text-slate-600 mb-4 leading-normal">
            Recebemos de <strong>{empresa.razaoSocial}</strong> a Fatura de Locação de Bens Móveis nº <strong>{fatura.numeroFatura}</strong> no valor líquido de <strong>{formatCurrencyBRL(fatura.valorTotal)}</strong> com vencimento em <strong>{new Date(fatura.dataVencimento + 'T00:00:00').toLocaleDateString('pt-BR')}</strong>, referente aos contratos e bens móveis nela discriminados.
          </p>

          <div className="grid grid-cols-3 gap-6 pt-2 border-t border-slate-300 text-[10px]">
            <div>
              <p className="font-semibold text-slate-700">Data de Recebimento:</p>
              <p className="border-b border-slate-400 mt-4 pb-0.5 text-center font-mono">___ / ___ / 2026</p>
            </div>
            <div className="col-span-2">
              <p className="font-semibold text-slate-700">Assinatura e Nome Legível do Recebedor:</p>
              <p className="border-b border-slate-400 mt-4 pb-0.5 text-center text-slate-400">
                (Assinar e datar no ato da entrega da fatura)
              </p>
            </div>
          </div>
        </div>

        {/* Linha de Corte do Canhoto */}
        <div className="flex items-center gap-2 mb-8 text-[9px] text-slate-400">
          <div className="flex-1 border-t border-dashed border-slate-400" />
          <span>✂ Destacar aqui no ato da entrega</span>
          <div className="flex-1 border-t border-dashed border-slate-400" />
        </div>

        {/* Cabeçalho da Fatura */}
        <div className="border-b-2 border-slate-900 pb-4 mb-6 flex justify-between items-start">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded bg-gradient-to-br from-[#2AA3D8] to-[#125c80] flex items-center justify-center text-white font-black text-2xl tracking-tighter">
              CL
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900 tracking-tight uppercase">
                {empresa.nomeFantasia}
              </h1>
              <p className="text-[11px] font-semibold text-slate-700">{empresa.razaoSocial}</p>
              <p className="text-[10px] text-slate-500">
                CNPJ: {empresa.cnpj} • I.E.: {empresa.inscricaoEstadual}
              </p>
              <p className="text-[10px] text-slate-500">
                {empresa.endereco}, {empresa.bairro} - {empresa.cidade}/{empresa.uf} - Fone: {empresa.telefone}
              </p>
            </div>
          </div>

          <div className="text-right border-l-2 border-slate-900 pl-4">
            <div className="inline-block bg-[#2AA3D8]/10 text-[#2AA3D8] font-bold text-[10px] px-2 py-0.5 rounded uppercase mb-1">
              Fatura de Locação
            </div>
            <div className="text-2xl font-black text-[#D9332B] font-mono">
              Nº {fatura.numeroFatura}
            </div>
            <p className="text-[10px] text-slate-600 mt-1">
              Emissão: {new Date(fatura.dataEmissao + 'T00:00:00').toLocaleDateString('pt-BR')}
            </p>
            <p className="text-[12px] font-bold text-slate-900 mt-0.5">
              Vencimento: <span className="text-[#D9332B]">{new Date(fatura.dataVencimento + 'T00:00:00').toLocaleDateString('pt-BR')}</span>
            </p>
          </div>
        </div>

        {/* Status Tag */}
        {fatura.status === 'paga' && (
          <div className="mb-4 bg-emerald-50 border border-emerald-300 text-emerald-800 p-2.5 rounded flex items-center justify-between text-xs font-semibold">
            <span className="flex items-center gap-1.5">
              <Check className="w-4 h-4 text-emerald-600" /> FATURA QUITADA / PAGA
            </span>
            <span>Data de Pagamento: {fatura.dataPagamento ? new Date(fatura.dataPagamento + 'T00:00:00').toLocaleDateString('pt-BR') : 'Confirmado'}</span>
          </div>
        )}

        {/* Dados do Locatário */}
        <div className="mb-6 bg-slate-50 p-4 border border-slate-200 rounded">
          <div className="grid grid-cols-2 gap-4 text-[11px]">
            <div>
              <p className="text-[10px] text-slate-500 uppercase font-semibold">Locatário / Pagador</p>
              <p className="font-bold text-slate-900 text-[12px]">{cliente.nomeRazao}</p>
              <p className="text-slate-600">{cliente.tipo === 'PJ' ? 'CNPJ' : 'CPF'}: <strong>{cliente.cpfCnpj}</strong></p>
              <p className="text-slate-600">I.E. / RG: {cliente.rgIe || 'Isento'}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase font-semibold">Contato e Faturamento</p>
              <p className="text-slate-700">Telefone: {cliente.telefone}</p>
              <p className="text-slate-700">E-mail: {cliente.email}</p>
              <p className="text-slate-700">Contrato(s) Vinculado(s): <strong>{fatura.contratosVinculados.join(', ')}</strong></p>
            </div>
          </div>
        </div>

        {/* Tabela de Linhas e Itens da Fatura (Item 3.3) */}
        <div className="mb-6">
          <table className="w-full border-collapse border border-slate-300 text-[11px]">
            <thead>
              <tr className="bg-slate-200 text-slate-800 text-left">
                <th className="border border-slate-300 p-2.5">Descrição dos Serviços / Período / Itens de Locação</th>
                <th className="border border-slate-300 p-2 text-center w-16">Tipo</th>
                <th className="border border-slate-300 p-2 text-center w-14">Qtde</th>
                <th className="border border-slate-300 p-2 text-right w-24">Unitário</th>
                <th className="border border-slate-300 p-2 text-right w-28">Total</th>
              </tr>
            </thead>
            <tbody>
              {fatura.linhas.map((lin) => (
                <tr key={lin.id} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="border border-slate-300 p-2.5 font-mono text-[10.5px] leading-relaxed text-slate-800">
                    {lin.descricao}
                  </td>
                  <td className="border border-slate-300 p-2 text-center capitalize text-[10px] text-slate-600">
                    {lin.tipo === 'pro_rata' ? 'Pro Rata' : lin.tipo}
                  </td>
                  <td className="border border-slate-300 p-2 text-center font-bold">
                    {lin.quantidade}
                  </td>
                  <td className="border border-slate-300 p-2 text-right font-mono text-slate-700">
                    {formatCurrencyBRL(lin.valorUnitario)}
                  </td>
                  <td className="border border-slate-300 p-2 text-right font-mono font-bold text-slate-900">
                    {formatCurrencyBRL(lin.valorTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-bold text-[12px]">
                <td colSpan={4} className="border border-slate-300 p-2.5 text-right uppercase text-slate-800">
                  VALOR TOTAL LÍQUIDO DA FATURA:
                </td>
                <td className="border border-slate-300 p-2.5 text-right font-mono text-[#D9332B] text-[13px]">
                  {formatCurrencyBRL(fatura.valorTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Total por Extenso (Item 3.3) */}
        <div className="mb-6 p-3 bg-slate-100 border border-slate-300 rounded text-[11px]">
          <span className="font-bold text-slate-800 uppercase">VALOR POR EXTENSO: </span>
          <span className="font-semibold text-slate-700 italic">
            ({valorExtenso})
          </span>
        </div>

        {/* Área de Pagamento: PIX e Boleto */}
        <div className="mb-6 p-4 border border-slate-300 rounded bg-slate-50 grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
          {/* QR Code PIX Simulado/Renderizado */}
          <div className="flex flex-col items-center text-center border-r border-slate-200 pr-4">
            <div className="w-28 h-28 bg-white border border-slate-300 p-1.5 rounded flex items-center justify-center shadow-xs">
              {/* QR Code SVG */}
              <svg viewBox="0 0 100 100" className="w-full h-full text-slate-900">
                <rect x="0" y="0" width="30" height="30" fill="currentColor" />
                <rect x="5" y="5" width="20" height="20" fill="white" />
                <rect x="10" y="10" width="10" height="10" fill="currentColor" />

                <rect x="70" y="0" width="30" height="30" fill="currentColor" />
                <rect x="75" y="5" width="20" height="20" fill="white" />
                <rect x="80" y="10" width="10" height="10" fill="currentColor" />

                <rect x="0" y="70" width="30" height="30" fill="currentColor" />
                <rect x="5" y="75" width="20" height="20" fill="white" />
                <rect x="10" y="80" width="10" height="10" fill="currentColor" />

                {/* Pattern dots */}
                <rect x="35" y="10" width="8" height="8" fill="currentColor" />
                <rect x="50" y="15" width="8" height="8" fill="currentColor" />
                <rect x="40" y="35" width="20" height="20" fill="currentColor" />
                <rect x="10" y="45" width="15" height="10" fill="currentColor" />
                <rect x="75" y="40" width="15" height="8" fill="currentColor" />
                <rect x="40" y="75" width="10" height="15" fill="currentColor" />
                <rect x="65" y="70" width="10" height="10" fill="currentColor" />
                <rect x="80" y="80" width="15" height="15" fill="currentColor" />
              </svg>
            </div>
            <span className="text-[10px] font-bold text-[#2AA3D8] mt-1.5 flex items-center gap-1">
              <QrCode className="w-3.5 h-3.5" /> PIX Banco Inter / Asaas
            </span>
          </div>

          {/* Dados PIX e Chave */}
          <div className="col-span-2 space-y-2 text-[10.5px]">
            <div>
              <p className="text-[10px] text-slate-500 font-semibold uppercase">Pague instantaneamente via PIX:</p>
              <p className="font-mono text-slate-800 text-[11px] font-bold">Chave CNPJ: {empresa.cnpj}</p>
              <p className="text-slate-600">Favorecido: {empresa.razaoSocial}</p>
            </div>

            <div className="pt-2 border-t border-slate-200">
              <p className="text-[10px] text-slate-500 font-semibold uppercase mb-1">Linha Digitável / Boleto Bancário:</p>
              <p className="font-mono text-slate-900 bg-white p-2 border border-slate-200 rounded text-[11px] font-semibold tracking-wider">
                {fatura.codigoBarrasBoleto}
              </p>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={copiarPix}
                className="flex items-center gap-1.5 text-xs font-semibold text-[#2AA3D8] hover:text-[#1c84b1] bg-white border border-[#2AA3D8]/40 px-3 py-1.5 rounded shadow-2xs transition-colors print:hidden"
              >
                {copiado ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copiado ? 'Código Copiado com Sucesso!' : 'Copiar Chave / Código PIX Copia-e-Cola'}
              </button>
            </div>
          </div>
        </div>

        {/* Declaração Legal e Tributária Fixa (Item 3.3) */}
        <div className="p-3 bg-slate-100 border border-slate-300 rounded text-[10px] text-slate-700 leading-normal mb-6">
          <p className="font-bold text-slate-900 mb-0.5 uppercase">
            DECLARAÇÃO E NATUREZA FISCAL DA OPERAÇÃO:
          </p>
          <p>
            "Natureza da operação: Locação de Bens Móveis. Não é fato gerador de ISSQN. Dispensado de Nota Fiscal conforme Lei Complementar Federal nº 116/2003 e item 3 da Súmula Vinculante 31 do STF. Locação de equipamento sem fornecimento de mão de obra."
          </p>
        </div>

        {/* Rodapé da Fatura */}
        <div className="pt-4 border-t border-slate-300 flex justify-between items-center text-[9px] text-slate-400">
          <span>Sistema Central Locação — Desenvolvido por Lynus Tecnologia</span>
          <span>Fatura Nº {fatura.numeroFatura} • Emitida eletronicamente</span>
        </div>
      </div>
    </div>
  );
};
