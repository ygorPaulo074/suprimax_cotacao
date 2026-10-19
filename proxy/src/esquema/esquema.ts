import dicionario from './dicionario-de-dados.json';

// Estrutura do banco que o proxy aceita (tabelas, colunas, chaves). Nomes que não constam aqui
// são recusados: não há SQL bruto, e identificadores nunca vêm direto do payload (docs/12, 12.2).

export interface Relacao {
  /** Tabela que contém a FK. */
  tabelaFilha: string;
  colunaFilha: string;
  /** Tabela referenciada e a coluna usada na ligação. */
  tabelaPai: string;
  colunaPai: string;
}

export interface Esquema {
  tabelaExiste(tabela: string): boolean;
  colunas(tabela: string): string[];
  temColuna(tabela: string, coluna: string): boolean;
  chavePrimaria(tabela: string): string[];
  /** Ligações por FK entre duas tabelas, em qualquer direção. */
  relacoes(tabela: string, outra: string): Relacao[];
}

interface DadosEsquema {
  colunas: { tabela: string; coluna: string; pk: boolean }[];
  chaves_estrangeiras: {
    tabela: string;
    coluna: string;
    tabela_ref: string;
    coluna_ref: string;
  }[];
}

export function criarEsquema(dados: DadosEsquema): Esquema {
  const porTabela = new Map<string, string[]>();
  const pks = new Map<string, string[]>();
  for (const c of dados.colunas) {
    porTabela.set(c.tabela, [...(porTabela.get(c.tabela) ?? []), c.coluna]);
    if (c.pk) pks.set(c.tabela, [...(pks.get(c.tabela) ?? []), c.coluna]);
  }
  const fks: Relacao[] = dados.chaves_estrangeiras.map((f) => ({
    tabelaFilha: f.tabela,
    colunaFilha: f.coluna,
    tabelaPai: f.tabela_ref,
    colunaPai: f.coluna_ref,
  }));

  return {
    tabelaExiste: (t) => porTabela.has(t),
    colunas: (t) => porTabela.get(t) ?? [],
    temColuna: (t, c) => porTabela.get(t)?.includes(c) ?? false,
    chavePrimaria: (t) => pks.get(t) ?? [],
    relacoes: (t, outra) =>
      fks.filter(
        (f) =>
          (f.tabelaFilha === t && f.tabelaPai === outra) ||
          (f.tabelaFilha === outra && f.tabelaPai === t),
      ),
  };
}

/** Esquema do Sistema 2, a partir do dicionário de dados (npm run esquema:atualizar). */
export const esquemaDoDicionario: Esquema = criarEsquema(dicionario as DadosEsquema);

/** Colunas que nunca saem de dados.consultar sem o escopo `operador.credenciais:consultar`. */
export const COLUNAS_SENSIVEIS: Record<string, string[]> = {
  operador: ['senha_hash', 'token_recuperacao_senha', 'validade_token'],
};
export const ESCOPO_CREDENCIAIS = 'operador.credenciais:consultar';
