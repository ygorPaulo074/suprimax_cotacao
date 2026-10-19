import { AppError } from '../erros';
import type { Esquema } from '../esquema/esquema';
import type { Consulta } from '../banco/executor';
import {
  aspas,
  colunasVisiveis,
  Parametros,
  validarColuna,
  validarTabela,
  SEM_CREDENCIAIS,
} from './base';
import { construirWhere, type Filtro } from './filtros';

// dados.inserir, dados.atualizar e dados.excluir (docs/12, seção 12.8.2).

export type Valores = Record<string, unknown>;

const LINHAS_MAXIMAS_POR_INSERT = 100;
const invalido = (motivo: string) => new AppError('PAYLOAD_INVALIDO', undefined, motivo);

function ehValor(v: unknown): boolean {
  return v === null || ['string', 'number', 'boolean', 'object'].includes(typeof v);
}

/** Colunas devolvidas após gravar: as pedidas ou todas as visíveis (nunca as sensíveis). */
function retorno(esquema: Esquema, tabela: string, retornar?: string[]): string {
  const colunas = retornar?.length
    ? retornar.map((c) => validarColuna(esquema, tabela, c, SEM_CREDENCIAIS))
    : colunasVisiveis(esquema, tabela, SEM_CREDENCIAIS);
  return colunas.map(aspas).join(', ');
}

function colunasEscrita(esquema: Esquema, tabela: string, chaves: string[]): string[] {
  if (chaves.length === 0) throw invalido('valores vazios');
  // Escrever em coluna sensível (ex.: senha_hash) é permitido a quem tem o escopo da tabela:
  // só a leitura é restrita. Aqui basta a coluna existir.
  return chaves.map((c) => {
    if (!esquema.temColuna(tabela, c)) throw invalido(`coluna inexistente: ${tabela}.${c}`);
    return c;
  });
}

export function montarInsert(
  esquema: Esquema,
  p: { tabela: string; valores: Valores | Valores[]; retornar?: string[] },
): Consulta {
  const tabela = validarTabela(esquema, p.tabela);
  const linhas = Array.isArray(p.valores) ? p.valores : [p.valores];
  if (linhas.length === 0 || linhas.length > LINHAS_MAXIMAS_POR_INSERT) {
    throw invalido(`inserir aceita de 1 a ${LINHAS_MAXIMAS_POR_INSERT} linhas`);
  }
  const primeira = linhas[0] as Valores;
  const colunas = colunasEscrita(esquema, tabela, Object.keys(primeira)).sort();
  const params = new Parametros();
  const tuplas = linhas.map((linha) => {
    const chaves = Object.keys(linha).sort();
    if (chaves.length !== colunas.length || chaves.some((c, i) => c !== colunas[i])) {
      throw invalido('todas as linhas devem ter as mesmas colunas');
    }
    return `(${colunas
      .map((c) => {
        const v = linha[c];
        if (!ehValor(v)) throw invalido(`valor inválido em ${c}`);
        return params.adicionar(v);
      })
      .join(', ')})`;
  });
  return {
    texto:
      `INSERT INTO ${aspas(tabela)} (${colunas.map(aspas).join(', ')}) VALUES ${tuplas.join(', ')} ` +
      `RETURNING ${retorno(esquema, tabela, p.retornar)}`,
    valores: params.valores,
  };
}

export function montarUpdate(
  esquema: Esquema,
  p: { tabela: string; filtros: Filtro; valores: Valores; retornar?: string[] },
): Consulta {
  const tabela = validarTabela(esquema, p.tabela);
  const colunas = colunasEscrita(esquema, tabela, Object.keys(p.valores));
  const pk = esquema.chavePrimaria(tabela);
  if (colunas.some((c) => pk.includes(c))) {
    // Trocar a chave primária rompe as ligações com outras tabelas (risco estrutural, 12.1).
    throw new AppError('RISCO_ESTRUTURAL', undefined, `alteração de chave primária em ${tabela}`);
  }
  const params = new Parametros();
  const sets = colunas.map((c) => {
    const v = p.valores[c];
    if (!ehValor(v)) throw invalido(`valor inválido em ${c}`);
    return `${aspas(c)} = ${params.adicionar(v)}`;
  });
  const where = construirWhere(p.filtros, tabela, 't', esquema, params, SEM_CREDENCIAIS);
  return {
    texto:
      `UPDATE ${aspas(tabela)} t SET ${sets.join(', ')} WHERE ${where} ` +
      (p.retornar?.length ? `RETURNING ${retorno(esquema, tabela, p.retornar)}` : ''),
    valores: params.valores,
  };
}

export function montarDelete(esquema: Esquema, p: { tabela: string; filtros: Filtro }): Consulta {
  const tabela = validarTabela(esquema, p.tabela);
  const params = new Parametros();
  const where = construirWhere(p.filtros, tabela, 't', esquema, params, SEM_CREDENCIAIS);
  return { texto: `DELETE FROM ${aspas(tabela)} t WHERE ${where}`, valores: params.valores };
}
