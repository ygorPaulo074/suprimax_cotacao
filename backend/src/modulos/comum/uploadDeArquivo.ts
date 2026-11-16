// Recebimento de arquivo enviado em multipart (campo `arquivo`), em memória, com o mesmo tratamento
// de erros do multer para todas as rotas que aceitam upload (anexos de orçamento, UC19; documentos
// de análise de crédito, UC07). O serviço de cada módulo envia os bytes ao armazenamento (proxy).
import multer, { MulterError } from 'multer';
import { AppError, ErroDeValidacao } from '../../erros';

/** Tamanho máximo de um arquivo enviado (mesmo teto do proxy: 10 MB). */
export const TAMANHO_MAXIMO_DO_ARQUIVO_EM_BYTES = 10 * 1024 * 1024;
export const CAMPO_DO_ARQUIVO_NO_MULTIPART = 'arquivo';
export const MENSAGEM_DE_ARQUIVO_AUSENTE = 'Envie o arquivo no campo "arquivo" do multipart.';

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
  receberArquivo(req, res, (erro: unknown) => {
    if (!erro) {
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
