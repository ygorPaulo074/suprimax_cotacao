// UC22 — cadastro mínimo de fornecedores, usado na entrada de mercadoria (RF22).
import type { Logger } from '../../log';
import type { Sessao } from '../auth/sessoes';
import type { DadosDoFornecedorNovo } from './esquemas';
import type { Fornecedor, RepositorioDeFornecedores } from './repositorio';

/** Resultado do cadastro: o fornecedor e se ele foi criado agora ou já existia. */
export interface ResultadoDoCadastroDeFornecedor {
  readonly fornecedor: Fornecedor;
  readonly criado: boolean;
}

export interface DependenciasDoServicoDeFornecedores {
  readonly fornecedores: RepositorioDeFornecedores;
  readonly logger: Logger;
}

/** Regras do cadastro de fornecedores (UC22). */
export class ServicoDeFornecedores {
  private readonly fornecedores: RepositorioDeFornecedores;
  private readonly logger: Logger;

  constructor(dependencias: DependenciasDoServicoDeFornecedores) {
    this.fornecedores = dependencias.fornecedores;
    this.logger = dependencias.logger;
  }

  /** Lista os fornecedores cadastrados. */
  listar(): Promise<Fornecedor[]> {
    return this.fornecedores.listar();
  }

  /**
   * Cadastra o fornecedor. Se o CNPJ já estiver cadastrado, nada é gravado: o cadastro existente
   * é devolvido como está, para a tela abri-lo (UC22-E1).
   *
   * @param autor Operador chefe que fez o cadastro.
   */
  async cadastrar(
    dados: DadosDoFornecedorNovo,
    autor: Sessao,
  ): Promise<ResultadoDoCadastroDeFornecedor> {
    const existente = await this.fornecedores.buscarPorCnpj(dados.cnpj);
    if (existente) {
      return { fornecedor: existente, criado: false };
    }
    const resultado = await this.inserir(dados);
    if (resultado.criado) {
      this.logger.info(
        {
          evento: 'fornecedor_cadastrado',
          idFornecedor: resultado.fornecedor.idFornecedor,
          idAutor: autor.idOperador,
        },
        'Fornecedor cadastrado.',
      );
    }
    return resultado;
  }

  /**
   * Grava o fornecedor. Se a gravação falhar porque o mesmo CNPJ foi cadastrado ao mesmo tempo
   * por outra requisição, devolve o cadastro que chegou primeiro.
   */
  private async inserir(dados: DadosDoFornecedorNovo): Promise<ResultadoDoCadastroDeFornecedor> {
    try {
      return { fornecedor: await this.fornecedores.inserir(dados), criado: true };
    } catch (erro) {
      const existente = await this.fornecedores.buscarPorCnpj(dados.cnpj);
      if (existente) {
        return { fornecedor: existente, criado: false };
      }
      throw erro;
    }
  }
}
