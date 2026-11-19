// RNF05 (auditoria, achado B4 do PR #62): depois do multer, o contexto do operador
// (`AsyncLocalStorage`) precisa continuar disponível, para o cliente do proxy enviar X-User-Id.
import express from 'express';
import request from 'supertest';
import { executarComoOperador, operadorDaRequisicao } from '../../dados/usuarioDaRequisicao';
import { processarUploadComTiposAceitos, processarUploadDeArquivo } from './uploadDeArquivo';

function montarApp(
  middleware: express.RequestHandler,
  lido: { idAntes?: number; idDepois?: number },
): express.Express {
  const app = express();
  app.post(
    '/anexos',
    (_req, _res, next) => executarComoOperador(42, () => next()),
    (_req, _res, next) => {
      lido.idAntes = operadorDaRequisicao();
      next();
    },
    middleware,
    (_req, res) => {
      lido.idDepois = operadorDaRequisicao();
      res.status(204).end();
    },
  );
  return app;
}

describe('upload de arquivo e contexto do operador', () => {
  it('mantém o operador depois do multer (com arquivo)', async () => {
    const lido: { idAntes?: number; idDepois?: number } = {};
    await request(montarApp(processarUploadDeArquivo, lido))
      .post('/anexos')
      .attach('arquivo', Buffer.from('conteudo'), {
        filename: 'a.pdf',
        contentType: 'application/pdf',
      })
      .expect(204);
    expect(lido.idAntes).toBe(42);
    expect(lido.idDepois).toBe(42);
  });

  it('mantém o operador com tipos aceitos e em requisição que não é multipart', async () => {
    const lido: { idAntes?: number; idDepois?: number } = {};
    await request(montarApp(processarUploadComTiposAceitos(['application/pdf']), lido))
      .post('/anexos')
      .send({})
      .expect(204);
    expect(lido.idDepois).toBe(42);
  });

  it('sem operador no contexto (fora de rota autenticada), segue sem operador', async () => {
    const lido: { idDepois?: number } = {};
    const app = express();
    app.post('/x', processarUploadDeArquivo, (_req, res) => {
      lido.idDepois = operadorDaRequisicao();
      res.status(204).end();
    });
    await request(app)
      .post('/x')
      .attach('arquivo', Buffer.from('c'), { filename: 'a.pdf', contentType: 'application/pdf' })
      .expect(204);
    expect(lido.idDepois).toBeUndefined();
  });
});
