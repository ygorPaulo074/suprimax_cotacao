// UC25 — gestão de usuários pelo operador chefe: criar, mudar o perfil, inativar e reativar.
import { randomBytes } from 'node:crypto';
import {
  ErroDeAlteracaoDoProprioUsuario,
  ErroDeNovoVendedorObrigatorio,
  ErroDeUsuarioJaCadastrado,
  ErroDeUsuarioNaoEncontrado,
  ErroDeValidacao,
  ErroDeVendedorComCarteira,
} from '../../erros';
import type { Logger } from '../../log';
import type { ServicoDeSenha } from '../auth/senha';
import type { RepositorioDeSessoes, Sessao } from '../auth/sessoes';
import { gerarTokenDeSenha } from '../auth/tokenDeSenha';
import type { DadosDoUsuarioAtualizar, DadosDoUsuarioNovo } from './esquemas';
import type { NotificadorDeEmail } from './notificador';
import {
  PERFIL_VENDEDOR,
  STATUS_ATIVO,
  type AlteracaoDeUsuario,
  type RepositorioDeUsuarios,
  type UsuarioCadastrado,
} from './repositorio';

/** Por quanto tempo vale o link de definição de senha enviado ao usuário novo. */
export const VALIDADE_DO_LINK_DE_DEFINICAO_DE_SENHA_MS = 24 * 60 * 60 * 1000;

/** Bytes da senha aleatória gravada até o usuário definir a própria. */
const BYTES_DA_SENHA_PROVISORIA = 32;
const CAMPO_NOVO_VENDEDOR = 'idNovoVendedor';
const MENSAGEM_NOVO_VENDEDOR_INVALIDO =
  'O novo vendedor responsável deve ser outro usuário ativo com perfil de vendedor.';

/** Usuário da lista de usuários. É o tipo `Usuario` de `frontend/src/api/types.ts`. */
export interface Usuario extends UsuarioCadastrado {
  readonly clientesNaCarteira: number;
}

export interface DependenciasDoServicoDeUsuarios {
  readonly usuarios: RepositorioDeUsuarios;
  readonly senhas: ServicoDeSenha;
  readonly sessoes: RepositorioDeSessoes;
  readonly notificador: NotificadorDeEmail;
  readonly logger: Logger;
  /** Relógio; por padrão, a hora do sistema. */
  readonly agora?: () => Date;
}

/** Regras da gestão de usuários (UC25, RF24). */
export class ServicoDeUsuarios {
  private readonly usuarios: RepositorioDeUsuarios;
  private readonly senhas: ServicoDeSenha;
  private readonly sessoes: RepositorioDeSessoes;
  private readonly notificador: NotificadorDeEmail;
  private readonly logger: Logger;
  private readonly agora: () => Date;

  constructor(dependencias: DependenciasDoServicoDeUsuarios) {
    this.usuarios = dependencias.usuarios;
    this.senhas = dependencias.senhas;
    this.sessoes = dependencias.sessoes;
    this.notificador = dependencias.notificador;
    this.logger = dependencias.logger;
    this.agora = dependencias.agora ?? (() => new Date());
  }

  /** Lista os usuários com o tamanho da carteira de cada um. */
  async listar(): Promise<Usuario[]> {
    const [usuarios, carteiras] = await Promise.all([
      this.usuarios.listar(),
      this.usuarios.contarClientesPorVendedor(),
    ]);
    return usuarios.map((usuario) => ({
      ...usuario,
      clientesNaCarteira: carteiras.get(usuario.idOperador) ?? 0,
    }));
  }

  /**
   * Cria o usuário e manda o link de definição de senha ao e-mail cadastrado.
   *
   * O usuário nasce com uma senha aleatória que ninguém conhece: só consegue entrar depois de
   * definir a própria pelo link. Se o envio do e-mail falhar, o usuário continua criado e pode
   * pedir um novo link pela recuperação de senha.
   *
   * @param autor Operador chefe que fez o cadastro.
   * @throws {ErroDeUsuarioJaCadastrado} Se o nome de usuário ou o e-mail já existir (UC25-E2).
   */
  async criar(dados: DadosDoUsuarioNovo, autor: Sessao): Promise<Usuario> {
    if (await this.usuarios.existeComUsuarioOuEmail(dados.usuario, dados.email)) {
      throw new ErroDeUsuarioJaCadastrado();
    }
    const senhaProvisoria = randomBytes(BYTES_DA_SENHA_PROVISORIA).toString('base64url');
    const convite = gerarTokenDeSenha(VALIDADE_DO_LINK_DE_DEFINICAO_DE_SENHA_MS, this.agora());
    const criado = await this.inserir({
      ...dados,
      senhaHash: await this.senhas.gerarHash(senhaProvisoria),
      resumoDoToken: convite.resumo,
      validadeDoToken: convite.validade,
    });
    this.logger.info(
      {
        evento: 'usuario_criado',
        idOperador: criado.idOperador,
        perfil: criado.perfil,
        idAutor: autor.idOperador,
      },
      'Usuário criado.',
    );
    await this.avisar(criado, convite.token, convite.validade);
    return { ...criado, clientesNaCarteira: 0 };
  }

  /**
   * Muda o perfil ou o status do usuário.
   *
   * Um vendedor que deixa de atender (é inativado ou muda de perfil) não pode ficar com clientes:
   * a carteira passa ao vendedor indicado em `idNovoVendedor`. As sessões abertas do usuário são
   * encerradas quando ele é inativado ou muda de perfil.
   *
   * @param autor Operador chefe que fez a alteração.
   * @throws {ErroDeUsuarioNaoEncontrado} Se o usuário não existir.
   * @throws {ErroDeAlteracaoDoProprioUsuario} Se o autor tentar inativar ou rebaixar a si mesmo.
   * @throws {ErroDeNovoVendedorObrigatorio} Ao inativar vendedor com carteira sem indicar o novo
   * responsável (UC25-E1).
   * @throws {ErroDeVendedorComCarteira} Ao mudar o perfil de vendedor com carteira sem indicar o
   * novo responsável.
   * @throws {ErroDeValidacao} Se o novo vendedor não for outro vendedor ativo.
   */
  async atualizar(
    idOperador: number,
    dados: DadosDoUsuarioAtualizar,
    autor: Sessao,
  ): Promise<Usuario> {
    const atual = await this.usuarios.buscarPorId(idOperador);
    if (!atual) {
      throw new ErroDeUsuarioNaoEncontrado();
    }
    const alteracao = this.calcularAlteracao(atual, dados);
    if (alteracao.perfil === undefined && alteracao.status === undefined) {
      // Nada muda: o pedido repete o que já está gravado.
      return { ...atual, clientesNaCarteira: await this.usuarios.contarClientesDe(idOperador) };
    }
    const inativando = alteracao.status !== undefined && alteracao.status !== STATUS_ATIVO;
    const mudandoDePerfil = alteracao.perfil !== undefined;
    if (autor.idOperador === idOperador && (inativando || mudandoDePerfil)) {
      throw new ErroDeAlteracaoDoProprioUsuario();
    }

    const deixaACarteira = atual.perfil === PERFIL_VENDEDOR && (inativando || mudandoDePerfil);
    const carteira = deixaACarteira ? await this.usuarios.contarClientesDe(idOperador) : 0;
    if (carteira > 0) {
      await this.conferirNovoVendedor(idOperador, dados.idNovoVendedor, carteira, inativando);
    }

    await this.usuarios.atualizar(
      idOperador,
      alteracao,
      carteira > 0 ? dados.idNovoVendedor : undefined,
    );
    if (inativando || mudandoDePerfil) {
      await this.sessoes.encerrarDoOperador(idOperador);
    }
    this.logger.info(
      {
        evento: 'usuario_alterado',
        idOperador,
        ...alteracao,
        clientesTransferidos: carteira,
        ...(carteira > 0 && { idNovoVendedor: dados.idNovoVendedor }),
        idAutor: autor.idOperador,
      },
      'Usuário alterado.',
    );
    return {
      ...atual,
      ...alteracao,
      clientesNaCarteira: deixaACarteira ? 0 : await this.usuarios.contarClientesDe(idOperador),
    };
  }

  /** Só entram na alteração os campos pedidos que diferem do valor atual. */
  private calcularAlteracao(
    atual: UsuarioCadastrado,
    { perfil, status }: DadosDoUsuarioAtualizar,
  ): AlteracaoDeUsuario {
    return {
      ...(perfil !== undefined && perfil !== atual.perfil && { perfil }),
      ...(status !== undefined && status !== atual.status && { status }),
    };
  }

  private async conferirNovoVendedor(
    idOperador: number,
    idNovoVendedor: number | undefined,
    carteira: number,
    inativando: boolean,
  ): Promise<void> {
    if (idNovoVendedor === undefined) {
      throw inativando
        ? new ErroDeNovoVendedorObrigatorio(carteira)
        : new ErroDeVendedorComCarteira(carteira);
    }
    const novo =
      idNovoVendedor === idOperador ? null : await this.usuarios.buscarPorId(idNovoVendedor);
    if (novo?.perfil !== PERFIL_VENDEDOR || novo.status !== STATUS_ATIVO) {
      throw new ErroDeValidacao({
        mensagem: MENSAGEM_NOVO_VENDEDOR_INVALIDO,
        detalhes: { campos: [CAMPO_NOVO_VENDEDOR] },
      });
    }
  }

  /**
   * Grava o usuário. Se a gravação falhar porque outro cadastro igual chegou ao mesmo tempo, o
   * erro vira o mesmo conflito da conferência inicial.
   */
  private async inserir(
    novo: Parameters<RepositorioDeUsuarios['inserir']>[0],
  ): Promise<UsuarioCadastrado> {
    try {
      return await this.usuarios.inserir(novo);
    } catch (erro) {
      if (await this.usuarios.existeComUsuarioOuEmail(novo.usuario, novo.email)) {
        throw new ErroDeUsuarioJaCadastrado();
      }
      throw erro;
    }
  }

  private async avisar(usuario: UsuarioCadastrado, token: string, validade: Date): Promise<void> {
    const { idOperador, email } = usuario;
    try {
      await this.notificador.enviarDefinicaoDeSenha({
        idOperador,
        usuario: usuario.usuario,
        email,
        token,
        validade,
      });
    } catch (erro) {
      this.logger.error(
        { evento: 'email_falhou', tipo: 'definicao_de_senha', idOperador, err: erro },
        'Falha ao enviar o e-mail de definição de senha.',
      );
    }
  }
}
