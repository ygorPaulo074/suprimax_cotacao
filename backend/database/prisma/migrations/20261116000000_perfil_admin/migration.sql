-- Perfil ADMIN: administrador do sistema, com acesso a todas as áreas do Sistema 2.
--
-- 1) Troca a restrição operador_perfil_check (criada em 20261112001000_business_rules) para
--    aceitar o valor novo. Um único ALTER TABLE: o PostgreSQL derruba a restrição antiga e cria a
--    nova na mesma instrução, então não há instante sem restrição. Nenhuma linha existente usa
--    ADMIN, então a validação da restrição nova não falha por dados atuais.
ALTER TABLE public.operador
  DROP CONSTRAINT operador_perfil_check,
  ADD CONSTRAINT operador_perfil_check CHECK (perfil IN ('VENDEDOR','OPERADOR','OPERADOR_CHEFE','FISCAL','FINANCEIRO','GESTOR','ADMIN'));

-- 2) O ADMIN também pode liberar divergência na entrada de mercadoria (RF19), como o
--    OPERADOR_CHEFE. Só a lista de perfis muda: o gatilho entrada_liberador_validar continua o
--    mesmo e a mensagem de erro LIBERADOR_NAO_E_OPERADOR_CHEFE também (nenhum código a consulta
--    pelo nome), para não alterar o contrato de erro.
--
-- Os outros gatilhos que dependem de perfil não mudam: o do fiscal em analise_credito segue
-- exigindo FISCAL e o de inativação de VENDEDOR segue como está.
CREATE OR REPLACE FUNCTION public.suprimax_validar_responsavel_entrada()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.id_operador_liberacao IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.operador WHERE id_operador=NEW.id_operador_liberacao AND perfil IN ('OPERADOR_CHEFE','ADMIN') AND status='ATIVO'
  ) THEN RAISE EXCEPTION 'LIBERADOR_NAO_E_OPERADOR_CHEFE'; END IF;
  RETURN NEW;
END $$;
