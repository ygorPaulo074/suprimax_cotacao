# Changelog — frontend

Uma entrada por PR: data, descrição e UC de origem (ver docs/03-requisitos-nao-funcionais.md, seção 3.3.5).

## [Não lançado]

- 2026-11-17 — Fila offline (RNF06): toda mutação JSON de `/orcamentos` envia `Idempotency-Key` (UUID gerado uma vez por ação e reutilizado nos reenvios); mutação sobre orçamento existente feita sem conexão vai para fila persistida em `localStorage` (sem token), é reenviada em ordem ao evento `online` e a cada 30 s, e só sai da fila após resposta OK e releitura (invalidação do TanStack Query); 4xx definitivo descarta e avisa; indicador "N alterações pendentes" no cabeçalho; o último orçamento lido fica em cache local para continuar visível offline; fila e cache são apagados no logout. `api/filaOffline.ts`, `api/cacheLocal.ts`, `components/AlteracoesPendentes.tsx`. RNF06 (UC16).
- 2026-11-17 — Análise de crédito: campo de arquivo opcional (PDF, JPEG, PNG, até 10 MB, validado no cliente) enviado em multipart ao registrar o documento; botão "Abrir" pela URL assinada quando `temArquivo`; erros 413 e 422 no formulário. `creditoApi.urlDoDocumento`, `validarArquivoDeCredito`, `DocumentoCredito.temArquivo`. UC07.
- 2026-11-17 — Ficha do cliente: "Novo orçamento" também desabilitado para cliente BLOQUEADO, com o motivo "Cliente bloqueado: não é possível criar orçamento.". UC14.
- 2026-11-17 — Ficha do cliente: botão "Novo orçamento" (`POST /orcamentos`, abre `/orcamentos/:id`), visível só para operador, operador chefe e administrador; desabilitado com o motivo visível se há dívida em aberto ou o cliente está inativo. `orcamentosApi.criar` e tipo `OrcamentoNovo`. UC14.
- 2026-11-16 — Perfil ADMIN: `temPerfil` em `lib/perfis.ts` (ADMIN passa em todas as checagens de menu, rotas e ações de operador chefe); opção ADMIN no cadastro de usuários só para ADMIN; rótulos de perfil em português (Administrador); liberação de divergência de entrada por operador chefe ou administrador. UC04 (E1), UC13, UC25.
- 2026-11-16 — Telas pendentes: redefinição de senha (`/redefinir-senha?token=`), ação Quitar em Dívidas, botão Abrir e mensagens de erro de upload nos anexos do orçamento, página 404. UC13, UC19, UC23.
- 2026-11-13 — Variáveis de ambiente: `.env.example` próprio do serviço (substitui o da raiz); `VITE_API_URL` é lida no build da Vercel. Infra (docs/03, seção 3.2); sem UC.
- 2026-10-19 — Frontend criado a partir do protótipo do Figma: Vite, React 19, Tailwind 4, React Router, camada de API tipada, 18 telas sem dados fixos, menu por perfil. UC01–UC25 (telas).
