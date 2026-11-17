// Perfil ADMIN (UC13, UC04/RF19, UC25): acesso a todas as rotas e liberação de divergência.
import request from 'supertest';
import { montarCenarioDeCadastros } from '../../testing/cenarioDeCadastros';

const ROTAS_POR_PERFIL = [
  ['OPERADOR', '/clientes'],
  ['OPERADOR_CHEFE', '/usuarios'],
  ['FISCAL', '/analises-credito'],
  ['FINANCEIRO', '/dividas'],
  ['GESTOR', '/indicadores'],
] as const;

describe('perfil ADMIN (UC13)', () => {
  it.each(ROTAS_POR_PERFIL)('acessa uma rota exclusiva de %s (%s)', async (_perfil, rota) => {
    const cenario = montarCenarioDeCadastros();
    const admin = await cenario.entrarComo('ADMIN', 'adm');

    const resposta = await request(cenario.app).get(rota).set('Authorization', admin.autorizacao);

    expect(resposta.status).not.toBe(401);
    expect(resposta.status).not.toBe(403);
  });

  it('acessa a rota de jobs do gestor', async () => {
    const cenario = montarCenarioDeCadastros();
    const admin = await cenario.entrarComo('ADMIN', 'adm');

    const resposta = await request(cenario.app)
      .post('/jobs/executar')
      .set('Authorization', admin.autorizacao);

    expect(resposta.status).toBe(200);
  });

  it('continua negando as rotas de outros perfis ao OPERADOR_CHEFE (403)', async () => {
    const cenario = montarCenarioDeCadastros();
    const chefe = await cenario.entrarComo('OPERADOR_CHEFE', 'carla');

    const resposta = await request(cenario.app)
      .get('/dividas')
      .set('Authorization', chefe.autorizacao);

    expect(resposta.status).toBe(403);
    expect(resposta.body.codigo).toBe('ACESSO_NEGADO');
  });
});
