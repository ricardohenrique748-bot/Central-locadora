/**
 * Central Locação - Documento Oficial: Contrato de Locação de Bens Móveis
 * Conforme item 3.1 do Prompt Mestre
 * Formato fiel para impressão e geração de PDF
 */

import React from 'react';
import { Contrato, Cliente, Obra, Equipamento, ConfiguracoesEmpresa } from '../../types';
import { formatCurrencyBRL } from '../../utils/billing';
import { Printer, Download, ArrowLeft, ShieldCheck, FileText } from 'lucide-react';

interface ContratoDocumentProps {
  contrato: Contrato;
  cliente: Cliente;
  obra?: Obra;
  equipamentos: Equipamento[];
  empresa: ConfiguracoesEmpresa;
  onBack: () => void;
}

export const ContratoDocument: React.FC<ContratoDocumentProps> = ({
  contrato,
  cliente,
  obra,
  equipamentos,
  empresa,
  onBack,
}) => {
  const handlePrint = () => {
    window.print();
  };

  const totalIndenizacao = contrato.itens.reduce(
    (acc, it) => acc + it.valorIndenizacaoUnitario * it.quantidade,
    0
  );

  return (
    <div className="bg-slate-100 min-h-screen p-4 md:p-8 text-slate-900 print:bg-white print:p-0">
      {/* Barra de Ações Superior (Oculta na Impressão) */}
      <div className="max-w-4xl mx-auto mb-6 flex flex-wrap items-center justify-between gap-4 print:hidden">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 px-4 py-2 rounded-lg shadow-xs"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar ao Painel
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 text-sm font-semibold text-white bg-[#2AA3D8] hover:bg-[#1f87b3] px-5 py-2.5 rounded-lg shadow-sm"
          >
            <Printer className="w-4 h-4" /> Imprimir Contrato (Ctrl+P)
          </button>
        </div>
      </div>

      {/* Folha do Contrato A4 */}
      <div className="max-w-4xl mx-auto bg-white border border-slate-300 p-8 md:p-12 shadow-md print:shadow-none print:border-none print:p-0 print:max-w-none text-[12px] leading-relaxed">
        {/* Cabeçalho */}
        <div className="border-b-2 border-slate-900 pb-4 mb-6">
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded bg-gradient-to-br from-[#2AA3D8] to-[#125c80] flex items-center justify-center text-white font-black text-xl tracking-tighter">
                CL
              </div>
              <div>
                <h1 className="text-lg font-black text-slate-900 tracking-tight uppercase">
                  {empresa.nomeFantasia}
                </h1>
                <p className="text-[11px] font-semibold text-slate-600">
                  {empresa.razaoSocial}
                </p>
                <p className="text-[10px] text-slate-500">
                  CNPJ: {empresa.cnpj} • I.E.: {empresa.inscricaoEstadual}
                </p>
                <p className="text-[10px] text-slate-500">
                  {empresa.endereco}, {empresa.bairro} - {empresa.cidade}/{empresa.uf} - Fone: {empresa.telefone}
                </p>
              </div>
            </div>

            <div className="text-right border-l-2 border-slate-900 pl-4">
              <span className="text-[11px] font-bold text-slate-500 uppercase block">
                Contrato de Locação
              </span>
              <span className="text-xl font-black text-[#D9332B] font-mono">
                Nº {contrato.numeroContrato}
              </span>
              <p className="text-[10px] text-slate-500 mt-1">
                Data de Emissão: {new Date(contrato.dataEmissao + 'T00:00:00').toLocaleDateString('pt-BR')}
              </p>
            </div>
          </div>
        </div>

        {/* Título Oficial */}
        <div className="text-center my-4">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 underline underline-offset-4">
            CONTRATO DE LOCAÇÃO DE BENS MÓVEIS SEM FORNECIMENTO DE MÃO DE OBRA
          </h2>
          <p className="text-[10px] text-slate-500 italic mt-1">
            (Dispensado de Nota Fiscal nos termos da LC nº 116/2003 e Súmula Vinculante 31 do STF)
          </p>
        </div>

        {/* Qualificação das Partes */}
        <div className="space-y-3 mb-6 bg-slate-50 p-4 border border-slate-200 rounded">
          <div>
            <span className="font-bold text-slate-800 uppercase">LOCADORA: </span>
            <span className="text-slate-700">
              {empresa.razaoSocial}, pessoa jurídica de direito privado inscrita no CNPJ sob nº {empresa.cnpj}, com sede na {empresa.endereco}, {empresa.bairro}, na cidade de {empresa.cidade} - {empresa.uf}, CEP {empresa.cep}.
            </span>
          </div>

          <div>
            <span className="font-bold text-slate-800 uppercase">LOCATÁRIO: </span>
            <span className="text-slate-700">
              <strong>{cliente.nomeRazao}</strong>, inscrito no {cliente.tipo === 'PJ' ? 'CNPJ' : 'CPF'} sob o nº <strong>{cliente.cpfCnpj}</strong>, RG/I.E. {cliente.rgIe || 'Isento'}, telefone {cliente.telefone}, e-mail {cliente.email}.
            </span>
          </div>

          <div>
            <span className="font-bold text-slate-800 uppercase">ENDEREÇO DA OBRA (USO EXCLUSIVO): </span>
            <span className="text-slate-700">
              {obra
                ? `${obra.nomeIdentificacao} — ${obra.logradouro}, nº ${obra.numero} ${obra.complemento || ''}, Bairro ${obra.bairro}, ${obra.cidade}/${obra.uf}, CEP: ${obra.cep}. Responsável no local: ${obra.responsavelNome} (${obra.responsavelTelefone}).`
                : 'Uso no endereço cadastral do Locatário.'}
            </span>
          </div>
        </div>

        {/* Tabela de Equipamentos e Indenização */}
        <div className="mb-6">
          <h3 className="font-bold uppercase text-[11px] mb-2 text-slate-800 flex items-center justify-between">
            <span>1. TABELA DE EQUIPAMENTOS, CICLOS E VALORES DE INDENIZAÇÃO:</span>
            <span className="text-slate-500 font-normal">Valores e ciclos individuais por item</span>
          </h3>

          <table className="w-full border-collapse border border-slate-300 text-[11px]">
            <thead>
              <tr className="bg-slate-200 text-slate-800 text-left">
                <th className="border border-slate-300 p-2 text-center w-10">Item</th>
                <th className="border border-slate-300 p-2">Equipamento / Descrição Detalhada</th>
                <th className="border border-slate-300 p-2 text-center w-12">Qtde</th>
                <th className="border border-slate-300 p-2 text-center w-20">Início</th>
                <th className="border border-slate-300 p-2 text-center w-20">Período</th>
                <th className="border border-slate-300 p-2 text-right w-24">Aluguel/Item</th>
                <th className="border border-slate-300 p-2 text-right w-24">Indenização/Un</th>
              </tr>
            </thead>
            <tbody>
              {contrato.itens.map((it, idx) => {
                const equip = equipamentos.find((e) => e.id === it.equipamentoId);
                return (
                  <tr key={it.id} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="border border-slate-300 p-2 text-center font-mono font-semibold">
                      {String(idx + 1).padStart(2, '0')}
                    </td>
                    <td className="border border-slate-300 p-2">
                      <div className="font-semibold text-slate-900">{equip?.nome || 'Equipamento'}</div>
                      <div className="text-[10px] text-slate-600">{equip?.descricao}</div>
                      {it.patrimonioIds && it.patrimonioIds.length > 0 && (
                        <div className="text-[10px] text-indigo-700 font-mono mt-0.5">
                          Patrimônio(s): {it.patrimonioIds.join(', ')}
                        </div>
                      )}
                      {it.observacoes && (
                        <div className="text-[10px] text-slate-500 italic mt-0.5">Obs: {it.observacoes}</div>
                      )}
                    </td>
                    <td className="border border-slate-300 p-2 text-center font-bold">
                      {it.quantidade} {equip?.unidadeMedida || 'pç'}
                    </td>
                    <td className="border border-slate-300 p-2 text-center font-mono">
                      {new Date(it.dataInicio + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </td>
                    <td className="border border-slate-300 p-2 text-center capitalize">
                      {it.periodoTipo}
                    </td>
                    <td className="border border-slate-300 p-2 text-right font-mono font-semibold">
                      {formatCurrencyBRL(it.valorUnitarioPeriodo * it.quantidade)}
                    </td>
                    <td className="border border-slate-300 p-2 text-right font-mono text-red-700">
                      {formatCurrencyBRL(it.valorIndenizacaoUnitario)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-bold">
                <td colSpan={5} className="border border-slate-300 p-2 text-right uppercase">
                  Total Estimado da Locação Mensal / Ciclo Inicial:
                </td>
                <td className="border border-slate-300 p-2 text-right font-mono text-slate-900 text-[12px]">
                  {formatCurrencyBRL(contrato.totalMensalEstimado)}
                </td>
                <td className="border border-slate-300 p-2 text-right font-mono text-slate-700 text-[10px]">
                  Total Ind.: {formatCurrencyBRL(totalIndenizacao)}
                </td>
              </tr>
              {contrato.freteEntrega > 0 && (
                <tr className="bg-slate-50 text-[10px]">
                  <td colSpan={5} className="border border-slate-300 p-2 text-right">
                    Taxa de Frete / Entrega Acordada:
                  </td>
                  <td colSpan={2} className="border border-slate-300 p-2 text-right font-mono">
                    {formatCurrencyBRL(contrato.freteEntrega)}
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>

        {/* Cláusulas Contratuais */}
        <div className="mb-8">
          <h3 className="font-bold uppercase text-[11px] mb-2 text-slate-800">
            2. CLÁUSULAS GERAIS E CONDIÇÕES CONTRATUAIS:
          </h3>
          <div className="space-y-2 text-[10.5px] text-justify text-slate-700 leading-normal border border-slate-200 p-4 rounded bg-slate-50/50">
            <p>
              <strong>CLÁUSULA 1ª - DO OBJETO E USO EXCLUSIVO:</strong> O presente contrato tem por objeto a locação dos bens móveis discriminados na tabela acima, para utilização EXCLUSIVA no endereço da obra supra qualificada. É terminantemente proibido transferir, sublocar, ceder ou remover qualquer equipamento do local de obra sem consentimento formal prévio da LOCADORA.
            </p>
            <p>
              <strong>CLÁUSULA 2ª - DO VALOR E REAJUSTE:</strong> O aluguel será pago nos períodos e valores acordados. Caso a locação permaneça ativa após 12 (doze) meses da data inicial, o valor unitário de cada item sofrerá reajuste anual automático de acordo com a variação positiva do IGP-M/FGV (ou índice oficial que vier a substituí-lo).
            </p>
            <p>
              <strong>CLÁUSULA 3ª - DO PRAZO E PRORROGAÇÃO AUTOMÁTICA:</strong> A locação vigora a partir da entrega ou retirada dos equipamentos. Em não ocorrendo a restituição formal na data de encerramento do período inicial contratado, o presente contrato considerar-se-á <strong>PRORROGADO AUTOMATICAMENTE POR PRAZO INDETERMINADO</strong> em ciclos sucessivos de 30 (trinta) dias. O atraso na devolução implicará cobrança de diária proporcional acrescida de encargos moratórios.
            </p>
            <p>
              <strong>CLÁUSULA 4ª - DO ESTADO DE CONSERVAÇÃO:</strong> O LOCATÁRIO declara e reconhece expressamente que recebeu os bens móveis limpos, revisados, lubrificados e em perfeito estado de funcionamento, cabendo-lhe zelar por sua guarda e integridade.
            </p>
            <p>
              <strong>CLÁUSULA 5ª - DA RESPONSABILIDADE POR ACIDENTES:</strong> O LOCATÁRIO assume integral e irrestrita responsabilidade civil, trabalhista, administrativa e penal por danos materiais, corporais ou acidentes causados a seus empregados, prepostos ou a terceiros pelo uso, montagem ou manuseio dos bens ora locados.
            </p>
            <p>
              <strong>CLÁUSULA 6ª - DA MANUTENÇÃO E PEÇAS:</strong> Manutenções preventivas ou corretivas decorrentes de desgaste natural serão efetuadas pela LOCADORA. Danos por imperícia, sobrecarga ou uso inadequado serão reparados pela LOCADORA e cobrados do LOCATÁRIO com base na Tabela de Peças e Serviços da Locadora.
            </p>
            <p>
              <strong>CLÁUSULA 7ª - DO EXTRAVIO, DANO TOTAL OU ROUBO:</strong> Em caso de furto, roubo, apropriação indébita, extravio ou perda total de qualquer dos bens, o LOCATÁRIO pagará de imediato à LOCADORA o <strong>VALOR DE REPOSIÇÃO / INDENIZAÇÃO</strong> fixado na tabela do presente contrato.
            </p>
            <p>
              <strong>CLÁUSULA 8ª - DO TRANSPORTE E DEVOLUÇÃO:</strong> O transporte é por conta do LOCATÁRIO, salvo quando expressamente contratado frete da LOCADORA. A devolução só se aperfeiçoará com a emissão do <strong>COMPROVANTE DE DEVOLUÇÃO / CHECKLIST</strong> assinado por ambas as partes. Eventuais avarias constatadas serão cobradas em fatura com vencimento para 30 (trinta) dias.
            </p>
            <p>
              <strong>CLÁUSULA 9ª - DA MULTA CONTRATUAL E FORO:</strong> Em caso de inadimplência ou descumprimento contratual, fica estipulada a multa penal irredutível de <strong>20% (vinte por cento)</strong> sobre o valor do contrato, sem prejuízo da reintegração de posse imediata dos bens. Fica eleito o Foro da Comarca de <strong>São José do Rio Preto – SP</strong> para dirimir quaisquer dúvidas oriundas deste contrato.
            </p>
          </div>
        </div>

        {/* Campos de Assinatura */}
        <div className="pt-6 border-t border-slate-300">
          <p className="text-center text-[11px] text-slate-600 mb-8">
            São José do Rio Preto – SP, {new Date(contrato.dataEmissao + 'T00:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}.
          </p>

          <div className="grid grid-cols-2 gap-12 text-center text-[11px]">
            <div>
              <div className="border-b border-slate-800 pb-1 mb-1 h-12 flex items-end justify-center font-signature text-blue-900 italic font-bold">
                {empresa.nomeFantasia}
              </div>
              <p className="font-bold text-slate-800">{empresa.razaoSocial}</p>
              <p className="text-slate-500">LOCADORA (CNPJ: {empresa.cnpj})</p>
            </div>

            <div>
              <div className="border-b border-slate-800 pb-1 mb-1 h-12 flex items-end justify-center font-signature text-blue-900 italic font-bold">
                {contrato.responsavelLocatarioNome || cliente.nomeRazao}
              </div>
              <p className="font-bold text-slate-800">{cliente.nomeRazao}</p>
              <p className="text-slate-500">LOCATÁRIO ({cliente.tipo === 'PJ' ? 'CNPJ' : 'CPF'}: {cliente.cpfCnpj})</p>
            </div>
          </div>

          <div className="mt-8 pt-4 border-t border-dashed border-slate-200 grid grid-cols-2 gap-8 text-[10px] text-slate-500">
            <div>
              <p>Testemunha 1: ___________________________</p>
              <p className="mt-1">Nome / CPF:</p>
            </div>
            <div>
              <p>Testemunha 2: ___________________________</p>
              <p className="mt-1">Nome / CPF:</p>
            </div>
          </div>
        </div>

        {/* Rodapé Sistema */}
        <div className="mt-8 pt-4 border-t border-slate-200 flex justify-between items-center text-[9px] text-slate-400">
          <span>Sistema Central Locação — Desenvolvido por Lynus Tecnologia</span>
          <span>Contrato Nº {contrato.numeroContrato} • Folha 1 de 1</span>
        </div>
      </div>
    </div>
  );
};
