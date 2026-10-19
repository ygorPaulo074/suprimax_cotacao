import { AppError } from '../erros';
import type { Esquema } from '../esquema/esquema';
import type { Consulta } from '../banco/executor';
import {
  aspas,
  colunasVisiveis,
  Parametros,
  validarColuna,
  validarIdentificador,
  validarTabela,
  type PermissaoLeitura,
} from './base';
import { construirWhere, filtroVazio, type Filtro } from './filtros';

// dados.consultar (docs/12, seção 12.8.2).

export const LIMITE_PADRAO = 50;
export const LIMITE_MAXIMO = 500;

const FUNCOES = {
  contar: 'COUNT',
  soma: 'SUM',
  media: 'AVG',
  minimo: 'MIN',
  maximo: 'MAX',
} as const;
type Funcao = keyof typeof FUNCOES;

export interface Agregacao {
  fn: Funcao;
  campo: string;
  como: string;
}

export interface ParamsConsultar {
  tabela: string;
  campos?: string[];
  filtros?: Filtro;
  incluir?: string[];
  agrupar?: string[];
  agregacoes?: Agregacao[];
  ordenacao?: [string, 'asc' | 'desc'][];
  limite?: number;
  cursor?: string;
}

export interface ConsultaMontada {
  consulta: Consulta;
  limite: number;
  offset: number;
}

const invalido = (motivo: string) => new AppError('PAYLOAD_INVALIDO', undefined, motivo);

export function codificarCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

export function decodificarCursor(cursor: string): number {
  try {
    const { o } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o: unknown };
    if (Number.isInteger(o) && (o as number) >= 0) return o as number;
  } catch {
    /* cai no erro abaixo */
  }
  throw invalido('cursor inválido');
}

/** Tabelas relacionadas por FK, devolvidas aninhadas (`incluir`). */
function subconsultaIncluir(
  esquema: Esquema,
  base: string,
  relacionada: string,
  permissao: PermissaoLeitura,
): string {
  validarTabela(esquema, relacionada);
  if (relacionada === base) throw invalido('incluir não aceita a própria tabela');
  const [relacao] = esquema.relacoes(base, relacionada);
  if (!relacao) throw invalido(`sem relação entre ${base} e ${relacionada}`);
  const colunas = colunasVisiveis(esquema, relacionada, permissao)
    .map((c) => `i.${aspas(c)}`)
    .join(', ');
  const ehFilha = relacao.tabelaFilha === relacionada;
  if (ehFilha) {
    return (
      `COALESCE((SELECT json_agg(row_to_json(x)) FROM (SELECT ${colunas} FROM ${aspas(relacionada)} i ` +
      `WHERE i.${aspas(relacao.colunaFilha)} = t.${aspas(relacao.colunaPai)}) x), '[]'::json) AS ${aspas(relacionada)}`
    );
  }
  return (
    `(SELECT row_to_json(x) FROM (SELECT ${colunas} FROM ${aspas(relacionada)} i ` +
    `WHERE i.${aspas(relacao.colunaPai)} = t.${aspas(relacao.colunaFilha)} LIMIT 1) x) AS ${aspas(relacionada)}`
  );
}

export function montarConsulta(
  esquema: Esquema,
  p: ParamsConsultar,
  permissao: PermissaoLeitura,
): ConsultaMontada {
  const tabela = validarTabela(esquema, p.tabela);
  const params = new Parametros();
  const col = (c: unknown) => validarColuna(esquema, tabela, c, permissao);

  const limite = p.limite ?? LIMITE_PADRAO;
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) {
    throw invalido(`limite deve ser de 1 a ${LIMITE_MAXIMO}`);
  }
  const offset = p.cursor === undefined ? 0 : decodificarCursor(p.cursor);

  const agregando = (p.agregacoes?.length ?? 0) > 0;
  if (!agregando && (p.agrupar?.length ?? 0) > 0) throw invalido('agrupar exige agregacoes');
  if (agregando && (p.incluir?.length ?? 0) > 0)
    throw invalido('incluir não combina com agregacoes');

  let selecao: string[];
  const ordenaveis = new Set<string>();
  if (agregando) {
    const grupos = (p.agrupar ?? []).map((c) => col(c));
    const aliases = new Set<string>();
    const aggs = (p.agregacoes ?? []).map((a) => {
      if (!(a.fn in FUNCOES)) throw invalido(`função desconhecida: ${String(a.fn)}`);
      const como = validarIdentificador(a.como, 'alias');
      if (aliases.has(como) || grupos.includes(como)) throw invalido(`alias repetido: ${como}`);
      aliases.add(como);
      const alvo = a.fn === 'contar' && a.campo === '*' ? '*' : `t.${aspas(col(a.campo))}`;
      return `${FUNCOES[a.fn]}(${alvo}) AS ${aspas(como)}`;
    });
    selecao = [...grupos.map((g) => `t.${aspas(g)}`), ...aggs];
    [...grupos, ...aliases].forEach((n) => ordenaveis.add(n));
  } else {
    const campos = p.campos?.length
      ? p.campos.map((c) => col(c))
      : colunasVisiveis(esquema, tabela, permissao);
    selecao = campos.map((c) => `t.${aspas(c)}`);
    esquema.colunas(tabela).forEach((c) => ordenaveis.add(c));
    for (const rel of p.incluir ?? [])
      selecao.push(subconsultaIncluir(esquema, tabela, rel, permissao));
  }

  let sql = `SELECT ${selecao.join(', ')} FROM ${aspas(tabela)} t`;
  if (p.filtros !== undefined) {
    sql += ` WHERE ${construirWhere(p.filtros, tabela, 't', esquema, params, permissao)}`;
  }
  if (agregando && (p.agrupar?.length ?? 0) > 0) {
    sql += ` GROUP BY ${(p.agrupar ?? []).map((g) => `t.${aspas(col(g))}`).join(', ')}`;
  }

  // Ordem estável: a paginação por cursor depende dela. Sem ordenação pedida, usa a chave primária.
  const ordem = p.ordenacao?.length
    ? p.ordenacao.map(([campo, direcao]) => {
        if (!ordenaveis.has(campo)) throw invalido(`ordenação inválida: ${String(campo)}`);
        if (!agregando) col(campo);
        if (direcao !== 'asc' && direcao !== 'desc') throw invalido('direção deve ser asc ou desc');
        return `${aspas(campo)} ${direcao.toUpperCase()}`;
      })
    : agregando
      ? []
      : esquema.chavePrimaria(tabela).map((c) => `${aspas(c)} ASC`);
  if (ordem.length > 0) sql += ` ORDER BY ${ordem.join(', ')}`;

  // Uma linha a mais que o limite: sabe-se se há próxima página sem outra consulta.
  sql += ` LIMIT ${params.adicionar(limite + 1)} OFFSET ${params.adicionar(offset)}`;
  return { consulta: { texto: sql, valores: params.valores }, limite, offset };
}

/** SELECT COUNT(*) com o mesmo filtro, usado na verificação de risco de atualizar/excluir. */
export function montarContagem(
  esquema: Esquema,
  tabela: string,
  filtros: Filtro,
  permissao: PermissaoLeitura,
): Consulta {
  validarTabela(esquema, tabela);
  const params = new Parametros();
  const where = construirWhere(filtros, tabela, 't', esquema, params, permissao);
  return {
    texto: `SELECT COUNT(*)::int AS total FROM ${aspas(tabela)} t WHERE ${where}`,
    valores: params.valores,
  };
}

export { filtroVazio };
