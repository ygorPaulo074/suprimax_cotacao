import { api } from './client';
import type {
  AnaliseCreditoDetalhe,
  AnaliseCreditoResumo,
  DataISO,
  ResultadoCredito,
  TipoDocumentoCredito,
} from './types';

export const TIPOS_DE_ARQUIVO_DE_CREDITO = ['application/pdf', 'image/jpeg', 'image/png'];
export const TAMANHO_MAXIMO_ARQUIVO_CREDITO = 10 * 1024 * 1024;

/** Validação no cliente do arquivo de crédito (PDF, JPEG ou PNG, até 10 MB); devolve a mensagem ou null. */
export function validarArquivoDeCredito(arquivo: File): string | null {
  if (!TIPOS_DE_ARQUIVO_DE_CREDITO.includes(arquivo.type))
    return 'Formato não aceito. Envie um arquivo PDF, JPEG ou PNG.';
  if (arquivo.size > TAMANHO_MAXIMO_ARQUIVO_CREDITO)
    return 'O arquivo é maior que 10 MB. Envie um arquivo menor.';
  return null;
}

export const creditoApi = {
  /** Análises pendentes (e recentes) para o perfil FISCAL. */
  listar: () => api.get<AnaliseCreditoResumo[]>('/analises-credito'),
  obter: (idAnalise: number) => api.get<AnaliseCreditoDetalhe>(`/analises-credito/${idAnalise}`),
  /**
   * Marca o documento do checklist como recebido (status e data de recebimento). Com `arquivo`,
   * envia multipart (campo `arquivo`); sem ele, JSON (recebido em meio físico).
   * 413 arquivo acima de 10 MB; 422 tipo de arquivo não aceito.
   */
  registrarDocumento: (
    idAnalise: number,
    tipo: TipoDocumentoCredito,
    dataRecebimento: DataISO,
    arquivo?: File | null,
  ) => {
    const caminho = `/analises-credito/${idAnalise}/documentos`;
    if (!arquivo)
      return api.post<AnaliseCreditoDetalhe>(caminho, { tipoDocumento: tipo, dataRecebimento });
    const form = new FormData();
    form.append('tipoDocumento', tipo);
    form.append('dataRecebimento', dataRecebimento);
    form.append('arquivo', arquivo);
    return api.upload<AnaliseCreditoDetalhe>(caminho, form);
  },
  /** URL assinada (300 s) do arquivo digital; 404 DOCUMENTO_CREDITO_NAO_ENCONTRADO. */
  urlDoDocumento: (idAnalise: number, tipo: TipoDocumentoCredito) =>
    api.get<{ url: string; expiraEm: string }>(
      `/analises-credito/${idAnalise}/documentos/${tipo}/arquivo`,
    ),
  /** Aprovado ou Reprovado; o orçamento volta de PENDENTE_CREDITO para RASCUNHO. */
  registrarResultado: (idAnalise: number, resultado: ResultadoCredito) =>
    api.post<AnaliseCreditoDetalhe>(`/analises-credito/${idAnalise}/resultado`, { resultado }),
};
