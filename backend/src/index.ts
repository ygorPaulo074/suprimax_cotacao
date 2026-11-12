// Item 1 do backend/TAREFAS.md — ponto de entrada: carrega a configuração e sobe o servidor.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { carregarConfig, ConfigInvalidaError, NIVEL_LOG_PADRAO, type Config } from './config';
import {
  ClienteDeProxyIndisponivel,
  ClienteProxy,
  variaveisDoProxyAusentes,
  type ClienteDeProxy,
} from './dados';
import { createApp, type DependenciasDoApp } from './http/app';
import { RepositorioDeSessoesEmMemoria } from './modulos/auth/sessoes';
import { criarLogger, type Logger, type OpcoesDoLogger } from './log';

/** Tempo para as requisições em andamento terminarem antes de as conexões serem derrubadas. */
export const PRAZO_DE_ENCERRAMENTO_MS = 10_000;

/** Sinais que encerram o servidor. O Render envia SIGTERM a cada deploy. */
export const SINAIS_DE_ENCERRAMENTO = ['SIGTERM', 'SIGINT'] as const;

const CODIGO_DE_SAIDA_SUCESSO = 0;
const CODIGO_DE_SAIDA_FALHA = 1;

/** Parte de `process` usada no encerramento; os testes passam um substituto. */
export type ProcessoEncerravel = Pick<NodeJS.Process, 'once' | 'exit'>;

/** Erro de uso do ServidorHttp fora da ordem (consultar a porta antes de iniciar, iniciar duas vezes). */
export class ServidorHttpError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ServidorHttpError';
  }
}

/**
 * Ciclo de vida do servidor HTTP do backend: abrir a porta, encerrar com calma e reagir aos
 * sinais do sistema operacional.
 */
export class ServidorHttp {
  private servidor?: Server;
  private encerramento?: Promise<void>;

  private readonly config: Config;
  private readonly logger: Logger;

  /**
   * @param dependencias O que a aplicação precisa: configuração, logger, acesso a dados e sessões.
   * @param prazoDeEncerramentoMs Espera máxima pelas requisições em andamento ao encerrar.
   */
  constructor(
    private readonly dependencias: DependenciasDoApp,
    private readonly prazoDeEncerramentoMs: number = PRAZO_DE_ENCERRAMENTO_MS,
  ) {
    this.config = dependencias.config;
    this.logger = dependencias.logger;
  }

  /**
   * Porta em que o servidor de fato escuta.
   *
   * @throws {ServidorHttpError} Se o servidor ainda não foi iniciado.
   */
  get porta(): number {
    if (!this.servidor) {
      throw new ServidorHttpError('O servidor ainda não foi iniciado.');
    }
    return (this.servidor.address() as AddressInfo).port;
  }

  /**
   * Sobe o servidor na porta da configuração.
   *
   * @throws {ServidorHttpError} Se o servidor já foi iniciado.
   * @throws Se a porta não puder ser aberta (por exemplo, já em uso).
   */
  async iniciar(): Promise<void> {
    if (this.servidor) {
      throw new ServidorHttpError('O servidor já foi iniciado.');
    }
    const app = createApp(this.dependencias);
    this.servidor = await new Promise<Server>((resolve, reject) => {
      const servidor = app.listen(this.config.porta);
      servidor.once('error', reject);
      servidor.once('listening', () => {
        servidor.off('error', reject);
        resolve(servidor);
      });
    });
    this.logger.info({ porta: this.porta, ambiente: this.config.ambiente }, 'servidor no ar');
  }

  /**
   * Para de aceitar conexões e espera as requisições em andamento, até o prazo de encerramento.
   * Pode ser chamado mais de uma vez; sem servidor iniciado, não faz nada.
   */
  encerrar(): Promise<void> {
    this.encerramento ??= this.servidor ? this.fechar(this.servidor) : Promise.resolve();
    return this.encerramento;
  }

  /** Encerra o servidor ao receber SIGTERM ou SIGINT e, em seguida, finaliza o processo. */
  registrarEncerramento(processo: ProcessoEncerravel = process): void {
    for (const sinal of SINAIS_DE_ENCERRAMENTO) {
      processo.once(sinal, () => {
        this.logger.info({ sinal }, 'encerrando o servidor');
        this.encerrar().then(
          () => processo.exit(CODIGO_DE_SAIDA_SUCESSO),
          (erro: unknown) => {
            this.logger.error({ err: erro }, 'falha ao encerrar o servidor');
            processo.exit(CODIGO_DE_SAIDA_FALHA);
          },
        );
      });
    }
  }

  private fechar(servidor: Server): Promise<void> {
    return new Promise((resolve, reject) => {
      const temporizador = setTimeout(
        () => servidor.closeAllConnections(),
        this.prazoDeEncerramentoMs,
      );
      servidor.close((erro) => {
        clearTimeout(temporizador);
        if (erro) {
          reject(erro);
        } else {
          resolve();
        }
      });
      servidor.closeIdleConnections();
    });
  }
}

/**
 * Cria o acesso a dados. Sem as variáveis do proxy (só é possível em dev), o servidor sobe mesmo
 * assim, e as rotas que dependem de dados respondem 503.
 */
export function criarClienteDeProxy(config: Config, logger: Logger): ClienteDeProxy {
  const ausentes = variaveisDoProxyAusentes(config);
  if (ausentes.length > 0) {
    logger.warn({ variaveis: ausentes }, 'proxy não configurado: rotas de dados responderão 503');
    return new ClienteDeProxyIndisponivel();
  }
  return ClienteProxy.aPartirDaConfig(config, logger);
}

/**
 * Carrega a configuração, sobe o servidor e registra o encerramento.
 * Se a configuração for inválida ou a porta não abrir, registra o motivo e sai com código 1.
 *
 * @param env Fonte das variáveis de ambiente.
 * @param processo Processo que recebe os sinais e é finalizado.
 * @param destinoDoLog Destino das linhas de log; por padrão, a saída padrão.
 */
export async function principal(
  env: NodeJS.ProcessEnv = process.env,
  processo: ProcessoEncerravel = process,
  destinoDoLog?: OpcoesDoLogger['destino'],
): Promise<void> {
  let logger = criarLogger({ nivel: NIVEL_LOG_PADRAO, destino: destinoDoLog });
  try {
    const config = carregarConfig(env);
    logger = criarLogger({ nivel: config.nivelLog, destino: destinoDoLog });
    const sessoes = new RepositorioDeSessoesEmMemoria({
      inatividadeMs: config.sessaoInatividadeMs,
    });
    sessoes.iniciarLimpeza();
    const proxy = criarClienteDeProxy(config, logger);
    const servidor = new ServidorHttp({ config, logger, proxy, sessoes });
    await servidor.iniciar();
    servidor.registrarEncerramento(processo);
  } catch (erro) {
    if (erro instanceof ConfigInvalidaError) {
      logger.fatal({ variaveis: erro.variaveis }, erro.message);
    } else {
      logger.fatal({ err: erro }, 'falha ao subir o servidor');
    }
    processo.exit(CODIGO_DE_SAIDA_FALHA);
  }
}

if (require.main === module) {
  void principal();
}
