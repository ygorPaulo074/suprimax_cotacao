# Banco de dados — andamento e próximos passos

**Responsável:** modelagem e administração do banco. **Pasta:** `backend/database/`. Mudanças compartilhadas do schema precisam da revisão e aprovação dos responsáveis pelos três sistemas, conforme o processo do repositório.

## Escopo entregue nesta etapa

Os artefatos locais foram preparados para revisão e validação:

- Schema Prisma com as 22 entidades do negócio e as três tabelas operacionais do proxy.
- Três migrations versionadas: estrutura e índices; regras, gatilhos e RLS; funções transacionais e jobs.
- Script do bucket privado e script opcional de agendamento via `pg_cron`.
- Seed sintético local, testes de integração com guarda de segurança e instruções de uso.

A validação do schema pelo Prisma CLI passou e a migration inicial foi gerada e comparada. As três migrations foram aplicadas com sucesso nos bancos locais `suprimax_dev` e `suprimax_test`; os testes básicos passaram. Nada foi aplicado no Supabase. A equipe do proxy poderá conectar a aplicação ao Supabase depois; isso não substitui a execução das migrations, que precisa de conexão autorizada para DDL.

## Checklist atualizado

- [x] Schema Prisma escrito para 22 tabelas do negócio + 3 do proxy; nomes e 212 campos do negócio conferidos contra o dicionário, depois validado e formatado pelo Prisma CLI.
- [x] Migration inicial gerada pelo Prisma CLI e comparada com a versão preparada: 25 tabelas, 240 colunas, 45 chaves estrangeiras e 51 índices, sem diferenças estruturais detectadas; aplicada nos dois bancos locais.
- [x] Migration SQL de regras aplicada nos dois bancos locais: RLS ativado nas 25 tabelas e sem políticas instaladas.
- [x] Funções nomeadas do proxy e jobs SQL aplicados localmente; sete funções `proxy_*` presentes. O contrato integrado com o proxy ainda requer conferência conjunta.
- [x] Bucket privado e agendamento `pg_cron` documentados em scripts separados.
- [x] Seed de desenvolvimento preparado, restrito a PostgreSQL local `_dev` e sem senha em texto puro.
- [ ] Executar o seed depois que o backend definir o mecanismo de hash de senha e fornecer um hash compatível.
- [x] Testes básicos preparados, restritos a PostgreSQL local `_test`; a verificação de saldo foi corrigida para alcançar o gatilho de estoque.
- [x] Executar a suíte básica no banco local: cinco testes passaram.
- [ ] Ampliar os testes para a lista recomendada em `docs/13-banco-de-dados.md` (concorrência, login/token, reserva, fechamento da resposta, pedido e expiração de rascunho).
- [x] Instruções de configuração, backup e futura aplicação escritas.
- [x] Instalar dependências locais (`prisma`, `pg`, `dotenv`); `prisma validate` passou e `prisma format` foi executado.
- [x] Configurar conexão PostgreSQL local no `.env`, aplicar migrations nos bancos vazios e confirmar as três migrations aplicadas.
- [ ] Expandir os testes além dos cinco casos básicos; sem `TEST_DATABASE_URL`, eles serão ignorados.
- [ ] Revisão/aprovação pelos responsáveis dos três sistemas.
- [ ] Configurar a conexão autorizada de migration (`DIRECT_URL`) e aplicar migrations no Supabase; não usar a URL do Transaction pooler.
- [ ] Habilitar `pg_cron`, se disponível, e executar o script de agendamento.
- [ ] Criar o bucket privado executando o script de Storage autorizado.
- [ ] Fazer backup antes de alterações estruturais em ambiente compartilhado.

## Integrações que precisam de conferência conjunta

- A criação do projeto Supabase e a conexão de runtime no `.env` do proxy ficam com a equipe do proxy. Não foram verificadas nem alteradas nesta entrega; a informação atual é que o proxy será conectado depois.
- O schema Prisma limita `chave_seguranca` a 64 caracteres, enquanto a validação atual de `orcamento.emitir` no proxy aceita até 255. Confirmar o tamanho real do token e alinhar o contrato antes de integrar.
- A função SQL levanta alguns erros de negócio além dos seis códigos que o tradutor atual do proxy reconhece. Sem alinhar a lista, esses casos viram `INTERNAL_ERROR` no proxy; combinar os códigos e as respostas HTTP com a equipe do proxy.
- O teste de estoque agora chega à validação de saldo. Os cinco testes básicos passaram, mas a suíte ainda não cobre todos os cenários recomendados na seção 13.5.

## Próxima etapa local

Os bancos locais `suprimax_dev` e `suprimax_test`, as dependências e as migrations já estão configurados. Para executar o seed, o backend precisa primeiro definir seu mecanismo de hash de senha; então forneça `SEED_OPERATOR_PASSWORD_HASH` compatível e rode o procedimento do `README.md`. A ampliação dos testes pode avançar em paralelo, coordenando os contratos que dependem do proxy e do backend.

## Próxima etapa no ambiente compartilhado

Antes de aplicar qualquer DDL, combinar a janela e revisar os arquivos de migration com os responsáveis. Configure `DIRECT_URL` somente no ambiente local autorizado e use conexão direta ou Session pooler (porta 5432). O endpoint operacional do proxy não transporta migrations nem executa DDL arbitrário. Nunca grave credenciais no repositório.

Para o Supabase, aplique `prisma migrate deploy`; em seguida, se habilitado, execute `supabase/002_agendar_jobs_pg_cron.sql` e `supabase/001_bucket_privado.sql`. Consulte o [README da pasta](README.md) para comandos e backup.

## Premissas a confirmar antes de produção

- O bloqueio após três tentativas está configurado para 15 minutos, pois a documentação funcional só especifica bloqueio temporário.
- A migration de emissão exige pagamento `ADIANTADO_100` para primeira compra. Confirmar com as regras comerciais e o Sistema 1.
- A política de acesso do bucket deve ser implementada pelo serviço responsável; o script cria bucket privado sem políticas públicas.
- Os jobs podem rodar por `pg_cron` ou agendador do proxy, conforme infraestrutura disponível.
