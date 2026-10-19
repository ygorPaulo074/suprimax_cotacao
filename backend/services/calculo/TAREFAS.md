# Módulo de cálculo — orientações

**Responsável:** time do módulo de cálculo (revisor obrigatório da pasta `backend/services/calculo/` no CODEOWNERS). O módulo é interno ao backend, importado por chamada de função, e centraliza as regras comerciais. Especificação: `docs/11-backend-e-modulo-de-calculo.md`, seção 11.6.

## Situação

O módulo expõe **oito funções** (seção 11.6.4). Hoje só uma está implementada.

| Função                             | Seção    | Situação                                                         |
| ---------------------------------- | -------- | ---------------------------------------------------------------- |
| `calcularImpostoItem`              | 11.6.3.3 | ✅ feita, com testes                                             |
| `validarCondicaoFaturamento`       | 11.6.3.1 | ⬜ pendente                                                      |
| `calcularCondicaoCreditoReprovado` | 11.6.3.1 | ⬜ pendente                                                      |
| `calcularFrete`                    | 11.6.3.2 | ⬜ pendente                                                      |
| `validarDisponibilidadeEstoque`    | 11.6.3.4 | ⬜ pendente                                                      |
| `formatarNumeroOrcamento`          | 11.6.3.5 | ⬜ pendente                                                      |
| `calcularValidadeOrcamento`        | 11.6.3.5 | ⬜ pendente                                                      |
| `recalcularOrcamentoAprovado`      | 11.6.3.6 | ⬜ pendente (depende de `calcularImpostoItem` e `calcularFrete`) |

Já existem em `services/calculo/`: `types.ts`, `erros.ts` (`CalculoError` com os 7 códigos), `regras.ts` (constantes de regra) e `index.ts` (`VERSAO_REGRAS`).

## Regras de implementação (seção 11.6.2)

- **Funções puras:** não acessam banco, relógio nem rede. Crédito, saldo, data de emissão e valor do frete cotado entram como parâmetro.
- **Dinheiro em centavos inteiros** (`Centavos`); datas `'AAAA-MM-DD'` com aritmética em UTC.
- **Sem números soltos no código:** limites e alíquota vêm de `regras.ts`.
- **Resultado de regra não é erro:** mínimo não atingido, crédito reprovado e estoque indisponível voltam como dado (`{ ok: false, motivo }`). Entrada inválida lança `CalculoError`, e nunca devolve `NaN` nem corrige o valor em silêncio.
- **Limites inclusivos:** exatamente R$ 500,00 atinge o mínimo; exatamente R$ 1.500,00 é CIF e libera parcelamento.
- **Base de comparação:** soma dos totais das linhas (com imposto, **sem frete**).

## Entregas, em ordem

- [ ] **1. Validações compartilhadas** (`validacao.ts`): inteiro ≥ 0 em centavos, quantidade > 0, prazo permitido, parcelas de 2 a 6, data ISO válida (`CALC_DATA_INVALIDA`), número ≥ 1. Reutilize em todas as funções.
- [ ] **2. `calcularFrete`** (`frete.ts`): CIF a partir de R$ 1.500; FOB abaixo disso, com origem `SUPRIMAX` (valor cotado ou frete provisório) ou `CLIENTE`.
- [ ] **3. `calcularCondicaoCreditoReprovado`** (`creditoReprovado.ts`): 50% adiantado arredondado para cima e o restante, de modo que a soma sempre feche o total.
- [ ] **4. `validarCondicaoFaturamento`** (`faturamento.ts`): primeira compra 100% adiantada; mínimo de R$ 500 a partir da 2ª compra; boleto sob análise de crédito com prazo permitido; parcelamento a partir de R$ 1.500, até 6 parcelas e parcela mínima de R$ 250 (`valorParcela` por divisão inteira, com o resto na última).
- [ ] **5. `validarDisponibilidadeEstoque`** (`estoque.ts`): bloqueia a variação sem saldo, mesmo que outra variação do produto tenha.
- [ ] **6. `formatarNumeroOrcamento` e `calcularValidadeOrcamento`** (`orcamento.ts`): mínimo de 5 dígitos sem limite superior (`00001`, `100000`); validade = emissão + 30 dias em UTC.
- [ ] **7. `recalcularOrcamentoAprovado`** (`fechamento.ts`): AVULSO pela faixa da quantidade aprovada, FARDO com preço fixo, quantidade 0 = `NAO_APROVADO`; com todos aprovados, aplica mínimo e frete sobre o total aceito.
- [ ] **8. Exportar tudo em `index.ts`** e fechar a documentação da seção 11.6.3 se alguma assinatura mudar.

## Definição de pronto de cada função

- Teste Jest **em tabela de casos** (`*.test.ts` ao lado), cobrindo os exemplos da documentação, os **limites exatos** (49.999 / 50.000 e 149.999 / 150.000 centavos), cada motivo de recusa e cada código de `CalculoError`.
- Lint, formatação e tipos limpos; cobertura das ramificações de regra.
- PR citando o UC (UC18, UC19, UC20 ou UC17, conforme a função), **só com mudanças do módulo**.
- Se mudar uma regra ou assinatura: incrementar `VERSAO_REGRAS` (MAJOR muda o resultado para a mesma entrada; MINOR é função nova), registrar em `backend/CHANGELOG.md` com a observação “módulo de cálculo” e atualizar a seção 11.6.3 no mesmo PR.

## Quem consome

O backend (módulo de Cotação) chama estas funções ao montar, emitir e recalcular orçamentos. O frontend **não** calcula nada: recebe os valores e os bloqueios prontos (`docs/frontend-api.md`).
