-- O ADMIN também registra o resultado da análise de crédito (UC07), como o FISCAL.
--
-- Complementa 20261116000000_perfil_admin: lá o perfil ADMIN passou a existir e a liberar divergência
-- na entrada de mercadoria. Aqui o gatilho analise_credito_fiscal_validar passa a aceitar FISCAL ou
-- ADMIN em analise_credito.id_operador_fiscal. Sem isso, o backend deixa o ADMIN chamar a rota de
-- resultado (acesso total) e o gatilho recusa com RESPONSAVEL_CREDITO_NAO_E_FISCAL (erro 500).
--
-- Só a lista de perfis muda: o gatilho continua o mesmo e a mensagem de erro também.
CREATE OR REPLACE FUNCTION public.suprimax_validar_responsavel_credito()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.id_operador_fiscal IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.operador WHERE id_operador=NEW.id_operador_fiscal AND perfil IN ('FISCAL','ADMIN') AND status='ATIVO'
  ) THEN RAISE EXCEPTION 'RESPONSAVEL_CREDITO_NAO_E_FISCAL'; END IF;
  RETURN NEW;
END $$;
