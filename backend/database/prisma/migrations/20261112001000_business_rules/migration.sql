-- Restrições que não podem ser representadas no schema Prisma.
CREATE SEQUENCE public.numero_orcamento_seq AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;

ALTER TABLE public.operador
  ADD CONSTRAINT operador_perfil_check CHECK (perfil IN ('VENDEDOR','OPERADOR','OPERADOR_CHEFE','FISCAL','FINANCEIRO','GESTOR')),
  ADD CONSTRAINT operador_status_check CHECK (status IN ('ATIVO','INATIVO')),
  ADD CONSTRAINT operador_tentativas_login_check CHECK (tentativas_login_invalidas BETWEEN 0 AND 3);
ALTER TABLE public.cliente
  ADD CONSTRAINT cliente_cnpj_check CHECK (cnpj ~ '^[0-9]{14}$'),
  ADD CONSTRAINT cliente_tipo_unidade_check CHECK (tipo_unidade IN ('MATRIZ','FILIAL')),
  ADD CONSTRAINT cliente_status_check CHECK (status IN ('ATIVO','INATIVO','BLOQUEADO')),
  ADD CONSTRAINT cliente_aceite_lgpd_check CHECK (aceite_lgpd IS TRUE);
ALTER TABLE public.fornecedor
  ADD CONSTRAINT fornecedor_cnpj_check CHECK (cnpj ~ '^[0-9]{14}$');
ALTER TABLE public.endereco_cliente
  ADD CONSTRAINT endereco_cliente_tipo_check CHECK (tipo IN ('CADASTRAL','ENTREGA')),
  ADD CONSTRAINT endereco_cliente_cep_check CHECK (cep ~ '^[0-9]{8}$');
ALTER TABLE public.variacao_produto
  ADD CONSTRAINT variacao_produto_estoque_check CHECK (quantidade_estoque >= 0);
ALTER TABLE public.faixa_preco
  ADD CONSTRAINT faixa_preco_quantidade_check CHECK (quantidade_minima > 0),
  ADD CONSTRAINT faixa_preco_preco_check CHECK (preco_unitario >= 0);
ALTER TABLE public.fardo
  ADD CONSTRAINT fardo_quantidade_check CHECK (quantidade_unidades > 0),
  ADD CONSTRAINT fardo_preco_check CHECK (preco_fixo >= 0);

ALTER TABLE public.orcamento
  ADD CONSTRAINT orcamento_numero_check CHECK (numero_orcamento IS NULL OR numero_orcamento > 0),
  ADD CONSTRAINT orcamento_status_check CHECK (status IN ('RASCUNHO','PENDENTE_CREDITO','ABERTO','ALTERACAO_SOLICITADA','ACEITO','RECUSADO','CANCELADO','SUBSTITUIDO','EXPIRADO')),
  ADD CONSTRAINT orcamento_emissao_check CHECK (
    ((status IN ('RASCUNHO','PENDENTE_CREDITO') OR (status='EXPIRADO' AND motivo_expiracao='RASCUNHO') OR (status='CANCELADO' AND numero_orcamento IS NULL))
      AND numero_orcamento IS NULL AND data_emissao IS NULL AND data_validade IS NULL AND chave_seguranca IS NULL)
    OR ((status NOT IN ('RASCUNHO','PENDENTE_CREDITO') AND NOT (status='EXPIRADO' AND motivo_expiracao='RASCUNHO') AND NOT (status='CANCELADO' AND numero_orcamento IS NULL))
      AND numero_orcamento IS NOT NULL AND data_emissao IS NOT NULL AND data_validade = data_emissao + 30 AND chave_seguranca IS NOT NULL)
  ),
  ADD CONSTRAINT orcamento_prazo_entrega_check CHECK (prazo_entrega_dias IS NULL OR prazo_entrega_dias > 0),
  ADD CONSTRAINT orcamento_condicao_check CHECK (condicao_pagamento IS NULL OR condicao_pagamento IN ('ADIANTADO_100','BOLETO','PARCELADO','ADIANTADO_50_50')),
  ADD CONSTRAINT orcamento_boleto_check CHECK (
    (condicao_pagamento = 'BOLETO' AND prazo_dias IS NOT NULL AND prazo_dias IN (10,15,20,28,30) AND numero_parcelas IS NULL)
    OR (condicao_pagamento = 'PARCELADO' AND numero_parcelas IS NOT NULL AND numero_parcelas > 1 AND prazo_dias IS NULL)
    OR (condicao_pagamento IN ('ADIANTADO_100','ADIANTADO_50_50') AND prazo_dias IS NULL AND numero_parcelas IS NULL)
    OR (condicao_pagamento IS NULL AND prazo_dias IS NULL AND numero_parcelas IS NULL)
  ),
  ADD CONSTRAINT orcamento_modalidade_frete_check CHECK (modalidade_frete IS NULL OR modalidade_frete IN ('CIF','FOB')),
  ADD CONSTRAINT orcamento_origem_frete_check CHECK (origem_transportadora IS NULL OR origem_transportadora IN ('SUPRIMAX','CLIENTE')),
  ADD CONSTRAINT orcamento_frete_check CHECK (
    (modalidade_frete = 'CIF' AND origem_transportadora IS NULL AND valor_frete IS NULL AND NOT frete_provisorio)
    OR (modalidade_frete = 'FOB' AND (origem_transportadora IS NULL OR origem_transportadora IN ('SUPRIMAX','CLIENTE'))
        AND (origem_transportadora IS DISTINCT FROM 'CLIENTE' OR valor_frete IS NULL)
        AND (NOT frete_provisorio OR (valor_frete IS NULL AND origem_transportadora IS DISTINCT FROM 'CLIENTE')))
    OR (modalidade_frete IS NULL AND origem_transportadora IS NULL AND valor_frete IS NULL AND NOT frete_provisorio)
  ),
  ADD CONSTRAINT orcamento_valor_frete_check CHECK (valor_frete IS NULL OR valor_frete >= 0),
  ADD CONSTRAINT orcamento_total_itens_check CHECK (valor_total_itens IS NULL OR valor_total_itens >= 0),
  ADD CONSTRAINT orcamento_total_imposto_check CHECK (valor_total_imposto IS NULL OR valor_total_imposto >= 0),
  ADD CONSTRAINT orcamento_total_proposta_check CHECK (
    valor_total_proposta IS NULL OR (valor_total_itens IS NOT NULL AND valor_total_proposta = valor_total_itens + COALESCE(valor_frete,0))
  ),
  ADD CONSTRAINT orcamento_expiracao_check CHECK (
    (status = 'EXPIRADO' AND motivo_expiracao IN ('RASCUNHO','VALIDADE'))
    OR (status <> 'EXPIRADO' AND motivo_expiracao IS NULL)
  );

ALTER TABLE public.item_orcamento
  ADD CONSTRAINT item_orcamento_granularidade_check CHECK (
    (granularidade = 'FARDO' AND id_fardo IS NOT NULL AND quantidade_fardos > 0 AND id_faixa_preco IS NULL AND quantidade_avulsa IS NULL)
    OR (granularidade = 'AVULSO' AND id_fardo IS NULL AND quantidade_fardos IS NULL AND id_faixa_preco IS NOT NULL AND quantidade_avulsa > 0)
  ),
  ADD CONSTRAINT item_orcamento_precos_check CHECK (preco_unitario_aplicado >= 0 AND valor_imposto >= 0 AND valor_total_item >= 0),
  ADD CONSTRAINT item_orcamento_imposto_check CHECK (
    valor_imposto = ROUND((CASE WHEN granularidade = 'FARDO' THEN quantidade_fardos ELSE quantidade_avulsa END)::NUMERIC * preco_unitario_aplicado * 0.18, 2)
  ),
  ADD CONSTRAINT item_orcamento_total_check CHECK (
    valor_total_item = (CASE WHEN granularidade = 'FARDO' THEN quantidade_fardos ELSE quantidade_avulsa END)::NUMERIC * preco_unitario_aplicado + valor_imposto
  );
ALTER TABLE public.reserva_estoque
  ADD CONSTRAINT reserva_estoque_quantidade_check CHECK (quantidade_reservada > 0),
  ADD CONSTRAINT reserva_estoque_status_check CHECK (status IN ('CONFIRMADA','BAIXADA','LIBERADA','EXPIRADA'));
ALTER TABLE public.anexo_orcamento
  ADD CONSTRAINT anexo_orcamento_tipo_check CHECK (tipo_anexo IN ('DESCRITIVO_TECNICO','MATERIAL_APOIO'));
ALTER TABLE public.analise_credito
  ADD CONSTRAINT analise_credito_resultado_check CHECK (resultado IS NULL OR resultado IN ('APROVADO','REPROVADO')),
  ADD CONSTRAINT analise_credito_data_check CHECK (
    (resultado IS NULL AND data_analise IS NULL AND id_operador_fiscal IS NULL)
    OR (resultado IS NOT NULL AND data_analise IS NOT NULL AND id_operador_fiscal IS NOT NULL)
  );
ALTER TABLE public.documento_analise_credito
  ADD CONSTRAINT documento_analise_tipo_check CHECK (tipo_documento IN ('CONTRATO_SOCIAL','BALANCO_LUCRO','COMPROVANTE_ENDERECO','DOCUMENTO_PROPRIETARIO','NOTA_FISCAL_COMPRA','REFERENCIA_COMERCIAL'));
ALTER TABLE public.divida_inadimplencia
  ADD CONSTRAINT divida_valor_check CHECK (valor_divida > 0),
  ADD CONSTRAINT divida_status_check CHECK (status IN ('EM_ABERTO','RENEGOCIADA','QUITADA','PROTESTADA')),
  ADD CONSTRAINT divida_renegociacao_check CHECK (
    (status = 'RENEGOCIADA' AND data_renegociacao IS NOT NULL AND valor_pago_renegociacao IS NOT NULL AND valor_pago_renegociacao >= valor_divida * 0.5)
    OR (status = 'QUITADA' AND ((data_renegociacao IS NULL AND valor_pago_renegociacao IS NULL)
        OR (data_renegociacao IS NOT NULL AND valor_pago_renegociacao IS NOT NULL AND valor_pago_renegociacao >= valor_divida * 0.5)))
    OR (status IN ('EM_ABERTO','PROTESTADA') AND data_renegociacao IS NULL AND valor_pago_renegociacao IS NULL)
  ),
  ADD CONSTRAINT divida_protesto_check CHECK (
    (status = 'PROTESTADA' AND data_protesto IS NOT NULL)
    OR (status = 'EM_ABERTO' AND data_protesto IS NULL)
    OR status IN ('RENEGOCIADA','QUITADA')
  );
ALTER TABLE public.historico_orcamento
  ADD CONSTRAINT historico_tipo_check CHECK (tipo_evento IN ('MUDANCA_STATUS','ATUALIZACAO_FOLLOWUP'));
ALTER TABLE public.entrada_mercadoria
  ADD CONSTRAINT entrada_quantidades_check CHECK (quantidade_comprada > 0 AND quantidade_informada > 0),
  ADD CONSTRAINT entrada_liberacao_check CHECK (
    (quantidade_comprada = quantidade_informada AND id_operador_liberacao IS NULL AND data_liberacao IS NULL)
    OR (quantidade_comprada <> quantidade_informada AND id_operador_liberacao IS NOT NULL AND data_liberacao IS NOT NULL)
  );
ALTER TABLE public.pedido
  ADD CONSTRAINT pedido_condicao_check CHECK (condicao_pagamento_desejada IS NULL OR condicao_pagamento_desejada IN ('ADIANTADO_100','BOLETO','PARCELADO','ADIANTADO_50_50')),
  ADD CONSTRAINT pedido_boleto_check CHECK (prazo_dias_desejado IS NULL OR prazo_dias_desejado IN (10,15,20,28,30)),
  ADD CONSTRAINT pedido_parcelas_check CHECK (numero_parcelas_desejado IS NULL OR numero_parcelas_desejado > 1),
  ADD CONSTRAINT pedido_status_check CHECK (status IN ('SOLICITADO','EM_ANALISE','APROVADO','NEGADO','CANCELADO')),
  ADD CONSTRAINT pedido_negativa_check CHECK ((status = 'NEGADO' AND motivo_negativa IS NOT NULL AND btrim(motivo_negativa) <> '') OR (status <> 'NEGADO' AND motivo_negativa IS NULL));
ALTER TABLE public.item_pedido
  ADD CONSTRAINT item_pedido_granularidade_check CHECK (
    (granularidade = 'FARDO' AND id_fardo IS NOT NULL AND quantidade_solicitada > 0)
    OR (granularidade = 'AVULSO' AND id_fardo IS NULL AND quantidade_solicitada > 0)
  );
ALTER TABLE public.resposta_orcamento
  ADD CONSTRAINT resposta_tipo_check CHECK (tipo_resposta IN ('ITENS','RECUSA','ALTERACAO')),
  ADD CONSTRAINT resposta_status_check CHECK (status_resposta IN ('PENDENTE','CONSOLIDADA','AGUARDA_OPERADOR','TRATADA')),
  ADD CONSTRAINT resposta_processamento_data_check CHECK (
    (status_resposta='PENDENTE' AND data_processamento IS NULL)
    OR (status_resposta<>'PENDENTE' AND data_processamento IS NOT NULL)
  ),
  ADD CONSTRAINT resposta_tratamento_data_check CHECK (
    (status_resposta='TRATADA' AND id_operador_tratamento IS NOT NULL AND data_tratamento IS NOT NULL)
    OR (status_resposta<>'TRATADA' AND id_operador_tratamento IS NULL AND data_tratamento IS NULL)
  ),
  ADD CONSTRAINT resposta_motivo_check CHECK (
    (status_resposta IN ('AGUARDA_OPERADOR','TRATADA') AND motivo_tratamento IN ('RECUSA','ALTERACAO','ITENS_NAO_APROVADOS','ABAIXO_DO_MINIMO'))
    OR (status_resposta IN ('PENDENTE','CONSOLIDADA') AND motivo_tratamento IS NULL)
  ),
  ADD CONSTRAINT resposta_totais_check CHECK (
    (valor_total_itens_aprovado IS NULL OR valor_total_itens_aprovado >= 0)
    AND (valor_total_imposto_aprovado IS NULL OR valor_total_imposto_aprovado >= 0)
    AND (valor_frete_aceito IS NULL OR valor_frete_aceito >= 0)
    AND (valor_total_aceito IS NULL OR (valor_total_itens_aprovado IS NOT NULL AND valor_total_aceito = valor_total_itens_aprovado + COALESCE(valor_frete_aceito,0)))
  );
ALTER TABLE public.item_resposta_orcamento
  ADD CONSTRAINT item_resposta_situacao_check CHECK (
    (situacao = 'APROVADO' AND quantidade_aprovada > 0)
    OR (situacao = 'NAO_APROVADO' AND quantidade_aprovada = 0)
  ),
  ADD CONSTRAINT item_resposta_valores_check CHECK (
    (preco_unitario_aceito IS NULL AND valor_imposto_aceito IS NULL AND valor_total_item_aceito IS NULL)
    OR (situacao = 'APROVADO' AND preco_unitario_aceito IS NOT NULL AND valor_imposto_aceito IS NOT NULL AND valor_total_item_aceito IS NOT NULL
        AND preco_unitario_aceito >= 0 AND valor_imposto_aceito >= 0 AND valor_total_item_aceito = quantidade_aprovada * preco_unitario_aceito + valor_imposto_aceito)
  ),
  ADD CONSTRAINT item_resposta_imposto_check CHECK (
    valor_imposto_aceito IS NULL OR valor_imposto_aceito = ROUND(quantidade_aprovada::NUMERIC * preco_unitario_aceito * 0.18, 2)
  );
ALTER TABLE public.movimentacao_estoque
  ADD CONSTRAINT movimentacao_tipo_check CHECK (tipo IN ('ENTRADA','BAIXA','AJUSTE','ESTORNO')),
  ADD CONSTRAINT movimentacao_quantidade_check CHECK (
    quantidade <> 0 AND ((tipo = 'ENTRADA' AND quantidade > 0) OR (tipo = 'BAIXA' AND quantidade < 0) OR tipo IN ('AJUSTE','ESTORNO'))
  ),
  ADD CONSTRAINT movimentacao_ajuste_motivo_check CHECK (tipo <> 'AJUSTE' OR (motivo IS NOT NULL AND btrim(motivo) <> ''));

-- Restrições das tabelas internas do proxy.
ALTER TABLE public.integrantes_proxy ADD CONSTRAINT integrantes_proxy_escopos_check CHECK (cardinality(escopos)>0);
ALTER TABLE public.fila_escrita
  ADD CONSTRAINT fila_escrita_status_check CHECK (status IN ('pendente','processando','concluido','erro')),
  ADD CONSTRAINT fila_escrita_tentativas_check CHECK (tentativas>=0);
ALTER TABLE public.log_auditoria
  ADD CONSTRAINT log_auditoria_risco_check CHECK (resultado_verificacao_risco IN ('APROVADO','BLOQUEADO','NAO_APLICAVEL')),
  ADD CONSTRAINT log_auditoria_execucao_check CHECK (status_execucao IN ('SUCESSO','ERRO')),
  ADD CONSTRAINT log_auditoria_duracao_check CHECK (duracao_ms>=0);

-- A mesma resposta deve incluir no máximo uma linha por item cotado.
CREATE OR REPLACE FUNCTION public.suprimax_quantidade_item_unidades(p_id_item INTEGER)
RETURNS INTEGER LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE v_item public.item_orcamento%ROWTYPE; v_unidades BIGINT;
BEGIN
  SELECT * INTO v_item FROM public.item_orcamento WHERE id_item = p_id_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_item.granularidade = 'AVULSO' THEN
    v_unidades := v_item.quantidade_avulsa;
  ELSE
    SELECT v_item.quantidade_fardos::BIGINT * f.quantidade_unidades INTO v_unidades
    FROM public.fardo f WHERE f.id_fardo = v_item.id_fardo AND f.id_variacao = v_item.id_variacao;
    IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_ORCAMENTO_INVALIDO'; END IF;
  END IF;
  IF v_unidades IS NULL OR v_unidades < 1 OR v_unidades > 2147483647 THEN RAISE EXCEPTION 'ITEM_ORCAMENTO_INVALIDO'; END IF;
  RETURN v_unidades::INTEGER;
END $$;

CREATE OR REPLACE FUNCTION public.suprimax_validar_orcamento()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_bloqueado BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'RASCUNHO' AND NOT (OLD.status = 'EXPIRADO' AND OLD.motivo_expiracao = 'RASCUNHO' AND current_setting('suprimax.allow_expired_draft_delete',true) = 'on') THEN
      RAISE EXCEPTION 'ORCAMENTO_NAO_EDITAVEL';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'RASCUNHO' THEN RAISE EXCEPTION 'ORCAMENTO_DEVE_INICIAR_EM_RASCUNHO'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.cliente c WHERE c.id_cliente=NEW.id_cliente AND c.status='ATIVO') THEN RAISE EXCEPTION 'CLIENTE_INATIVO'; END IF;
    SELECT EXISTS (SELECT 1 FROM public.divida_inadimplencia d WHERE d.id_cliente = NEW.id_cliente AND d.status IN ('EM_ABERTO','PROTESTADA')) INTO v_bloqueado;
    IF v_bloqueado THEN RAISE EXCEPTION 'CLIENTE_INADIMPLENTE'; END IF;
  ELSE
    IF OLD.numero_orcamento IS NOT NULL AND
       (to_jsonb(NEW) - ARRAY['status','data_encerramento','motivo_expiracao','justificativa']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','data_encerramento','motivo_expiracao','justificativa']) THEN
      RAISE EXCEPTION 'ORCAMENTO_NAO_EDITAVEL';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (
        (OLD.status = 'RASCUNHO' AND NEW.status IN ('PENDENTE_CREDITO','ABERTO','EXPIRADO','CANCELADO')) OR
        (OLD.status = 'PENDENTE_CREDITO' AND NEW.status IN ('RASCUNHO','EXPIRADO','CANCELADO')) OR
        (OLD.status = 'ABERTO' AND NEW.status IN ('ACEITO','RECUSADO','ALTERACAO_SOLICITADA','SUBSTITUIDO','EXPIRADO','CANCELADO')) OR
        (OLD.status = 'ALTERACAO_SOLICITADA' AND NEW.status IN ('SUBSTITUIDO','CANCELADO')) OR
        (OLD.status = 'RECUSADO' AND NEW.status = 'SUBSTITUIDO')
      ) THEN RAISE EXCEPTION 'TRANSICAO_ORCAMENTO_INVALIDA'; END IF;
    END IF;
    IF NEW.status = 'ABERTO' AND OLD.status <> 'ABERTO' AND current_setting('suprimax.emitting_quote',true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'EMISSAO_DEVE_USAR_OPERACAO_NOMEADA';
    END IF;
    IF NEW.status = 'ACEITO' AND OLD.status <> 'ACEITO' AND current_setting('suprimax.processing_response',true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'ACEITE_DEVE_USAR_OPERACAO_NOMEADA';
    END IF;
  END IF;
  IF NEW.status = 'ABERTO' AND NEW.id_endereco_entrega IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.endereco_cliente e WHERE e.id_endereco = NEW.id_endereco_entrega AND e.id_cliente = NEW.id_cliente
  ) THEN RAISE EXCEPTION 'ENDERECO_CLIENTE_DIVERGENTE'; END IF;
  IF NEW.status IN ('ACEITO','RECUSADO','CANCELADO','SUBSTITUIDO','EXPIRADO') AND NEW.data_encerramento IS NULL THEN
    NEW.data_encerramento := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orcamento_validar BEFORE INSERT OR UPDATE OR DELETE ON public.orcamento
FOR EACH ROW EXECUTE FUNCTION public.suprimax_validar_orcamento();

CREATE OR REPLACE FUNCTION public.suprimax_status_orcamento()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_id_operador INTEGER; v_old_transition TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    BEGIN v_id_operador := NULLIF(current_setting('suprimax.id_operador',true),'')::INTEGER; EXCEPTION WHEN invalid_text_representation THEN v_id_operador := NULL; END;
    INSERT INTO public.historico_orcamento(id_orcamento,id_operador,tipo_evento,status_anterior,status_novo,data_registro)
    VALUES (NEW.id_orcamento,v_id_operador,'MUDANCA_STATUS',OLD.status,NEW.status,CURRENT_TIMESTAMP);
    v_old_transition := current_setting('suprimax.reservation_transition',true);
    PERFORM set_config('suprimax.reservation_transition','on',true);
    IF NEW.status IN ('RECUSADO','CANCELADO','SUBSTITUIDO') THEN
      UPDATE public.reserva_estoque SET status='LIBERADA' WHERE id_item IN (SELECT id_item FROM public.item_orcamento WHERE id_orcamento=NEW.id_orcamento) AND status='CONFIRMADA';
    ELSIF NEW.status='EXPIRADO' THEN
      UPDATE public.reserva_estoque SET status='EXPIRADA' WHERE id_item IN (SELECT id_item FROM public.item_orcamento WHERE id_orcamento=NEW.id_orcamento) AND status='CONFIRMADA';
    END IF;
    PERFORM set_config('suprimax.reservation_transition',COALESCE(v_old_transition,'off'),true);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orcamento_status_auditar AFTER UPDATE OF status ON public.orcamento
FOR EACH ROW EXECUTE FUNCTION public.suprimax_status_orcamento();

CREATE OR REPLACE FUNCTION public.suprimax_validar_item_orcamento()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_status VARCHAR(20); v_origem INTEGER; v_variacao INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_status FROM public.orcamento WHERE id_orcamento=OLD.id_orcamento FOR UPDATE;
    IF v_status NOT IN ('RASCUNHO','PENDENTE_CREDITO') AND current_setting('suprimax.allow_expired_draft_delete',true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'ORCAMENTO_NAO_EDITAVEL'; END IF;
    RETURN OLD;
  END IF;
  SELECT status,id_orcamento_origem INTO v_status,v_origem FROM public.orcamento WHERE id_orcamento=NEW.id_orcamento FOR UPDATE;
  IF v_status NOT IN ('RASCUNHO','PENDENTE_CREDITO') THEN RAISE EXCEPTION 'ORCAMENTO_NAO_EDITAVEL'; END IF;
  IF NEW.aprovacao_herdada AND v_origem IS NULL THEN RAISE EXCEPTION 'APROVACAO_HERDADA_SEM_ORIGEM'; END IF;
  IF TG_OP='UPDATE' AND (NEW.id_variacao,NEW.granularidade,NEW.id_fardo,NEW.quantidade_fardos,NEW.id_faixa_preco,NEW.quantidade_avulsa)
       IS DISTINCT FROM (OLD.id_variacao,OLD.granularidade,OLD.id_fardo,OLD.quantidade_fardos,OLD.id_faixa_preco,OLD.quantidade_avulsa) THEN
    NEW.aprovacao_herdada := FALSE;
  END IF;
  IF NEW.id_fardo IS NOT NULL THEN
    SELECT id_variacao INTO v_variacao FROM public.fardo WHERE id_fardo=NEW.id_fardo;
    IF v_variacao IS DISTINCT FROM NEW.id_variacao THEN RAISE EXCEPTION 'FARDO_VARIACAO_DIVERGENTE'; END IF;
  END IF;
  IF NEW.id_faixa_preco IS NOT NULL THEN
    SELECT id_variacao INTO v_variacao FROM public.faixa_preco WHERE id_faixa_preco=NEW.id_faixa_preco;
    IF v_variacao IS DISTINCT FROM NEW.id_variacao THEN RAISE EXCEPTION 'FAIXA_VARIACAO_DIVERGENTE'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER item_orcamento_validar BEFORE INSERT OR UPDATE OR DELETE ON public.item_orcamento
FOR EACH ROW EXECUTE FUNCTION public.suprimax_validar_item_orcamento();
CREATE OR REPLACE FUNCTION public.suprimax_tocar_rascunho()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_id INTEGER;
BEGIN
  v_id := CASE WHEN TG_OP='DELETE' THEN OLD.id_orcamento ELSE NEW.id_orcamento END;
  UPDATE public.orcamento SET data_ultima_edicao=CURRENT_TIMESTAMP WHERE id_orcamento=v_id AND status IN ('RASCUNHO','PENDENTE_CREDITO');
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER item_orcamento_tocar_rascunho AFTER INSERT OR UPDATE OR DELETE ON public.item_orcamento
FOR EACH ROW EXECUTE FUNCTION public.suprimax_tocar_rascunho();

CREATE OR REPLACE FUNCTION public.suprimax_validar_reserva()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_item public.item_orcamento%ROWTYPE; v_status VARCHAR(20); v_validade DATE; v_estoque INTEGER; v_reservado BIGINT; v_esperada INTEGER; v_produto TEXT;
BEGIN
  SELECT i.* INTO v_item FROM public.item_orcamento i WHERE i.id_item=NEW.id_item;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT o.status,o.data_validade INTO v_status,v_validade FROM public.orcamento o WHERE o.id_orcamento=v_item.id_orcamento;
  IF NEW.status='CONFIRMADA' THEN
    IF v_status <> 'ABERTO' OR NEW.data_expiracao IS DISTINCT FROM v_validade THEN RAISE EXCEPTION 'RESERVA_FORA_DA_EMISSAO'; END IF;
    v_esperada := public.suprimax_quantidade_item_unidades(NEW.id_item);
    IF NEW.quantidade_reservada <> v_esperada THEN RAISE EXCEPTION 'QUANTIDADE_RESERVA_DIVERGENTE'; END IF;
    SELECT quantidade_estoque INTO v_estoque FROM public.variacao_produto WHERE id_variacao=v_item.id_variacao FOR UPDATE;
    SELECT COALESCE(SUM(r.quantidade_reservada),0) INTO v_reservado
    FROM public.reserva_estoque r JOIN public.item_orcamento i ON i.id_item=r.id_item
    WHERE i.id_variacao=v_item.id_variacao AND r.status='CONFIRMADA'
      AND (TG_OP='INSERT' OR r.id_reserva <> NEW.id_reserva);
    IF v_estoque - v_reservado < NEW.quantidade_reservada THEN
      SELECT p.descricao INTO v_produto FROM public.variacao_produto v JOIN public.produto p ON p.id_produto=v.id_produto WHERE v.id_variacao=v_item.id_variacao;
      RAISE EXCEPTION 'ESTOQUE_INSUFICIENTE:%',json_build_object(
        'produto',v_produto,'disponivel',GREATEST(v_estoque-v_reservado,0),'quantidade',NEW.quantidade_reservada
      )::TEXT;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reserva_estoque_validar BEFORE INSERT OR UPDATE ON public.reserva_estoque
FOR EACH ROW EXECUTE FUNCTION public.suprimax_validar_reserva();

CREATE OR REPLACE FUNCTION public.suprimax_validar_responsavel_entrada()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.id_operador_liberacao IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.operador WHERE id_operador=NEW.id_operador_liberacao AND perfil='OPERADOR_CHEFE' AND status='ATIVO'
  ) THEN RAISE EXCEPTION 'LIBERADOR_NAO_E_OPERADOR_CHEFE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entrada_liberador_validar BEFORE INSERT OR UPDATE ON public.entrada_mercadoria
FOR EACH ROW EXECUTE FUNCTION public.suprimax_validar_responsavel_entrada();
CREATE OR REPLACE FUNCTION public.suprimax_validar_responsavel_credito()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.id_operador_fiscal IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.operador WHERE id_operador=NEW.id_operador_fiscal AND perfil='FISCAL' AND status='ATIVO'
  ) THEN RAISE EXCEPTION 'RESPONSAVEL_CREDITO_NAO_E_FISCAL'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER analise_credito_fiscal_validar BEFORE INSERT OR UPDATE ON public.analise_credito
FOR EACH ROW EXECUTE FUNCTION public.suprimax_validar_responsavel_credito();

CREATE OR REPLACE FUNCTION public.suprimax_atualizar_estoque()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_estoque INTEGER; v_reservado BIGINT; v_antigo TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'MOVIMENTACAO_E_IMUTAVEL'; END IF;
  SELECT quantidade_estoque INTO v_estoque FROM public.variacao_produto WHERE id_variacao=NEW.id_variacao FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT COALESCE(SUM(r.quantidade_reservada),0) INTO v_reservado
  FROM public.reserva_estoque r JOIN public.item_orcamento i ON i.id_item=r.id_item
  WHERE i.id_variacao=NEW.id_variacao AND r.status='CONFIRMADA';
  IF v_estoque + NEW.quantidade < v_reservado THEN RAISE EXCEPTION 'ESTOQUE_ABAIXO_DAS_RESERVAS'; END IF;
  v_antigo := current_setting('suprimax.stock_movement',true);
  PERFORM set_config('suprimax.stock_movement','on',true);
  UPDATE public.variacao_produto SET quantidade_estoque=quantidade_estoque+NEW.quantidade WHERE id_variacao=NEW.id_variacao;
  PERFORM set_config('suprimax.stock_movement',COALESCE(v_antigo,'off'),true);
  RETURN NEW;
END $$;
CREATE TRIGGER movimentacao_estoque_atualizar AFTER INSERT OR UPDATE OR DELETE ON public.movimentacao_estoque
FOR EACH ROW EXECUTE FUNCTION public.suprimax_atualizar_estoque();
CREATE OR REPLACE FUNCTION public.suprimax_proteger_saldo()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_reservado BIGINT;
BEGIN
  IF NEW.quantidade_estoque IS DISTINCT FROM OLD.quantidade_estoque AND current_setting('suprimax.stock_movement',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'ESTOQUE_DEVE_SER_ALTERADO_POR_MOVIMENTACAO';
  END IF;
  SELECT COALESCE(SUM(r.quantidade_reservada),0) INTO v_reservado
  FROM public.reserva_estoque r JOIN public.item_orcamento i ON i.id_item=r.id_item
  WHERE i.id_variacao=NEW.id_variacao AND r.status='CONFIRMADA';
  IF NEW.quantidade_estoque < v_reservado THEN RAISE EXCEPTION 'ESTOQUE_ABAIXO_DAS_RESERVAS'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER variacao_proteger_saldo BEFORE UPDATE OF quantidade_estoque ON public.variacao_produto
FOR EACH ROW EXECUTE FUNCTION public.suprimax_proteger_saldo();

CREATE OR REPLACE FUNCTION public.suprimax_proteger_reserva()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'RESERVA_NAO_EXCLUIVEL'; END IF;
  IF (NEW.id_item,NEW.quantidade_reservada,NEW.data_expiracao) IS DISTINCT FROM (OLD.id_item,OLD.quantidade_reservada,OLD.data_expiracao) THEN
    RAISE EXCEPTION 'RESERVA_IMUTAVEL';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND current_setting('suprimax.reservation_transition',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'RESERVA_DEVE_SER_ATUALIZADA_POR_OPERACAO_NOMEADA';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status='CONFIRMADA' AND NEW.status IN ('BAIXADA','LIBERADA','EXPIRADA'))
  ) THEN RAISE EXCEPTION 'TRANSICAO_RESERVA_INVALIDA'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reserva_estoque_proteger BEFORE UPDATE OR DELETE ON public.reserva_estoque
FOR EACH ROW EXECUTE FUNCTION public.suprimax_proteger_reserva();

CREATE OR REPLACE FUNCTION public.suprimax_validar_item_resposta()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_id_orcamento INTEGER; v_status_resposta VARCHAR(20); v_quantidade INTEGER; v_granularidade VARCHAR(6); v_id_variacao INTEGER; v_id_faixa_variacao INTEGER;
BEGIN
  SELECT r.id_orcamento,r.status_resposta INTO v_id_orcamento,v_status_resposta FROM public.resposta_orcamento r WHERE r.id_resposta=NEW.id_resposta FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT CASE WHEN i.granularidade='FARDO' THEN i.quantidade_fardos ELSE i.quantidade_avulsa END,i.granularidade,i.id_variacao
    INTO v_quantidade,v_granularidade,v_id_variacao FROM public.item_orcamento i WHERE i.id_item=NEW.id_item AND i.id_orcamento=v_id_orcamento;
  IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_RESPOSTA_ORCAMENTO_DIVERGENTE'; END IF;
  IF NEW.quantidade_aprovada > v_quantidade THEN RAISE EXCEPTION 'QUANTIDADE_APROVADA_EXCEDE_COTADA'; END IF;
  IF (NEW.situacao='APROVADO') <> (NEW.quantidade_aprovada > 0) THEN RAISE EXCEPTION 'SITUACAO_QUANTIDADE_DIVERGENTE'; END IF;
  IF NEW.id_faixa_preco_aceita IS NOT NULL THEN
    SELECT id_variacao INTO v_id_faixa_variacao FROM public.faixa_preco WHERE id_faixa_preco=NEW.id_faixa_preco_aceita;
    IF v_id_faixa_variacao IS DISTINCT FROM v_id_variacao OR v_granularidade <> 'AVULSO' THEN RAISE EXCEPTION 'FAIXA_ACEITA_VARIACAO_DIVERGENTE'; END IF;
  END IF;
  IF TG_OP='INSERT' AND (v_status_resposta <> 'PENDENTE' OR NEW.id_faixa_preco_aceita IS NOT NULL OR NEW.preco_unitario_aceito IS NOT NULL) THEN
    RAISE EXCEPTION 'RESPOSTA_NAO_EDITAVEL';
  END IF;
  IF TG_OP='UPDATE' AND current_setting('suprimax.processing_response',true) IS DISTINCT FROM 'on' AND
     (NEW.id_resposta,NEW.id_item,NEW.quantidade_aprovada,NEW.situacao,NEW.id_faixa_preco_aceita,NEW.preco_unitario_aceito,NEW.valor_imposto_aceito,NEW.valor_total_item_aceito)
     IS DISTINCT FROM (OLD.id_resposta,OLD.id_item,OLD.quantidade_aprovada,OLD.situacao,OLD.id_faixa_preco_aceita,OLD.preco_unitario_aceito,OLD.valor_imposto_aceito,OLD.valor_total_item_aceito) THEN
    RAISE EXCEPTION 'RESPOSTA_NAO_EDITAVEL';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER item_resposta_validar BEFORE INSERT OR UPDATE ON public.item_resposta_orcamento
FOR EACH ROW EXECUTE FUNCTION public.suprimax_validar_item_resposta();

CREATE OR REPLACE FUNCTION public.suprimax_validar_resposta()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_status_orcamento VARCHAR(20);
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status_resposta <> 'PENDENTE' OR NEW.data_processamento IS NOT NULL OR NEW.data_tratamento IS NOT NULL THEN RAISE EXCEPTION 'RESPOSTA_DEVE_INICIAR_PENDENTE'; END IF;
    SELECT status INTO v_status_orcamento FROM public.orcamento WHERE id_orcamento=NEW.id_orcamento;
    IF v_status_orcamento <> 'ABERTO' THEN RAISE EXCEPTION 'ORCAMENTO_NAO_ABERTO'; END IF;
  ELSE
    IF NEW.id_orcamento IS DISTINCT FROM OLD.id_orcamento OR NEW.tipo_resposta IS DISTINCT FROM OLD.tipo_resposta OR NEW.id_operador_vendedor IS DISTINCT FROM OLD.id_operador_vendedor THEN
      RAISE EXCEPTION 'RESPOSTA_IMUTAVEL';
    END IF;
    IF NEW.status_resposta IS DISTINCT FROM OLD.status_resposta AND NOT (
      (OLD.status_resposta='PENDENTE' AND NEW.status_resposta IN ('CONSOLIDADA','AGUARDA_OPERADOR') AND current_setting('suprimax.processing_response',true)='on')
      OR (OLD.status_resposta='AGUARDA_OPERADOR' AND NEW.status_resposta='TRATADA')
    ) THEN RAISE EXCEPTION 'TRANSICAO_RESPOSTA_INVALIDA'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resposta_orcamento_validar BEFORE INSERT OR UPDATE ON public.resposta_orcamento
FOR EACH ROW EXECUTE FUNCTION public.suprimax_validar_resposta();

CREATE OR REPLACE FUNCTION public.suprimax_validar_divida()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.status='PROTESTADA' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'PROTESTADA') THEN
    IF NEW.data_vencimento_original + 60 >= CURRENT_DATE THEN RAISE EXCEPTION 'PRAZO_PROTESTO_NAO_ATINGIDO'; END IF;
    NEW.data_protesto := COALESCE(NEW.data_protesto,CURRENT_DATE);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER divida_validar_protesto BEFORE INSERT OR UPDATE ON public.divida_inadimplencia
FOR EACH ROW EXECUTE FUNCTION public.suprimax_validar_divida();

CREATE OR REPLACE FUNCTION public.suprimax_validar_operador()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.perfil='VENDEDOR' AND NEW.status='INATIVO' AND OLD.status='ATIVO' AND EXISTS (
    SELECT 1 FROM public.cliente WHERE id_operador_vendedor=OLD.id_operador
  ) THEN RAISE EXCEPTION 'VENDEDOR_COM_CARTEIRA_ATIVA'; END IF;
  IF TG_OP='UPDATE' AND NEW.senha_hash IS DISTINCT FROM OLD.senha_hash THEN
    NEW.token_recuperacao_senha := NULL;
    NEW.validade_token := NULL;
  END IF;
  IF NEW.tentativas_login_invalidas=0 AND (TG_OP='INSERT' OR OLD.tentativas_login_invalidas>0) THEN NEW.bloqueado_ate := NULL; END IF;
  IF NEW.tentativas_login_invalidas=3 AND (TG_OP='INSERT' OR OLD.tentativas_login_invalidas<3 OR OLD.bloqueado_ate IS NULL OR OLD.bloqueado_ate<=CURRENT_TIMESTAMP) THEN
    NEW.bloqueado_ate := CURRENT_TIMESTAMP + INTERVAL '15 minutes';
  END IF;
  IF NEW.token_recuperacao_senha IS NULL THEN
    NEW.validade_token := NULL;
  ELSIF NEW.validade_token IS NULL OR NEW.validade_token<=CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'TOKEN_RECUPERACAO_INVALIDO';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER operador_regras BEFORE INSERT OR UPDATE ON public.operador
FOR EACH ROW EXECUTE FUNCTION public.suprimax_validar_operador();

-- RLS sem políticas: somente a conexão administrativa do proxy acessa as tabelas.
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['operador','cliente','endereco_cliente','produto','variacao_produto','faixa_preco','fardo','orcamento','item_orcamento','reserva_estoque','anexo_orcamento','analise_credito','documento_analise_credito','divida_inadimplencia','historico_orcamento','entrada_mercadoria','fornecedor','pedido','item_pedido','resposta_orcamento','item_resposta_orcamento','movimentacao_estoque','integrantes_proxy','fila_escrita','log_auditoria'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  END LOOP;
END $$;
