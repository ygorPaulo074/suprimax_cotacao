// UC04 (passos 6-8) — entrada de mercadoria, com a divergência de quantidades e a liberação por
// um operador chefe (RF19).
import type { ClienteDeProxy } from '../../dados';
import {
  ErroDeEntradaDivergente,
  ErroDeFornecedorNaoEncontrado,
  ErroDeLiberacaoNegada,
  ErroDeVariacaoNaoEncontrada,
} from '../../erros';
import type { Logger } from '../../log';
import type { RepositorioDeOperadores } from '../auth/operadores';
import type { ServicoDeSenha } from '../auth/senha';
import type { Sessao } from '../auth/sessoes';
import { registrarMovimentacaoDeEstoque } from '../comum/estoque';
import type { RepositorioDeEstoque } from '../estoque/repositorio';
import type { RepositorioDeFornecedores } from '../fornecedores/repositorio';
import type { DadosDaEntradaNova } from './esquemas';
import { OPERACOES_DE_ENTRADAS, type RepositorioDeEntradas } from './repositorio';

/** Perfil exigido para liberar uma divergência (RF19). */
const PERFIL_DE_LIBERACAO = 'OPERADOR_CHEFE';

export interface DependenciasDoServicoDeEntradas {
  readonly entradas: RepositorioDeEntradas;
  readonly fornecedores: RepositorioDeFornecedores;
  readonly estoque: RepositorioDeEstoque;
  readonly operadores: RepositorioDeOperadores;
  readonly senhas: ServicoDeSenha;
  readonly proxy: ClienteDeProxy;
  readonly logger: Logger;
  readonly agora?: () => Date;
}

/** Regras de registro da entrada de mercadoria (UC04, passos 6-8). */
export class ServicoDeEntradas {
  private readonly entradas: RepositorioDeEntradas;
  private readonly fornecedores: RepositorioDeFornecedores;
  private readonly estoque: RepositorioDeEstoque;
  private readonly operadores: RepositorioDeOperadores;
  private readonly senhas: ServicoDeSenha;
  private readonly proxy: ClienteDeProxy;
  private readonly logger: Logger;
  private readonly agora: () => Date;

  constructor(dependencias: DependenciasDoServicoDeEntradas) {
    this.entradas = dependencias.entradas;
    this.fornecedores = dependencias.fornecedores;
    this.estoque = dependencias.estoque;
    this.operadores = dependencias.operadores;
    this.senhas = dependencias.senhas;
    this.proxy = dependencias.proxy;
    this.logger = dependencias.logger;
    this.agora = dependencias.agora ?? (() => new Date());
  }

  /**
   * Registra a entrada de mercadoria e soma a quantidade informada ao estoque físico.
   *
   * @throws {ErroDeFornecedorNaoEncontrado} Se o fornecedor não existir (404).
   * @throws {ErroDeVariacaoNaoEncontrada} Se a variação não existir (404).
   * @throws {ErroDeEntradaDivergente} Se as quantidades divergirem e não vier liberação (422).
   * @throws {ErroDeLiberacaoNegada} Se a liberação vier com credenciais inválidas ou de um
   * usuário que não é operador chefe (403).
   */
  async registrar(dados: DadosDaEntradaNova, autor: Sessao): Promise<void> {
    const [fornecedor, variacao] = await Promise.all([
      this.fornecedores.buscarPorId(dados.idFornecedor),
      this.estoque.buscarPorId(dados.idVariacao),
    ]);
    if (!fornecedor) {
      throw new ErroDeFornecedorNaoEncontrado();
    }
    if (!variacao) {
      throw new ErroDeVariacaoNaoEncontrada();
    }

    const divergente = dados.quantidadeComprada !== dados.quantidadeInformada;
    const liberacao = divergente ? await this.exigirLiberacao(dados) : null;

    const idEntrada = await this.entradas.inserir({
      idVariacao: dados.idVariacao,
      idFornecedor: dados.idFornecedor,
      idOperador: autor.idOperador,
      numeroCotacaoCompra: dados.numeroCotacaoCompra,
      quantidadeComprada: dados.quantidadeComprada,
      quantidadeInformada: dados.quantidadeInformada,
      idOperadorLiberacao: liberacao?.idOperador ?? null,
      dataLiberacao: liberacao === null ? null : this.agora(),
    });
    await registrarMovimentacaoDeEstoque(
      this.proxy,
      {
        idVariacao: dados.idVariacao,
        tipo: 'ENTRADA',
        quantidade: dados.quantidadeInformada,
        idOperador: autor.idOperador,
        idEntrada,
        quantidadeEstoqueAtual: variacao.quantidadeEstoque,
      },
      OPERACOES_DE_ENTRADAS.REGISTRAR,
    );
    this.logger.info(
      {
        evento: 'entrada_mercadoria_registrada',
        idEntrada,
        idVariacao: dados.idVariacao,
        divergente,
        idAutor: autor.idOperador,
      },
      'Entrada de mercadoria registrada.',
    );
  }

  /**
   * Confere as credenciais informadas na liberação: usuário existente, senha correta e perfil
   * OPERADOR_CHEFE. Devolve o operador liberador, ou lança `ErroDeLiberacaoNegada`.
   */
  private async exigirLiberacao(dados: DadosDaEntradaNova): Promise<{ idOperador: number }> {
    if (!dados.liberacao) {
      throw new ErroDeEntradaDivergente();
    }
    const credenciais = await this.operadores.buscarCredenciais(dados.liberacao.usuario);
    if (
      !credenciais ||
      credenciais.status !== 'ATIVO' ||
      credenciais.perfil !== PERFIL_DE_LIBERACAO
    ) {
      await this.senhas.simularVerificacao(dados.liberacao.senha);
      throw new ErroDeLiberacaoNegada();
    }
    const senhaValida = await this.senhas.verificar(dados.liberacao.senha, credenciais.senhaHash);
    if (!senhaValida) {
      throw new ErroDeLiberacaoNegada();
    }
    return { idOperador: credenciais.idOperador };
  }
}
