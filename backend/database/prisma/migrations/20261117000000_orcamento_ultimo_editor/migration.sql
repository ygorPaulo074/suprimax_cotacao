-- Último operador que editou o rascunho do orçamento (UC14): base do aviso "este rascunho foi
-- alterado por X em Y" mostrado ao responsável. Hoje historico_orcamento só registra mudança de
-- status e follow-up, então edições de itens, cabeçalho e condições não deixam o autor; só havia
-- data_ultima_edicao.
--
-- Mudança aditiva: coluna nula, sem default e sem NOT NULL; nenhuma linha existente é alterada
-- (orçamentos anteriores ficam com NULL e o backend usa o histórico como alternativa). O backend
-- grava a coluna junto das atualizações de rascunho que já gravam data_ultima_edicao.
--
-- Gatilhos: orcamento_validar só confere imutabilidade quando numero_orcamento já foi atribuído
-- (orçamento emitido), e aí qualquer alteração fora de status/encerramento/justificativa é recusada
-- com ORCAMENTO_NAO_EDITAVEL, inclusive nesta coluna (to_jsonb(NEW) passa a incluí-la). Em RASCUNHO
-- a atualização passa pelos gatilhos sem mudança neles.
--
-- ON DELETE SET NULL, como nas outras FKs opcionais de orcamento (id_endereco_entrega, id_pedido).
-- Na prática o operador é inativado, não apagado.
ALTER TABLE public.orcamento ADD COLUMN IF NOT EXISTS id_operador_ultima_edicao INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orcamento_id_operador_ultima_edicao_fkey' AND conrelid = 'public.orcamento'::regclass
  ) THEN
    ALTER TABLE public.orcamento
      ADD CONSTRAINT orcamento_id_operador_ultima_edicao_fkey
      FOREIGN KEY (id_operador_ultima_edicao) REFERENCES public.operador(id_operador) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS orcamento_id_operador_ultima_edicao_idx ON public.orcamento(id_operador_ultima_edicao);
