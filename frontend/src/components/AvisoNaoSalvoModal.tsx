import type { ReactNode } from 'react';
import type { Blocker } from 'react-router-dom';
import { BotaoAtencao, BotaoSecundario, Modal } from '@/components/ui';

/** RNF06: confirmação de saída com alterações não salvas (par do hook `useAvisoNaoSalvo`). */
export function AvisoNaoSalvoModal({
  bloqueio,
  children,
}: {
  bloqueio: Blocker;
  children: ReactNode;
}) {
  if (bloqueio.state !== 'blocked') return null;
  return (
    <Modal
      titulo="Alterações não salvas"
      aoFechar={() => bloqueio.reset()}
      acoes={
        <>
          <BotaoSecundario onClick={() => bloqueio.reset()}>Ficar na tela</BotaoSecundario>
          <BotaoAtencao onClick={() => bloqueio.proceed()}>Sair sem salvar</BotaoAtencao>
        </>
      }
    >
      <p className="text-sm">{children}</p>
    </Modal>
  );
}
