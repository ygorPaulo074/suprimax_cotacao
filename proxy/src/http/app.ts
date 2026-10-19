import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { AppError, corpoDoErro } from '../erros';
import { processar, type DepsServidor } from './processar';

type RequisicaoComCorpo = Request & { corpoBruto?: string };

export function criarApp(deps: DepsServidor): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // atrás do balanceador do Render: o IP real vem em X-Forwarded-For

  app.get('/saude', (_req, res) => {
    res.json({ ok: true, ambiente: deps.config.env });
  });

  // Limite por origem (IP): conter abuso, força bruta e picos (docs/12, seção 12.4).
  const limitador = rateLimit({
    windowMs: deps.config.rateLimitJanelaSegundos * 1000,
    limit: deps.config.rateLimitMaximo,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      const erro = new AppError('LIMITE_EXCEDIDO');
      res.status(erro.status).json(corpoDoErro(erro));
    },
  });

  app.post(
    '/executar',
    limitador,
    // O corpo bruto entra na chave anti-replay: cada requisição idêntica só vale uma vez.
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as RequisicaoComCorpo).corpoBruto = buf.toString('utf8');
      },
    }),
    async (req: RequisicaoComCorpo, res: Response) => {
      const resposta = await processar(deps, {
        headers: req.headers,
        corpoBruto: req.corpoBruto ?? '',
        corpo: req.body,
        ip: req.ip ?? null,
      });
      res.status(resposta.status).json(resposta.corpo);
    },
  );

  app.use((_req, res) => {
    const erro = new AppError('NOT_FOUND');
    res.status(erro.status).json(corpoDoErro(erro));
  });

  // JSON malformado ou grande demais: só o código chega ao cliente.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    const erro =
      err instanceof AppError
        ? err
        : (err as { type?: string })?.type?.startsWith('entity.')
          ? new AppError('PAYLOAD_INVALIDO', undefined, String(err))
          : new AppError('INTERNAL_ERROR', undefined, String(err));
    if (erro.codigo === 'INTERNAL_ERROR') deps.logger.error({ err }, 'erro nao tratado');
    res.status(erro.status).json(corpoDoErro(erro));
  });

  return app;
}
