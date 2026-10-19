# Backend — orientações

**Responsável:** backend (inclui o módulo de cálculo, que tem revisor próprio no CODEOWNERS). **Pasta:** `backend/`. Node.js + TypeScript; hospedado no Render. Fala com o banco **somente pelo proxy**.

## Leia antes de começar

- `docs/11-backend-e-modulo-de-calculo.md`: regras do backend (11.3), componentes (11.4) e **módulo de cálculo (11.6)**.
- `docs/04-regras-de-negocio.md` (regras, status e transições) e `docs/05-casos-de-uso.md` (UC01 a UC25).
- `docs/frontend-api.md`: **as rotas REST que o frontend já espera**. Se mudar algo, atualize esse documento e `frontend/src/api/`.
- `docs/12-proxy.md` (como o backend chama o banco).

As tarefas do módulo de cálculo estão em [`services/calculo/TAREFAS.md`](services/calculo/TAREFAS.md).

## Já existe

`services/calculo/` com `calcularImpostoItem`, erros, constantes de regra (`regras.ts`) e testes. Use-o como modelo para as demais funções.

## Entregas, em ordem

- [ ] **1. Servidor base:** Express, configuração por variáveis de ambiente, `GET /saude`, tratamento de erros padronizado (`{ codigo, mensagem, detalhes? }`).
- [ ] **2. Camada de acesso a dados:** cliente do proxy (`POST /executar` com os cabeçalhos do 12.3). Nenhum outro módulo acessa o banco.
- [ ] **3. Autenticação (UC13):** login, token de sessão, expiração por inatividade, bloqueio após 3 tentativas, recuperação de senha por e-mail (Resend), perfis e carteira do vendedor.
- [ ] **4. Módulo de cálculo completo (11.6.3.1 a 11.6.3.6):** faturamento e crédito, frete, estoque, número e validade do orçamento e fechamento por item. Funções puras, em centavos, **cada uma com tabela de casos no Jest**. Atualize `VERSAO_REGRAS` e o `CHANGELOG.md` a cada mudança de regra.
- [ ] **5. Cadastros:** clientes (UC02/UC03, LGPD), produtos com variações, faixas e fardos (UC04), fornecedores (UC22) e usuários (UC25).
- [ ] **6. Pedidos e orçamento:** fila de pedidos e análise (UC10), montagem do rascunho com validação de estoque e recálculo a cada mudança (UC14 a UC18), emissão com chave de segurança, número e PDF (UC19, PDFKit ou pdfmake), cancelamento (UC06) e histórico.
- [ ] **7. Respostas do cliente:** processar respostas pendentes (UC20), tratar e emitir nova versão (UC21).
- [ ] **8. Demais módulos:** análise de crédito (UC07), dívidas (UC23), estoque e entrada de mercadoria (UC04/UC24), e dados agregados para o Sistema 3 (RF17).
- [ ] **9. Jobs agendados:** expirações e avisos (seção 11.4), combinados com o responsável pelo banco.
- [ ] **10. Integração com o frontend:** implementar as rotas de `docs/frontend-api.md` e validar fluxo a fluxo com as telas.

## Definição de pronto de cada item

Testes Jest passando, lint e tipos limpos, PR citando o UC, entrada no `CHANGELOG.md` e `docs/frontend-api.md` atualizado quando a rota mudar.

## Regras que não se negociam

Dinheiro em centavos inteiros; imposto de 18% arredondado **uma vez por linha**; limites inclusivos; orçamento emitido é imutável (mudança = nova versão); o módulo de cálculo não acessa banco, relógio nem rede.

## Dependências

Precisa do schema (banco) e dos itens 3 a 5 do proxy para a camada de dados. Os itens 1, 3 (sem banco) e 4 podem começar já.
