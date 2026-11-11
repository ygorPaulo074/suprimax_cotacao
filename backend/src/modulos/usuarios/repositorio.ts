// UC25 — leitura e gravação da tabela `operador` para a gestão de usuários, e da carteira de
// clientes de cada vendedor (`cliente.id_operador_vendedor`). É o único arquivo do módulo que
// conhece o proxy e os nomes das colunas (docs/13, seções 13.7.1 e 13.7.2).
import { z } from 'zod';
import {
  consultar,
  consultarTodas,
  emBlocos,
  executarEmLotes,
  linhasDe,
  MAXIMO_DE_LINHAS_POR_ALTERACAO,
  validarLinha,
  type ClienteDeProxy,
  type FiltroDoProxy,
  type PassoDoLote,
} from '../../dados';
import { ErroInterno } from '../../erros';
import { STATUS_DO_USUARIO, type StatusDoUsuario } from '../auth/operadores';
import { PERFIS, type Perfil } from '../auth/sessoes';

/** Perfil dos usuários que têm carteira de clientes. */
export const PERFIL_VENDEDOR: Perfil = 'VENDEDOR';
/** Situação dos usuários que podem entrar no sistema. */
export const STATUS_ATIVO: StatusDoUsuario = 'ATIVO';

/** Identificação de cada chamada na auditoria do proxy (X-Operation-Id). */
export const OPERACOES_DE_USUARIOS = {
  LISTAR: 'UC25-listar-usuarios',
  BUSCAR: 'UC25-buscar-usuario',
  CONFERIR_DUPLICIDADE: 'UC25-conferir-duplicidade',
  CRIAR: 'UC25-criar-usuario',
  ATUALIZAR: 'UC25-atualizar-usuario',
  CONTAR_CARTEIRA: 'UC25-contar-carteira',
  LISTAR_CARTEIRA: 'UC25-listar-carteira',
  LISTAR_VENDEDORES: 'UC02-listar-vendedores',
} as const;

const TABELA_DE_USUARIOS = 'operador';
const TABELA_DE_CLIENTES = 'cliente';
const COLUNA_DO_VENDEDOR = 'id_operador_vendedor';
const ALIAS_DO_TOTAL = 'total';
/**
 * Colunas lidas. São sempre pedidas pelo nome: sem `campos`, o proxy devolveria também o hash da
 * senha e o token de recuperação a quem tem o escopo de credenciais.
 */
const COLUNAS_DO_USUARIO = ['id_operador', 'usuario', 'email', 'perfil', 'status'];

/** Usuário como a gestão de usuários o enxerga: sem senha, sem token. */
export interface UsuarioCadastrado {
  readonly idOperador: number;
  readonly usuario: string;
  readonly email: string;
  readonly perfil: Perfil;
  readonly status: StatusDoUsuario;
}

/** Dados gravados na criação de um usuário. */
export interface UsuarioAInserir {
  readonly usuario: string;
  readonly email: string;
  readonly perfil: Perfil;
  /** Hash bcrypt; a senha em texto puro nunca chega ao repositório. */
  readonly senhaHash: string;
  /** Resumo do token de definição de senha, nunca o token. */
  readonly resumoDoToken: string;
  readonly validadeDoToken: Date;
}

/** Campos que a gestão de usuários pode mudar. */
export interface AlteracaoDeUsuario {
  readonly perfil?: Perfil;
  readonly status?: StatusDoUsuario;
}

const esquemaDoUsuario = z.object({
  idOperador: z.number().int(),
  usuario: z.string(),
  email: z.string(),
  perfil: z.enum(PERFIS),
  status: z.enum(STATUS_DO_USUARIO),
});

const esquemaDoTotal = z.object({ total: z.number().int() });
const esquemaDoTotalPorVendedor = esquemaDoTotal.extend({ idOperadorVendedor: z.number().int() });
const esquemaDoIdDeCliente = z.object({ idCliente: z.number().int() });

function paraUsuario(linha: unknown): UsuarioCadastrado {
  return validarLinha(esquemaDoUsuario, linha, TABELA_DE_USUARIOS);
}

/** Acesso aos usuários e às carteiras de clientes, sempre pelo proxy. */
export class RepositorioDeUsuarios {
  constructor(private readonly proxy: ClienteDeProxy) {}

  /** Todos os usuários, em ordem alfabética do nome de usuário. */
  async listar(): Promise<UsuarioCadastrado[]> {
    const linhas = await consultarTodas(
      this.proxy,
      { tabela: TABELA_DE_USUARIOS, campos: COLUNAS_DO_USUARIO, ordenacao: [['usuario', 'asc']] },
      OPERACOES_DE_USUARIOS.LISTAR,
    );
    return linhas.map(paraUsuario);
  }

  /** Busca o usuário pelo identificador; `null` se não existir. */
  async buscarPorId(idOperador: number): Promise<UsuarioCadastrado | null> {
    const [linha] = await consultar(
      this.proxy,
      {
        tabela: TABELA_DE_USUARIOS,
        campos: COLUNAS_DO_USUARIO,
        filtros: { e: [['id_operador', '=', idOperador]] },
        limite: 1,
      },
      OPERACOES_DE_USUARIOS.BUSCAR,
    );
    return linha === undefined ? null : paraUsuario(linha);
  }

  /** Vendedores ativos, em ordem alfabética: os que podem assumir uma carteira de clientes. */
  async listarVendedoresAtivos(): Promise<UsuarioCadastrado[]> {
    const linhas = await consultarTodas(
      this.proxy,
      {
        tabela: TABELA_DE_USUARIOS,
        campos: COLUNAS_DO_USUARIO,
        filtros: {
          e: [
            ['perfil', '=', PERFIL_VENDEDOR],
            ['status', '=', STATUS_ATIVO],
          ],
        },
        ordenacao: [['usuario', 'asc']],
      },
      OPERACOES_DE_USUARIOS.LISTAR_VENDEDORES,
    );
    return linhas.map(paraUsuario);
  }

  /** Indica se já existe usuário com o mesmo nome de usuário ou com o mesmo e-mail. */
  async existeComUsuarioOuEmail(usuario: string, email: string): Promise<boolean> {
    const linhas = await consultar(
      this.proxy,
      {
        tabela: TABELA_DE_USUARIOS,
        campos: ['id_operador'],
        filtros: {
          ou: [
            ['usuario', '=', usuario],
            ['email', '=', email],
          ],
        },
        limite: 1,
      },
      OPERACOES_DE_USUARIOS.CONFERIR_DUPLICIDADE,
    );
    return linhas.length > 0;
  }

  /** Grava o usuário novo, ATIVO, com o token de definição de senha. */
  async inserir(novo: UsuarioAInserir): Promise<UsuarioCadastrado> {
    const resposta = await this.proxy.executar(
      'dados.inserir',
      {
        tabela: TABELA_DE_USUARIOS,
        valores: {
          usuario: novo.usuario,
          email: novo.email,
          perfil: novo.perfil,
          status: STATUS_ATIVO,
          senha_hash: novo.senhaHash,
          token_recuperacao_senha: novo.resumoDoToken,
          validade_token: novo.validadeDoToken.toISOString(),
        },
        retornar: COLUNAS_DO_USUARIO,
      },
      OPERACOES_DE_USUARIOS.CRIAR,
    );
    const [linha] = linhasDe(resposta);
    if (linha === undefined) {
      throw new ErroInterno(new Error('A criação do usuário não devolveu a linha gravada.'));
    }
    return paraUsuario(linha);
  }

  /** Quantos clientes cada vendedor tem na carteira. Quem não tem clientes não aparece. */
  async contarClientesPorVendedor(): Promise<Map<number, number>> {
    const linhas = await consultarTodas(
      this.proxy,
      {
        tabela: TABELA_DE_CLIENTES,
        agrupar: [COLUNA_DO_VENDEDOR],
        agregacoes: [{ fn: 'contar', campo: '*', como: ALIAS_DO_TOTAL }],
        ordenacao: [[COLUNA_DO_VENDEDOR, 'asc']],
      },
      OPERACOES_DE_USUARIOS.CONTAR_CARTEIRA,
    );
    return new Map(
      linhas
        .map((linha) => validarLinha(esquemaDoTotalPorVendedor, linha, TABELA_DE_CLIENTES))
        .map(({ idOperadorVendedor, total }) => [idOperadorVendedor, total]),
    );
  }

  /** Quantos clientes o usuário tem na carteira. */
  async contarClientesDe(idOperador: number): Promise<number> {
    const [linha] = await consultar(
      this.proxy,
      {
        tabela: TABELA_DE_CLIENTES,
        filtros: this.filtroDaCarteira(idOperador),
        agregacoes: [{ fn: 'contar', campo: '*', como: ALIAS_DO_TOTAL }],
      },
      OPERACOES_DE_USUARIOS.CONTAR_CARTEIRA,
    );
    return validarLinha(esquemaDoTotal, linha, TABELA_DE_CLIENTES).total;
  }

  /**
   * Grava a alteração do usuário e, se pedido, passa antes a carteira dele ao novo vendedor.
   *
   * O proxy bloqueia atualizações de mais de 50 linhas, então a carteira é transferida em blocos,
   * e o usuário só é alterado no último passo. Até 950 clientes, tudo cabe em uma transação;
   * acima disso são várias, e uma falha no meio deixa o vendedor como estava, com parte da
   * carteira já transferida: basta repetir a operação.
   *
   * @param idNovoVendedor Quem recebe a carteira; omita quando não há carteira a transferir.
   */
  async atualizar(
    idOperador: number,
    alteracao: AlteracaoDeUsuario,
    idNovoVendedor?: number,
  ): Promise<void> {
    const grupos: PassoDoLote[][] = [];
    if (idNovoVendedor !== undefined) {
      const clientes = await this.listarIdsDaCarteira(idOperador);
      emBlocos(clientes, MAXIMO_DE_LINHAS_POR_ALTERACAO).forEach((bloco, indice) => {
        grupos.push([
          {
            id: `carteira_${indice}`,
            operacao: 'dados.atualizar',
            payload: {
              tabela: TABELA_DE_CLIENTES,
              filtros: {
                e: [
                  ['id_cliente', 'em', bloco],
                  [COLUNA_DO_VENDEDOR, '=', idOperador],
                ],
              },
              valores: { [COLUNA_DO_VENDEDOR]: idNovoVendedor },
            },
          },
        ]);
      });
    }
    if (alteracao.perfil !== undefined || alteracao.status !== undefined) {
      grupos.push([
        {
          id: 'usuario',
          operacao: 'dados.atualizar',
          payload: {
            tabela: TABELA_DE_USUARIOS,
            filtros: { e: [['id_operador', '=', idOperador]] },
            valores: {
              ...(alteracao.perfil !== undefined && { perfil: alteracao.perfil }),
              ...(alteracao.status !== undefined && { status: alteracao.status }),
            },
          },
        },
      ]);
    }
    await executarEmLotes(this.proxy, grupos, OPERACOES_DE_USUARIOS.ATUALIZAR);
  }

  private async listarIdsDaCarteira(idOperador: number): Promise<number[]> {
    const linhas = await consultarTodas(
      this.proxy,
      {
        tabela: TABELA_DE_CLIENTES,
        campos: ['id_cliente'],
        filtros: this.filtroDaCarteira(idOperador),
      },
      OPERACOES_DE_USUARIOS.LISTAR_CARTEIRA,
    );
    return linhas.map(
      (linha) => validarLinha(esquemaDoIdDeCliente, linha, TABELA_DE_CLIENTES).idCliente,
    );
  }

  private filtroDaCarteira(idOperador: number): FiltroDoProxy {
    return { e: [[COLUNA_DO_VENDEDOR, '=', idOperador]] };
  }
}
