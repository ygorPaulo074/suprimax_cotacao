# Banco de dados SupriMax

Esta pasta guarda o schema Prisma, o histórico de migrations, funções e regras SQL, seed de desenvolvimento e testes de integração. O Prisma é usado para versionar a estrutura; a aplicação continua lendo e gravando pelo proxy.

## Arquivos principais

- `schema.prisma`: 22 tabelas do negócio e três tabelas operacionais do proxy.
- `prisma/migrations/`: criação das tabelas, constraints, gatilhos, funções e RLS.
- `supabase/001_bucket_privado.sql`: criação idempotente do bucket privado de documentos de crédito.
- `supabase/002_agendar_jobs_pg_cron.sql`: agenda os jobs depois que `pg_cron` estiver habilitado.
- `scripts/seed.cjs`: dados sintéticos de desenvolvimento; recusa qualquer banco que não seja local e termine em `_dev`.
- `tests/database-rules.test.cjs`: testes contra um banco local terminado em `_test`.

## Preparar um PostgreSQL local

1. Crie dois bancos vazios: `suprimax_dev` e `suprimax_test`.
2. Copie `.env.example` para `.env` e ajuste usuário e senha locais.
3. Instale as dependências desta pasta:

   ```powershell
   npm install
   ```

4. Valide e formate o schema:

   ```powershell
   npm run validate
   npm run format
   ```

5. Aplique as migrations que já estão versionadas no banco local de desenvolvimento:

   ```powershell
   npm run migrate:deploy
   ```

   `migrate:deploy` executa os arquivos existentes sem criar outra migration. Use `migrate:dev` somente quando estiver desenvolvendo uma mudança nova de schema em um banco local descartável; esse comando pode gerar uma nova migration e precisa de um banco sombra.

6. Para testar as regras, o `.env` deve ter `TEST_DATABASE_URL` apontando a `suprimax_test`. Aponte temporariamente `DIRECT_URL` para esse mesmo banco, aplique as migrations e depois remova a variável temporária:

   ```powershell
   $env:DIRECT_URL = "postgresql://postgres:SUA_SENHA@localhost:5432/suprimax_test"
   npm run migrate:deploy
   Remove-Item Env:DIRECT_URL
   npm test
   ```

Os testes recusam conexões remotas e nomes que não terminem em `_test`. Sem `TEST_DATABASE_URL`, são ignorados.

## Seed local

O seed cria um `OPERADOR_CHEFE`, clientes, produtos, variações, faixas de preço e fardos de exemplo. Antes de rodá-lo, defina `SEED_OPERATOR_PASSWORD_HASH` com um hash produzido pelo mesmo mecanismo de senha que o backend adotará. O seed não recebe nem grava uma senha em texto puro.

```powershell
npm run db:seed
```

O script só aceita host local e banco terminado em `_dev`. Os CNPJs e demais cadastros de exemplo são dados sintéticos; não os use em produção.

## Aplicar no Supabase

O proxy usa a conexão de runtime do PostgreSQL indicada no `.env` dele. O Prisma usa `DIRECT_URL`, via conexão direta ou Session pooler (porta 5432), para aplicar migrations. O endpoint de operações do proxy não aplica DDL nem recebe SQL bruto; portanto, a aplicação de migrations requer que o responsável pela conexão execute o fluxo de migration com acesso autorizado ao banco. Não use a URL de Transaction pooler (porta 6543) para migrations.

Com o responsável pelo projeto Supabase, após revisão e aprovação das alterações de schema pelos três sistemas:

1. Configure temporariamente `DIRECT_URL` para a conexão de migration autorizada.
2. Confira `npm run migrate:status`.
3. Aplique apenas migrations pendentes com `npm run migrate:deploy`.
4. Habilite `pg_cron` no painel, se disponível, e execute `supabase/002_agendar_jobs_pg_cron.sql`.
5. Execute `supabase/001_bucket_privado.sql` para criar o bucket privado. O script não cria políticas de acesso; a service role deve ser mantida apenas no serviço autorizado.

Não execute `migrate dev` na produção. A URL de conexão contém credenciais e nunca deve ser enviada ao repositório.

## Backup manual

Antes de uma mudança estrutural em um banco acessível, faça um dump fora do repositório:

```powershell
pg_dump --format=custom --no-owner --no-privileges --file .\suprimax-antes-da-mudanca.dump "$env:DIRECT_URL"
```

Restaure somente em um banco de recuperação dedicado, depois de conferir o destino:

```powershell
pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$env:DIRECT_URL" .\suprimax-antes-da-mudanca.dump
```

O dump pode conter dados pessoais e credenciais hash; proteja-o e não o comite.

## Regras e manutenção

Restrições `CHECK`, triggers, funções do proxy, RLS, jobs e a configuração do Storage estão em SQL porque o Prisma não descreve essas regras. Edite o schema e crie uma nova migration para cada mudança estrutural; não reescreva migrations já aplicadas. Alterações do banco compartilhado exigem aprovação dos responsáveis pelos três sistemas.

**Estado da migration inicial:** foi emitida pelo Prisma CLI a partir de `schema.prisma` e comparada com a versão anterior preparada manualmente. As duas contêm as mesmas 25 tabelas, 240 colunas, 45 chaves estrangeiras e 51 índices. As regras não representadas pelo Prisma continuam nas migrations SQL seguintes. As três migrations foram aplicadas nos bancos PostgreSQL locais `suprimax_dev` e `suprimax_test`, e os cinco testes básicos passaram. A implantação no Supabase continua pendente de revisão, aprovação e acesso autorizado.

O bloqueio de login está configurado para 15 minutos, pois a documentação determina o bloqueio temporário após três erros, mas não define a duração. Confirme esse prazo com o grupo de autenticação antes de produção.
