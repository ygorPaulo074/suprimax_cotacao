// UC07 — regras da análise de crédito: abertura automática (pedida pelo orçamento), checklist de
// documentos e registro do resultado pelo fiscal (devolvendo o orçamento a RASCUNHO).
import { ArmazenamentoDeArquivos, ErroDeArquivoNaoEncontrado } from '../../dados/armazenamento';
import {
  ErroDeAnaliseCreditoJaConcluida,
  ErroDeAnaliseCreditoNaoEncontrada,
  ErroDeDocumentoDeCreditoNaoEncontrado,
} from '../../erros';
import type { Logger } from '../../log';
import type { Sessao } from '../auth/sessoes';
import type { RepositorioDeClientes } from '../clientes/repositorio';
import { hojeComoDataISO } from '../cotacao/calculoAdapter';
import type { ResultadoDeCredito } from '../comum/situacaoCliente';
import type { DadosDoDocumentoRecebido } from './esquemas';
import {
  TIPOS_DE_DOCUMENTO_CREDITO,
  type AnaliseCredito,
  type RepositorioDeAnalisesDeCredito,
  type TipoDeDocumentoCredito,
} from './repositorio';

/** Documento do checklist (`DocumentoCredito` do frontend). */
export interface DocumentoCredito {
  readonly tipoDocumento: TipoDeDocumentoCredito;
  readonly recebido: boolean;
  readonly dataRecebimento: string | null;
  /** Há arquivo digital (baixável pela URL assinada); falso = recebido em meio físico. */
  readonly temArquivo: boolean;
}

/** Análise como a tela lista (`AnaliseCreditoResumo` do frontend). */
export interface AnaliseCreditoResumo {
  readonly idAnalise: number;
  readonly cliente: string;
  readonly cnpj: string;
  readonly numeroOrcamento: number | null;
  readonly dataSolicitacao: string;
  readonly resultado: ResultadoDeCredito | null;
}

/** Análise com o checklist completo (`AnaliseCreditoDetalhe` do frontend). */
export interface AnaliseCreditoDetalhe extends AnaliseCreditoResumo {
  readonly valorCompra: number | null;
  readonly documentos: DocumentoCredito[];
}

/**
 * O que a análise de crédito pede ao orçamento (UC07): reabrir as condições comerciais quando o
 * resultado sai. Implementado por `ServicoDeOrcamentos`, injetado no construtor — ao contrário da
 * direção oposta, o orçamento já existe quando este serviço é montado.
 */
export interface GestorDeOrcamentoParaCredito {
  resolverPendenciaDeCredito(idOrcamento: number, autor: Sessao): Promise<void>;
}

export interface DependenciasDoServicoDeAnaliseCredito {
  readonly analises: RepositorioDeAnalisesDeCredito;
  readonly clientes: RepositorioDeClientes;
  readonly gestorDeOrcamento: GestorDeOrcamentoParaCredito;
  readonly armazenamento: ArmazenamentoDeArquivos;
  readonly logger: Logger;
  readonly agora?: () => Date;
}

/** Arquivo enviado junto com o documento (multipart, campo `arquivo`). */
export interface ArquivoDoUploadDeCredito {
  readonly nomeArquivo: string;
  readonly tipoConteudo: string;
  readonly conteudo: Buffer;
}

/** Regras de negócio da análise de crédito (UC07). */
export class ServicoDeAnaliseCredito {
  private readonly analises: RepositorioDeAnalisesDeCredito;
  private readonly clientes: RepositorioDeClientes;
  private readonly gestorDeOrcamento: GestorDeOrcamentoParaCredito;
  private readonly armazenamento: ArmazenamentoDeArquivos;
  private readonly logger: Logger;
  private readonly agora: () => Date;

  constructor(dependencias: DependenciasDoServicoDeAnaliseCredito) {
    this.analises = dependencias.analises;
    this.clientes = dependencias.clientes;
    this.gestorDeOrcamento = dependencias.gestorDeOrcamento;
    this.armazenamento = dependencias.armazenamento;
    this.logger = dependencias.logger;
    this.agora = dependencias.agora ?? (() => new Date());
  }

  /**
   * Implementa `GestorDeAnaliseDeCredito` (chamado pelo orçamento ao entrar em
   * PENDENTE_CREDITO). Idempotente: se o cliente já tem uma análise sem resultado, não abre outra.
   */
  async solicitarAnalise(dados: { idCliente: number; idOrcamento: number }): Promise<void> {
    const pendente = await this.analises.buscarPendentePorCliente(dados.idCliente);
    if (pendente) {
      return;
    }
    const idAnalise = await this.analises.abrir({
      idCliente: dados.idCliente,
      idOrcamento: dados.idOrcamento,
      dataSolicitacao: hojeComoDataISO(this.agora()),
    });
    this.logger.info(
      { evento: 'analise_credito_solicitada', idAnalise, idCliente: dados.idCliente },
      'Análise de crédito aberta.',
    );
  }

  /** Lista as análises (mais recentes primeiro), para a fila do fiscal. */
  async listar(): Promise<AnaliseCreditoResumo[]> {
    const analises = await this.analises.listar();
    return this.comResumo(analises);
  }

  /** Detalhe de uma análise, com o checklist de documentos. */
  async obter(idAnalise: number): Promise<AnaliseCreditoDetalhe> {
    const analise = await this.buscarOuFalhar(idAnalise);
    const [resumo] = await this.comResumo([analise]);
    const [documentos, valorCompra] = await Promise.all([
      this.comChecklistCompleto(idAnalise),
      this.valorCompraDe(analise),
    ]);
    return { ...(resumo as AnaliseCreditoResumo), valorCompra, documentos };
  }

  /**
   * Marca um tipo de documento do checklist como recebido (UC07). Com `arquivo`, guarda também o
   * arquivo digital (dado sensível, LGPD) no armazenamento privado, via proxy: primeiro o objeto,
   * depois a linha; se gravar a linha falhar, o objeto é removido (compensação). Sem `arquivo`, só
   * registra o recebimento em meio físico (comportamento anterior).
   *
   * @throws {ErroDeAnaliseCreditoNaoEncontrada} Se a análise não existir (404).
   */
  async registrarDocumento(
    idAnalise: number,
    dados: DadosDoDocumentoRecebido,
    arquivo?: ArquivoDoUploadDeCredito,
  ): Promise<AnaliseCreditoDetalhe> {
    await this.buscarOuFalhar(idAnalise);
    let caminhoNovo: string | undefined;
    if (arquivo) {
      caminhoNovo = await this.armazenamento.salvar({
        idAnaliseCredito: idAnalise,
        nomeArquivo: arquivo.nomeArquivo,
        tipoConteudo: arquivo.tipoConteudo,
        conteudo: arquivo.conteudo,
      });
    }
    let substituido: string | null;
    try {
      substituido = await this.analises.registrarDocumento({
        idAnalise,
        tipoDocumento: dados.tipoDocumento,
        dataRecebimento: dados.dataRecebimento,
        ...(arquivo &&
          caminhoNovo !== undefined && {
            arquivo: { nomeArquivo: arquivo.nomeArquivo, caminhoArquivo: caminhoNovo },
          }),
      });
    } catch (erro) {
      if (caminhoNovo !== undefined) {
        await this.removerObjetoOrfao(idAnalise, caminhoNovo);
      }
      throw erro;
    }
    if (substituido !== null) {
      await this.removerObjetoOrfao(idAnalise, substituido);
    }
    this.logger.info(
      {
        evento: 'documento_credito_registrado',
        idAnalise,
        tipo: dados.tipoDocumento,
        comArquivo: arquivo !== undefined,
      },
      'Documento do checklist de crédito marcado como recebido.',
    );
    return this.obter(idAnalise);
  }

  /**
   * URL assinada de curta duração para baixar o arquivo digital do documento (UC07, fiscal).
   *
   * @throws {ErroDeAnaliseCreditoNaoEncontrada} Se a análise não existir (404).
   * @throws {ErroDeDocumentoDeCreditoNaoEncontrado} Se a análise não tiver esse documento com
   * arquivo digital, ou o arquivo faltar no armazenamento (404).
   */
  async obterUrlDoDocumento(
    idAnalise: number,
    tipoDocumento: TipoDeDocumentoCredito,
  ): Promise<{ url: string; expiraEm: string }> {
    await this.buscarOuFalhar(idAnalise);
    const caminho = await this.analises.buscarCaminhoDoArquivo(idAnalise, tipoDocumento);
    if (caminho === null) {
      throw new ErroDeDocumentoDeCreditoNaoEncontrado();
    }
    try {
      return await this.armazenamento.gerarUrlAssinada(caminho);
    } catch (erro) {
      if (erro instanceof ErroDeArquivoNaoEncontrado) {
        throw new ErroDeDocumentoDeCreditoNaoEncontrado();
      }
      throw erro;
    }
  }

  /** Remove um objeto que ficou sem linha (ou foi substituído); falhar aqui só vira log. */
  private async removerObjetoOrfao(idAnalise: number, caminho: string): Promise<void> {
    await this.armazenamento.remover(caminho).catch((falha: unknown) => {
      this.logger.warn(
        { evento: 'documento_credito_objeto_orfao', idAnalise, err: falha },
        'não foi possível remover o arquivo do documento de crédito do armazenamento',
      );
    });
  }

  /**
   * Registra o resultado da análise (UC07, fiscal) e devolve o orçamento vinculado a RASCUNHO,
   * aprovado ou reprovado (ambos reabrem as condições comerciais — ver
   * `ServicoDeOrcamentos.resolverPendenciaDeCredito`).
   *
   * @throws {ErroDeAnaliseCreditoNaoEncontrada} Se a análise não existir (404).
   * @throws {ErroDeAnaliseCreditoJaConcluida} Se a análise já tiver um resultado (409).
   */
  async registrarResultado(
    idAnalise: number,
    resultado: ResultadoDeCredito,
    autor: Sessao,
  ): Promise<AnaliseCreditoDetalhe> {
    const analise = await this.buscarOuFalhar(idAnalise);
    if (analise.resultado !== null) {
      throw new ErroDeAnaliseCreditoJaConcluida();
    }
    await this.analises.registrarResultado(idAnalise, {
      resultado,
      dataAnalise: hojeComoDataISO(this.agora()),
      idOperadorFiscal: autor.idOperador,
    });
    this.logger.info(
      { evento: 'analise_credito_concluida', idAnalise, resultado, idAutor: autor.idOperador },
      'Resultado da análise de crédito registrado.',
    );
    if (analise.idOrcamento !== null) {
      await this.gestorDeOrcamento.resolverPendenciaDeCredito(analise.idOrcamento, autor);
    }
    return this.obter(idAnalise);
  }

  private async buscarOuFalhar(idAnalise: number): Promise<AnaliseCredito> {
    const analise = await this.analises.buscarPorId(idAnalise);
    if (!analise) {
      throw new ErroDeAnaliseCreditoNaoEncontrada();
    }
    return analise;
  }

  private async valorCompraDe(analise: AnaliseCredito): Promise<number | null> {
    if (analise.idOrcamento === null) {
      return null;
    }
    const dadosDoOrcamento = await this.analises.buscarDadosDoOrcamento(analise.idOrcamento);
    return dadosDoOrcamento?.valorTotalProposta ?? null;
  }

  private async comChecklistCompleto(idAnalise: number): Promise<DocumentoCredito[]> {
    const recebidos = await this.analises.listarDocumentos(idAnalise);
    const porTipo = new Map(recebidos.map((documento) => [documento.tipoDocumento, documento]));
    return TIPOS_DE_DOCUMENTO_CREDITO.map((tipoDocumento) => {
      const recebido = porTipo.get(tipoDocumento);
      return {
        tipoDocumento,
        recebido: recebido !== undefined,
        dataRecebimento: recebido?.dataRecebimento ?? null,
        temArquivo: recebido?.temArquivo ?? false,
      };
    });
  }

  private async comResumo(analises: readonly AnaliseCredito[]): Promise<AnaliseCreditoResumo[]> {
    const idsUnicos = [...new Set(analises.map((analise) => analise.idCliente))];
    const clientes = await Promise.all(idsUnicos.map((id) => this.clientes.buscarPorId(id)));
    const porCliente = new Map(
      clientes.flatMap((cliente, indice) =>
        cliente ? [[idsUnicos[indice] as number, cliente] as const] : [],
      ),
    );
    const orcamentos = await Promise.all(
      analises.map((analise) =>
        analise.idOrcamento === null
          ? Promise.resolve(null)
          : this.analises.buscarDadosDoOrcamento(analise.idOrcamento),
      ),
    );
    return analises.map((analise, indice) => {
      const cliente = porCliente.get(analise.idCliente);
      return {
        idAnalise: analise.idAnalise,
        cliente: cliente?.razaoSocial ?? '',
        cnpj: cliente?.cnpj ?? '',
        numeroOrcamento: orcamentos[indice]?.numeroOrcamento ?? null,
        dataSolicitacao: analise.dataSolicitacao,
        resultado: analise.resultado,
      };
    });
  }
}
