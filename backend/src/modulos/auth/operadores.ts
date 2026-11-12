// UC13 — leitura e atualização da tabela `operador` para o login (docs/13, seção 13.7.1).
// É o único arquivo do módulo que conhece o proxy e os nomes das colunas.
import { z } from 'zod';
import type { ClienteDeProxy } from '../../dados';
import { ErroInterno } from '../../erros';
import { PERFIS, type Perfil } from './sessoes';

/** Situações do usuário (coluna `status`). */
export const STATUS_DO_USUARIO = ['ATIVO', 'INATIVO'] as const;
export type StatusDoUsuario = (typeof STATUS_DO_USUARIO)[number];

/** Tentativas inválidas seguidas que bloqueiam a conta (UC13-E2); é o teto do CHECK da coluna. */
export const MAXIMO_DE_TENTATIVAS_INVALIDAS = 3;

/** Identificação de cada chamada na auditoria do proxy (X-Operation-Id). */
export const OPERACOES_DE_LOGIN = {
  BUSCAR: 'UC13-login',
  REGISTRAR_FALHA: 'UC13-login-falha',
  ZERAR_TENTATIVAS: 'UC13-login-sucesso',
} as const;

const TABELA = 'operador';
const COLUNAS_DO_BLOQUEIO = ['tentativas_login_invalidas', 'bloqueado_ate'];
const COLUNAS_DAS_CREDENCIAIS = [
  'id_operador',
  'usuario',
  'email',
  'perfil',
  'status',
  'senha_hash',
  ...COLUNAS_DO_BLOQUEIO,
];
/** TIMESTAMP sem fuso é lido como UTC; este padrão reconhece o texto que já traz o fuso. */
const PADRAO_COM_FUSO = /(Z|[+-]\d{2}:?\d{2})$/i;
const SUFIXO_UTC = 'Z';
const SEPARADOR_SQL_DE_DATA_E_HORA = ' ';
const SEPARADOR_ISO_DE_DATA_E_HORA = 'T';

/** Estado do bloqueio de login de um usuário. */
export interface EstadoDoBloqueio {
  readonly tentativasLoginInvalidas: number;
  /** Fim do bloqueio; `null` quando o banco não registrou bloqueio. */
  readonly bloqueadoAte: Date | null;
}

/** O que o login precisa saber de um usuário. Contém o hash da senha: nunca devolva ao frontend. */
export interface CredenciaisDoOperador extends EstadoDoBloqueio {
  readonly idOperador: number;
  readonly usuario: string;
  readonly email: string;
  readonly perfil: Perfil;
  readonly status: StatusDoUsuario;
  readonly senhaHash: string;
}

const esquemaDoBloqueio = z.object({
  tentativasLoginInvalidas: z.number().int(),
  bloqueadoAte: z.string().nullable(),
});

const esquemaDasCredenciais = esquemaDoBloqueio.extend({
  idOperador: z.number().int(),
  usuario: z.string(),
  email: z.string(),
  perfil: z.enum(PERFIS),
  status: z.enum(STATUS_DO_USUARIO),
  senhaHash: z.string(),
});

function paraData(texto: string | null): Date | null {
  if (texto === null) {
    return null;
  }
  const iso = texto.replace(SEPARADOR_SQL_DE_DATA_E_HORA, SEPARADOR_ISO_DE_DATA_E_HORA);
  const data = new Date(PADRAO_COM_FUSO.test(iso) ? iso : `${iso}${SUFIXO_UTC}`);
  if (Number.isNaN(data.getTime())) {
    throw new ErroInterno(new Error('Data do operador fora do formato esperado.'));
  }
  return data;
}

function linhasDe(resposta: unknown): unknown[] {
  const dados = (resposta as { dados?: unknown }).dados;
  return Array.isArray(dados) ? dados : [];
}

/** Acesso aos dados de login dos usuários, sempre pelo proxy. */
export class RepositorioDeOperadores {
  constructor(private readonly proxy: ClienteDeProxy) {}

  /** Busca o usuário pelo nome de login; `null` se não existir. */
  async buscarCredenciais(usuario: string): Promise<CredenciaisDoOperador | null> {
    const resposta = await this.proxy.executar(
      'dados.consultar',
      {
        tabela: TABELA,
        campos: COLUNAS_DAS_CREDENCIAIS,
        filtros: { e: [['usuario', '=', usuario]] },
        limite: 1,
      },
      OPERACOES_DE_LOGIN.BUSCAR,
    );
    const [linha] = linhasDe(resposta);
    if (linha === undefined) {
      return null;
    }
    const { bloqueadoAte, ...demais } = this.validar(esquemaDasCredenciais, linha);
    return { ...demais, bloqueadoAte: paraData(bloqueadoAte) };
  }

  /**
   * Conta uma tentativa inválida e devolve o estado do bloqueio depois dela.
   *
   * Só o contador é gravado: `bloqueado_ate` é responsabilidade do gatilho do banco (docs/13,
   * seção 13.4). A atualização é condicionada ao valor lido, para duas tentativas simultâneas não
   * contarem como uma só; se outra tentativa chegou antes, devolve o estado que ela deixou.
   *
   * @param agora Momento da tentativa: se o bloqueio anterior já venceu, a contagem recomeça em 1.
   */
  async registrarFalha(operador: CredenciaisDoOperador, agora: Date): Promise<EstadoDoBloqueio> {
    const bloqueioVencido = operador.bloqueadoAte !== null && operador.bloqueadoAte <= agora;
    const tentativas = bloqueioVencido
      ? 1
      : Math.min(operador.tentativasLoginInvalidas + 1, MAXIMO_DE_TENTATIVAS_INVALIDAS);
    const resposta = await this.proxy.executar(
      'dados.atualizar',
      {
        tabela: TABELA,
        filtros: {
          e: [
            ['id_operador', '=', operador.idOperador],
            ['tentativas_login_invalidas', '=', operador.tentativasLoginInvalidas],
          ],
        },
        valores: { tentativas_login_invalidas: tentativas },
        retornar: COLUNAS_DO_BLOQUEIO,
      },
      OPERACOES_DE_LOGIN.REGISTRAR_FALHA,
    );
    const [linha] = linhasDe(resposta);
    return linha === undefined
      ? this.buscarBloqueio(operador.idOperador)
      : this.paraEstadoDoBloqueio(linha);
  }

  /** Zera o contador de tentativas inválidas depois de um login bem-sucedido. */
  async zerarTentativas(idOperador: number): Promise<void> {
    await this.proxy.executar(
      'dados.atualizar',
      {
        tabela: TABELA,
        filtros: { e: [['id_operador', '=', idOperador]] },
        valores: { tentativas_login_invalidas: 0 },
      },
      OPERACOES_DE_LOGIN.ZERAR_TENTATIVAS,
    );
  }

  private async buscarBloqueio(idOperador: number): Promise<EstadoDoBloqueio> {
    const resposta = await this.proxy.executar(
      'dados.consultar',
      {
        tabela: TABELA,
        campos: COLUNAS_DO_BLOQUEIO,
        filtros: { e: [['id_operador', '=', idOperador]] },
        limite: 1,
      },
      OPERACOES_DE_LOGIN.REGISTRAR_FALHA,
    );
    return this.paraEstadoDoBloqueio(linhasDe(resposta)[0]);
  }

  private paraEstadoDoBloqueio(linha: unknown): EstadoDoBloqueio {
    const { tentativasLoginInvalidas, bloqueadoAte } = this.validar(esquemaDoBloqueio, linha);
    return { tentativasLoginInvalidas, bloqueadoAte: paraData(bloqueadoAte) };
  }

  /** Uma linha fora do formato é defeito do backend ou do schema, nunca culpa do usuário. */
  private validar<T>(esquema: z.ZodType<T>, linha: unknown): T {
    const resultado = esquema.safeParse(linha);
    if (!resultado.success) {
      throw new ErroInterno(new Error('Linha de operador fora do formato esperado.'));
    }
    return resultado.data;
  }
}
