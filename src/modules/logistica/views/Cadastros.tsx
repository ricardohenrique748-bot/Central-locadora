/**
 * Motoristas e veículos usados nas operações.
 */

import React, { useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { logCan } from '../../../../shared/logistica/rules';
import { api, ApiError } from '../../orcamentos/api';
import { Button, Card, Checkbox, Field, Input, Modal, PageHeader, cx, useToast } from '../../orcamentos/ui';
import { useLog } from '../context';
import { Th } from '../components';

export const CadastrosView: React.FC = () => {
  const { user, drivers, vehicles, reload } = useLog();
  const toast = useToast();
  const [drv, setDrv] = useState<any>(null);
  const [veh, setVeh] = useState<any>(null);
  const can = logCan.registry(user);
  const save = async (kind: 'drivers' | 'vehicles', body: any) => {
    try {
      if (body.id) await api.put(`/logistics/${kind}/${body.id}`, body);
      else await api.post(`/logistics/${kind}`, body);
      toast('success', 'Cadastro salvo.');
      setDrv(null);
      setVeh(null);
      reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    }
  };
  return (
    <div>
      <PageHeader title="Motoristas e veículos" subtitle="Usados na programação e nos comprovantes. Inativos ficam no histórico." />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <Card title="Motoristas" bodyClassName="p-0" actions={can && <Button size="sm" icon={Plus} onClick={() => setDrv({ name: '', document: '', phone: '', active: true })}>Motorista</Button>}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><Th>Nome</Th><Th>Documento</Th><Th>Telefone</Th><Th /></tr></thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.id} className={cx('border-t border-slate-100', !d.active && 'text-slate-400')}>
                  <td className="px-4 py-2">{d.name}{!d.active && ' (inativo)'}</td><td className="px-4 py-2">{d.document || '—'}</td><td className="px-4 py-2">{d.phone || '—'}</td>
                  <td className="px-4 py-2 text-right">{can && <Button size="sm" variant="ghost" icon={Pencil} aria-label="Editar" onClick={() => setDrv(d)} />}</td>
                </tr>
              ))}
              {!drivers.length && <tr><td colSpan={4} className="px-4 py-4 text-slate-500 text-center">Nenhum motorista.</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card title="Veículos" bodyClassName="p-0" actions={can && <Button size="sm" icon={Plus} onClick={() => setVeh({ plate: '', description: '', capacity: '', active: true })}>Veículo</Button>}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><Th>Placa</Th><Th>Descrição</Th><Th>Capacidade</Th><Th /></tr></thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.id} className={cx('border-t border-slate-100', !v.active && 'text-slate-400')}>
                  <td className="px-4 py-2 font-mono">{v.plate}</td><td className="px-4 py-2">{v.description}{!v.active && ' (inativo)'}</td><td className="px-4 py-2">{v.capacity || '—'}</td>
                  <td className="px-4 py-2 text-right">{can && <Button size="sm" variant="ghost" icon={Pencil} aria-label="Editar" onClick={() => setVeh(v)} />}</td>
                </tr>
              ))}
              {!vehicles.length && <tr><td colSpan={4} className="px-4 py-4 text-slate-500 text-center">Nenhum veículo.</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>
      <Modal open={!!drv} onClose={() => setDrv(null)} title={drv?.id ? 'Editar motorista' : 'Novo motorista'} size="sm" footer={<><Button onClick={() => setDrv(null)}>Cancelar</Button><Button variant="primary" onClick={() => save('drivers', drv)}>Salvar</Button></>}>
        {drv && (
          <div className="space-y-3">
            <Field label="Nome" required><Input value={drv.name} onChange={(e) => setDrv({ ...drv, name: e.target.value })} /></Field>
            <Field label="Documento (CNH/CPF)"><Input value={drv.document || ''} onChange={(e) => setDrv({ ...drv, document: e.target.value })} /></Field>
            <Field label="Telefone"><Input value={drv.phone || ''} onChange={(e) => setDrv({ ...drv, phone: e.target.value })} /></Field>
            {drv.id && <Checkbox checked={!!drv.active} onChange={(v) => setDrv({ ...drv, active: v })} label="Ativo" />}
          </div>
        )}
      </Modal>
      <Modal open={!!veh} onClose={() => setVeh(null)} title={veh?.id ? 'Editar veículo' : 'Novo veículo'} size="sm" footer={<><Button onClick={() => setVeh(null)}>Cancelar</Button><Button variant="primary" onClick={() => save('vehicles', veh)}>Salvar</Button></>}>
        {veh && (
          <div className="space-y-3">
            <Field label="Placa" required><Input value={veh.plate} onChange={(e) => setVeh({ ...veh, plate: e.target.value.toUpperCase() })} /></Field>
            <Field label="Descrição" required><Input value={veh.description} onChange={(e) => setVeh({ ...veh, description: e.target.value })} placeholder="Ex.: Caminhão munck 3/4" /></Field>
            <Field label="Capacidade"><Input value={veh.capacity || ''} onChange={(e) => setVeh({ ...veh, capacity: e.target.value })} /></Field>
            {veh.id && <Checkbox checked={!!veh.active} onChange={(v) => setVeh({ ...veh, active: v })} label="Ativo" />}
          </div>
        )}
      </Modal>
    </div>
  );
};
