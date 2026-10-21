/**
 * Configurações de contratos: aprovação, assinatura, alertas, cobrança, encerramento e modelo do documento.
 */

import React, { useEffect, useState } from 'react';
import { Save, RotateCcw, Upload, Trash2, PenLine } from 'lucide-react';
import { ContractSettings } from '../../../../shared/contratos/types';
import { contractCan } from '../../../../shared/contratos/rules';
import { api, ApiError } from '../../orcamentos/api';
import { Button, Card, Checkbox, Field, Input, MoneyInput, Notice, PageHeader, Textarea, useToast } from '../../orcamentos/ui';
import { useCtr } from '../context';

const PLACEHOLDERS = 'empresa, cliente, documento_cliente, numero_documento_cliente, endereco_cliente, ie_cliente, local_obra, primeiro_vencimento, data_extenso, tabela_itens, tabela_prazo, tabela_reposicao, testemunhas, assinatura|linha 1|linha 2, numero, inicio, termino, valor_periodo, periodo, periodicidade, condicoes_pagamento, multa, juros, caucao, reajuste, resp_transporte, resp_combustivel, resp_manutencao, resp_avarias, condicoes_especiais';

export const CtrConfigView: React.FC = () => {
  const { settings, user, reload } = useCtr();
  const toast = useToast();
  const [f, setF] = useState<ContractSettings & { alert_text: string }>({ ...settings, alert_text: settings.alert_days.join(', ') });
  const [busy, setBusy] = useState(false);
  const admin = contractCan.configure(user);
  useEffect(() => setF({ ...settings, alert_text: settings.alert_days.join(', ') }), [settings]);
  const save = async () => {
    setBusy(true);
    try {
      await api.put('/contracts/settings', { ...f, alert_days: f.alert_text });
      toast('success', 'Configurações salvas.');
      reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader title="Configurações de contratos" subtitle={admin ? 'Regras aplicadas pelo servidor em todos os contratos.' : 'Visualização — alterações somente pelo administrador.'} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <Card title="Fluxo e regras">
          <div className="space-y-3">
            <Checkbox checked={f.require_approval} disabled={!admin} onChange={(v) => setF({ ...f, require_approval: v })} label="Todo contrato passa por aprovação interna" />
            <Field label="Alçada: acima deste valor sempre exige aprovação (0 = desligado)">
              <MoneyInput value={f.approval_limit} disabled={!admin} onChange={(v) => setF({ ...f, approval_limit: v ?? 0 })} />
            </Field>
            <Checkbox checked={f.require_signature_to_activate} disabled={!admin} onChange={(v) => setF({ ...f, require_signature_to_activate: v })} label="Exigir assinatura registrada antes de ativar" />
            <Checkbox checked={f.require_inspection_before_close} disabled={!admin} onChange={(v) => setF({ ...f, require_inspection_before_close: v })} label="Exigir inspeção dos equipamentos devolvidos antes de encerrar" />
            <Checkbox checked={f.block_close_with_open_charges} disabled={!admin} onChange={(v) => setF({ ...f, block_close_with_open_charges: v })} label="Bloquear encerramento com cobranças em aberto" />
          </div>
        </Card>
        <Card title="Alertas e cobrança">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Avisar vencimento com (dias)" hint="Ex.: 30, 15, 7">
              <Input value={f.alert_text} disabled={!admin} onChange={(e) => setF({ ...f, alert_text: e.target.value })} />
            </Field>
            <Field label="Prazo indeterminado: gerar cobranças até (meses)">
              <Input type="number" min={1} max={24} value={f.charge_horizon_months} disabled={!admin} onChange={(e) => setF({ ...f, charge_horizon_months: Number(e.target.value) })} />
            </Field>
            <Field label="Vencimento padrão (dias após a referência)">
              <Input type="number" min={0} max={120} value={f.default_due_days_after} disabled={!admin} onChange={(e) => setF({ ...f, default_due_days_after: Number(e.target.value) })} />
            </Field>
          </div>
          <p className="text-xs text-slate-500 mt-3">As categorias financeiras de locação e venda usadas nas cobranças são definidas em Financeiro › Configurações.</p>
        </Card>
        <Card title={<span className="flex items-center gap-2"><PenLine className="w-4 h-4 text-[#1e3a5f]" />Assinatura da locadora</span>} className="xl:col-span-2">
          <p className="text-sm text-slate-600 mb-3">
            A assinatura enviada aqui sai já impressa na linha da <b>locadora</b> nos contratos e aditivos gerados a partir de agora. Assim só falta colher a assinatura do cliente. Use uma foto ou escaneamento só da assinatura, de preferência PNG com fundo transparente.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 items-start">
            <div className="h-28 rounded-lg border border-dashed border-slate-300 bg-white flex items-center justify-center p-2">
              {f.lessor_signature ? <img src={f.lessor_signature} alt="Assinatura da locadora" className="max-h-24 max-w-full object-contain" /> : <span className="text-xs text-slate-400">Nenhuma assinatura enviada</span>}
            </div>
            <div className="space-y-3">
              <Field label="Nome do representante (aparece abaixo da assinatura)">
                <Input value={f.lessor_signatory} disabled={!admin} maxLength={120} onChange={(e) => setF({ ...f, lessor_signatory: e.target.value })} placeholder="Ex.: Fulano de Tal — Sócio-administrador" />
              </Field>
              {admin && (
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer">
                    <Upload className="w-4 h-4" /> {f.lessor_signature ? 'Trocar imagem' : 'Enviar imagem da assinatura'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        if (!/^image\/(png|jpeg)$/.test(file.type)) return toast('error', 'Envie uma imagem PNG ou JPG.');
                        if (file.size > 400_000) return toast('error', 'Imagem muito grande (máx. 400 KB). Recorte só a assinatura.');
                        const r = new FileReader();
                        r.onload = () => setF((cur) => ({ ...cur, lessor_signature: String(r.result) }));
                        r.readAsDataURL(file);
                      }}
                    />
                  </label>
                  {f.lessor_signature && (
                    <Button size="sm" variant="ghost" icon={Trash2} className="text-red-600" onClick={() => setF({ ...f, lessor_signature: null })}>
                      Remover
                    </Button>
                  )}
                </div>
              )}
              <p className="text-xs text-slate-500">Depois de enviar, clique em <b>Salvar</b>. Contratos já gerados não mudam: para um contrato em andamento sair com a assinatura, gere o documento de novo.</p>
            </div>
          </div>
        </Card>
        <Card
          title="Modelo do documento do contrato"
          className="xl:col-span-2"
          actions={
            admin && (
              <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setF({ ...f, contract_template: '' })}>
                Restaurar modelo padrão
              </Button>
            )
          }
        >
          <Notice kind="warning" className="mb-3">
            O modelo padrão é só um ponto de partida e não foi validado juridicamente. Revise as cláusulas com a assessoria jurídica antes de usar. Títulos de cláusula começam com “## ”.
          </Notice>
          <Textarea rows={18} value={f.contract_template} disabled={!admin} onChange={(e) => setF({ ...f, contract_template: e.target.value })} className="font-mono text-xs" placeholder="Vazio = modelo padrão" />
          <p className="text-xs text-slate-500 mt-2">
            Campos automáticos (entre chaves duplas, ex.: {'{{cliente}}'}): {PLACEHOLDERS}. Documentos já emitidos não mudam.
          </p>
        </Card>
      </div>
      {admin && (
        <div className="flex justify-end mt-5">
          <Button variant="primary" icon={Save} loading={busy} onClick={save}>
            Salvar
          </Button>
        </div>
      )}
    </div>
  );
};
