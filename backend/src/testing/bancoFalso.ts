// Banco em memória para os testes dos módulos que leem e gravam dados. Interpreta as operações
// `dados.*` do proxy (docs/12, seção 12.8.2) sobre as tabelas do dicionário de dados e aplica as
// mesmas restrições que o proxy e o banco real: colunas existentes, NOT NULL, UNIQUE, chave
// estrangeira, verificação de risco e transação em `dados.lote`.
//
// As regras implementadas por gatilho (docs/13, seção 13.4) não são simuladas aqui.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  centavosParaDecimal,
  converterChavesParaCamelCase,
  decimalParaCentavos,
} from '../dados/conversao';
import { ErroProxy } from '../dados/proxyCliente';
import { traduzirErroDeProxy } from '../dados/traducaoDeErros';
import type { ChamadaAoProxy, ProxyClienteFalso } from './proxyClienteFalso';

/** Linha de uma tabela, com as colunas em snake_case. */
export type Linha = Record<string, unknown>;

interface ColunaDoDicionario {
  readonly tabela: string;
  readonly coluna: string;
  readonly tipo: string;
  readonly pk: boolean;
  readonly uk: boolean;
  readonly nullable: boolean;
}

interface ChaveEstrangeira {
  readonly tabela: string;
  readonly coluna: string;
  readonly tabela_ref: string;
  readonly coluna_ref: string;
}

interface Dicionario {
  readonly colunas: readonly ColunaDoDicionario[];
  readonly chaves_estrangeiras: readonly ChaveEstrangeira[];
}

type Padrao = unknown | ((agora: Date) => unknown);

const CAMINHO_DO_DICIONARIO = path.resolve(
  __dirname,
  '../../../docs/banco-de-dados/dicionario-de-dados.json',
);

const momentoAtual: Padrao = (agora: Date) => agora.toISOString();

/** Valores padrão das colunas (docs/13, seção 13.7), que o dicionário só descreve em texto. */
const VALORES_PADRAO: Readonly<Record<string, Readonly<Record<string, Padrao>>>> = {
  operador: { status: 'ATIVO', tentativas_login_invalidas: 0, data_cadastro: momentoAtual },
  cliente: { status: 'ATIVO', data_cadastro: momentoAtual },
  produto: { ativo: true },
  variacao_produto: { quantidade_estoque: 0 },
  fornecedor: { data_cadastro: momentoAtual },
  divida_inadimplencia: { status: 'EM_ABERTO' },
  pedido: { status: 'SOLICITADO', data_solicitacao: momentoAtual },
  orcamento: {
    status: 'RASCUNHO',
    data_criacao: momentoAtual,
    data_ultima_edicao: momentoAtual,
    primeira_compra: false,
    frete_provisorio: true,
  },
  historico_orcamento: { data_registro: momentoAtual },
  anexo_orcamento: { data_anexo: momentoAtual },
  reserva_estoque: { status: 'CONFIRMADA' },
};

const OPERACOES = {
  CONSULTAR: 'dados.consultar',
  INSERIR: 'dados.inserir',
  ATUALIZAR: 'dados.atualizar',
  EXCLUIR: 'dados.excluir',
  LOTE: 'dados.lote',
  ASSUMIR_PEDIDO: 'pedido.assumir',
  EMITIR_ORCAMENTO: 'orcamento.emitir',
} as const;

/** Status do pedido que `pedido.assumir` exige para passar a EM_ANALISE (UC10). */
const STATUS_PEDIDO_SOLICITADO = 'SOLICITADO';
const STATUS_PEDIDO_EM_ANALISE = 'EM_ANALISE';
const STATUS_PEDIDO_APROVADO = 'APROVADO';

/** Status do orçamento que `orcamento.emitir` aceita (RASCUNHO ou reenviado após alteração). */
const STATUS_ORCAMENTO_EDITAVEIS_PARA_EMISSAO: ReadonlySet<string> = new Set([
  'RASCUNHO',
  'PENDENTE_CREDITO',
  'ALTERACAO_SOLICITADA',
]);
const STATUS_ORCAMENTO_ABERTO = 'ABERTO';
const STATUS_RESERVA_VIGENTE = 'CONFIRMADA';
const DIAS_DE_VALIDADE_DO_ORCAMENTO = 30;
const MILISSEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

const OPERACOES_PERMITIDAS_NO_LOTE: ReadonlySet<string> = new Set([
  OPERACOES.CONSULTAR,
  OPERACOES.INSERIR,
  OPERACOES.ATUALIZAR,
  OPERACOES.EXCLUIR,
]);

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 500;
const MAXIMO_DE_LINHAS_POR_INSERCAO = 100;
const MAXIMO_DE_LINHAS_POR_ALTERACAO = 50;
const MAXIMO_DE_VALORES_NO_EM = 100;
const MAXIMO_DE_PASSOS = 20;
const PADRAO_DE_IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/;
const PADRAO_DE_REFERENCIA = /^\$([a-z_][a-z0-9_]*)\.(.+)$/;
const PADRAO_DE_PARTE_DO_CAMINHO = /[^.[\]]+/g;
const TIPO_DECIMAL = 'DECIMAL';
const CODIFICACAO_DO_CURSOR = 'base64url';

const COMPARACOES: Readonly<Record<string, (a: never, b: never) => boolean>> = {
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
};

function payloadInvalido(motivo: string): ErroProxy {
  return new ErroProxy(400, 'PAYLOAD_INVALIDO', motivo);
}

function riscoEstrutural(motivo: string): ErroProxy {
  return new ErroProxy(422, 'RISCO_ESTRUTURAL', motivo);
}

/** Violação de restrição do banco: o proxy real a devolve como erro interno, sem detalhe. */
function erroDoBanco(motivo: string): ErroProxy {
  return new ErroProxy(500, 'INTERNAL_ERROR', motivo);
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

export interface OpcoesDoBancoFalso {
  /** Relógio dos valores padrão de data; por padrão, a hora do sistema. */
  readonly agora?: () => Date;
}

/**
 * Banco em memória com as tabelas do dicionário de dados.
 *
 * @example
 * const { proxy } = montarAppDeTeste();
 * const banco = new BancoFalso().instalarEm(proxy);
 * banco.semear('fornecedor', { cnpj: '11222333000181', razao_social: 'Papel Bom' });
 * // ... chama a rota ...
 * expect(banco.linhas('fornecedor')).toHaveLength(1);
 */
export class BancoFalso {
  private readonly dicionario: Dicionario;
  private readonly colunasPorTabela = new Map<string, ColunaDoDicionario[]>();
  private tabelas = new Map<string, Linha[]>();
  private sequencias = new Map<string, number>();
  private readonly agora: () => Date;

  constructor(opcoes: OpcoesDoBancoFalso = {}) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.dicionario = JSON.parse(readFileSync(CAMINHO_DO_DICIONARIO, 'utf8')) as Dicionario;
    for (const coluna of this.dicionario.colunas) {
      const colunas = this.colunasPorTabela.get(coluna.tabela) ?? [];
      colunas.push(coluna);
      this.colunasPorTabela.set(coluna.tabela, colunas);
    }
  }

  /** Insere linhas direto na tabela, com as mesmas restrições de `dados.inserir`. */
  semear(tabela: string, linhas: Linha | readonly Linha[]): Linha[] {
    const resultado = this.inserir({ tabela, valores: linhas });
    return resultado.dados.map((linha) => ({ ...linha }));
  }

  /** Cópia das linhas atuais da tabela, na ordem da chave primária. */
  linhas(tabela: string): Linha[] {
    return this.linhasDa(tabela).map((linha) => ({ ...linha }));
  }

  /**
   * Faz o dublê do proxy responder às operações `dados.*` com este banco. Como o cliente real, a
   * resposta sai com as chaves em camelCase e os erros do proxy passam pela tradução.
   */
  instalarEm(proxy: ProxyClienteFalso): this {
    for (const operacao of Object.values(OPERACOES)) {
      proxy.responder(operacao, (chamada: ChamadaAoProxy) => this.atender(chamada));
    }
    return this;
  }

  /**
   * Executa uma operação `dados.*` e devolve o resultado como o proxy o devolve, em snake_case.
   *
   * @throws {ErroProxy} Com o código e o status que o proxy usaria.
   */
  executar(operacao: string, payload: Readonly<Record<string, unknown>>): Record<string, unknown> {
    switch (operacao) {
      case OPERACOES.CONSULTAR:
        return this.consultar(payload);
      case OPERACOES.INSERIR:
        return this.inserir(payload);
      case OPERACOES.ATUALIZAR:
        return this.atualizar(payload);
      case OPERACOES.EXCLUIR:
        return this.excluir(payload);
      case OPERACOES.LOTE:
        return this.lote(payload);
      case OPERACOES.ASSUMIR_PEDIDO:
        return this.assumirPedido(payload);
      case OPERACOES.EMITIR_ORCAMENTO:
        return this.emitirOrcamento(payload);
      default:
        throw new ErroProxy(404, 'OPERACAO_DESCONHECIDA', `operação desconhecida: ${operacao}`);
    }
  }

  /**
   * Atende uma chamada do dublê do proxy como o cliente real atenderia. Use direto quando o teste
   * precisar intercalar respostas programadas com as do banco.
   */
  atender({ operacao, payload }: ChamadaAoProxy): unknown {
    try {
      const corpo: Record<string, unknown> = { ok: true, ...this.executar(operacao, payload) };
      if (operacao !== OPERACOES.LOTE) {
        return converterChavesParaCamelCase(corpo);
      }
      const resultados = Object.entries(corpo.resultados as Record<string, unknown>);
      return {
        ok: true,
        resultados: Object.fromEntries(
          resultados.map(([passo, retorno]) => [passo, converterChavesParaCamelCase(retorno)]),
        ),
      };
    } catch (erro) {
      throw erro instanceof ErroProxy ? (traduzirErroDeProxy(erro) ?? erro) : erro;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Estrutura

  private colunasDa(tabela: unknown): ColunaDoDicionario[] {
    const colunas = typeof tabela === 'string' ? this.colunasPorTabela.get(tabela) : undefined;
    if (!colunas) {
      throw payloadInvalido(`tabela inexistente: ${String(tabela)}`);
    }
    return colunas;
  }

  private linhasDa(tabela: string): Linha[] {
    this.colunasDa(tabela);
    const linhas = this.tabelas.get(tabela) ?? [];
    this.tabelas.set(tabela, linhas);
    return linhas;
  }

  private chavePrimariaDa(tabela: string): string {
    const coluna = this.colunasDa(tabela).find(({ pk }) => pk);
    if (!coluna) {
      throw payloadInvalido(`tabela sem chave primária: ${tabela}`);
    }
    return coluna.coluna;
  }

  private exigirColuna(tabela: string, coluna: unknown): string {
    if (typeof coluna !== 'string' || !this.colunasDa(tabela).some((c) => c.coluna === coluna)) {
      throw payloadInvalido(`coluna inexistente: ${tabela}.${String(coluna)}`);
    }
    return coluna;
  }

  private ehDecimal(tabela: string, coluna: string): boolean {
    const definicao = this.colunasDa(tabela).find((c) => c.coluna === coluna);
    return definicao?.tipo.startsWith(TIPO_DECIMAL) ?? false;
  }

  // ------------------------------------------------------------------------------------------
  // Filtros

  private filtrar(tabela: string, filtros: unknown): Linha[] {
    const linhas = this.linhasDa(tabela);
    return filtros === undefined
      ? [...linhas]
      : linhas.filter((linha) => this.atendeAoGrupo(tabela, linha, filtros));
  }

  private atendeAoGrupo(tabela: string, linha: Linha, grupo: unknown): boolean {
    if (!ehObjeto(grupo) || Object.keys(grupo).length !== 1) {
      throw payloadInvalido('o filtro deve ter exatamente "e" ou "ou"');
    }
    const itens = grupo.e ?? grupo.ou;
    if (!Array.isArray(itens) || itens.length === 0) {
      throw payloadInvalido('filtro sem condições');
    }
    const resultados = itens.map((item: unknown) =>
      Array.isArray(item)
        ? this.atendeACondicao(tabela, linha, item)
        : this.atendeAoGrupo(tabela, linha, item),
    );
    return 'e' in grupo ? resultados.every(Boolean) : resultados.some(Boolean);
  }

  private atendeACondicao(tabela: string, linha: Linha, condicao: unknown[]): boolean {
    const [campo, operador, esperado] = condicao;
    const valor = linha[this.exigirColuna(tabela, campo)];
    switch (operador) {
      case 'nulo':
        return valor === null;
      case 'nao_nulo':
        return valor !== null;
      case '=':
        return valor === esperado;
      case '!=':
        return valor !== esperado;
      case 'em':
        if (
          !Array.isArray(esperado) ||
          esperado.length === 0 ||
          esperado.length > MAXIMO_DE_VALORES_NO_EM
        ) {
          throw payloadInvalido('"em" exige uma lista de 1 a 100 valores');
        }
        return esperado.includes(valor);
      case 'contem':
        if (typeof esperado !== 'string') {
          throw payloadInvalido('"contem" exige texto');
        }
        return typeof valor === 'string' && valor.toLowerCase().includes(esperado.toLowerCase());
      default: {
        const comparar = COMPARACOES[String(operador)];
        if (!comparar) {
          throw payloadInvalido(`operador desconhecido: ${String(operador)}`);
        }
        return valor !== null && comparar(valor as never, esperado as never);
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // dados.consultar

  private consultar(p: Readonly<Record<string, unknown>>): {
    dados: Linha[];
    proximo_cursor: string | null;
  } {
    const tabela = String(p.tabela);
    const limite = (p.limite as number | undefined) ?? LIMITE_PADRAO;
    if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) {
      throw payloadInvalido(`limite deve ser de 1 a ${LIMITE_MAXIMO}`);
    }
    const inicio = p.cursor === undefined ? 0 : this.decodificarCursor(p.cursor);
    const filtradas = this.filtrar(tabela, p.filtros);
    const agregacoes = (p.agregacoes as Linha[] | undefined) ?? [];
    const agrupar = (p.agrupar as string[] | undefined) ?? [];
    // Sem agregação, a ordem é decidida sobre a linha inteira (qualquer coluna da tabela) e a
    // projeção vem depois; sem ordenação pedida, vale a chave primária, como no proxy.
    const ordenadas =
      agregacoes.length > 0
        ? this.ordenar(this.agregar(tabela, filtradas, agregacoes, agrupar), p.ordenacao)
        : this.projetar(
            tabela,
            this.ordenar(this.ordenarPelaChave(tabela, filtradas), p.ordenacao),
            p,
          );
    const pagina = ordenadas.slice(inicio, inicio + limite);
    const haMais = ordenadas.length > inicio + limite;
    return { dados: pagina, proximo_cursor: haMais ? this.codificarCursor(inicio + limite) : null };
  }

  private ordenarPelaChave(tabela: string, linhas: Linha[]): Linha[] {
    const chave = this.chavePrimariaDa(tabela);
    return [...linhas].sort((a, b) => Number(a[chave]) - Number(b[chave]));
  }

  private projetar(tabela: string, linhas: Linha[], p: Readonly<Record<string, unknown>>): Linha[] {
    const pedidos = p.campos as string[] | undefined;
    const campos = pedidos?.length
      ? pedidos.map((campo) => this.exigirColuna(tabela, campo))
      : this.colunasDa(tabela).map(({ coluna }) => coluna);
    const incluir = (p.incluir as string[] | undefined) ?? [];
    return linhas.map((linha) => ({
      ...Object.fromEntries(campos.map((campo) => [campo, linha[campo]])),
      ...Object.fromEntries(
        incluir.map((relacionada) => [relacionada, this.incluir(tabela, linha, relacionada)]),
      ),
    }));
  }

  private incluir(tabela: string, linha: Linha, relacionada: string): Linha[] | Linha | null {
    this.colunasDa(relacionada);
    const relacao = this.dicionario.chaves_estrangeiras.find(
      (fk) =>
        (fk.tabela === relacionada && fk.tabela_ref === tabela) ||
        (fk.tabela === tabela && fk.tabela_ref === relacionada),
    );
    if (!relacao || relacionada === tabela) {
      throw payloadInvalido(`sem relação entre ${tabela} e ${relacionada}`);
    }
    const outras = this.linhasDa(relacionada);
    if (relacao.tabela === relacionada) {
      return outras
        .filter((filha) => filha[relacao.coluna] === linha[relacao.coluna_ref])
        .map((filha) => ({ ...filha }));
    }
    const pai = outras.find((candidata) => candidata[relacao.coluna_ref] === linha[relacao.coluna]);
    return pai ? { ...pai } : null;
  }

  private agregar(
    tabela: string,
    linhas: Linha[],
    agregacoes: Linha[],
    agrupar: string[],
  ): Linha[] {
    agrupar.forEach((coluna) => this.exigirColuna(tabela, coluna));
    const grupos = new Map<string, Linha[]>();
    for (const linha of linhas) {
      const chave = JSON.stringify(agrupar.map((coluna) => linha[coluna]));
      grupos.set(chave, [...(grupos.get(chave) ?? []), linha]);
    }
    if (agrupar.length === 0 && grupos.size === 0) {
      grupos.set('[]', []);
    }
    return [...grupos.values()].map((grupo) => ({
      ...Object.fromEntries(agrupar.map((coluna) => [coluna, grupo[0]?.[coluna]])),
      ...Object.fromEntries(
        agregacoes.map(({ fn, campo, como }) => [
          String(como),
          this.calcularAgregacao(tabela, grupo, String(fn), String(campo)),
        ]),
      ),
    }));
  }

  private calcularAgregacao(tabela: string, grupo: Linha[], fn: string, campo: string): unknown {
    if (fn === 'contar') {
      return campo === '*' ? grupo.length : grupo.filter((l) => l[campo] !== null).length;
    }
    if (fn !== 'soma') {
      throw payloadInvalido(`função não simulada pelo BancoFalso: ${fn}`);
    }
    const valores = grupo.map((l) => l[this.exigirColuna(tabela, campo)]).filter((v) => v !== null);
    if (valores.length === 0) {
      return null;
    }
    if (!this.ehDecimal(tabela, campo)) {
      return valores.reduce((total: number, valor) => total + Number(valor), 0);
    }
    const centavos = valores.reduce(
      (total: number, valor) => total + decimalParaCentavos(String(valor)),
      0,
    );
    return centavosParaDecimal(centavos);
  }

  private ordenar(linhas: Linha[], ordenacao: unknown): Linha[] {
    if (!Array.isArray(ordenacao) || ordenacao.length === 0) {
      return linhas;
    }
    const criterios = ordenacao as [string, string][];
    return [...linhas].sort((a, b) => {
      for (const [campo, direcao] of criterios) {
        const [x, y] = [a[campo] as never, b[campo] as never];
        if (x !== y) {
          return (x < y ? -1 : 1) * (direcao === 'desc' ? -1 : 1);
        }
      }
      return 0;
    });
  }

  private codificarCursor(posicao: number): string {
    return Buffer.from(JSON.stringify({ o: posicao })).toString(CODIFICACAO_DO_CURSOR);
  }

  private decodificarCursor(cursor: unknown): number {
    try {
      const texto = Buffer.from(String(cursor), CODIFICACAO_DO_CURSOR).toString('utf8');
      const { o } = JSON.parse(texto) as { o: unknown };
      if (Number.isInteger(o) && (o as number) >= 0) {
        return o as number;
      }
    } catch {
      // cai no erro abaixo
    }
    throw payloadInvalido('cursor inválido');
  }

  // ------------------------------------------------------------------------------------------
  // Gravações

  private inserir(p: Readonly<Record<string, unknown>>): { dados: Linha[]; afetados: number } {
    const tabela = String(p.tabela);
    const novas = (Array.isArray(p.valores) ? p.valores : [p.valores]) as Linha[];
    if (novas.length === 0 || novas.length > MAXIMO_DE_LINHAS_POR_INSERCAO) {
      throw payloadInvalido(`inserir aceita de 1 a ${MAXIMO_DE_LINHAS_POR_INSERCAO} linhas`);
    }
    const colunas = Object.keys(novas[0] ?? {}).sort();
    if (colunas.length === 0) {
      throw payloadInvalido('valores vazios');
    }
    colunas.forEach((coluna) => this.exigirColuna(tabela, coluna));
    const chave = this.chavePrimariaDa(tabela);
    const inseridas = novas.map((valores) => {
      if (Object.keys(valores).sort().join() !== colunas.join()) {
        throw payloadInvalido('todas as linhas devem ter as mesmas colunas');
      }
      const linha = this.linhaComPadroes(tabela, valores);
      linha[chave] = this.reservarId(tabela, linha[chave]);
      this.conferirRestricoes(tabela, linha);
      this.linhasDa(tabela).push(linha);
      return linha;
    });
    return { dados: this.retornar(tabela, inseridas, p.retornar), afetados: inseridas.length };
  }

  private atualizar(p: Readonly<Record<string, unknown>>): { afetados: number; dados?: Linha[] } {
    const tabela = String(p.tabela);
    const valores = (p.valores ?? {}) as Linha;
    const colunas = Object.keys(valores);
    if (colunas.length === 0) {
      throw payloadInvalido('valores vazios');
    }
    colunas.forEach((coluna) => this.exigirColuna(tabela, coluna));
    const alvos = this.linhasSobRisco(tabela, p.filtros);
    if (colunas.includes(this.chavePrimariaDa(tabela))) {
      throw riscoEstrutural(`alteração de chave primária em ${tabela}`);
    }
    for (const linha of alvos) {
      Object.assign(linha, valores);
      this.conferirRestricoes(tabela, linha);
    }
    const pedeRetorno = Array.isArray(p.retornar) && p.retornar.length > 0;
    return {
      afetados: alvos.length,
      ...(pedeRetorno && { dados: this.retornar(tabela, alvos, p.retornar) }),
    };
  }

  private excluir(p: Readonly<Record<string, unknown>>): { afetados: number } {
    const tabela = String(p.tabela);
    const alvos = this.linhasSobRisco(tabela, p.filtros);
    const chave = this.chavePrimariaDa(tabela);
    for (const linha of alvos) {
      this.conferirSemFilhas(tabela, linha);
    }
    const removidas = new Set(alvos.map((linha) => linha[chave]));
    this.tabelas.set(
      tabela,
      this.linhasDa(tabela).filter((linha) => !removidas.has(linha[chave])),
    );
    return { afetados: alvos.length };
  }

  /** Verificação de risco do proxy: gravação sem filtro ou sobre mais de 50 linhas é bloqueada. */
  private linhasSobRisco(tabela: string, filtros: unknown): Linha[] {
    const itens = ehObjeto(filtros) ? (filtros.e ?? filtros.ou) : undefined;
    if (!Array.isArray(itens) || itens.length === 0) {
      throw riscoEstrutural(`${tabela}: operação sem filtro`);
    }
    const alvos = this.filtrar(tabela, filtros);
    if (alvos.length > MAXIMO_DE_LINHAS_POR_ALTERACAO) {
      throw riscoEstrutural(`${tabela}: ${alvos.length} linhas afetadas`);
    }
    return alvos;
  }

  private linhaComPadroes(tabela: string, valores: Linha): Linha {
    const padroes = VALORES_PADRAO[tabela] ?? {};
    const agora = this.agora();
    const linha: Linha = {};
    for (const { coluna } of this.colunasDa(tabela)) {
      const padrao = padroes[coluna];
      linha[coluna] =
        valores[coluna] ?? (typeof padrao === 'function' ? padrao(agora) : (padrao ?? null));
    }
    return linha;
  }

  /** Usa o id informado (ao semear) ou o próximo da sequência, que nunca repete um id usado. */
  private reservarId(tabela: string, informado: unknown): number {
    const ultimo = this.sequencias.get(tabela) ?? 0;
    const id = typeof informado === 'number' ? informado : ultimo + 1;
    this.sequencias.set(tabela, Math.max(ultimo, id));
    return id;
  }

  private conferirRestricoes(tabela: string, linha: Linha): void {
    const chave = this.chavePrimariaDa(tabela);
    const outras = this.linhasDa(tabela).filter((outra) => outra !== linha);
    for (const { coluna, nullable, pk, uk } of this.colunasDa(tabela)) {
      const valor = linha[coluna];
      if (valor === null || valor === undefined) {
        if (!nullable && !pk) {
          throw erroDoBanco(`${tabela}.${coluna} não aceita nulo`);
        }
        continue;
      }
      if ((uk || coluna === chave) && outras.some((outra) => outra[coluna] === valor)) {
        throw erroDoBanco(`valor repetido em ${tabela}.${coluna}`);
      }
    }
    for (const fk of this.dicionario.chaves_estrangeiras) {
      const valor = fk.tabela === tabela ? linha[fk.coluna] : null;
      const existe = () => this.linhasDa(fk.tabela_ref).some((pai) => pai[fk.coluna_ref] === valor);
      if (valor !== null && valor !== undefined && !existe()) {
        throw erroDoBanco(`${tabela}.${fk.coluna} aponta para registro inexistente`);
      }
    }
  }

  private conferirSemFilhas(tabela: string, linha: Linha): void {
    for (const fk of this.dicionario.chaves_estrangeiras) {
      if (
        fk.tabela_ref === tabela &&
        (this.tabelas.get(fk.tabela) ?? []).some((f) => f[fk.coluna] === linha[fk.coluna_ref])
      ) {
        throw erroDoBanco(`${tabela} ainda é referenciada por ${fk.tabela}.${fk.coluna}`);
      }
    }
  }

  private retornar(tabela: string, linhas: Linha[], retornar: unknown): Linha[] {
    const colunas =
      Array.isArray(retornar) && retornar.length > 0
        ? retornar.map((coluna) => this.exigirColuna(tabela, coluna))
        : this.colunasDa(tabela).map(({ coluna }) => coluna);
    return linhas.map((linha) => Object.fromEntries(colunas.map((c) => [c, linha[c]])));
  }

  // ------------------------------------------------------------------------------------------
  // pedido.assumir (docs/12, seção 12.8.3)

  /**
   * SOLICITADO → EM_ANALISE, de forma atômica: só muda quem ainda está SOLICITADO.
   *
   * @throws {ErroProxy} `NOT_FOUND` se o pedido não existir; `PEDIDO_JA_ASSUMIDO` se outro
   * operador (ou a mesma chamada, em uma corrida) já tiver assumido.
   */
  private assumirPedido(p: Readonly<Record<string, unknown>>): { dados: Linha } {
    const idPedido = p.id_pedido;
    const idOperador = p.id_operador;
    if (typeof idPedido !== 'number' || typeof idOperador !== 'number') {
      throw payloadInvalido('pedido.assumir exige id_pedido e id_operador numéricos');
    }
    const pedido = this.linhasDa('pedido').find((linha) => linha.id_pedido === idPedido);
    if (!pedido) {
      throw new ErroProxy(404, 'NOT_FOUND', `pedido inexistente: ${idPedido}`);
    }
    if (pedido.status !== STATUS_PEDIDO_SOLICITADO) {
      throw new ErroProxy(409, 'PEDIDO_JA_ASSUMIDO', `pedido ${idPedido} não está mais SOLICITADO`);
    }
    pedido.status = STATUS_PEDIDO_EM_ANALISE;
    pedido.id_operador_atendimento = idOperador;
    return { dados: { ...pedido } };
  }

  // ------------------------------------------------------------------------------------------
  // orcamento.emitir (docs/12, seção 12.8.3; UC19)

  /**
   * Emite o orçamento: confere saldo de cada item, atribui o número sequencial e a chave de
   * segurança, grava as reservas CONFIRMADA e aprova o pedido de origem — tudo atomicamente.
   *
   * @throws {ErroProxy} `NOT_FOUND` se o orçamento não existir; `ORCAMENTO_NAO_EDITAVEL` se não
   * estiver em um status que permita emissão; `CHAVE_DUPLICADA` se a chave já estiver em uso;
   * `ESTOQUE_INSUFICIENTE` se algum item não tiver saldo suficiente.
   */
  private emitirOrcamento(p: Readonly<Record<string, unknown>>): { dados: Linha } {
    const idOrcamento = p.id_orcamento;
    const idOperador = p.id_operador;
    const chaveSeguranca = p.chave_seguranca;
    if (
      typeof idOrcamento !== 'number' ||
      typeof idOperador !== 'number' ||
      typeof chaveSeguranca !== 'string'
    ) {
      throw payloadInvalido('orcamento.emitir exige id_orcamento, id_operador e chave_seguranca');
    }
    const orcamento = this.linhasDa('orcamento').find(
      (linha) => linha.id_orcamento === idOrcamento,
    );
    if (!orcamento) {
      throw new ErroProxy(404, 'NOT_FOUND', `orçamento inexistente: ${idOrcamento}`);
    }
    if (!STATUS_ORCAMENTO_EDITAVEIS_PARA_EMISSAO.has(String(orcamento.status))) {
      throw new ErroProxy(422, 'ORCAMENTO_NAO_EDITAVEL', `orçamento ${idOrcamento} não é editável`);
    }
    if (this.linhasDa('orcamento').some((outro) => outro.chave_seguranca === chaveSeguranca)) {
      throw new ErroProxy(409, 'CHAVE_DUPLICADA', 'chave de segurança já em uso');
    }

    const itens = this.linhasDa('item_orcamento').filter(
      (item) => item.id_orcamento === idOrcamento,
    );
    const quantidadesEmUnidades = new Map<number, number>();
    for (const item of itens) {
      const idItem = item.id_item as number;
      if (item.granularidade === 'FARDO') {
        const fardo = this.linhasDa('fardo').find((f) => f.id_fardo === item.id_fardo);
        const unidadesPorFardo = Number(fardo?.quantidade_unidades ?? 0);
        quantidadesEmUnidades.set(idItem, Number(item.quantidade_fardos) * unidadesPorFardo);
      } else {
        quantidadesEmUnidades.set(idItem, Number(item.quantidade_avulsa));
      }
    }
    for (const item of itens) {
      const idItem = item.id_item as number;
      const idVariacao = item.id_variacao as number;
      const variacao = this.linhasDa('variacao_produto').find((v) => v.id_variacao === idVariacao);
      const fisico = Number(variacao?.quantidade_estoque ?? 0);
      const reservado = this.somarReservasConfirmadasDaVariacao(idVariacao);
      const disponivel = Math.max(0, fisico - reservado);
      const solicitado = quantidadesEmUnidades.get(idItem) ?? 0;
      if (solicitado > disponivel) {
        throw new ErroProxy(
          422,
          'ESTOQUE_INSUFICIENTE',
          `variação ${idVariacao}: solicitado ${solicitado}, disponível ${disponivel}`,
        );
      }
    }

    const agora = this.agora();
    const dataEmissao = agora.toISOString().slice(0, 10);
    const dataValidade = new Date(
      agora.getTime() + DIAS_DE_VALIDADE_DO_ORCAMENTO * MILISSEGUNDOS_POR_DIA,
    )
      .toISOString()
      .slice(0, 10);
    const numeroOrcamento = this.proximoNumeroDeOrcamento();

    for (const item of itens) {
      const idItem = item.id_item as number;
      this.inserir({
        tabela: 'reserva_estoque',
        valores: {
          id_item: idItem,
          quantidade_reservada: quantidadesEmUnidades.get(idItem) ?? 0,
          status: STATUS_RESERVA_VIGENTE,
          data_expiracao: dataValidade,
        },
      });
    }

    orcamento.status = STATUS_ORCAMENTO_ABERTO;
    orcamento.numero_orcamento = numeroOrcamento;
    orcamento.chave_seguranca = chaveSeguranca;
    orcamento.data_emissao = dataEmissao;
    orcamento.data_validade = dataValidade;
    orcamento.data_ultima_edicao = agora.toISOString();

    if (typeof orcamento.id_pedido === 'number') {
      const pedido = this.linhasDa('pedido').find(
        (linha) => linha.id_pedido === orcamento.id_pedido,
      );
      if (pedido) {
        pedido.status = STATUS_PEDIDO_APROVADO;
        pedido.data_decisao = agora.toISOString();
      }
    }

    // Sem historico_orcamento aqui: o contrato real de `orcamento.emitir` (docs/12-proxy.md,
    // seção 12.8.3) não grava histórico — isso é responsabilidade do backend, que já registra o
    // evento por uma chamada separada (`historico_orcamento:inserir`) depois de chamar esta
    // operação (ver `ServicoDeOrcamentos.emitir`).
    return { dados: { ...orcamento } };
  }

  /** Soma as reservas CONFIRMADA de uma variação, pelo mesmo caminho de `somarReservasPorVariacao`. */
  private somarReservasConfirmadasDaVariacao(idVariacao: number): number {
    const idsDosItens = this.linhasDa('item_orcamento')
      .filter((item) => item.id_variacao === idVariacao)
      .map((item) => item.id_item);
    return this.linhasDa('reserva_estoque')
      .filter(
        (reserva) =>
          idsDosItens.includes(reserva.id_item) && reserva.status === STATUS_RESERVA_VIGENTE,
      )
      .reduce((total, reserva) => total + Number(reserva.quantidade_reservada), 0);
  }

  /** Próximo número sequencial de orçamento (maior `numero_orcamento` já emitido, mais um). */
  private proximoNumeroDeOrcamento(): number {
    const maior = this.linhasDa('orcamento').reduce(
      (atual, linha) => Math.max(atual, Number(linha.numero_orcamento ?? 0)),
      0,
    );
    return maior + 1;
  }

  // ------------------------------------------------------------------------------------------
  // dados.lote

  private lote(p: Readonly<Record<string, unknown>>): { resultados: Record<string, unknown> } {
    const passos = p.passos as { id: string; operacao: string; payload: Linha }[] | undefined;
    if (!Array.isArray(passos) || passos.length === 0 || passos.length > MAXIMO_DE_PASSOS) {
      throw payloadInvalido(`o lote aceita de 1 a ${MAXIMO_DE_PASSOS} passos`);
    }
    const copia = { tabelas: structuredClone(this.tabelas), sequencias: new Map(this.sequencias) };
    const resultados: Record<string, unknown> = {};
    try {
      for (const { id, operacao, payload } of passos) {
        if (!PADRAO_DE_IDENTIFICADOR.test(id) || id in resultados) {
          throw payloadInvalido(`id de passo inválido ou repetido: ${id}`);
        }
        if (!OPERACOES_PERMITIDAS_NO_LOTE.has(operacao)) {
          throw payloadInvalido(`operação não permitida no lote: ${operacao}`);
        }
        const resolvido = this.resolverReferencias(payload, resultados) as Linha;
        resultados[id] = { ok: true, ...this.executar(operacao, resolvido) };
      }
      return { resultados };
    } catch (erro) {
      this.tabelas = copia.tabelas;
      this.sequencias = copia.sequencias;
      throw erro;
    }
  }

  private resolverReferencias(valor: unknown, resultados: Record<string, unknown>): unknown {
    if (typeof valor === 'string') {
      const partes = PADRAO_DE_REFERENCIA.exec(valor);
      if (!partes) {
        return valor;
      }
      const [, passo = '', caminho = ''] = partes;
      let atual: unknown = resultados[passo];
      for (const parte of caminho.match(PADRAO_DE_PARTE_DO_CAMINHO) ?? []) {
        atual = ehObjeto(atual) || Array.isArray(atual) ? (atual as Linha)[parte] : undefined;
      }
      if (atual === undefined) {
        throw payloadInvalido(`referência sem valor: ${valor}`);
      }
      return atual;
    }
    if (Array.isArray(valor)) {
      return valor.map((item: unknown) => this.resolverReferencias(item, resultados));
    }
    if (ehObjeto(valor)) {
      return Object.fromEntries(
        Object.entries(valor).map(([k, v]) => [k, this.resolverReferencias(v, resultados)]),
      );
    }
    return valor;
  }
}
