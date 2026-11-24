// UC13 — regras do login: credenciais, bloqueio após três tentativas, usuário inativo e sessão.
// Também a recuperação de senha por e-mail (RN01), prevista no item 3 do TAREFAS.md e fechada
// agora, no item 10, por ser uma das rotas de docs/frontend-api.md.
import {
  ErroDeContaBloqueada,
  ErroDeCredenciaisInvalidas,
  ErroDeTokenDeRecuperacaoInvalido,
  ErroDeUsuarioInativo,
} from '../../erros';
import type { Logger } from '../../log';
import {
  NotificadorDeRecuperacaoDeSenhaMudo,
  type NotificadorDeRecuperacaoDeSenha,
} from './notificador';
import type { CredenciaisDoOperador, RepositorioDeOperadores } from './operadores';
import type { ServicoDeSenha } from './senha';
import type { RepositorioDeSessoes, Sessao } from './sessoes';
import { gerarTokenDeSenha, resumoDoTokenDeSenha } from './tokenDeSenha';

/** Por quanto tempo vale o link de recuperação de senha enviado ao e-mail do usuário. */
export const VALIDADE_DO_LINK_DE_RECUPERACAO_DE_SENHA_MS = 60 * 60 * 1000;

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
const MENSAGEM_DO_LOG_DE_RECUPERACAO = 'recuperação de senha';

export interface DependenciasDoServicoDeAutenticacao {
  readonly operadores: RepositorioDeOperadores;
  readonly sessoes: RepositorioDeSessoes;
  readonly senhas: ServicoDeSenha;
  readonly logger: Logger;
  /** Por padrão, o notificador que só registra em log. */
  readonly notificador?: NotificadorDeRecuperacaoDeSenha;
  /** Relógio; por padrão, a hora do sistema. */
  readonly agora?: () => Date;
}

/** Autentica usuários, abre e encerra sessões e trata a recuperação de senha (UC13). */
export class ServicoDeAutenticacao {
  private readonly operadores: RepositorioDeOperadores;
  private readonly sessoes: RepositorioDeSessoes;
  private readonly senhas: ServicoDeSenha;
  private readonly logger: Logger;
  private readonly notificador: NotificadorDeRecuperacaoDeSenha;
  private readonly agora: () => Date;

  constructor(dependencias: DependenciasDoServicoDeAutenticacao) {
    this.operadores = dependencias.operadores;
    this.sessoes = dependencias.sessoes;
    this.senhas = dependencias.senhas;
    this.logger = dependencias.logger;
    this.notificador =
      dependencias.notificador ?? new NotificadorDeRecuperacaoDeSenhaMudo(dependencias.logger);
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
      const bloqueadoAte = await this.contarTentativaInvalida(operador, agora, requestId);
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

  /**
   * Pede o link de recuperação de senha (UC13, RN01). Sempre termina em sucesso silencioso,
   * exista ou não a conta: a resposta não pode revelar quais e-mails estão cadastrados. Se o
   * envio do e-mail falhar, o pedido pode ser repetido.
   */
  async recuperarSenha({ email }: { email: string }): Promise<void> {
    const operador = await this.operadores.buscarPorEmail(email);
    if (!operador) {
      this.logger.info(
        { evento: 'recuperacao_de_senha_email_desconhecido' },
        MENSAGEM_DO_LOG_DE_RECUPERACAO,
      );
      return;
    }
    const recuperacao = gerarTokenDeSenha(
      VALIDADE_DO_LINK_DE_RECUPERACAO_DE_SENHA_MS,
      this.agora(),
    );
    await this.operadores.gravarTokenDeRecuperacao(
      operador.idOperador,
      recuperacao.resumo,
      recuperacao.validade,
    );
    this.logger.info(
      { evento: 'recuperacao_de_senha_solicitada', idOperador: operador.idOperador },
      MENSAGEM_DO_LOG_DE_RECUPERACAO,
    );
    try {
      await this.notificador.enviarRecuperacaoDeSenha({
        idOperador: operador.idOperador,
        usuario: operador.usuario,
        email: operador.email,
        token: recuperacao.token,
        validade: recuperacao.validade,
      });
    } catch (erro) {
      this.logger.error(
        {
          evento: 'email_falhou',
          tipo: 'recuperacao_de_senha',
          idOperador: operador.idOperador,
          err: erro,
        },
        'Falha ao enviar o e-mail de recuperação de senha.',
      );
    }
  }

  /**
   * Define a nova senha a partir do token recebido por e-mail (UC13, RN01). O token é de uso
   * único: depois desta chamada, o mesmo link não serve mais, e as sessões abertas do usuário são
   * encerradas, para uma sessão antiga não continuar válida com a senha trocada.
   *
   * @throws {ErroDeTokenDeRecuperacaoInvalido} Se o token não existir ou já tiver vencido (422).
   */
  async redefinirSenha({ token, novaSenha }: { token: string; novaSenha: string }): Promise<void> {
    const operador = await this.operadores.buscarPorResumoDeToken(resumoDoTokenDeSenha(token));
    if (!operador || operador.validadeToken === null || operador.validadeToken <= this.agora()) {
      throw new ErroDeTokenDeRecuperacaoInvalido();
    }
    const senhaHash = await this.senhas.gerarHash(novaSenha);
    await this.operadores.definirNovaSenha(operador.idOperador, senhaHash);
    await this.sessoes.encerrarDoOperador(operador.idOperador);
    this.logger.info(
      { evento: 'senha_redefinida', idOperador: operador.idOperador },
      MENSAGEM_DO_LOG_DE_RECUPERACAO,
    );
  }

  /**
   * Conta a senha errada. Se a gravação falhar (proxy lento, hibernado ou limitado), a resposta
   * continua sendo "usuário ou senha inválidos": a senha está errada, e dizer "serviço
   * indisponível" esconderia isso. A tentativa deixa de contar para o bloqueio e a falha vai ao log.
   */
  private async contarTentativaInvalida(
    operador: CredenciaisDoOperador,
    agora: Date,
    requestId?: string,
  ): Promise<Date | null> {
    try {
      return (await this.operadores.registrarFalha(operador, agora)).bloqueadoAte;
    } catch (erro) {
      this.logger.error(
        { requestId, idOperador: operador.idOperador, evento: 'tentativa_nao_contada', err: erro },
        'Não foi possível gravar a tentativa de login inválida.',
      );
      return null;
    }
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
