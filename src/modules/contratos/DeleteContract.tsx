/**
 * Exclusão de contrato nunca formalizado (rascunho / aguardando aprovação). O servidor confere de novo
 * dono, status e vínculos; contrato formalizado é cancelado, não excluído.
 */

import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { AuthUser } from '../../../shared/orcamentos/types';
import { ContractStatus } from '../../../shared/contratos/types';
import { api, ApiError } from '../orcamentos/api';
import { Button, Modal, useToast } from '../orcamentos/ui';

const isDraft = (status: ContractStatus) => ['rascunho', 'aguardando_aprovacao'].includes(status);

/** Rascunho: dono, gestor ou admin. Formalizado: só o admin (o servidor ainda barra entrega, logística, OS e recebimento). */
export const canDeleteContract = (user: AuthUser, status: ContractStatus) =>
  isDraft(status) ? ['admin', 'gestor', 'vendedor'].includes(user.role) : user.role === 'admin';

export const DeleteContractModal: React.FC<{ contract: { id: number; contract_number: string; customer_name: string; status: ContractStatus } | null; onClose: () => void; onDeleted: () => void }> = ({ contract, onClose, onDeleted }) => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const formalized = !!contract && !isDraft(contract.status);
  const remove = async () => {
    if (!contract) return;
    setBusy(true);
    try {
      await api.del(`/contracts/${contract.id}`);
      toast('success', `Contrato ${contract.contract_number} excluído.`);
      onDeleted();
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!contract}
      onClose={onClose}
      title="Excluir contrato"
      footer={
        <>
          <Button onClick={onClose}>Voltar</Button>
          <Button variant="danger" icon={Trash2} loading={busy} onClick={remove}>
            Excluir definitivamente
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-700">
        Excluir o contrato <b>{contract?.contract_number}</b> de <b>{contract?.customer_name}</b>? Itens e histórico dele também serão apagados e reservas abertas no estoque serão canceladas. Esta ação não pode ser desfeita.
      </p>
      {formalized ? (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-md p-2 mt-2">
          Contrato já formalizado: documentos, aditivos e cobranças dele também serão apagados, e os títulos no Financeiro ficam cancelados. Só é possível se não houver entrega, logística, OS nem recebimento registrado; nesses casos, use Cancelar.
        </p>
      ) : (
        <p className="text-xs text-slate-500 mt-2">
          Contratos aprovados, assinados ou ativos só podem ser excluídos pelo administrador, e apenas sem entrega, logística, OS ou recebimento; nos demais casos, use Cancelar.
        </p>
      )}
    </Modal>
  );
};
