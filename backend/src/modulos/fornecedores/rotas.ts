// UC22 — rotas de fornecedores (docs/frontend-api.md, tela 16).
import { Router } from 'express';
import { STATUS_HTTP } from '../../erros';
import { exigirPerfil, exigirSessao, obterSessao } from '../../http/middlewares/autenticacao';
import { rotaAssincrona } from '../../http/rotaAssincrona';
import { validarEntrada } from '../../http/validacao';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { esquemaDeFornecedorNovo } from './esquemas';
import type { ServicoDeFornecedores } from './servico';

export const ROTA_DE_FORNECEDORES = '/fornecedores';

export interface DependenciasDasRotasDeFornecedores {
  readonly servico: ServicoDeFornecedores;
  readonly sessoes: RepositorioDeSessoes;
}

/**
 * Rotas de fornecedores:
 * - `GET /fornecedores` (OPERADOR e OPERADOR_CHEFE): lista, usada também na entrada de mercadoria;
 * - `POST /fornecedores` (OPERADOR_CHEFE): 201 com o fornecedor criado, ou 200 com o cadastro
 *   existente quando o CNPJ já está cadastrado.
 */
export function criarRotasDeFornecedores({
  servico,
  sessoes,
}: DependenciasDasRotasDeFornecedores): Router {
  const rotas = Router();
  const autenticado = exigirSessao(sessoes);

  rotas.get(
    ROTA_DE_FORNECEDORES,
    autenticado,
    exigirPerfil('OPERADOR', 'OPERADOR_CHEFE'),
    rotaAssincrona(async (_req, res) => {
      res.status(STATUS_HTTP.OK).json(await servico.listar());
    }),
  );

  rotas.post(
    ROTA_DE_FORNECEDORES,
    autenticado,
    exigirPerfil('OPERADOR_CHEFE'),
    rotaAssincrona(async (req, res) => {
      const dados = validarEntrada(esquemaDeFornecedorNovo, req.body);
      const { fornecedor, criado } = await servico.cadastrar(dados, obterSessao(res));
      res.status(criado ? STATUS_HTTP.CRIADO : STATUS_HTTP.OK).json(fornecedor);
    }),
  );

  return rotas;
}
