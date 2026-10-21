/**
 * Central Locação - Comprovante de Devolução / Checklist Oficial
 * Conforme item 3.2 do Prompt Mestre
 */

import React from 'react';
import { ComprovanteDevolucao, Cliente, Obra, Contrato, ConfiguracoesEmpresa } from '../../types';
import { formatCurrencyBRL } from '../../utils/billing';
import { Printer, ArrowLeft, CheckCircle2, AlertTriangle, HelpCircle, XCircle } from 'lucide-react';

interface ComprovanteDevolucaoDocumentProps {
  devolucao: ComprovanteDevolucao;
  cliente: Cliente;
  obra?: Obra;
  contrato: Contrato;
  empresa: ConfiguracoesEmpresa;
  onBack: () => void;
}

export const ComprovanteDevolucaoDocument: React.FC<ComprovanteDevolucaoDocumentProps> = ({
  devolucao,
  cliente,
  obra,
  contrato,
  empresa,
  onBack,
}) => {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="bg-slate-100 min-h-screen p-4 md:p-8 text-slate-900 print:bg-white print:p-0">
      {/* Botões Superiores */}
      <div className="max-w-4xl mx-auto mb-6 flex flex-wrap items-center justify-between gap-4 print:hidden">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 px-4 py-2 rounded-lg shadow-xs"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar
        </button>
        <button
          onClick={handlePrint}
          className="flex items-center gap-2 text-sm font-semibold text-white bg-[#2AA3D8] hover:bg-[#1f87b3] px-5 py-2.5 rounded-lg shadow-sm"
        >
          <Printer className="w-4 h-4" /> Imprimir Comprovante / Checklist
        </button>
      </div>

      {/* Folha A4 do Comprovante */}
      <div className="max-w-4xl mx-auto bg-white border border-slate-300 p-8 md:p-12 shadow-md print:shadow-none print:border-none print:p-0 print:max-w-none text-[12px] leading-relaxed">
        {/* Cabeçalho */}
        <div className="border-b-2 border-slate-900 pb-4 mb-4 flex justify-between items-start">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded bg-gradient-to-br from-[#2AA3D8] to-[#125c80] flex items-center justify-center text-white font-black text-xl tracking-tighter">
              CL
            </div>
            <div>
              <h1 className="text-base font-black text-slate-900 tracking-tight uppercase">
                {empresa.nomeFantasia}
              </h1>
              <p className="text-[11px] font-semibold text-slate-600">{empresa.razaoSocial}</p>
              <p className="text-[10px] text-slate-500">
                CNPJ: {empresa.cnpj} • I.E.: {empresa.inscricaoEstadual} • Tel: {empresa.telefone}
              </p>
              <p className="text-[10px] text-slate-500">
                {empresa.endereco}, {empresa.bairro} - {empresa.cidade}/{empresa.uf}
              </p>
            </div>
          </div>

          <div className="text-right border-l-2 border-slate-900 pl-4">
            <span className="text-[11px] font-bold text-slate-500 uppercase block">
              Comprovante de Devolução / Checklist
            </span>
            <span className="text-xl font-black text-[#2AA3D8] font-mono">
              Nº {devolucao.numeroComprovante}
            </span>
            <p className="text-[11px] font-semibold text-slate-800 mt-1">
              Contrato Ref.: <span className="text-[#D9332B] font-mono font-bold">{contrato.numeroContrato}</span>
            </p>
            <p className="text-[10px] text-slate-500">
              Data/Hora: {devolucao.dataHora}
            </p>
          </div>
        </div>

        {/* Título */}
        <div className="text-center my-3 bg-slate-100 py-2 border border-slate-200">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-900">
            CHECKLIST DE VISTORIA E COMPROVANTE DE RECEBIMENTO DE MATERIAL
          </h2>
        </div>

        {/* Dados do Locatário e Local */}
        <div className="grid grid-cols-2 gap-4 mb-4 bg-slate-50 p-3 border border-slate-200 rounded text-[11px]">
          <div>
            <p><strong>LOCATÁRIO:</strong> {cliente.nomeRazao}</p>
            <p><strong>CPF/CNPJ:</strong> {cliente.cpfCnpj}</p>
            <p><strong>TELEFONE:</strong> {cliente.telefone}</p>
          </div>
          <div>
            <p><strong>LOCAL DE ENTREGA:</strong> {devolucao.localEntrega === 'balcao' ? 'Cliente retira / devolve no Balcão da Locadora' : `Coleta efetuada na Obra: ${obra?.nomeIdentificacao || 'Endereço da obra'}`}</p>
            {obra && devolucao.localEntrega === 'obra' && (
              <p className="text-[10px] text-slate-500">{obra.logradouro}, {obra.numero} - {obra.bairro}, {obra.cidade}/{obra.uf}</p>
            )}
          </div>
        </div>

        {/* Tabela de Itens Devolvidos */}
        <div className="mb-4">
          <table className="w-full border-collapse border border-slate-300 text-[11px]">
            <thead>
              <tr className="bg-slate-200 text-slate-800">
                <th className="border border-slate-300 p-2 text-center w-12">Qtde</th>
                <th className="border border-slate-300 p-2 text-left">Descrição do Item Devolvido</th>
                <th className="border border-slate-300 p-2 text-center w-28">Patrimônio / Série</th>
                <th className="border border-slate-300 p-2 text-left">Observação / Vistoria Visual</th>
                <th className="border border-slate-300 p-2 text-center w-36">Condição Apurada</th>
              </tr>
            </thead>
            <tbody>
              {devolucao.itens.map((it, idx) => (
                <tr key={idx} className="border-b border-slate-200">
                  <td className="border border-slate-300 p-2 text-center font-bold text-slate-900">
                    {it.quantidadeDevolvida}
                  </td>
                  <td className="border border-slate-300 p-2">
                    <span className="font-semibold text-slate-900">{it.descricao}</span>
                  </td>
                  <td className="border border-slate-300 p-2 text-center font-mono text-indigo-700">
                    {it.patrimonioId || 'Granel'}
                  </td>
                  <td className="border border-slate-300 p-2 text-slate-700">
                    {it.observacao || 'Conferido no ato da entrega'}
                    {it.valorCobrancaAvaria && it.valorCobrancaAvaria > 0 ? (
                      <span className="block text-red-600 font-semibold mt-0.5">
                        Cobrança gerada: {formatCurrencyBRL(it.valorCobrancaAvaria)}
                      </span>
                    ) : null}
                  </td>
                  <td className="border border-slate-300 p-2 text-center">
                    {it.condicao === 'conforme' && (
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Conforme
                      </span>
                    )}
                    {it.condicao === 'danificado_sujo' && (
                      <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                        <AlertTriangle className="w-3.5 h-3.5" /> Danificado / Sujo
                      </span>
                    )}
                    {it.condicao === 'testar_na_empresa' && (
                      <span className="inline-flex items-center gap-1 font-semibold text-blue-700">
                        <HelpCircle className="w-3.5 h-3.5" /> Testar na Empresa
                      </span>
                    )}
                    {it.condicao === 'extraviado_roubado' && (
                      <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                        <XCircle className="w-3.5 h-3.5" /> Extraviado/Roubado
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Quadro Oficial de Avaliação Visual / Funcional (Item 3.2 do Prompt Mestre) */}
        <div className="mb-6 p-4 border-2 border-slate-400 rounded bg-slate-50">
          <p className="font-bold text-slate-900 mb-2 uppercase text-[11px]">
            AVALIAÇÃO VISUAL E FUNCIONAL NA RECEPÇÃO DO MATERIAL:
          </p>
          <div className="grid grid-cols-2 gap-3 text-[11px] text-slate-800">
            <label className="flex items-center gap-2 cursor-pointer">
              <span className={`w-4 h-4 border border-slate-800 rounded-sm flex items-center justify-center font-bold text-[10px] ${devolucao.itens.some(i => i.condicao === 'danificado_sujo') ? 'bg-amber-500 text-white' : 'bg-white'}`}>
                {devolucao.itens.some(i => i.condicao === 'danificado_sujo') ? 'X' : ''}
              </span>
              <span>( ) Danificado / Sujo (avarias debitadas em até 30 dias)</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <span className={`w-4 h-4 border border-slate-800 rounded-sm flex items-center justify-center font-bold text-[10px] ${devolucao.itens.some(i => i.condicao === 'extraviado_roubado') ? 'bg-red-600 text-white' : 'bg-white'}`}>
                {devolucao.itens.some(i => i.condicao === 'extraviado_roubado') ? 'X' : ''}
              </span>
              <span>( ) Extraviado / Roubado (cobrança tabela reposição)</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <span className={`w-4 h-4 border border-slate-800 rounded-sm flex items-center justify-center font-bold text-[10px] ${devolucao.itens.some(i => i.condicao === 'testar_na_empresa') ? 'bg-blue-600 text-white' : 'bg-white'}`}>
                {devolucao.itens.some(i => i.condicao === 'testar_na_empresa') ? 'X' : ''}
              </span>
              <span>( ) Será testado na empresa (aguarda laudo técnico)</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <span className={`w-4 h-4 border border-slate-800 rounded-sm flex items-center justify-center font-bold text-[10px] ${devolucao.itens.every(i => i.condicao === 'conforme') ? 'bg-emerald-600 text-white' : 'bg-white'}`}>
                {devolucao.itens.every(i => i.condicao === 'conforme') ? 'X' : ''}
              </span>
              <span>( ) Conforme acima descrito (recebido sem pendências)</span>
            </label>
          </div>
          <p className="mt-3 text-[10px] text-slate-500 italic">
            * O recebimento com a anotação "Será testado na empresa" não quita defeitos internos de motores, queima de bobina ou faltas não detectáveis a olho nu.
          </p>
        </div>

        {/* Assinaturas */}
        <div className="pt-4 border-t border-slate-300">
          <p className="text-center text-[11px] text-slate-600 mb-6">
            {devolucao.cidade}, {devolucao.dataHora.split(' ')[0]}.
          </p>

          <div className="grid grid-cols-2 gap-10 text-[11px]">
            {/* Assinatura Locadora */}
            <div className="text-center">
              <div className="h-16 border-b border-slate-700 flex items-center justify-center mb-1">
                {devolucao.assinaturaLocadora.assinaturaDataUrl ? (
                  <img
                    src={devolucao.assinaturaLocadora.assinaturaDataUrl}
                    alt="Assinatura Locadora"
                    className="max-h-14 max-w-full object-contain"
                  />
                ) : (
                  <span className="font-signature text-blue-900 text-lg italic font-bold">
                    {devolucao.assinaturaLocadora.nome}
                  </span>
                )}
              </div>
              <p className="font-bold text-slate-800">
                {devolucao.assinaturaLocadora.nome || 'Locadora (Conferente)'}
              </p>
              <p className="text-slate-500 text-[10px]">{empresa.nomeFantasia}</p>
            </div>

            {/* Assinatura Recebedor / Devolvente */}
            <div className="text-center">
              <div className="h-16 border-b border-slate-700 flex items-center justify-center mb-1">
                {devolucao.assinaturaRecebedor.assinaturaDataUrl ? (
                  <img
                    src={devolucao.assinaturaRecebedor.assinaturaDataUrl}
                    alt="Assinatura Recebedor"
                    className="max-h-14 max-w-full object-contain"
                  />
                ) : (
                  <span className="font-signature text-blue-900 text-lg italic font-bold">
                    {devolucao.assinaturaRecebedor.nome}
                  </span>
                )}
              </div>
              <p className="font-bold text-slate-800">
                {devolucao.assinaturaRecebedor.nome || 'Responsável pela Devolução'}
              </p>
              <p className="text-slate-500 text-[10px]">
                RG: {devolucao.assinaturaRecebedor.rg || 'Não informado'} • Fone: {devolucao.assinaturaRecebedor.telefone || 'Não informado'}
              </p>
            </div>
          </div>
        </div>

        {/* Rodapé */}
        <div className="mt-8 pt-4 border-t border-slate-200 flex justify-between items-center text-[9px] text-slate-400">
          <span>Sistema Central Locação — Lynus Tecnologia</span>
          <span>{devolucao.numeroComprovante} • Via Locadora / Locatário</span>
        </div>
      </div>
    </div>
  );
};
