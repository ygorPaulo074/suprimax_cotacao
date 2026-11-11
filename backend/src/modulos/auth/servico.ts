// UC13 — regras do login: credenciais, bloqueio após três tentativas, usuário inativo e sessão.
import {
  ErroDeContaBloqueada,
  ErroDeCredenciaisInvalidas,
  ErroDeUsuarioInativo,
} from '../../erros';
import type { Logger } from '../../log';
import type { CredenciaisDoOperador, RepositorioDeOperadores } from './operadores';
import type { ServicoDeSenha } from './senha';
import type { RepositorioDeSessoes, Sessao } from './sessoes';

/** Dados informados na tela de login. */
export interface CredenciaisInformadas {
  readonly usuario: string;
  readonly senha: string;
}

/** Resposta de um login bem-sucedido (`LoginResponse` do frontend). */
export interface ResultadoDoLogin {
  readonly token: string;
  readonly usuario: Sessao;
}

/** Resultado de cada tentativa, como aparece no log. */
export const RESULTADOS_DO_LOGIN = {
  SUCESSO: 'sucesso',
  USUARIO_DESCONHECIDO: 'usuario_desconhecido',
  SENHA_INCORRETA: 'senha_incorreta',
  CONTA_BLOQUEADA: 'conta_bloqueada',
  USUARIO_INATIVO: 'usuario_inativo',
} as const;
type ResultadoDaTentativa = (typeof RESULTADOS_DO_LOGIN)[keyof typeof RESULTADOS_DO_LOGIN];

const MENSAGEM_DO_LOG = 'tentativa de login';

export interface DependenciasDoServicoDeAutenticacao {
  readonly operadores: RepositorioDeOperadores;
  readonly sessoes: RepositorioDeSessoes;
  readonly senhas: ServicoDeSenha;
  readonly logger: Logger;
  /** Relógio; por padrão, a hora do sistema. */
  readonly agora?: () => Date;
}

/** Autentica usuários e abre e encerra sessões. */
export class ServicoDeAutenticacao {
  private readonly operadores: RepositorioDeOperadores;
  private readonly sessoes: RepositorioDeSessoes;
  private readonly senhas: ServicoDeSenha;
  private readonly logger: Logger;
  private readonly agora: () => Date;

  constructor(dependencias: DependenciasDoServicoDeAutenticacao) {
    this.operadores = dependencias.operadores;
    this.sessoes = dependencias.sessoes;
    this.senhas = dependencias.senhas;
    this.logger = dependencias.logger;
    this.agora = dependencias.agora ?? (() => new Date());
  }

  /**
   * Confere as credenciais e abre a sessão.
   *
   * @param requestId Identificador da requisição, para o log.
   * @throws {ErroDeCredenciaisInvalidas} Usuário inexistente ou senha errada (mesma resposta).
   * @throws {ErroDeContaBloqueada} Conta bloqueada, inclusive pela tentativa atual.
   * @throws {ErroDeUsuarioInativo} Senha certa, mas usuário inativo.
   */
  async entrar(
    { usuario, senha }: CredenciaisInformadas,
    requestId?: string,
  ): Promise<ResultadoDoLogin> {
    const operador = await this.operadores.buscarCredenciais(usuario);
    if (!operador) {
      await this.senhas.simularVerificacao(senha);
      this.registrar(RESULTADOS_DO_LOGIN.USUARIO_DESCONHECIDO, requestId);
      throw new ErroDeCredenciaisInvalidas();
    }

    const agora = this.agora();
    this.recusarSeBloqueada(operador.bloqueadoAte, agora, operador, requestId);

    if (!(await this.senhas.verificar(senha, operador.senhaHash))) {
      const { bloqueadoAte } = await this.operadores.registrarFalha(operador, agora);
      this.recusarSeBloqueada(bloqueadoAte, agora, operador, requestId);
      this.registrar(RESULTADOS_DO_LOGIN.SENHA_INCORRETA, requestId, operador);
      throw new ErroDeCredenciaisInvalidas();
    }
    if (operador.status !== 'ATIVO') {
      this.registrar(RESULTADOS_DO_LOGIN.USUARIO_INATIVO, requestId, operador);
      throw new ErroDeUsuarioInativo();
    }

    if (operador.tentativasLoginInvalidas > 0) {
      await this.operadores.zerarTentativas(operador.idOperador);
    }
    const sessao: Sessao = {
      idOperador: operador.idOperador,
      usuario: operador.usuario,
      nome: operador.usuario,
      email: operador.email,
      perfil: operador.perfil,
    };
    const token = await this.sessoes.criar(sessao);
    this.registrar(RESULTADOS_DO_LOGIN.SUCESSO, requestId, operador);
    return { token, usuario: sessao };
  }

  /** Encerra a sessão do token (logout). */
  async sair(token: string): Promise<void> {
    await this.sessoes.encerrar(token);
  }

  private recusarSeBloqueada(
    bloqueadoAte: Date | null,
    agora: Date,
    operador: CredenciaisDoOperador,
    requestId?: string,
  ): void {
    if (bloqueadoAte !== null && bloqueadoAte > agora) {
      this.registrar(RESULTADOS_DO_LOGIN.CONTA_BLOQUEADA, requestId, operador);
      throw new ErroDeContaBloqueada(bloqueadoAte);
    }
  }

  /** O log leva só o resultado e o id: nunca a senha, o hash ou o texto digitado em "usuário". */
  private registrar(
    resultado: ResultadoDaTentativa,
    requestId?: string,
    operador?: CredenciaisDoOperador,
  ): void {
    this.logger.info({ requestId, idOperador: operador?.idOperador, resultado }, MENSAGEM_DO_LOG);
  }
}
