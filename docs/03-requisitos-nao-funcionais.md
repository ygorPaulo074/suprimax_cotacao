# 3. Requisitos Não Funcionais


Os requisitos não funcionais descrevem como o sistema deve se comportar.


| **ID** | **Descrição** |
|---|---|
| **RNF01** | Segurança: senha de operador armazenada de forma criptografada e controle de acesso individual. |
| **RNF02** | Usabilidade: a geração de um orçamento completo, do pedido à emissão, deve exigir no máximo 10 cliques com 5 itens. |
| **RNF03** | Desempenho: busca por CNPJ em até 1 s; cálculo do orçamento em até 2 s; emissão com geração do PDF em até 5 s. Os tempos valem com o serviço já ativo: no plano gratuito do Render, o serviço hiberna por inatividade e a primeira requisição pode demorar mais. |
| **RNF04** | Confiabilidade: dados de cotação não podem ser perdidos após salvos. |
| **RNF05** | Segurança e integridade: toda comunicação entre os três sistemas, e destes com o banco de dados, deve passar exclusivamente por um proxy central, responsável por gerenciar, validar e tratar as requisições. Nenhum sistema acessa outro sistema ou a base diretamente. O proxy é transparente para os sistemas: funciona como um backend adicional e deve ser aplicado em toda comunicação. |
| **RNF06** | Confiabilidade: em caso de queda de conexão do usuário, nenhuma alteração em andamento pode ser perdida. As alterações devem ser mantidas em cache local no dispositivo do usuário enquanto a gravação não for concluída e reenviadas automaticamente ao backend quando a conexão for restabelecida. O backend persiste a alteração no banco de dados através do proxy e, confirmada a gravação, o frontend atualiza a página com os dados lidos do banco pelo backend; o cache local correspondente só é descartado após essa atualização. |
| **RNF07** | Padronização: o sistema web deve ser hospedado em um único host padronizado, evitando duplicidade de instâncias e de informações. |
| **RNF08** | Compatibilidade: o Sistema 2 deve funcionar nas versões recentes do Chrome, Edge e Firefox, em telas de 1280 px de largura ou mais. |
| **RNF09** | Concorrência: o Sistema 2 deve suportar 10 operadores simultâneos sem perda de dados e sem duplicidade de número de orçamento. |


## 3.1 Stack tecnológica


O banco de dados é único e compartilhado entre os três sistemas; sua definição, bem como a de infraestrutura, é comum a toda a solução e não pertence isoladamente ao Sistema 2.


| **Camada** | **Opções consideradas** | **Definição** |
|---|---|---|
| **Linguagem backend** | Java (Spring Boot), C# (.NET), Node.js (Express), Python (Django/Flask) | Node.js (TypeScript) |
| **Frontend** | React, Angular, HTML/CSS/JS puro | React |
| **Banco de dados** | PostgreSQL autogerenciado, Supabase | Supabase (PostgreSQL gerenciado) |
| **Controle de versão** | Git + GitHub | Git + GitHub |
| **Infraestrutura/deploy** | Vercel, Render, Railway, Cloudflare Workers/Pages | Vercel (frontend) + Render (backend, incluindo o módulo de cálculo) |
| **E-mail transacional** | Resend, SendGrid, SMTP próprio | Resend (plano gratuito) |
| **Armazenamento de arquivos** | Supabase Storage, S3 | Supabase Storage privado, com URL assinada para os documentos de crédito |
| **Geração de PDF** | PDFKit, pdfmake, Puppeteer | PDFKit ou pdfmake (leves); Puppeteer é pesado para o plano gratuito do Render |
| **Jobs agendados** | pg_cron (Supabase), cron no Render | pg_cron no Supabase, sujeito à disponibilidade no plano |


## 3.2 Infraestrutura


| **Item** | **Definição** |
|---|---|
| **Hospedagem do banco de dados** | Supabase (Postgres gerenciado), plano gratuito — banco único e compartilhado entre os três sistemas. |
| **Hospedagem dos sistemas** | Frontend hospedado na Vercel; backend (incluindo o módulo de cálculo) e proxy central hospedados no Render, como serviços independentes — todos em plano gratuito. O sistema mobile (Sistema 1) é distribuído por instalação direta via APK. |
| **Backend do Sistema 1** | O Sistema 1 possui backend próprio, que acessa o banco compartilhado exclusivamente através do proxy, com a credencial de serviço mantida em variável de ambiente (env). |
| **Comunicação de rede** | Comunicação via REST/JSON, centralizada em um proxy único, hospedado no Render, que intermedeia todas as chamadas entre os três sistemas e destes com o banco de dados, com autenticação por token de serviço — nenhum sistema se comunica diretamente com outro ou acessa o banco diretamente. O proxy gerencia, valida e serializa as requisições concorrentes; por intermediar os três sistemas, não pode ser embutido no código de um sistema específico, rodando como serviço próprio e com documentação própria de rotas e contratos. Detalhamento por blocos de cada sistema (banco de dados, frontend, backend), com definição comum aos três sistemas. |
| **Autenticação e controle de acesso** | Login unificado entre os três sistemas, com permissões diferenciadas por tipo de conta e por sistema. |
| **Responsável pela infraestrutura** | Papel único, responsável pela infraestrutura dos três sistemas. |
| **Backup e recuperação** | Persistência a cada alteração: enquanto a gravação não é concluída, a alteração permanece em cache local no dispositivo do usuário. O backend a encaminha ao banco de dados pelo proxy e, uma vez confirmada a gravação, o frontend recarrega a página a partir dos dados lidos do banco pelo backend. Com isso, não há perda de progresso em caso de queda de conexão. Para o MVP, mantemos o backup do banco de forma manual (dump) antes de alterações estruturais relevantes e nos marcos do projeto (N1, N2, apresentação final). |
| **Versionamento do schema** | Qualquer alteração no schema do banco deve ser analisada e aprovada em conjunto pelos responsáveis pelos três sistemas. Migrations gerenciadas via Prisma, com o repositório do Sistema 2 como fonte única da verdade do schema. |
| **Equipe do projeto** | Equipe de 9 integrantes, distribuída entre as seguintes frentes: gestão de projeto; backend (incluindo o módulo de cálculo); frontend; modelagem e administração do banco de dados; infraestrutura/DevOps; e QA, com responsáveis distintos para testes funcionais e não funcionais. |
| **Integração contínua (CI)** | Lint e formatação com ESLint + Prettier; testes unitários com Jest, priorizando as funções do módulo de cálculo (backend). <br> Deploy automático disparado a cada merge na branch main, tanto na Vercel (frontend) quanto no Render (backend, incluindo módulo de cálculo, e proxy). |
| **Arquivos de controle de ambiente** | .env.example e .gitignore são obrigatórios no repositório desde o início do projeto e são atualizados continuamente conforme novas variáveis e artefatos são incorporados — não precisam estar completos já na primeira versão. Cada serviço (frontend, backend e proxy) mantém também o seu CHANGELOG.md desde o início (seção 3.3.5). |
| **Conectividade do Sistema 1** | Funcionamento offline com sincronização posterior, conforme definição do módulo mobile. |


## 3.3 Versionamento e Controle de Código


O código do Sistema 2 fica em um monorepo único no GitHub, compartilhado pelos 9 integrantes da equipe (frontend, backend — incluindo o módulo de cálculo — e proxy sob o mesmo histórico). O fluxo abaixo equilibra a coordenação de uma equipe deste tamanho com a segurança de não permitir alterações não revisadas direto na branch estável.


### 3.3.1 Fluxo de branches e Pull Requests

- main é protegida: push direto não é permitido em nenhuma hipótese, mesmo em equipe pequena — toda alteração passa por Pull Request.
- Branches de feature por tarefa/serviço, no padrão feature/<serviço>/<tarefa> (ex.: feature/backend/uc01-gerar-cotacao).
- Fluxo de revisão: o time de QA executa os testes (Jest) e revisa a PR; a gestão de projeto (PM) aprova; a pessoa responsável pela infraestrutura realiza o merge.
- Estratégia de merge: squash and merge — cada PR vira um único commit na main, mantendo o histórico limpo e rastreável.
- Rastreabilidade: toda PR deve referenciar explicitamente o caso de uso (UC) que está implementando.

### 3.3.2 Qualidade e integração contínua


Lint e testes rodam como parte do fluxo de PR, e o deploy é automático a cada merge na main (Vercel para o frontend; Render para backend e proxy — ver 3.2).

- Lint/formatação: ESLint + Prettier.
- Testes funcionais: Jest, escrito junto do código-fonte de cada módulo (arquivos *.test.ts) — prioridade para as funções do módulo de cálculo.
- Testes não funcionais automatizáveis (performance, segurança): pasta própria tests-nfr/, com ferramentas como k6 ou Artillery.
- Testes não funcionais não automatizáveis: registrados como documentação, sem automação de execução.

### 3.3.3 CODEOWNERS


A revisão obrigatória é atribuída automaticamente por pasta via CODEOWNERS. Como o GitHub aplica o último padrão do arquivo que casar com o caminho alterado, os padrões de teste ficam no final — sobrepondo a regra de pasta do serviço sempre que o arquivo alterado for um teste.


| **Caminho** | **Dono(s) — revisor(es) obrigatório(s)** |
|---|---|
| **/frontend/** | Time de Frontend |
| **/backend/** | Time de Backend |
| **/backend/database/** | Responsável pela modelagem e administração do banco de dados |
| **/backend/services/calculo/** | Time do módulo de cálculo |
| **/proxy/** | Responsável pela infraestrutura/DevOps |
| **/tests-nfr/** | Time de QA — testes não funcionais |
| /*.test.ts** | Time de QA — testes funcionais |


Na prática: um arquivo *.test.ts dentro de /backend/services/calculo/, por exemplo, exige aprovação tanto do time do módulo de cálculo (dono da pasta) quanto do time de QA responsável pelo padrão de teste — os dois CODEOWNERS diferentes precisam aprovar a mesma PR.


Isso reforça o controle de qualidade, mas significa que toda PR de funcionalidade com teste embutido no código depende da aprovação de uma pessoa a mais, o que pode deixar o fluxo mais lento. Vale a equipe monitorar o tempo de ciclo das PRs após ativar "Require review from Code Owners" nas branch protection rules da main.


### 3.3.4 Versionamento de contratos e de schema


O proxy expõe um único contrato de execução de operações (seção 12.2), e não um conjunto de rotas específicas por domínio de negócio; por isso, não se aplica a ele o versionamento por prefixo de rota (/v1/, /v2/). A estabilidade do contrato está no formato fixo do envelope de operação (operacao + payload), que se mantém constante independentemente do crescimento do catálogo de operações (seção 12.8) à medida que o Modelo de Dados Compartilhado (seção 13) evolui. O versionamento do módulo de cálculo está descrito na seção 11.6.2.2.


O versionamento do schema do banco de dados compartilhado segue o que já está definido em 3.2: migrations gerenciadas via Prisma, com o repositório do Sistema 2 como fonte única da verdade, e qualquer alteração estrutural aprovada em conjunto pelos responsáveis dos três sistemas antes do merge.


### 3.3.5 Changelog obrigatório por serviço


Cada serviço do monorepo mantém um arquivo CHANGELOG.md na raiz da sua pasta: /frontend/CHANGELOG.md, /backend/CHANGELOG.md e /proxy/CHANGELOG.md. O arquivo é obrigatório desde o início do projeto, no mesmo padrão do .env.example (seção 3.2), e não precisa estar completo na primeira versão.

- Toda PR que altera um serviço inclui a entrada correspondente no CHANGELOG desse serviço, com a data, a descrição da mudança e o caso de uso (UC) de origem, conforme a regra de rastreabilidade da seção 3.3.1.
- O módulo de cálculo não tem changelog próprio: por ser parte do backend, suas mudanças são registradas em /backend/CHANGELOG.md, com a observação “módulo de cálculo” e o valor de VERSAO_REGRAS (seção 11.6.2.2).
