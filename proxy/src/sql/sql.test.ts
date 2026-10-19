import { AppError } from '../erros';
import { esquemaDoDicionario as esquema } from '../esquema/esquema';
import { SEM_CREDENCIAIS } from './base';
import { codificarCursor, montarConsulta, montarContagem } from './consultar';
import { montarDelete, montarInsert, montarUpdate } from './escrita';

const COM_CREDENCIAIS = { credenciais: true };

function codigo(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.codigo : 'OUTRO';
  }
  return 'OK';
}

describe('dados.consultar', () => {
  it('seleciona as colunas visíveis, ordena pela chave primária e pagina', () => {
    const { consulta, limite, offset } = montarConsulta(
      esquema,
      { tabela: 'pedido' },
      SEM_CREDENCIAIS,
    );
    expect(consulta.texto).toMatch(/^SELECT t\."id_pedido", /);
    expect(consulta.texto).toContain('FROM "pedido" t');
    expect(consulta.texto).toContain('ORDER BY "id_pedido" ASC');
    expect(consulta.texto).toMatch(/LIMIT \$1 OFFSET \$2$/);
    expect(consulta.valores).toEqual([51, 0]);
    expect([limite, offset]).toEqual([50, 0]);
  });

  it('nunca devolve colunas sensíveis por padrão', () => {
    const { consulta } = montarConsulta(esquema, { tabela: 'operador' }, SEM_CREDENCIAIS);
    expect(consulta.texto).not.toContain('senha_hash');
    expect(consulta.texto).not.toContain('token_recuperacao_senha');
    expect(consulta.texto).toContain('"usuario"');
  });

  it('só devolve credenciais com a permissão', () => {
    const { consulta } = montarConsulta(esquema, { tabela: 'operador' }, COM_CREDENCIAIS);
    expect(consulta.texto).toContain('"senha_hash"');
  });

  it('bloqueia pedir, filtrar ou ordenar por coluna sensível sem permissão', () => {
    expect(
      codigo(() =>
        montarConsulta(esquema, { tabela: 'operador', campos: ['senha_hash'] }, SEM_CREDENCIAIS),
      ),
    ).toBe('ESCOPO_NEGADO');
    expect(
      codigo(() =>
        montarConsulta(
          esquema,
          { tabela: 'operador', filtros: { e: [['senha_hash', '=', 'x']] } },
          SEM_CREDENCIAIS,
        ),
      ),
    ).toBe('ESCOPO_NEGADO');
    expect(
      codigo(() =>
        montarConsulta(
          esquema,
          { tabela: 'operador', ordenacao: [['senha_hash', 'asc']] },
          SEM_CREDENCIAIS,
        ),
      ),
    ).toBe('ESCOPO_NEGADO');
  });

  it('valores vão como parâmetros e nunca no texto (injeção)', () => {
    const { consulta } = montarConsulta(
      esquema,
      { tabela: 'cliente', filtros: { e: [['razao_social', '=', "x'; DROP TABLE cliente; --"]] } },
      SEM_CREDENCIAIS,
    );
    expect(consulta.texto).not.toContain('DROP');
    expect(consulta.valores).toContain("x'; DROP TABLE cliente; --");
  });

  it('recusa tabela, coluna e operador inexistentes', () => {
    expect(
      codigo(() => montarConsulta(esquema, { tabela: 'x"; DROP TABLE y; --' }, SEM_CREDENCIAIS)),
    ).toBe('PAYLOAD_INVALIDO');
    expect(
      codigo(() =>
        montarConsulta(esquema, { tabela: 'pedido', campos: ['id_pedido"; --'] }, SEM_CREDENCIAIS),
      ),
    ).toBe('PAYLOAD_INVALIDO');
    expect(
      codigo(() =>
        montarConsulta(
          esquema,
          { tabela: 'pedido', filtros: { e: [['status', 'parecido', 'x']] } },
          SEM_CREDENCIAIS,
        ),
      ),
    ).toBe('PAYLOAD_INVALIDO');
  });

  it('filtros: e, ou, em, contem, nulo e nao_nulo', () => {
    const { consulta } = montarConsulta(
      esquema,
      {
        tabela: 'pedido',
        filtros: {
          e: [
            ['status', 'em', ['SOLICITADO', 'EM_ANALISE']],
            {
              ou: [
                ['id_cliente', '=', 7],
                ['observacoes', 'contem', '50%_off'],
              ],
            },
            ['data_decisao', 'nulo'],
            ['id_endereco_entrega', 'nao_nulo'],
            ['id_operador_atendimento', '!=', null],
          ],
        },
      },
      SEM_CREDENCIAIS,
    );
    expect(consulta.texto).toContain('t."status" = ANY($1)');
    expect(consulta.texto).toContain('(t."id_cliente" = $2 OR t."observacoes" ILIKE $3)');
    expect(consulta.texto).toContain('t."data_decisao" IS NULL');
    expect(consulta.texto).toContain('t."id_endereco_entrega" IS NOT NULL');
    expect(consulta.texto).toContain('t."id_operador_atendimento" IS NOT NULL');
    expect(consulta.valores.slice(0, 3)).toEqual([
      ['SOLICITADO', 'EM_ANALISE'],
      7,
      '%50\\%\\_off%',
    ]);
  });

  it('limite: padrão 50, máximo 500, e cursor', () => {
    expect(
      codigo(() => montarConsulta(esquema, { tabela: 'pedido', limite: 501 }, SEM_CREDENCIAIS)),
    ).toBe('PAYLOAD_INVALIDO');
    expect(
      codigo(() => montarConsulta(esquema, { tabela: 'pedido', limite: 0 }, SEM_CREDENCIAIS)),
    ).toBe('PAYLOAD_INVALIDO');
    const { consulta, offset } = montarConsulta(
      esquema,
      { tabela: 'pedido', limite: 10, cursor: codificarCursor(20) },
      SEM_CREDENCIAIS,
    );
    expect(consulta.valores).toEqual([11, 20]);
    expect(offset).toBe(20);
    expect(
      codigo(() => montarConsulta(esquema, { tabela: 'pedido', cursor: 'lixo' }, SEM_CREDENCIAIS)),
    ).toBe('PAYLOAD_INVALIDO');
  });

  it('incluir devolve filhas como lista e pai como objeto, sem colunas sensíveis', () => {
    const filhas = montarConsulta(
      esquema,
      { tabela: 'pedido', incluir: ['item_pedido'] },
      SEM_CREDENCIAIS,
    ).consulta.texto;
    expect(filhas).toContain('COALESCE((SELECT json_agg(row_to_json(x))');
    expect(filhas).toContain('i."id_pedido" = t."id_pedido"');
    const pai = montarConsulta(
      esquema,
      { tabela: 'item_pedido', incluir: ['pedido'] },
      SEM_CREDENCIAIS,
    ).consulta.texto;
    expect(pai).toContain('(SELECT row_to_json(x)');
    const operadores = montarConsulta(
      esquema,
      { tabela: 'cliente', incluir: ['operador'] },
      SEM_CREDENCIAIS,
    ).consulta.texto;
    expect(operadores).not.toContain('senha_hash');
    expect(
      codigo(() =>
        montarConsulta(esquema, { tabela: 'pedido', incluir: ['fardo'] }, SEM_CREDENCIAIS),
      ),
    ).toBe('PAYLOAD_INVALIDO');
    expect(
      codigo(() =>
        montarConsulta(esquema, { tabela: 'pedido', incluir: ['pedido'] }, SEM_CREDENCIAIS),
      ),
    ).toBe('PAYLOAD_INVALIDO');
  });

  it('agregações com agrupar', () => {
    const { consulta } = montarConsulta(
      esquema,
      {
        tabela: 'orcamento',
        agrupar: ['status'],
        agregacoes: [
          { fn: 'contar', campo: '*', como: 'qtd' },
          { fn: 'soma', campo: 'valor_total_proposta', como: 'total' },
        ],
        ordenacao: [['total', 'desc']],
      },
      SEM_CREDENCIAIS,
    );
    expect(consulta.texto).toContain(
      'SELECT t."status", COUNT(*) AS "qtd", SUM(t."valor_total_proposta") AS "total"',
    );
    expect(consulta.texto).toContain('GROUP BY t."status"');
    expect(consulta.texto).toContain('ORDER BY "total" DESC');
    expect(
      codigo(() =>
        montarConsulta(esquema, { tabela: 'orcamento', agrupar: ['status'] }, SEM_CREDENCIAIS),
      ),
    ).toBe('PAYLOAD_INVALIDO');
    expect(
      codigo(() =>
        montarConsulta(
          esquema,
          { tabela: 'orcamento', agregacoes: [{ fn: 'soma', campo: 'status', como: 'x"; --' }] },
          SEM_CREDENCIAIS,
        ),
      ),
    ).toBe('PAYLOAD_INVALIDO');
  });

  it('limita a complexidade do filtro', () => {
    let f: unknown = { e: [['id_pedido', '=', 1]] };
    for (let i = 0; i < 6; i++) f = { e: [f] };
    expect(
      codigo(() =>
        montarConsulta(esquema, { tabela: 'pedido', filtros: f as never }, SEM_CREDENCIAIS),
      ),
    ).toBe('PAYLOAD_INVALIDO');
    expect(
      codigo(() =>
        montarConsulta(esquema, { tabela: 'pedido', filtros: { e: [] } }, SEM_CREDENCIAIS),
      ),
    ).toBe('PAYLOAD_INVALIDO');
    expect(
      codigo(() =>
        montarConsulta(
          esquema,
          { tabela: 'pedido', filtros: { e: [], ou: [] } as never },
          SEM_CREDENCIAIS,
        ),
      ),
    ).toBe('PAYLOAD_INVALIDO');
  });
});

describe('dados.inserir', () => {
  it('uma linha, com retorno padrão sem colunas sensíveis', () => {
    const c = montarInsert(esquema, {
      tabela: 'pedido',
      valores: { id_cliente: 1, id_operador_vendedor: 2 },
    });
    expect(c.texto).toMatch(
      /^INSERT INTO "pedido" \("id_cliente", "id_operador_vendedor"\) VALUES \(\$1, \$2\) RETURNING /,
    );
    expect(c.valores).toEqual([1, 2]);
    const op = montarInsert(esquema, { tabela: 'operador', valores: { usuario: 'a' } });
    expect(op.texto).not.toMatch(/RETURNING.*senha_hash/);
  });

  it('várias linhas devem ter as mesmas colunas', () => {
    const c = montarInsert(esquema, {
      tabela: 'item_pedido',
      valores: [
        { id_pedido: 1, quantidade_solicitada: 2 },
        { quantidade_solicitada: 3, id_pedido: 1 },
      ],
    });
    expect(c.valores).toEqual([1, 2, 1, 3]);
    expect(
      codigo(() =>
        montarInsert(esquema, {
          tabela: 'item_pedido',
          valores: [{ id_pedido: 1 }, { id_pedido: 1, quantidade_solicitada: 1 }],
        }),
      ),
    ).toBe('PAYLOAD_INVALIDO');
  });

  it('recusa coluna inexistente, vazio e retorno sensível', () => {
    expect(
      codigo(() => montarInsert(esquema, { tabela: 'pedido', valores: { naoexiste: 1 } })),
    ).toBe('PAYLOAD_INVALIDO');
    expect(codigo(() => montarInsert(esquema, { tabela: 'pedido', valores: {} }))).toBe(
      'PAYLOAD_INVALIDO',
    );
    expect(
      codigo(() =>
        montarInsert(esquema, {
          tabela: 'operador',
          valores: { usuario: 'a' },
          retornar: ['senha_hash'],
        }),
      ),
    ).toBe('ESCOPO_NEGADO');
  });
});

describe('dados.atualizar e dados.excluir', () => {
  it('atualiza com filtro parametrizado', () => {
    const c = montarUpdate(esquema, {
      tabela: 'pedido',
      filtros: { e: [['id_pedido', '=', 9]] },
      valores: { status: 'NEGADO', motivo_negativa: 'Sem estoque' },
      retornar: ['status'],
    });
    expect(c.texto).toBe(
      'UPDATE "pedido" t SET "status" = $1, "motivo_negativa" = $2 WHERE (t."id_pedido" = $3) RETURNING "status"',
    );
    expect(c.valores).toEqual(['NEGADO', 'Sem estoque', 9]);
  });

  it('não permite alterar a chave primária (risco estrutural)', () => {
    expect(
      codigo(() =>
        montarUpdate(esquema, {
          tabela: 'pedido',
          filtros: { e: [['id_pedido', '=', 9]] },
          valores: { id_pedido: 10 },
        }),
      ),
    ).toBe('RISCO_ESTRUTURAL');
  });

  it('exclui com filtro', () => {
    const c = montarDelete(esquema, {
      tabela: 'anexo_orcamento',
      filtros: { e: [['id_anexo', '=', 3]] },
    });
    expect(c.texto).toBe('DELETE FROM "anexo_orcamento" t WHERE (t."id_anexo" = $1)');
  });

  it('monta a contagem usada na verificação de risco', () => {
    const c = montarContagem(
      esquema,
      'item_orcamento',
      { e: [['id_orcamento', '=', 5]] },
      SEM_CREDENCIAIS,
    );
    expect(c.texto).toBe(
      'SELECT COUNT(*)::int AS total FROM "item_orcamento" t WHERE (t."id_orcamento" = $1)',
    );
  });
});
