# Changelog — frontend

Uma entrada por PR: data, descrição e UC de origem (ver docs/03-requisitos-nao-funcionais.md, seção 3.3.5).

## [Não lançado]

- 2026-11-16 — Telas pendentes: redefinição de senha (`/redefinir-senha?token=`), ação Quitar em Dívidas, botão Abrir e mensagens de erro de upload nos anexos do orçamento, página 404. UC13, UC19, UC23.
- 2026-11-13 — Variáveis de ambiente: `.env.example` próprio do serviço (substitui o da raiz); `VITE_API_URL` é lida no build da Vercel. Infra (docs/03, seção 3.2); sem UC.
- 2026-10-19 — Frontend criado a partir do protótipo do Figma: Vite, React 19, Tailwind 4, React Router, camada de API tipada, 18 telas sem dados fixos, menu por perfil. UC01–UC25 (telas).
