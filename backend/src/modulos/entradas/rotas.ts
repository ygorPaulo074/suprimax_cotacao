// UC04 (passos 6-8) — rota de entrada de mercadoria (docs/frontend-api.md, tela 15).
import { Router } from 'express';
import { STATUS_HTTP } from '../../erros';
import { exigirPerfil, exigirSessao, obterSessao } from '../../http/middlewares/autenticacao';
import { rotaAssincrona } from '../../http/rotaAssincrona';
import { validarEntrada } from '../../http/validacao';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { esquemaDeEntradaNova } from './esquemas';
import type { ServicoDeEntradas } from './servico';

export const ROTA_DE_ENTRADAS = '/entradas-mercadoria';

export interface DependenciasDasRotasDeEntradas {
  readonly servico: ServicoDeEntradas;
  readonly sessoes: RepositorioDeSessoes;
}

/** Rota de entrada de mercadoria (UC04, passos 6-8), para OPERADOR e OPERADOR_CHEFE. */
export function criarRotasDeEntradas({ servico, sessoes }: DependenciasDasRotasDeEntradas): Router {
  const rotas = Router();

  rotas.post(
    ROTA_DE_ENTRADAS,
    exigirSessao(sessoes),
    exigirPerfil('OPERADOR', 'OPERADOR_CHEFE'),
    rotaAssincrona(async (req, res) => {
      const dados = validarEntrada(esquemaDeEntradaNova, req.body);
      await servico.registrar(dados, obterSessao(res));
      res.status(STATUS_HTTP.SEM_CONTEUDO).end();
    }),
  );

  return rotas;
}
