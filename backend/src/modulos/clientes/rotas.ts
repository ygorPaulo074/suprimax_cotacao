// UC02 e UC03 — rotas de clientes (docs/frontend-api.md, telas 4 e 5).
import { Router } from 'express';
import { STATUS_HTTP } from '../../erros';
import { exigirPerfil, exigirSessao, obterSessao } from '../../http/middlewares/autenticacao';
import { rotaAssincrona } from '../../http/rotaAssincrona';
import { validarEntrada } from '../../http/validacao';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { esquemaDeParametroId } from '../comum/campos';
import { esquemaDeBuscaPorCnpj, esquemaDeClienteNovo } from './esquemas';
import type { ServicoDeClientes } from './servico';

export const ROTAS_DE_CLIENTES = {
  COLECAO: '/clientes',
  BUSCA: '/clientes/busca',
  ORCAMENTOS_EM_ABERTO: '/clientes/:id/orcamentos-em-aberto',
  HISTORICO_DE_COMPRAS: '/clientes/:id/historico-compras',
  VENDEDORES: '/vendedores',
} as const;

export interface DependenciasDasRotasDeClientes {
  readonly servico: ServicoDeClientes;
  readonly sessoes: RepositorioDeSessoes;
}

/**
 * Rotas de clientes, para OPERADOR e OPERADOR_CHEFE:
 * - `GET /clientes/busca?cnpj=`: ficha do cliente; `404 CLIENTE_NAO_ENCONTRADO`;
 * - `POST /clientes`: cadastro com `aceiteLgpd: true` → 201 com a ficha;
 * - `GET /clientes/:id/orcamentos-em-aberto` e `/historico-compras`: listas (vazias até o item 6);
 * - `GET /vendedores`: opções do campo "vendedor responsável".
 */
export function criarRotasDeClientes({ servico, sessoes }: DependenciasDasRotasDeClientes): Router {
  const rotas = Router();
  const operador = [exigirSessao(sessoes), exigirPerfil('OPERADOR', 'OPERADOR_CHEFE')];

  rotas.get(
    ROTAS_DE_CLIENTES.BUSCA,
    operador,
    rotaAssincrona(async (req, res) => {
      const { cnpj } = validarEntrada(esquemaDeBuscaPorCnpj, req.query);
      res.status(STATUS_HTTP.OK).json(await servico.buscarFichaPorCnpj(cnpj));
    }),
  );

  rotas.post(
    ROTAS_DE_CLIENTES.COLECAO,
    operador,
    rotaAssincrona(async (req, res) => {
      const dados = validarEntrada(esquemaDeClienteNovo, req.body);
      res.status(STATUS_HTTP.CRIADO).json(await servico.cadastrar(dados, obterSessao(res)));
    }),
  );

  rotas.get(
    ROTAS_DE_CLIENTES.ORCAMENTOS_EM_ABERTO,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      res.status(STATUS_HTTP.OK).json(await servico.listarOrcamentosEmAberto(id));
    }),
  );

  rotas.get(
    ROTAS_DE_CLIENTES.HISTORICO_DE_COMPRAS,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      res.status(STATUS_HTTP.OK).json(await servico.listarHistoricoDeCompras(id));
    }),
  );

  rotas.get(
    ROTAS_DE_CLIENTES.VENDEDORES,
    operador,
    rotaAssincrona(async (_req, res) => {
      res.status(STATUS_HTTP.OK).json(await servico.listarVendedores());
    }),
  );

  return rotas;
}
