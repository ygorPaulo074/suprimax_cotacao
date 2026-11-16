// UC19, RF11 — armazenamento dos arquivos anexados aos orçamentos. O backend nunca acessa o
// Storage diretamente (RNF05): tudo passa pelo proxy, que guarda as credenciais e monta o caminho
// do objeto (operações `arquivo.salvar`, `arquivo.remover` e `arquivo.assinar`, docs/12).
import { z } from 'zod';
import { ErroDeServicoIndisponivel, ErroInterno } from '../erros';
import { ErroProxy, type ClienteDeProxy } from './proxyCliente';
import { CODIGOS_DO_PROXY } from './traducaoDeErros';

/** Validade padrão de uma URL assinada: curta, porque o frontend a usa logo após pedi-la. */
export const VALIDADE_PADRAO_DA_URL_EM_SEGUNDOS = 300;

const OPERACOES_DE_ARQUIVO = {
  SALVAR: 'UC19-salvar-arquivo',
  REMOVER: 'UC19-remover-arquivo',
  ASSINAR: 'UC19-assinar-arquivo',
} as const;

/** O objeto pedido não existe no armazenamento. */
export class ErroDeArquivoNaoEncontrado extends Error {
  constructor() {
    super('Arquivo não encontrado no armazenamento.');
    this.name = 'ErroDeArquivoNaoEncontrado';
  }
}

/**
 * Informe exatamente um dono: `idOrcamento` (anexo, bucket de anexos) ou `idAnaliseCredito`
 * (documento de análise de crédito, UC07, bucket privado separado). O proxy escolhe o bucket e
 * monta o caminho; as demais operações o deduzem do prefixo do caminho devolvido.
 */
export interface ArquivoASalvar {
  readonly idOrcamento?: number;
  readonly idAnaliseCredito?: number;
  readonly nomeArquivo: string;
  readonly tipoConteudo: string;
  readonly conteudo: Buffer;
}

export interface UrlAssinada {
  readonly url: string;
  /** Instante de expiração, em ISO 8601. */
  readonly expiraEm: string;
}

/** Guarda e entrega os bytes dos anexos. O `caminho` é opaco: só quem o recebeu o interpreta. */
export interface ArmazenamentoDeArquivos {
  /**
   * Grava o arquivo e devolve o caminho a guardar em `anexo_orcamento.caminho_arquivo`.
   *
   * @throws {ErroDeServicoIndisponivel} Se o proxy/Storage estiver fora do ar (503).
   */
  salvar(arquivo: ArquivoASalvar): Promise<string>;
  /** Remove o objeto. Remover algo que já não existe não é erro. */
  remover(caminho: string): Promise<void>;
  /**
   * @throws {ErroDeArquivoNaoEncontrado} Se o objeto não existir.
   */
  gerarUrlAssinada(caminho: string, expiraEmSegundos?: number): Promise<UrlAssinada>;
}

const esquemaDoCaminho = z.object({ caminho: z.string().min(1) });
const esquemaDaUrlAssinada = z.object({ url: z.string().min(1), expiraEm: z.string().min(1) });

function interpretar<T>(esquema: z.ZodType<T>, dados: unknown, operacao: string): T {
  const resultado = esquema.safeParse(dados);
  if (!resultado.success) {
    throw new ErroInterno(new Error(`Resposta de ${operacao} fora do formato esperado.`));
  }
  return resultado.data;
}

/** Erro do proxy ainda não traduzido (4xx desconhecido): vira erro interno, sem detalhe. */
function comoErroInterno(erro: unknown): unknown {
  return erro instanceof ErroProxy ? new ErroInterno(erro) : erro;
}

/**
 * Armazenamento real: delega ao proxy, que fala com o Storage. O conteúdo viaja em base64 dentro
 * do JSON. Nada do conteúdo, do caminho ou da URL assinada é logado aqui.
 */
export class ArmazenamentoViaProxy implements ArmazenamentoDeArquivos {
  constructor(private readonly proxy: ClienteDeProxy) {}

  async salvar(arquivo: ArquivoASalvar): Promise<string> {
    try {
      const resposta = await this.proxy.executar<{ dados?: unknown }>(
        'arquivo.salvar',
        {
          ...(arquivo.idOrcamento !== undefined && { id_orcamento: arquivo.idOrcamento }),
          ...(arquivo.idAnaliseCredito !== undefined && {
            id_analise_credito: arquivo.idAnaliseCredito,
          }),
          nome_arquivo: arquivo.nomeArquivo,
          tipo_conteudo: arquivo.tipoConteudo,
          conteudo_base64: arquivo.conteudo.toString('base64'),
        },
        OPERACOES_DE_ARQUIVO.SALVAR,
      );
      return interpretar(esquemaDoCaminho, resposta.dados, 'arquivo.salvar').caminho;
    } catch (erro) {
      throw comoErroInterno(erro);
    }
  }

  async remover(caminho: string): Promise<void> {
    try {
      await this.proxy.executar('arquivo.remover', { caminho }, OPERACOES_DE_ARQUIVO.REMOVER);
    } catch (erro) {
      if (erro instanceof ErroProxy && erro.codigo === CODIGOS_DO_PROXY.NOT_FOUND) {
        return;
      }
      throw comoErroInterno(erro);
    }
  }

  async gerarUrlAssinada(
    caminho: string,
    expiraEmSegundos = VALIDADE_PADRAO_DA_URL_EM_SEGUNDOS,
  ): Promise<UrlAssinada> {
    try {
      const resposta = await this.proxy.executar<{ dados?: unknown }>(
        'arquivo.assinar',
        { caminho, expira_em_segundos: expiraEmSegundos },
        OPERACOES_DE_ARQUIVO.ASSINAR,
      );
      return interpretar(esquemaDaUrlAssinada, resposta.dados, 'arquivo.assinar');
    } catch (erro) {
      if (erro instanceof ErroProxy && erro.codigo === CODIGOS_DO_PROXY.NOT_FOUND) {
        throw new ErroDeArquivoNaoEncontrado();
      }
      throw comoErroInterno(erro);
    }
  }
}

/** Armazenamento em memória, para testes e desenvolvimento sem proxy. Não persiste nada. */
export class ArmazenamentoEmMemoria implements ArmazenamentoDeArquivos {
  /** Objetos guardados, por caminho. */
  readonly objetos = new Map<string, { conteudo: Buffer; tipoConteudo: string }>();
  /** Liga/desliga falhas simuladas (503), para os testes. */
  falharAoSalvar = false;
  falharAoRemover = false;
  private sequencia = 0;

  salvar(arquivo: ArquivoASalvar): Promise<string> {
    if (this.falharAoSalvar) {
      return Promise.reject(new ErroDeServicoIndisponivel());
    }
    this.sequencia += 1;
    const dono =
      arquivo.idAnaliseCredito === undefined
        ? `orcamentos/${arquivo.idOrcamento}`
        : `analise-credito/${arquivo.idAnaliseCredito}`;
    const caminho = `${dono}/${this.sequencia}-${arquivo.nomeArquivo}`;
    this.objetos.set(caminho, { conteudo: arquivo.conteudo, tipoConteudo: arquivo.tipoConteudo });
    return Promise.resolve(caminho);
  }

  remover(caminho: string): Promise<void> {
    if (this.falharAoRemover) {
      return Promise.reject(new ErroDeServicoIndisponivel());
    }
    this.objetos.delete(caminho);
    return Promise.resolve();
  }

  gerarUrlAssinada(
    caminho: string,
    expiraEmSegundos = VALIDADE_PADRAO_DA_URL_EM_SEGUNDOS,
  ): Promise<UrlAssinada> {
    if (!this.objetos.has(caminho)) {
      return Promise.reject(new ErroDeArquivoNaoEncontrado());
    }
    return Promise.resolve({
      url: `https://armazenamento.local/${encodeURI(caminho)}?expira=${expiraEmSegundos}`,
      expiraEm: new Date(Date.now() + expiraEmSegundos * 1000).toISOString(),
    });
  }
}
