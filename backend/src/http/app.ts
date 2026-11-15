// Item 1 do backend/TAREFAS.md — aplicação Express do backend, sem abrir porta.
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Config } from '../config';
import type { ClienteDeProxy } from '../dados';
import type { Logger } from '../log';
import {
  criarModuloDeAuth,
  type DependenciasDoModuloDeAuth,
  type NotificadorDeRecuperacaoDeSenha,
} from '../modulos/auth';
import type { RepositorioDeSessoes } from '../modulos/auth/sessoes';
import { criarModuloDeClientes } from '../modulos/clientes';
import { criarModuloDeCredito } from '../modulos/credito';
import { criarModuloDeDividas } from '../modulos/dividas';
import { criarModuloDeEntradas } from '../modulos/entradas';
import { criarModuloDeEstoque } from '../modulos/estoque';
import { criarModuloDeFornecedores } from '../modulos/fornecedores';
import { criarModuloDeIndicadores } from '../modulos/indicadores';
import { criarModuloDeJobs } from '../modulos/jobs';
import { criarModuloDeOrcamentos } from '../modulos/orcamentos';
import { criarModuloDePedidos } from '../modulos/pedidos';
import { criarModuloDeProdutos } from '../modulos/produtos';
import { criarModuloDeRespostas } from '../modulos/respostas';
import { criarModuloDeUsuarios, type NotificadorDeEmail } from '../modulos/usuarios';
import { logRequisicao } from './middlewares/logRequisicao';
import { CABECALHO_REQUEST_ID, requestId } from './middlewares/requestId';
import { rotaNaoEncontrada } from './middlewares/rotaNaoEncontrada';
import { semCache } from './middlewares/semCache';
import { tratamentoDeErros } from './middlewares/tratamentoDeErros';
import { criarRotasDeSaude } from './rotas/saude';

/** Tamanho máximo do corpo JSON de uma requisição. */
export const LIMITE_DO_CORPO_JSON = '100kb';

const CONFIGURACAO_TRUST_PROXY = 'trust proxy';
const METODOS_PERMITIDOS_NO_CORS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const CABECALHOS_PERMITIDOS_NO_CORS = ['Authorization', 'Content-Type'];

/** O que a aplicação precisa receber pronto de quem a monta. */
export interface DependenciasDoApp {
  readonly config: Config;
  readonly logger: Logger;
  /** Acesso a dados; os testes passam o dublê. */
  readonly proxy: ClienteDeProxy;
  /** Sessões abertas, compartilhadas por todos os módulos. */
  readonly sessoes: RepositorioDeSessoes;
  /**
   * Ajustes para os testes: custo do hash, limite de login e relógio. O hash e o relógio valem
   * também para os módulos de cadastro.
   */
  readonly auth?: Pick<
    DependenciasDoModuloDeAuth,
    'senhas' | 'limiteDeLogin' | 'limiteDeRecuperacao' | 'agora'
  >;
  /** Envio do e-mail de definição de senha a usuário novo; por padrão, só registra em log. */
  readonly notificador?: NotificadorDeEmail;
  /** Envio do e-mail de recuperação de senha; por padrão, só registra em log. */
  readonly notificadorDeRecuperacao?: NotificadorDeRecuperacaoDeSenha;
}

/**
 * Monta a aplicação Express com os middlewares globais, as rotas e o tratamento de erros.
 *
 * Não chama `listen`: quem sobe o servidor é o `index.ts`, e os testes usam a aplicação direto.
 * As próximas entregas registram suas rotas depois das rotas de saúde e antes de
 * `rotaNaoEncontrada`.
 */
export function createApp({
  config,
  logger,
  proxy,
  sessoes,
  auth,
  notificador,
  notificadorDeRecuperacao,
}: DependenciasDoApp): Express {
  const app = express();
  // Define de onde vem o IP do cliente (req.ip), usado no limite de tentativas de login.
  app.set(CONFIGURACAO_TRUST_PROXY, config.trustProxy);

  app.use(requestId());
  app.use(logRequisicao(logger));
  app.use(helmet());
  app.use(semCache());
  app.use(
    cors({
      origin: [...config.corsOrigens],
      methods: METODOS_PERMITIDOS_NO_CORS,
      allowedHeaders: CABECALHOS_PERMITIDOS_NO_CORS,
      exposedHeaders: [CABECALHO_REQUEST_ID],
    }),
  );
  app.use(express.json({ limit: LIMITE_DO_CORPO_JSON }));

  app.use(criarRotasDeSaude());
  const comuns = { proxy, sessoes, logger };
  const { senhas, agora } = auth ?? {};
  app.use(criarModuloDeAuth({ ...comuns, ...auth, notificador: notificadorDeRecuperacao }).rotas);
  // Orçamentos é montado antes de clientes e de pedidos: a ficha do cliente (RF04) lê os
  // orçamentos dele, e a fila de pedidos (UC10) monta o orçamento (UC14); os dois através dele,
  // sem que nenhum dos dois módulos importe `orcamentos` diretamente.
  const orcamentos = criarModuloDeOrcamentos({
    ...comuns,
    agora,
    empresaEmissora: config.empresaEmissora,
  });
  app.use(criarModuloDeClientes({ ...comuns, agora, orcamentos: orcamentos.servico }).rotas);
  app.use(criarModuloDeProdutos(comuns).rotas);
  app.use(criarModuloDeFornecedores(comuns).rotas);
  app.use(criarModuloDeDividas(comuns).rotas);
  app.use(criarModuloDeEstoque(comuns).rotas);
  // Crédito e orçamentos dependem um do outro (UC07): o orçamento pede a abertura da análise ao
  // entrar em PENDENTE_CREDITO, e a análise devolve o orçamento a RASCUNHO ao sair. Como
  // orçamentos é montado primeiro, a ligação orçamentos → crédito só é possível depois daqui
  // (`definirGestorDeAnaliseCredito`); a ligação crédito → orçamentos entra no construtor.
  const credito = criarModuloDeCredito({ ...comuns, agora, gestorDeOrcamento: orcamentos.servico });
  orcamentos.servico.definirGestorDeAnaliseCredito(credito.servico);
  app.use(credito.rotas);
  // Entrada de mercadoria compartilha a mesma instância de ServicoDeSenha do login (RF19: a
  // liberação de divergência confere usuário e senha do operador chefe).
  app.use(criarModuloDeEntradas({ ...comuns, senhas, agora }).rotas);
  app.use(criarModuloDeIndicadores({ ...comuns, agora }).rotas);
  // O agendador deste módulo não é ligado aqui (createApp não decide o que roda em segundo
  // plano) — só a rota de disparo manual/externo (item 9, `POST /jobs/executar`). Quem liga o
  // agendador in-process é `index.ts` (`principal`), por `JOBS_AGENDADOS_HABILITADOS`.
  app.use(criarModuloDeJobs({ ...comuns, agora }).rotas);
  app.use(criarModuloDeUsuarios({ ...comuns, senhas, agora, notificador }).rotas);
  app.use(orcamentos.rotas);
  app.use(criarModuloDePedidos({ ...comuns, agora, orcamentos: orcamentos.servico }).rotas);
  // Respostas (UC20, UC21) delega a criação/emissão de nova versão ao serviço de orçamentos
  // (`GestorDeVersoesDeOrcamento`), pelo mesmo padrão de injeção usado acima.
  app.use(criarModuloDeRespostas({ ...comuns, agora, gestorDeVersoes: orcamentos.servico }).rotas);

  app.use(rotaNaoEncontrada());
  app.use(tratamentoDeErros(logger));

  return app;
}
