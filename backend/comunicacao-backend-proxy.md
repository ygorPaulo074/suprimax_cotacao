# Como o backend se comunica com o banco

O backend **nunca** acessa o Supabase nem o Postgres. Toda leitura e gravação passa pelo **proxy** (RNF05), por um único endpoint, `POST /executar`. Este guia mostra como o backend usa o proxy. A especificação do proxy está em [docs/12-proxy.md](../docs/12-proxy.md) e a implementação, em `proxy/` (veja também `proxy/README.md`).

```
Frontend ──► Backend S2 ──► Proxy ──► Postgres (Supabase)
             (regras)       (acesso)
```

## 1. Configuração

O backend precisa de três variáveis (`.env.example`):

| Variável              | Valor                                                                |
| --------------------- | -------------------------------------------------------------------- |
| `PROXY_URL`           | Endereço do proxy (ex.: `http://localhost:3001`, ou a URL do Render) |
| `PROXY_SERVICE_ID`    | O `service_id` do integrante do Sistema 2                            |
| `PROXY_SERVICE_TOKEN` | O token do integrante                                                |

O token **não** fica fixo no proxy: é emitido por quem administra o proxy (responsável pela infraestrutura), com a chave mestra, e mostrado uma única vez:

```bash
curl -X POST "$PROXY_URL/executar" \
  -H "Authorization: Bearer $PROXY_ADMIN_KEY" -H "X-Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -H "X-Operation-Id: setup" -H "Content-Type: application/json" \
  -d '{"operacao":"integrante.criar","payload":{"nome_sistema":"Sistema 2","escopos":["*:consultar","*:inserir","*:atualizar","operador.credenciais:consultar","operacao:pedido.assumir","operacao:orcamento.emitir","operacao:resposta.processar","rpc:*"]}}'
```

Resposta: `{ "ok": true, "dados": { "service_id": "...", "token": "...", "expira_em": "..." } }`. Guarde `service_id` e `token` nas variáveis de ambiente (Render/`.env`), nunca no código. Os escopos do Sistema 2 estão na seção 12.8.5. Exclusões (`*:excluir`) só devem ser concedidas nas tabelas previstas ali.

## 2. A requisição

Toda chamada é um `POST` com JSON `{ "operacao": "...", "payload": { ... } }` e estes cabeçalhos:

| Cabeçalho        | Valor                                                                      |
| ---------------- | -------------------------------------------------------------------------- |
| `Authorization`  | `Bearer <PROXY_SERVICE_TOKEN>`                                             |
| `X-Service-Id`   | `<PROXY_SERVICE_ID>`                                                       |
| `X-Timestamp`    | Horário atual (ISO 8601). Tolerância padrão: 60 s                          |
| `X-Operation-Id` | Identifica o processo, para a auditoria (ex.: `UC13-login`, `UC19-emitir`) |

**Gere um novo `X-Timestamp` a cada envio, inclusive em reenvios.** O proxy rejeita a mesma requisição (mesmo integrante, timestamp e corpo) repetida: é a proteção contra replay.

Resposta de sucesso: `{ "ok": true, ... }`. Erro: `{ "ok": false, "erro": { "codigo", "mensagem", "detalhes?" } }`.

## 3. Cliente único (camada de acesso a dados)

Só **um** módulo do backend fala com o proxy (item 2 de `backend/TAREFAS.md`). Os demais módulos usam os repositórios que ele expõe. Exemplo mínimo do cliente:

```ts
// backend/src/dados/clienteProxy.ts
export class ErroProxy extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: string,
    mensagem: string,
    public readonly detalhes?: Record<string, unknown>,
  ) {
    super(mensagem);
  }
}

export async function executar<T = Record<string, unknown>>(
  operacao: string,
  payload: Record<string, unknown>,
  operationId: string,
): Promise<T> {
  const resposta = await fetch(`${process.env.PROXY_URL}/executar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.PROXY_SERVICE_TOKEN}`,
      'X-Service-Id': process.env.PROXY_SERVICE_ID!,
      'X-Timestamp': new Date().toISOString(), // novo a cada chamada
      'X-Operation-Id': operationId,
    },
    body: JSON.stringify({ operacao, payload }),
  });
  const corpo = await resposta.json();
  if (!corpo.ok) {
    throw new ErroProxy(
      resposta.status,
      corpo.erro.codigo,
      corpo.erro.mensagem,
      corpo.erro.detalhes,
    );
  }
  return corpo as T;
}
```

## 4. Operações, com exemplos

### Consultar

```ts
const { dados, proximo_cursor } = await executar<{ dados: Linha[]; proximo_cursor: string | null }>(
  'dados.consultar',
  {
    tabela: 'pedido',
    filtros: {
      e: [
        ['status', '=', 'SOLICITADO'],
        ['id_cliente', 'em', [1, 2, 3]],
      ],
    },
    incluir: ['item_pedido'], // filhas vêm como lista (chave "item_pedido"); pais, como objeto
    ordenacao: [['data_solicitacao', 'desc']],
    limite: 50, // padrão 50, máximo 500
  },
  'UC10-listar-pedidos',
);
// Próxima página: repita com { cursor: proximo_cursor } até vir null.
```

- **Operadores de filtro:** `=`, `!=`, `>`, `>=`, `<`, `<=`, `em`, `contem` (busca parcial sem diferenciar maiúsculas), `nulo` e `nao_nulo`. Grupos: `{ e: [...] }` (AND) e `{ ou: [...] }` (OR), aninháveis até 5 níveis.
- **Agregações:** `agregacoes: [{ fn: 'soma', campo: 'valor_total_proposta', como: 'total' }]` com `agrupar: ['status']`; `fn` em `contar`, `soma`, `media`, `minimo`, `maximo`.
- Sem `campos`, vêm todas as colunas, **menos as sensíveis**. Para ler `senha_hash`, `token_recuperacao_senha` e `validade_token` (login e recuperação de senha), o integrante precisa do escopo `operador.credenciais:consultar` e pedir a coluna em `campos`.

### Inserir, atualizar e excluir

```ts
await executar(
  'dados.inserir',
  { tabela: 'cliente', valores: {/* colunas */}, retornar: ['id_cliente'] },
  'UC02-cadastrar',
);
await executar(
  'dados.atualizar',
  {
    tabela: 'orcamento',
    filtros: { e: [['id_orcamento', '=', 7]] },
    valores: { contato_solicitacao: 'Maria' },
  },
  'UC05-editar',
);
await executar(
  'dados.excluir',
  { tabela: 'item_orcamento', filtros: { e: [['id_item', '=', 3]] } },
  'UC05-remover-item',
);
```

Limites: `inserir` aceita até 100 linhas (todas com as mesmas colunas); `atualizar` e `excluir` **exigem filtro** e são bloqueados se afetarem **mais de 50 linhas** (`RISCO_ESTRUTURAL`); a chave primária não pode ser alterada. `atualizar` só devolve `dados` se `retornar` for informado.

### Várias gravações juntas: `dados.lote`

Use quando duas ou mais gravações precisam valer juntas (tudo ou nada). Um passo pode usar o resultado de outro com `"$passo.caminho"`:

```ts
await executar(
  'dados.lote',
  {
    passos: [
      {
        id: 'p1',
        operacao: 'dados.inserir',
        payload: { tabela: 'orcamento', valores: {/* ... */}, retornar: ['id_orcamento'] },
      },
      {
        id: 'p2',
        operacao: 'dados.inserir',
        payload: {
          tabela: 'item_orcamento',
          valores: { id_orcamento: '$p1.dados[0].id_orcamento' /* ... */ },
        },
      },
    ],
  },
  'UC01-montar',
);
```

Máximo de 20 passos, só `dados.consultar`, `dados.inserir`, `dados.atualizar` e `dados.excluir`. Os escopos de **todos** os passos são conferidos antes de executar.

### Operações nomeadas (transação e regra atômica)

| Operação             | Payload                                                                                                 | Quando usar                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pedido.assumir`     | `{ id_pedido, id_operador }`                                                                            | Operador seleciona o pedido. Só muda se ainda estiver SOLICITADO; senão, `PEDIDO_JA_ASSUMIDO` (409)                                                           |
| `orcamento.emitir`   | `{ id_orcamento, id_operador, chave_seguranca }`                                                        | Emissão (UC19). **O backend gera a chave de segurança** (mínimo de 16 caracteres, única). O proxy devolve `{ id_orcamento, numero_orcamento, data_validade }` |
| `resposta.processar` | `{ id_resposta, resultado: { status_resposta, motivo_tratamento?, itens, totais?, status_orcamento } }` | UC20, com os valores já calculados pelo módulo de cálculo (`recalcularOrcamentoAprovado`)                                                                     |

O número do orçamento, as reservas de estoque e a baixa no aceite acontecem **dentro do banco**, nessas operações. O backend não os calcula nem os grava à parte.

### Funções do banco: `dados.rpc`

`{ funcao: 'nome', argumentos: { nome_do_parametro: valor } }`, exigindo o escopo `rpc:nome`. Use só para funções que o responsável pelo banco publicar.

## 5. Tipos de dados: converta na fronteira

A camada de acesso a dados é o **único** lugar que converte formatos:

| No banco / proxy                                 | No backend                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| `DECIMAL(12,2)` chega como **texto** (`"12.34"`) | **Centavos inteiros** (`1234`). Converta sem usar ponto flutuante            |
| `BIGINT` (ex.: `numero_orcamento`)               | `number`                                                                     |
| Datas e timestamps                               | Texto ISO 8601 (`'AAAA-MM-DD'`)                                              |
| Colunas em `snake_case`                          | Objetos em `camelCase` (`preco_unitario_aplicado` ↔ `precoUnitarioAplicado`) |

```ts
// "12.34" -> 1234 ; "5" -> 500 ; "0.5" -> 50
export function decimalParaCentavos(texto: string): number {
  const [inteiro = '0', frac = ''] = texto.split('.');
  return Number(inteiro) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
}
// Ao gravar, envie o valor decimal em texto: (1234 / 100).toFixed(2) -> "12.34"
```

## 6. Erros e como tratá-los

| Código do proxy                                                       | HTTP | Significado                                                                                                          | O que o backend faz                                                                               |
| --------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `PAYLOAD_INVALIDO`                                                    | 400  | Payload fora do formato, tabela/coluna inexistente, ou **regra de integridade do banco violada** (CHECK, UNIQUE, FK) | Erro de programação (bug no backend) ou violação de regra: devolver erro de validação ao frontend |
| `TOKEN_INVALIDO`                                                      | 401  | Token ausente, expirado, revogado ou requisição repetida                                                             | Gerar novo `X-Timestamp`; se persistir, alertar a infra (token vencido)                           |
| `ESCOPO_NEGADO`                                                       | 403  | Falta o escopo                                                                                                       | Bug de configuração: pedir ao responsável pelo proxy                                              |
| `OPERACAO_DESCONHECIDA` / `NOT_FOUND`                                 | 404  | Operação ou registro inexistente                                                                                     | Conforme o caso                                                                                   |
| `PEDIDO_JA_ASSUMIDO`                                                  | 409  | Outro operador chegou antes                                                                                          | Repassar `409 PEDIDO_JA_ASSUMIDO` ao frontend                                                     |
| `ESTOQUE_INSUFICIENTE`                                                | 409  | Saldo menor que o pedido na emissão (`detalhes`: `produto`, `disponivel`, `quantidade`)                              | Responder `422` com a mensagem do UC19-E5 montada com os `detalhes`                               |
| `ORCAMENTO_NAO_EDITAVEL`, `CHAVE_DUPLICADA`, `RESPOSTA_JA_PROCESSADA` | 409  | Conflito de estado                                                                                                   | Recarregar o estado e informar                                                                    |
| `RISCO_ESTRUTURAL`                                                    | 422  | Atualização/exclusão sem filtro ou com mais de 50 linhas                                                             | Bug: ajustar o filtro                                                                             |
| `LIMITE_EXCEDIDO`                                                     | 429  | Muitas requisições                                                                                                   | Esperar e tentar de novo                                                                          |
| `INTERNAL_ERROR`                                                      | 500  | Falha interna                                                                                                        | Registrar e devolver erro genérico                                                                |

Mantenha o formato de erro do backend para o frontend (`{ codigo, mensagem, detalhes? }`, em `docs/frontend-api.md`). **Não repasse a mensagem do proxy ao frontend sem revisar**, e nunca exponha `detalhes` internos.

**Nova tentativa (retry):**

- Leituras (`dados.consultar`): pode repetir em falha de rede, `429` e `5xx`, com espera crescente.
- Gravações: **não repita às cegas.** Se a resposta se perdeu, a gravação pode ter acontecido. Leia o estado antes de tentar de novo. Em `pedido.assumir` e nas demais operações nomeadas, o próprio banco impede a duplicidade.

## 7. Boas práticas

- **Um módulo só** chama o proxy; os outros usam repositórios (`pedidos`, `orcamentos`, `clientes`…) que montam os payloads e convertem os tipos.
- **Transações:** use `dados.lote` ou as operações nomeadas; nunca duas chamadas separadas quando o resultado precisa ser atômico.
- **Regras comerciais ficam no módulo de cálculo**, não no payload. O banco tem `CHECK` redundantes (imposto, validade) que só impedem gravação divergente.
- **Não registre** token, senha nem o corpo das requisições em log.
- **Testes:** troque o `executar` por um dublê nos testes do backend; não dependa do proxy para rodar o Jest.
- **Schema muda?** Nomes de tabelas e colunas vêm do dicionário de dados (`docs/banco-de-dados/`). Mudança de schema exige aprovação dos três sistemas e atualização do proxy (`npm run esquema:atualizar`).

## 8. Limites do proxy

| Item                                      | Limite                                           |
| ----------------------------------------- | ------------------------------------------------ |
| Linhas por consulta                       | 50 por padrão, máximo 500 (paginar por `cursor`) |
| Linhas por `inserir`                      | 100                                              |
| Passos por `lote`                         | 20                                               |
| Linhas afetadas por `atualizar`/`excluir` | 50                                               |
| Aninhamento de filtros                    | 5 níveis, 50 condições                           |
| Tamanho do corpo                          | 1 MB                                             |
| Requisições                               | 300 por minuto por IP (configurável)             |
