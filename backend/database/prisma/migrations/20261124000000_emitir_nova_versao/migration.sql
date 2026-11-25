-- Emissão de uma nova versão (orçamento com id_orcamento_origem): corrige o erro
-- "column reference \"id_orcamento\" is ambiguous" de proxy_orcamento_emitir (UC15, UC16).
--
-- Causa: a função declara RETURNS TABLE(id_orcamento, numero_orcamento, data_validade), e essas colunas
-- de saída viram variáveis do PL/pgSQL. O UPDATE que marca o orçamento de origem como SUBSTITUIDO usava
-- `WHERE id_orcamento = ...` sem qualificar, e o PostgreSQL não sabia se era a coluna ou a variável.
-- Só acontecia quando havia origem; a emissão comum nunca passa por esse UPDATE.
--
-- Correção: o UPDATE passa a usar o alias `o` e `o.id_orcamento`. Nada mais muda: mesma assinatura, mesmo
-- retorno, mesmas regras e mesmo corpo. CREATE OR REPLACE preserva os privilégios já concedidos
-- (REVOKE de PUBLIC e GRANT ao postgres, da migration 20261112002000_proxy_functions_jobs).
--
-- A migration original não foi editada, para não mudar o checksum que o Prisma já registrou.
--
-- Mudança aditiva e sem dados: nenhuma linha é alterada, e a função só ganha o comportamento correto
-- no caso que antes falhava.

CREATE OR REPLACE FUNCTION public.proxy_orcamento_emitir(
  p_id_orcamento INTEGER,
  p_id_operador INTEGER,
  p_chave_seguranca TEXT
)
RETURNS TABLE(id_orcamento INTEGER, numero_orcamento BIGINT, data_validade DATE)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_orc public.orcamento%ROWTYPE;
  v_origem public.orcamento%ROWTYPE;
  v_numero BIGINT;
  v_itens NUMERIC(12,2);
  v_imposto NUMERIC(12,2);
  v_count INTEGER;
  v_item RECORD;
  v_antigo_emissor TEXT;
  v_antigo_operador TEXT;
  v_afetados INTEGER;
BEGIN
  IF p_chave_seguranca IS NULL OR btrim(p_chave_seguranca)='' OR length(p_chave_seguranca)>64 THEN RAISE EXCEPTION 'PAYLOAD_INVALIDO'; END IF;
  SELECT * INTO v_orc FROM public.orcamento o WHERE o.id_orcamento=p_id_orcamento FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_orc.status <> 'RASCUNHO' THEN RAISE EXCEPTION 'ORCAMENTO_NAO_EDITAVEL'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.operador op WHERE op.id_operador=p_id_operador AND op.status='ATIVO') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM public.divida_inadimplencia d WHERE d.id_cliente=v_orc.id_cliente AND d.status IN ('EM_ABERTO','PROTESTADA')) THEN RAISE EXCEPTION 'CLIENTE_INADIMPLENTE'; END IF;
  SELECT COUNT(*),COALESCE(SUM(i.valor_total_item),0),COALESCE(SUM(i.valor_imposto),0)
    INTO v_count,v_itens,v_imposto FROM public.item_orcamento i WHERE i.id_orcamento=p_id_orcamento;
  IF v_count=0 THEN RAISE EXCEPTION 'ORCAMENTO_SEM_ITENS'; END IF;
  IF v_orc.id_endereco_entrega IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.endereco_cliente e WHERE e.id_endereco=v_orc.id_endereco_entrega AND e.id_cliente=v_orc.id_cliente
  ) THEN RAISE EXCEPTION 'ENDERECO_CLIENTE_DIVERGENTE'; END IF;
  IF v_orc.id_orcamento_origem IS NOT NULL THEN
    SELECT * INTO v_origem FROM public.orcamento o WHERE o.id_orcamento=v_orc.id_orcamento_origem FOR UPDATE;
    IF NOT FOUND OR v_origem.id_cliente<>v_orc.id_cliente OR v_origem.status NOT IN ('ABERTO','ALTERACAO_SOLICITADA','RECUSADO') THEN RAISE EXCEPTION 'ORCAMENTO_NAO_EDITAVEL'; END IF;
  END IF;
  IF v_orc.condicao_pagamento IS NULL OR v_orc.modalidade_frete IS NULL THEN RAISE EXCEPTION 'ORCAMENTO_NAO_EDITAVEL'; END IF;
  IF v_orc.primeira_compra AND v_orc.condicao_pagamento<>'ADIANTADO_100' THEN RAISE EXCEPTION 'ORCAMENTO_NAO_EDITAVEL'; END IF;
  IF v_orc.valor_frete IS NOT NULL AND v_orc.modalidade_frete='FOB' AND v_orc.origem_transportadora='SUPRIMAX' AND v_orc.frete_provisorio THEN
    RAISE EXCEPTION 'FRETE_PROVISORIO_NAO_EMITIVEL';
  END IF;
  v_numero := nextval('public.numero_orcamento_seq');
  v_antigo_emissor := current_setting('suprimax.emitting_quote',true);
  v_antigo_operador := current_setting('suprimax.id_operador',true);
  PERFORM set_config('suprimax.emitting_quote','on',true);
  PERFORM set_config('suprimax.id_operador',p_id_operador::TEXT,true);
  IF v_orc.id_orcamento_origem IS NOT NULL THEN
    UPDATE public.orcamento AS o SET status='SUBSTITUIDO',data_encerramento=CURRENT_TIMESTAMP
      WHERE o.id_orcamento=v_orc.id_orcamento_origem;
  END IF;
  BEGIN
    UPDATE public.orcamento AS q SET
      numero_orcamento=v_numero,
      data_emissao=CURRENT_DATE,
      data_validade=CURRENT_DATE+30,
      chave_seguranca=p_chave_seguranca,
      valor_total_itens=v_itens,
      valor_total_imposto=v_imposto,
      valor_total_proposta=v_itens+COALESCE(v_orc.valor_frete,0),
      status='ABERTO'
    WHERE q.id_orcamento=p_id_orcamento;
  EXCEPTION WHEN unique_violation THEN
    PERFORM set_config('suprimax.emitting_quote',COALESCE(v_antigo_emissor,'off'),true);
    PERFORM set_config('suprimax.id_operador',COALESCE(v_antigo_operador,''),true);
    RAISE EXCEPTION 'CHAVE_DUPLICADA';
  END;
  IF v_orc.id_pedido IS NOT NULL THEN
    UPDATE public.pedido SET status='APROVADO',data_decisao=CURRENT_TIMESTAMP
      WHERE id_pedido=v_orc.id_pedido AND status='EM_ANALISE';
    GET DIAGNOSTICS v_afetados=ROW_COUNT;
    IF v_afetados<>1 THEN RAISE EXCEPTION 'PEDIDO_JA_ASSUMIDO'; END IF;
  END IF;
  FOR v_item IN SELECT i.id_item FROM public.item_orcamento i WHERE i.id_orcamento=p_id_orcamento ORDER BY i.id_item LOOP
    INSERT INTO public.reserva_estoque(id_item,quantidade_reservada,status,data_expiracao)
    VALUES(v_item.id_item,public.suprimax_quantidade_item_unidades(v_item.id_item),'CONFIRMADA',CURRENT_DATE+30);
  END LOOP;
  PERFORM set_config('suprimax.emitting_quote',COALESCE(v_antigo_emissor,'off'),true);
  PERFORM set_config('suprimax.id_operador',COALESCE(v_antigo_operador,''),true);
  RETURN QUERY SELECT v_orc.id_orcamento,v_numero,CURRENT_DATE+30;
END $$;
