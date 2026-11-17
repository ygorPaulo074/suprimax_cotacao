// Recebimento de arquivo enviado em multipart (campo `arquivo`), em memória, com o mesmo tratamento
// de erros do multer para todas as rotas que aceitam upload (anexos de orçamento, UC19; documentos
// de análise de crédito, UC07). O serviço de cada módulo envia os bytes ao armazenamento (proxy).
import multer, { MulterError } from 'multer';
import {
  AppError,
  ErroDeNomeDeArquivoLongoDemais,
  ErroDeTipoDeArquivoNaoAceito,
  ErroDeValidacao,
} from '../../erros';

/** Tamanho máximo de um arquivo enviado (mesmo teto do proxy: 10 MB). */
export const TAMANHO_MAXIMO_DO_ARQUIVO_EM_BYTES = 10 * 1024 * 1024;
export const CAMPO_DO_ARQUIVO_NO_MULTIPART = 'arquivo';
export const MENSAGEM_DE_ARQUIVO_AUSENTE = 'Envie o arquivo no campo "arquivo" do multipart.';

/** Tamanho máximo do nome do arquivo (colunas `nome_arquivo` são VARCHAR(255)). */
export const TAMANHO_MAXIMO_DO_NOME_DO_ARQUIVO = 255;
/** Tipos de conteúdo aceitos nos documentos de análise de crédito (dado sensível, LGPD). */
export const TIPOS_DE_CONTEUDO_DE_DOCUMENTO_DE_CREDITO: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
];

const receberArquivo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANHO_MAXIMO_DO_ARQUIVO_EM_BYTES },
}).single(CAMPO_DO_ARQUIVO_NO_MULTIPART);

/**
 * Middleware: lê o arquivo do multipart (requisições que não são multipart passam direto, sem
 * `req.file`) e converte qualquer erro do multer (ex.: arquivo grande demais) em `AppError`, para
 * o `tratamentoDeErros` central responder certo.
 */
export function processarUploadDeArquivo(
  req: Parameters<typeof receberArquivo>[0],
  res: Parameters<typeof receberArquivo>[1],
  proximo: (erro?: unknown) => void,
): void {
  processar(req, res, proximo);
}

/**
 * Como `processarUploadDeArquivo`, mas recusa (422) arquivo cujo tipo de conteúdo não esteja em
 * `tiposAceitos`, antes de qualquer envio ao armazenamento.
 */
export function processarUploadComTiposAceitos(tiposAceitos: readonly string[]) {
  return (
    req: Parameters<typeof receberArquivo>[0],
    res: Parameters<typeof receberArquivo>[1],
    proximo: (erro?: unknown) => void,
  ): void => processar(req, res, proximo, tiposAceitos);
}

function processar(
  req: Parameters<typeof receberArquivo>[0],
  res: Parameters<typeof receberArquivo>[1],
  proximo: (erro?: unknown) => void,
  tiposAceitos?: readonly string[],
): void {
  receberArquivo(req, res, (erro: unknown) => {
    if (!erro) {
      const arquivo = req.file;
      if (arquivo && arquivo.originalname.length > TAMANHO_MAXIMO_DO_NOME_DO_ARQUIVO) {
        proximo(new ErroDeNomeDeArquivoLongoDemais());
        return;
      }
      if (arquivo && tiposAceitos && !tiposAceitos.includes(arquivo.mimetype)) {
        proximo(new ErroDeTipoDeArquivoNaoAceito());
        return;
      }
      proximo();
      return;
    }
    if (erro instanceof MulterError && erro.code === 'LIMIT_FILE_SIZE') {
      proximo(new AppError('PAYLOAD_TOO_LARGE', { causa: erro }));
      return;
    }
    proximo(new ErroDeValidacao({ mensagem: MENSAGEM_DE_ARQUIVO_AUSENTE, causa: erro }));
  });
}
