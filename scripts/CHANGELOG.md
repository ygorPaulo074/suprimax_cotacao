# Changelog — scripts

Uma entrada por PR: data, descrição e UC de origem (ver docs/03-requisitos-nao-funcionais.md, seção 3.3.5).

## [Não lançado]

- 2026-11-18 — Novo `scripts/demo-fluxo.mjs`: roteiro de demonstração ponta a ponta pela API do backend (UC13 login e logout, UC03 ficha do cliente, UC04 busca de produtos, UC14 rascunho, UC19 itens, bloqueio de estoque e emissão, UC08 PDF e envio opcional). Simula por padrão (sem chamada de rede); `--executar` chama a API e `--enviar` inclui o e-mail ao vendedor. URL, usuário, senha e CNPJ por `DEMO_API_URL`, `DEMO_USUARIO`, `DEMO_SENHA` e `DEMO_CNPJ`; a senha nunca vai por argumento e nada secreto é impresso (nem token). Usa `Idempotency-Key` nas mutações (RNF06). Node >= 20, sem dependências. Sem mudança em backend, proxy nem frontend.
