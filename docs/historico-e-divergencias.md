# Origem dos documentos e divergências

Material original (repositório de documentação) e como foi aproveitado.

| Arquivo original | Situação |
|---|---|
| `Documentacao_SupriMax_FINAL.docx` | **Fonte de verdade.** Convertida em `01…13`. Cópia em `referencias/`. |
| `Dicionario_de_Dados_SupriMax.xlsx` | Dicionário em planilha (22 tabelas, 212 colunas, 45 FKs). Convertido em JSON/CSV; cópia em `referencias/`. Contagens da aba Entidades são fórmulas e não foram levadas ao JSON. |
| `modelos/Documentacao_Backend_SupriMax.docx` | Rascunho anterior do backend; conteúdo absorvido no capítulo 11. |
| `modelos/modulo-calculo-suprimax.docx` | Rascunho com funções "não definidas"; definido no FINAL (11.6). |
| `modelos/api-suprimax-referencia.docx` | **Obsoleto:** previa API em Python. Decidiu-se por módulo interno em TypeScript. |
| `modelos/Documentação_Modelo_Dados_SupriMax.docx`, `modelos/Suprimax_DB.docx` | Esqueleto/rascunho do modelo de dados; substituídos pelo capítulo 13. |
| `modelos/…Exemplos_Visuais.pdf` | Especificação de wireframes; guardada como `referencias/Wireframes_Sistema2.pdf`. |
| `.jpg` / `.png` soltos | Em `assets/marca` e `assets/diagramas`. |

## Divergências entre versões (vale o FINAL)

| Tema | Rascunhos antigos | FINAL |
|---|---|---|
| Linguagem do cálculo | Python, API com rotas | TypeScript, módulo importado |
| Bloqueio de login | 5 tentativas (backend antigo) | 3 tentativas (UC13) |
| Limite de CIF/parcelamento | "acima de R$ 1.500" | "a partir de" (≥), inclusivo |
| Frete FOB | Podia ser diluído no preço | Sempre destacado; imposto só sobre produtos |
| Imposto | Sobre o produto | Sobre o valor da linha, arredondado uma vez |
| Reserva de estoque | A cada inclusão de item | Só na emissão (rascunho não reserva) |
| Justificativa de recusa | Mínimo de 100 caracteres | Opcional |
| Numeração | 5 dígitos | Mínimo de 5, sem limite superior |
| Cotação sem retorno | 7 dias sem atualização | Pop-up 7 dias antes do vencimento; expira em 30 dias |

## Lacunas conhecidas

- Responsáveis do CODEOWNERS e integrantes da equipe não constam nos documentos.
- As figuras do FINAL estão em `assets/figNN.*` sem legenda própria; o contexto está no texto vizinho.
- A conversão do .docx pode perder formatação em alguns trechos; em caso de dúvida consulte `referencias/Documentacao_SupriMax_FINAL.docx`.
