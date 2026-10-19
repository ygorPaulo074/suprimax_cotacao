# Documentação — Sistema de Cotação Web (Sistema 2)

Fonte de verdade: **Documentacao_SupriMax_FINAL.docx** (cópia em [`referencias/`](referencias/)), convertida para Markdown nos arquivos numerados abaixo, com as imagens em [`assets/`](assets/). Em caso de divergência com os rascunhos, prevalece o FINAL; veja [`historico-e-divergencias.md`](historico-e-divergencias.md).

## Índice

| Arquivo | Conteúdo |
|---|---|
| [01-introducao.md](01-introducao.md) | Contexto de negócio, escopo, arquitetura, integração S1 ↔ S2 |
| [02-requisitos-funcionais.md](02-requisitos-funcionais.md) | RF01–RF27 |
| [03-requisitos-nao-funcionais.md](03-requisitos-nao-funcionais.md) | RNF01–RNF09, stack, infraestrutura, Git/PR/CI/CODEOWNERS |
| [04-regras-de-negocio.md](04-regras-de-negocio.md) | Faturamento, crédito, frete, imposto, numeração, status e transições |
| [05-casos-de-uso.md](05-casos-de-uso.md) | UC01–UC25 |
| [06-diagramas-de-sequencia.md](06-diagramas-de-sequencia.md) | Fluxos principais |
| [07-identidade-visual.md](07-identidade-visual.md), [08-estilo-visual.md](08-estilo-visual.md) | Marca, paleta, tipografia, componentes |
| [09-documento-de-orcamento-pdf.md](09-documento-de-orcamento-pdf.md) | Estrutura do PDF do orçamento |
| [10-frontend.md](10-frontend.md) | Perfis, componentes, badges e especificação das telas (com wireframes) |
| [11-backend-e-modulo-de-calculo.md](11-backend-e-modulo-de-calculo.md) | Camadas, regras do backend e **módulo de cálculo (11.6)** |
| [12-proxy.md](12-proxy.md) | Contrato `POST /executar`, auth/JWT, escopos, fila de escrita, catálogo de operações |
| [13-banco-de-dados.md](13-banco-de-dados.md) | Modelo, entidades, regras no banco, dicionário completo |
| [banco-de-dados/](banco-de-dados/) | Dicionário em formato utilizável por código |

## Material para uso direto

- `banco-de-dados/dicionario-de-dados.json` — entidades, 212 colunas e 45 FKs (base para `schema.prisma`, tipos TS, seeds).
- `banco-de-dados/colunas.csv` — mesma lista de colunas, para filtrar em planilha.
- `referencias/Dicionario_de_Dados_SupriMax.xlsx` — planilha original.
- `assets/marca/manual-de-marca.jpg` — logo, variações, paleta e tipografia. Cores: petróleo `#0B3D5C`, verde-limão `#8DC63F`, grafite `#333333`, off-white `#F7F7F7`, laranja de alertas `#F2994A`; fonte Poppins (fallback Inter).
- `assets/diagramas/` — DER geral, DER conceitual, recortes (catálogo/estoque e orçamento/crédito) e diagramas de sequência.
- `referencias/Wireframes_Sistema2.pdf` — especificação de wireframes de média fidelidade (18 frames, 1440×1024).

## Por onde começar

1. Leia 01, 04 e 13.1–13.3 (negócio, regras, modelo).
2. **Módulo de cálculo** (`backend/services/calculo/`): funções puras com regras fechadas; prioridade de testes Jest (seção 11.6).
3. **Schema Prisma** a partir do dicionário (13.7 / JSON) e **proxy** (cap. 12): o backend depende dos dois.
4. Backend: UC13 (login) → UC02/UC04 (cadastros) → UC01/UC14–UC19 (orçamento) → UC20/UC21 (resposta do cliente).
5. Frontend em paralelo, guiado pelo capítulo 10 e pelos wireframes.

## Pontos de atenção

- Dinheiro em **centavos inteiros**; imposto de 18% arredondado **uma vez por linha** (meio para cima); limites **inclusivos** (≥ R$ 500 e ≥ R$ 1.500); a base de comparação são os itens com imposto, **sem frete**.
- Orçamento emitido é **imutável**; qualquer mudança é uma nova versão (número novo).
- Rascunho não reserva estoque; reservas nascem na emissão e são baixadas no ACEITO.
- Nenhum componente acessa o banco sem passar pelo proxy.
