-- Emissão do orçamento é atômica: número, reservas, pedido e versão são confirmados juntos.
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
    UPDATE public.orcamento SET status='SUBSTITUIDO',data_encerramento=CURRENT_TIMESTAMP
      WHERE id_orcamento=v_orc.id_orcamento_origem;
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

-- O backend calcula preços e totais; a função confere as linhas e aplica o resultado sem alterar o orçamento emitido.
CREATE OR REPLACE FUNCTION public.proxy_resposta_processar(p_id_resposta INTEGER,p_resultado JSONB)
RETURNS TABLE(status_orcamento VARCHAR,status_resposta VARCHAR)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_resp public.resposta_orcamento%ROWTYPE;
  v_orc public.orcamento%ROWTYPE;
  v_linha JSONB;
  v_situacao VARCHAR(12);
  v_qtd INTEGER;
  v_faixa INTEGER;
  v_preco NUMERIC(12,2);
  v_imposto NUMERIC(12,2);
  v_total NUMERIC(12,2);
  v_itens NUMERIC(12,2);
  v_impostos NUMERIC(12,2);
  v_frete NUMERIC(12,2);
  v_total_final NUMERIC(12,2);
  v_num_itens INTEGER;
  v_num_aprovados INTEGER;
  v_num_processados INTEGER := 0;
  v_status_orc VARCHAR(20);
  v_status_resp VARCHAR(20);
  v_motivo VARCHAR(22);
  v_antigo_processamento TEXT;
  v_antigo_operador TEXT;
  v_id_item INTEGER;
  v_unidades INTEGER;
  v_reservas INTEGER;
BEGIN
  IF p_resultado IS NULL OR jsonb_typeof(p_resultado->'itens')<>'array' THEN RAISE EXCEPTION 'PAYLOAD_INVALIDO'; END IF;
  SELECT * INTO v_resp FROM public.resposta_orcamento r WHERE r.id_resposta=p_id_resposta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_resp.status_resposta<>'PENDENTE' THEN RAISE EXCEPTION 'RESPOSTA_JA_PROCESSADA'; END IF;
  SELECT * INTO v_orc FROM public.orcamento o WHERE o.id_orcamento=v_resp.id_orcamento FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_orc.status<>'ABERTO' THEN RAISE EXCEPTION 'ORCAMENTO_NAO_EDITAVEL'; END IF;
  SELECT COUNT(*) INTO v_num_itens FROM public.item_orcamento i WHERE i.id_orcamento=v_orc.id_orcamento;
  IF v_num_itens=0 THEN RAISE EXCEPTION 'ORCAMENTO_SEM_ITENS'; END IF;
  SELECT COUNT(DISTINCT (linha->>'id_item_resposta')::INTEGER) INTO v_num_processados
  FROM jsonb_array_elements(p_resultado->'itens') AS payload(linha);
  IF jsonb_array_length(p_resultado->'itens')<>v_num_itens OR v_num_processados<>v_num_itens THEN
    RAISE EXCEPTION 'RESPOSTA_DEVE_CONTER_TODOS_ITENS';
  END IF;
  v_num_processados := 0;
  v_antigo_processamento := current_setting('suprimax.processing_response',true);
  v_antigo_operador := current_setting('suprimax.id_operador',true);
  PERFORM set_config('suprimax.processing_response','on',true);
  PERFORM set_config('suprimax.id_operador',v_resp.id_operador_vendedor::TEXT,true);
  FOR v_linha IN SELECT value FROM jsonb_array_elements(p_resultado->'itens') LOOP
    v_situacao := v_linha->>'situacao';
    IF v_situacao NOT IN ('APROVADO','NAO_APROVADO') THEN RAISE EXCEPTION 'PAYLOAD_INVALIDO'; END IF;
    UPDATE public.item_resposta_orcamento ir SET
      situacao=v_situacao,
      quantidade_aprovada=COALESCE((v_linha->>'quantidade_aprovada')::INTEGER,ir.quantidade_aprovada),
      id_faixa_preco_aceita=CASE WHEN v_situacao='APROVADO' THEN NULLIF(v_linha->>'id_faixa_preco_aceita','')::INTEGER ELSE NULL END,
      preco_unitario_aceito=CASE WHEN v_situacao='APROVADO' THEN NULLIF(v_linha->>'preco_unitario_aceito','')::NUMERIC(12,2) ELSE NULL END,
      valor_imposto_aceito=CASE WHEN v_situacao='APROVADO' THEN NULLIF(v_linha->>'valor_imposto_aceito','')::NUMERIC(12,2) ELSE NULL END,
      valor_total_item_aceito=CASE WHEN v_situacao='APROVADO' THEN NULLIF(v_linha->>'valor_total_item_aceito','')::NUMERIC(12,2) ELSE NULL END
    WHERE ir.id_item_resposta=(v_linha->>'id_item_resposta')::INTEGER AND ir.id_resposta=p_id_resposta;
    GET DIAGNOSTICS v_qtd=ROW_COUNT;
    IF v_qtd<>1 THEN RAISE EXCEPTION 'ITEM_RESPOSTA_NAO_ENCONTRADO'; END IF;
    v_num_processados := v_num_processados+1;
  END LOOP;
  IF v_num_processados<>v_num_itens OR (SELECT COUNT(*) FROM public.item_resposta_orcamento ir WHERE ir.id_resposta=p_id_resposta)<>v_num_itens THEN
    RAISE EXCEPTION 'RESPOSTA_DEVE_CONTER_TODOS_ITENS';
  END IF;
  SELECT COUNT(*) FILTER(WHERE situacao='APROVADO'),
         COALESCE(SUM(valor_total_item_aceito) FILTER(WHERE situacao='APROVADO'),0),
         COALESCE(SUM(valor_imposto_aceito) FILTER(WHERE situacao='APROVADO'),0)
    INTO v_num_aprovados,v_itens,v_impostos FROM public.item_resposta_orcamento WHERE id_resposta=p_id_resposta;
  IF EXISTS (SELECT 1 FROM public.item_resposta_orcamento WHERE id_resposta=p_id_resposta AND situacao='APROVADO'
      AND (preco_unitario_aceito IS NULL OR valor_imposto_aceito IS NULL OR valor_total_item_aceito IS NULL)) THEN
    RAISE EXCEPTION 'PAYLOAD_INVALIDO';
  END IF;
  v_status_orc := p_resultado->>'status_orcamento';
  v_status_resp := p_resultado->>'status_resposta';
  v_motivo := p_resultado->>'motivo_tratamento';
  v_frete := NULLIF(p_resultado#>>'{totais,valor_frete_aceito}','')::NUMERIC(12,2);
  v_total_final := NULLIF(p_resultado#>>'{totais,valor_total_aceito}','')::NUMERIC(12,2);
  IF NULLIF(p_resultado#>>'{totais,valor_total_itens_aprovado}','') IS NOT NULL AND
      (p_resultado#>>'{totais,valor_total_itens_aprovado}')::NUMERIC(12,2)<>v_itens THEN RAISE EXCEPTION 'TOTAL_ITENS_DIVERGENTE'; END IF;
  IF NULLIF(p_resultado#>>'{totais,valor_total_imposto_aprovado}','') IS NOT NULL AND
      (p_resultado#>>'{totais,valor_total_imposto_aprovado}')::NUMERIC(12,2)<>v_impostos THEN RAISE EXCEPTION 'TOTAL_IMPOSTO_DIVERGENTE'; END IF;
  IF v_total_final IS NOT NULL AND v_total_final<>v_itens+COALESCE(v_frete,0) THEN RAISE EXCEPTION 'TOTAL_ACEITO_DIVERGENTE'; END IF;
  IF v_status_orc='ACEITO' THEN
    IF v_resp.tipo_resposta<>'ITENS' OR v_num_aprovados<>v_num_itens OR v_status_resp<>'CONSOLIDADA' OR v_motivo IS NOT NULL THEN
      RAISE EXCEPTION 'ACEITE_INCONSISTENTE';
    END IF;
    IF NOT v_orc.primeira_compra AND v_itens < 500.00 THEN RAISE EXCEPTION 'FATURAMENTO_MINIMO_NAO_ATINGIDO'; END IF;
    IF v_total_final IS NULL THEN RAISE EXCEPTION 'TOTAL_ACEITO_OBRIGATORIO'; END IF;
  ELSIF v_resp.tipo_resposta='RECUSA' THEN
    IF v_status_orc<>'RECUSADO' OR v_status_resp<>'AGUARDA_OPERADOR' OR v_motivo<>'RECUSA' THEN RAISE EXCEPTION 'RESPOSTA_INCONSISTENTE'; END IF;
  ELSIF v_resp.tipo_resposta='ALTERACAO' THEN
    IF v_status_orc<>'ALTERACAO_SOLICITADA' OR v_status_resp<>'AGUARDA_OPERADOR' OR v_motivo<>'ALTERACAO' THEN RAISE EXCEPTION 'RESPOSTA_INCONSISTENTE'; END IF;
  ELSIF v_resp.tipo_resposta='ITENS' THEN
    IF v_status_orc<>'ABERTO' OR v_status_resp<>'AGUARDA_OPERADOR' THEN RAISE EXCEPTION 'RESPOSTA_INCONSISTENTE'; END IF;
    IF v_num_aprovados<v_num_itens AND v_motivo<>'ITENS_NAO_APROVADOS' THEN RAISE EXCEPTION 'MOTIVO_TRATAMENTO_INVALIDO'; END IF;
    IF v_num_aprovados=v_num_itens AND (v_orc.primeira_compra OR v_itens>=500.00 OR v_motivo<>'ABAIXO_DO_MINIMO') THEN RAISE EXCEPTION 'MOTIVO_TRATAMENTO_INVALIDO'; END IF;
  ELSE
    RAISE EXCEPTION 'RESPOSTA_INCONSISTENTE';
  END IF;
  UPDATE public.resposta_orcamento SET
    status_resposta=v_status_resp,
    motivo_tratamento=v_motivo,
    data_processamento=CURRENT_TIMESTAMP,
    valor_total_itens_aprovado=v_itens,
    valor_total_imposto_aprovado=v_impostos,
    modalidade_frete_aceita=NULLIF(p_resultado#>>'{totais,modalidade_frete_aceita}',''),
    valor_frete_aceito=v_frete,
    valor_total_aceito=v_total_final
  WHERE id_resposta=p_id_resposta;
  IF v_status_orc='ACEITO' THEN
    UPDATE public.orcamento SET status='ACEITO',data_encerramento=CURRENT_TIMESTAMP WHERE id_orcamento=v_orc.id_orcamento;
    PERFORM set_config('suprimax.reservation_transition','on',true);
    UPDATE public.reserva_estoque r SET status='BAIXADA'
    FROM public.item_orcamento i,public.item_resposta_orcamento ir
    WHERE i.id_orcamento=v_orc.id_orcamento AND r.id_item=i.id_item AND ir.id_item=i.id_item AND ir.id_resposta=p_id_resposta AND ir.situacao='APROVADO' AND r.status='CONFIRMADA';
    GET DIAGNOSTICS v_reservas=ROW_COUNT;
    IF v_reservas<>v_num_itens THEN RAISE EXCEPTION 'RESERVA_NAO_ENCONTRADA'; END IF;
    FOR v_id_item IN SELECT i.id_item FROM public.item_orcamento i WHERE i.id_orcamento=v_orc.id_orcamento ORDER BY i.id_item LOOP
      v_unidades := public.suprimax_quantidade_item_unidades(v_id_item);
      SELECT id_variacao INTO v_qtd FROM public.item_orcamento WHERE id_item=v_id_item;
      INSERT INTO public.movimentacao_estoque(id_variacao,tipo,quantidade,id_operador,id_orcamento,motivo)
      VALUES(v_qtd,'BAIXA',-v_unidades,NULL,v_orc.id_orcamento,'Baixa automática no aceite do orçamento');
    END LOOP;
  ELSIF v_status_orc IN ('RECUSADO','ALTERACAO_SOLICITADA') THEN
    UPDATE public.orcamento SET status=v_status_orc,data_encerramento=CASE WHEN v_status_orc='RECUSADO' THEN CURRENT_TIMESTAMP ELSE data_encerramento END
      WHERE id_orcamento=v_orc.id_orcamento;
  END IF;
  PERFORM set_config('suprimax.processing_response',COALESCE(v_antigo_processamento,'off'),true);
  PERFORM set_config('suprimax.id_operador',COALESCE(v_antigo_operador,''),true);
  PERFORM set_config('suprimax.reservation_transition','off',true);
  RETURN QUERY SELECT v_status_orc::VARCHAR,v_status_resp::VARCHAR;
END $$;

-- Jobs idempotentes; podem ser chamados por pg_cron ou pelo agendador do proxy/Render.
CREATE OR REPLACE FUNCTION public.proxy_job_expirar_orcamentos()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.orcamento SET status='EXPIRADO',motivo_expiracao='VALIDADE',data_encerramento=CURRENT_TIMESTAMP
  WHERE status='ABERTO' AND data_validade<CURRENT_DATE;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.proxy_job_expirar_reservas()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_count INTEGER; v_old TEXT;
BEGIN
  v_old := current_setting('suprimax.reservation_transition',true);
  PERFORM set_config('suprimax.reservation_transition','on',true);
  UPDATE public.reserva_estoque SET status='EXPIRADA'
  WHERE status='CONFIRMADA' AND data_expiracao<CURRENT_DATE;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  PERFORM set_config('suprimax.reservation_transition',COALESCE(v_old,'off'),true);
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.proxy_job_expirar_rascunhos()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_expirados INTEGER; v_removidos INTEGER := 0; v_id INTEGER; v_old TEXT;
BEGIN
  UPDATE public.orcamento SET status='EXPIRADO',motivo_expiracao='RASCUNHO',data_encerramento=CURRENT_TIMESTAMP
  WHERE status IN ('RASCUNHO','PENDENTE_CREDITO') AND data_ultima_edicao<CURRENT_TIMESTAMP-INTERVAL '30 days';
  GET DIAGNOSTICS v_expirados=ROW_COUNT;
  v_old := current_setting('suprimax.allow_expired_draft_delete',true);
  PERFORM set_config('suprimax.allow_expired_draft_delete','on',true);
  FOR v_id IN SELECT id_orcamento FROM public.orcamento WHERE status='EXPIRADO' AND motivo_expiracao='RASCUNHO' AND data_encerramento<CURRENT_TIMESTAMP-INTERVAL '30 days' ORDER BY id_orcamento FOR UPDATE LOOP
    DELETE FROM public.orcamento WHERE id_orcamento=v_id;
    v_removidos := v_removidos+1;
  END LOOP;
  PERFORM set_config('suprimax.allow_expired_draft_delete',COALESCE(v_old,'off'),true);
  RETURN v_expirados+v_removidos;
END $$;

CREATE OR REPLACE FUNCTION public.proxy_job_protestar_dividas()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.divida_inadimplencia SET status='PROTESTADA',data_protesto=CURRENT_DATE
  WHERE status='EM_ABERTO' AND data_vencimento_original+60<CURRENT_DATE;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.proxy_job_expirar_tokens_recuperacao()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.operador SET token_recuperacao_senha=NULL,validade_token=NULL
  WHERE token_recuperacao_senha IS NOT NULL AND validade_token<=CURRENT_TIMESTAMP;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.proxy_orcamento_emitir(INTEGER,INTEGER,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.proxy_resposta_processar(INTEGER,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.proxy_job_expirar_orcamentos() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.proxy_job_expirar_reservas() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.proxy_job_expirar_rascunhos() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.proxy_job_protestar_dividas() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.proxy_job_expirar_tokens_recuperacao() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.proxy_orcamento_emitir(INTEGER,INTEGER,TEXT) TO postgres;
GRANT EXECUTE ON FUNCTION public.proxy_resposta_processar(INTEGER,JSONB) TO postgres;
GRANT EXECUTE ON FUNCTION public.proxy_job_expirar_orcamentos() TO postgres;
GRANT EXECUTE ON FUNCTION public.proxy_job_expirar_reservas() TO postgres;
GRANT EXECUTE ON FUNCTION public.proxy_job_expirar_rascunhos() TO postgres;
GRANT EXECUTE ON FUNCTION public.proxy_job_protestar_dividas() TO postgres;
GRANT EXECUTE ON FUNCTION public.proxy_job_expirar_tokens_recuperacao() TO postgres;
