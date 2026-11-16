-- Perfil ADMIN: administrador do sistema, com acesso a todas as áreas do Sistema 2.
--
-- Troca a restrição operador_perfil_check (criada em 20261112001000_business_rules) para aceitar
-- o valor novo. Um único ALTER TABLE: o PostgreSQL derruba a restrição antiga e cria a nova na
-- mesma instrução, então não há instante sem restrição. Nenhuma linha existente usa ADMIN, então
-- a validação da restrição nova não falha por dados atuais.
--
-- Não altera os gatilhos que dependem de perfil, de propósito:
--   * LIBERADOR_NAO_E_OPERADOR_CHEFE (entrada_mercadoria): a liberação de divergência continua
--     exclusiva do OPERADOR_CHEFE. Se o ADMIN também deve liberar, é uma decisão de regra de
--     negócio a tomar à parte.
--   * o gatilho de fiscal em analise_credito e o de inativação de VENDEDOR continuam como estão.
ALTER TABLE public.operador
  DROP CONSTRAINT operador_perfil_check,
  ADD CONSTRAINT operador_perfil_check CHECK (perfil IN ('VENDEDOR','OPERADOR','OPERADOR_CHEFE','FISCAL','FINANCEIRO','GESTOR','ADMIN'));
