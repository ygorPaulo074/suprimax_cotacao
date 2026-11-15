// UC01, UC14-19 — rotas de orçamentos (docs/frontend-api.md).
import { Router } from 'express';
import multer, { MulterError } from 'multer';
import { AppError, ErroDeValidacao, STATUS_HTTP } from '../../erros';
import { exigirPerfil, exigirSessao, obterSessao } from '../../http/middlewares/autenticacao';
import { rotaAssincrona } from '../../http/rotaAssincrona';
import { validarEntrada } from '../../http/validacao';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { esquemaDeIdNaRota, esquemaDeParametroId } from '../comum/campos';
import {
  esquemaDeAnexoNovo,
  esquemaDeCabecalhoAtualizar,
  esquemaDeCancelamento,
  esquemaDeCondicoesAtualizar,
  esquemaDeFiltroDeOrcamentos,
  esquemaDeItemAdicionar,
  esquemaDeOrcamentoNovo,
  esquemaDeQuantidadeAlterar,
} from './esquemas';
import type { ServicoDeOrcamentos } from './servico';

export const ROTAS_DE_ORCAMENTOS = {
  COLECAO: '/orcamentos',
  ITEM: '/orcamentos/:id',
  ITENS: '/orcamentos/:id/itens',
  ITEM_DO_ORCAMENTO: '/orcamentos/:id/itens/:idItem',
  CONDICOES: '/orcamentos/:id/condicoes',
  EMITIR: '/orcamentos/:id/emitir',
  CANCELAR: '/orcamentos/:id/cancelar',
  ANEXOS: '/orcamentos/:id/anexos',
  ANEXO_DO_ORCAMENTO: '/orcamentos/:id/anexos/:idAnexo',
  PDF: '/orcamentos/:id/pdf',
  ENVIAR: '/orcamentos/:id/enviar',
} as const;

/** Nenhum anexo de orçamento precisa ser maior que isto (UC19; limite escolhido nesta entrega). */
const TAMANHO_MAXIMO_DO_ANEXO_EM_BYTES = 10 * 1024 * 1024;
const CAMPO_DO_ARQUIVO_NO_MULTIPART = 'arquivo';
const MENSAGEM_DE_ARQUIVO_AUSENTE = 'Envie o arquivo no campo "arquivo" do multipart.';

const esquemaDeParametrosDoItem = esquemaDeParametroId.extend({ idItem: esquemaDeIdNaRota });
const esquemaDeParametrosDoAnexo = esquemaDeParametroId.extend({ idAnexo: esquemaDeIdNaRota });

/**
 * Recebe o anexo em memória (nenhum armazenamento de arquivos está configurado neste projeto,
 * ver `repositorio.ts`/`CAMINHO_ARQUIVO_NAO_ARMAZENADO`) e converte qualquer erro do multer (ex.:
 * arquivo grande demais) em `AppError`, para o `tratamentoDeErros` central responder certo.
 */
const receberAnexo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANHO_MAXIMO_DO_ANEXO_EM_BYTES },
}).single(CAMPO_DO_ARQUIVO_NO_MULTIPART);

function processarUploadDeAnexo(
  req: Parameters<typeof receberAnexo>[0],
  res: Parameters<typeof receberAnexo>[1],
  proximo: (erro?: unknown) => void,
): void {
  receberAnexo(req, res, (erro: unknown) => {
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

export interface DependenciasDasRotasDeOrcamentos {
  readonly servico: ServicoDeOrcamentos;
  readonly sessoes: RepositorioDeSessoes;
}

/**
 * Rotas de orçamentos, para OPERADOR e OPERADOR_CHEFE:
 * - `GET /orcamentos` e `GET /orcamentos/:id`: listagem (UC01) e detalhe, com as condições
 *   comerciais e os bloqueios sempre recalculados;
 * - `POST /orcamentos`: novo orçamento do zero (UC14);
 * - `PATCH /orcamentos/:id`: cabeçalho;
 * - `POST`/`PATCH`/`DELETE` em `/itens`: inclusão, alteração de quantidade e remoção (UC15-17);
 * - `PUT /orcamentos/:id/condicoes`: condições comerciais (UC18);
 * - `POST /orcamentos/:id/emitir`: emissão (UC19), 422 com `detalhes.bloqueios` se houver
 *   pendência;
 * - `POST /orcamentos/:id/cancelar`: cancelamento, com justificativa opcional.
 * - `POST`/`DELETE` em `/anexos`: upload (multipart, campo `arquivo`) e remoção de anexos (UC19).
 * - `GET /orcamentos/:id/pdf`: PDF do orçamento (docs/09), como `application/pdf` binário.
 * - `POST /orcamentos/:id/enviar`: disponibiliza o orçamento ao vendedor (UC08).
 */
export function criarRotasDeOrcamentos({
  servico,
  sessoes,
}: DependenciasDasRotasDeOrcamentos): Router {
  const rotas = Router();
  const operador = [exigirSessao(sessoes), exigirPerfil('OPERADOR', 'OPERADOR_CHEFE')];

  rotas.get(
    ROTAS_DE_ORCAMENTOS.COLECAO,
    operador,
    rotaAssincrona(async (req, res) => {
      const filtro = validarEntrada(esquemaDeFiltroDeOrcamentos, req.query);
      res.status(STATUS_HTTP.OK).json(await servico.listar(filtro));
    }),
  );

  rotas.post(
    ROTAS_DE_ORCAMENTOS.COLECAO,
    operador,
    rotaAssincrona(async (req, res) => {
      const dados = validarEntrada(esquemaDeOrcamentoNovo, req.body);
      res.status(STATUS_HTTP.CRIADO).json(await servico.criar(dados, obterSessao(res)));
    }),
  );

  rotas.get(
    ROTAS_DE_ORCAMENTOS.ITEM,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      res.status(STATUS_HTTP.OK).json(await servico.obter(id));
    }),
  );

  rotas.patch(
    ROTAS_DE_ORCAMENTOS.ITEM,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      const dados = validarEntrada(esquemaDeCabecalhoAtualizar, req.body);
      res
        .status(STATUS_HTTP.OK)
        .json(await servico.atualizarCabecalho(id, dados, obterSessao(res)));
    }),
  );

  rotas.post(
    ROTAS_DE_ORCAMENTOS.ITENS,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      const dados = validarEntrada(esquemaDeItemAdicionar, req.body);
      res.status(STATUS_HTTP.OK).json(await servico.adicionarItem(id, dados, obterSessao(res)));
    }),
  );

  rotas.patch(
    ROTAS_DE_ORCAMENTOS.ITEM_DO_ORCAMENTO,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id, idItem } = validarEntrada(esquemaDeParametrosDoItem, req.params);
      const { quantidade } = validarEntrada(esquemaDeQuantidadeAlterar, req.body);
      res
        .status(STATUS_HTTP.OK)
        .json(await servico.alterarQuantidade(id, idItem, quantidade, obterSessao(res)));
    }),
  );

  rotas.delete(
    ROTAS_DE_ORCAMENTOS.ITEM_DO_ORCAMENTO,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id, idItem } = validarEntrada(esquemaDeParametrosDoItem, req.params);
      res.status(STATUS_HTTP.OK).json(await servico.removerItem(id, idItem, obterSessao(res)));
    }),
  );

  rotas.put(
    ROTAS_DE_ORCAMENTOS.CONDICOES,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      const dados = validarEntrada(esquemaDeCondicoesAtualizar, req.body);
      res
        .status(STATUS_HTTP.OK)
        .json(await servico.atualizarCondicoes(id, dados, obterSessao(res)));
    }),
  );

  rotas.post(
    ROTAS_DE_ORCAMENTOS.EMITIR,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      res.status(STATUS_HTTP.OK).json(await servico.emitir(id, obterSessao(res)));
    }),
  );

  rotas.post(
    ROTAS_DE_ORCAMENTOS.CANCELAR,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      const { justificativa } = validarEntrada(esquemaDeCancelamento, req.body);
      await servico.cancelar(id, justificativa ?? null, obterSessao(res));
      res.status(STATUS_HTTP.SEM_CONTEUDO).end();
    }),
  );

  rotas.post(
    ROTAS_DE_ORCAMENTOS.ANEXOS,
    operador,
    processarUploadDeAnexo,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      const { tipoAnexo } = validarEntrada(esquemaDeAnexoNovo, req.body);
      if (!req.file) {
        throw new ErroDeValidacao({ mensagem: MENSAGEM_DE_ARQUIVO_AUSENTE });
      }
      res.status(STATUS_HTTP.OK).json(
        await servico.anexar(
          id,
          {
            tipoAnexo,
            nomeArquivo: req.file.originalname,
            tamanhoBytes: req.file.size,
          },
          obterSessao(res),
        ),
      );
    }),
  );

  rotas.delete(
    ROTAS_DE_ORCAMENTOS.ANEXO_DO_ORCAMENTO,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id, idAnexo } = validarEntrada(esquemaDeParametrosDoAnexo, req.params);
      res.status(STATUS_HTTP.OK).json(await servico.removerAnexo(id, idAnexo, obterSessao(res)));
    }),
  );

  rotas.get(
    ROTAS_DE_ORCAMENTOS.PDF,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      const pdf = await servico.gerarPdf(id);
      res
        .status(STATUS_HTTP.OK)
        .set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="orcamento-${id}.pdf"`,
        })
        .send(pdf);
    }),
  );

  rotas.post(
    ROTAS_DE_ORCAMENTOS.ENVIAR,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      // `frontend/src/api/orcamentos.ts`: `enviar` espera `void` (sem corpo), diferente das
      // outras mutações de orçamento.
      await servico.enviar(id, obterSessao(res));
      res.status(STATUS_HTTP.SEM_CONTEUDO).end();
    }),
  );

  return rotas;
}
