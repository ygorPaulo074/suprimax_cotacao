-- Sessões de login persistidas (UC13, RN02). Até aqui as sessões ficavam na memória do backend e
-- cada deploy ou reinício do Render derrubava todos os logins ("login constante"). Com esta
-- tabela, o backend grava a sessão pelo proxy (operações sessao.*, RNF05) e ela sobrevive ao
-- reinício.
--
-- Só o SHA-256 do token (64 caracteres hexadecimais) é gravado: quem ler a tabela não obtém um
-- token utilizável. O token em texto puro existe só na resposta do login.
--
-- expira_em é o prazo deslizante de inatividade (SESSAO_INATIVIDADE_MINUTOS); o proxy calcula e
-- compara com o relógio do banco (CURRENT_TIMESTAMP). Sessão vencida é ignorada na busca e
-- removida pela limpeza periódica (sessao.remover_expiradas, chamada pelos jobs do backend).
--
-- Mudança aditiva: tabela nova; a única linha existente alterada é o cadastro do integrante do
-- backend em integrantes_proxy, que ganha os escopos operacao:sessao.* (fim do arquivo). ON DELETE CASCADE no
-- operador: apagar o operador (na prática ele é inativado) leva as sessões junto.
-- Tabela de infraestrutura, como integrantes_proxy e fila_escrita: fica fora do dicionário de
-- dados, então dados.consultar/inserir/atualizar/excluir a recusam; só as operações sessao.* a
-- acessam. RLS ligada e sem políticas, como as demais: só a conexão administrativa do proxy lê.
CREATE TABLE IF NOT EXISTS public.sessao (
  token_hash  CHAR(64)       NOT NULL,
  id_operador INTEGER        NOT NULL,
  expira_em   TIMESTAMPTZ(6) NOT NULL,
  criado_em   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sessao_pkey PRIMARY KEY (token_hash),
  CONSTRAINT sessao_token_hash_formato CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT sessao_expira_depois_de_criar CHECK (expira_em > criado_em)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sessao_id_operador_fkey' AND conrelid = 'public.sessao'::regclass
  ) THEN
    ALTER TABLE public.sessao
      ADD CONSTRAINT sessao_id_operador_fkey
      FOREIGN KEY (id_operador) REFERENCES public.operador(id_operador) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- encerrar do operador (inativação, troca de perfil, senha redefinida) e limpeza das vencidas.
CREATE INDEX IF NOT EXISTS sessao_id_operador_idx ON public.sessao(id_operador);
CREATE INDEX IF NOT EXISTS sessao_expira_em_idx ON public.sessao(expira_em);

ALTER TABLE public.sessao ENABLE ROW LEVEL SECURITY;
-- Supabase expõe o schema public às roles da API REST (anon, authenticated); nada passa por lá.
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.sessao FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- Escopos das operações sessao.* para o integrante do backend do Sistema 2. O proxy lê os escopos
-- do cadastro (integrantes_proxy), não do token: basta acrescentá-los, sem gerar token novo.
-- Idempotente (só acrescenta o que falta) e restrito ao integrante do Sistema 2, com o nome usado
-- por scripts/gerar-env.cjs ('sistema2-backend') ou pelo exemplo de integrante.criar ('Sistema 2').
UPDATE public.integrantes_proxy
SET escopos = escopos || ARRAY(
  SELECT e FROM unnest(ARRAY[
    'operacao:sessao.criar',
    'operacao:sessao.buscar',
    'operacao:sessao.encerrar',
    'operacao:sessao.encerrar_operador',
    'operacao:sessao.remover_expiradas'
  ]::TEXT[]) AS e
  WHERE NOT (e = ANY(COALESCE(escopos, ARRAY[]::TEXT[])))
)
WHERE nome_sistema IN ('sistema2-backend', 'Sistema 2');
