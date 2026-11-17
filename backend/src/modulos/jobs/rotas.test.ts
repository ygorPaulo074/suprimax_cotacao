// Item 9 do backend/TAREFAS.md — teste de rota de `POST /jobs/executar`, pela aplicação real
// montada em `app.ts`. A regra de negócio de cada job já está coberta em `servico.test.ts`; aqui
// o que importa é a rota em si (perfil, formato da resposta).
import request from 'supertest';
import { montarCenarioDeCadastros } from '../../testing/cenarioDeCadastros';

const AGORA_DO_TESTE = new Date('2026-05-10T09:00:00.000Z');
const JOBS_TOKEN_DO_TESTE = 'token-de-maquina-do-teste-0123456789';

describe('POST /jobs/executar (item 9)', () => {
  it('responde 200 com o resumo dos cinco jobs, mesmo sem nenhum candidato', async () => {
    const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
    const gestor = await cenario.entrarComo('GESTOR');

    const resposta = await request(cenario.app)
      .post('/jobs/executar')
      .set('Authorization', gestor.autorizacao);

    expect(resposta.status).toBe(200);
    expect(resposta.body.resumo).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          job: 'expirar_rascunhos_e_pendentes_de_credito',
          processados: 0,
        }),
        expect.objectContaining({ job: 'apagar_rascunhos_expirados', processados: 0 }),
        expect.objectContaining({ job: 'expirar_orcamentos_emitidos', processados: 0 }),
        expect.objectContaining({ job: 'expirar_reservas', processados: 0 }),
        expect.objectContaining({ job: 'marcar_protesto_de_dividas', processados: 0 }),
      ]),
    );
    expect(resposta.body.resumo).toHaveLength(5);
  });

  it('expira um rascunho sem edição há 30 dias e devolve isso no resumo', async () => {
    const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
    const gestor = await cenario.entrarComo('GESTOR');
    const idOperador = cenario.semearUsuario('VENDEDOR', 'vendedor-jobs-rota');
    const [cliente] = cenario.banco.semear('cliente', {
      cnpj: '60000000000199',
      razao_social: 'Cliente Jobs Rota',
      nome_contato: 'Contato',
      tipo_unidade: 'MATRIZ',
      id_operador_vendedor: idOperador,
      aceite_lgpd: true,
      data_aceite_lgpd: new Date().toISOString(),
    });
    const trintaEUmDiasAtras = new Date(
      AGORA_DO_TESTE.getTime() - 31 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const [orcamento] = cenario.banco.semear('orcamento', {
      id_cliente: cliente?.id_cliente,
      id_operador: gestor.idOperador,
      status: 'RASCUNHO',
      data_ultima_edicao: trintaEUmDiasAtras,
    });

    const resposta = await request(cenario.app)
      .post('/jobs/executar')
      .set('Authorization', gestor.autorizacao);

    expect(resposta.status).toBe(200);
    expect(resposta.body.resumo).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          job: 'expirar_rascunhos_e_pendentes_de_credito',
          processados: 1,
        }),
      ]),
    );
    expect(
      cenario.banco.linhas('orcamento').find((l) => l.id_orcamento === orcamento?.id_orcamento),
    ).toMatchObject({ status: 'EXPIRADO', motivo_expiracao: 'RASCUNHO' });
  });

  it('responde 403 para quem não é gestor', async () => {
    const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
    const operador = await cenario.entrarComo('OPERADOR');

    const resposta = await request(cenario.app)
      .post('/jobs/executar')
      .set('Authorization', operador.autorizacao);

    expect(resposta.status).toBe(403);
  });

  it('responde 200 para o ADMIN', async () => {
    const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });
    const admin = await cenario.entrarComo('ADMIN');

    const resposta = await request(cenario.app)
      .post('/jobs/executar')
      .set('Authorization', admin.autorizacao);

    expect(resposta.status).toBe(200);
  });

  it('responde 401 sem sessão', async () => {
    const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });

    const resposta = await request(cenario.app).post('/jobs/executar');

    expect(resposta.status).toBe(401);
  });
});

describe('POST /jobs/executar com JOBS_TOKEN (UC20, autenticação de máquina)', () => {
  const montar = () =>
    montarCenarioDeCadastros({
      agora: () => AGORA_DO_TESTE,
      config: { jobsToken: JOBS_TOKEN_DO_TESTE },
    });

  it('responde 200 com o token de máquina, sem sessão', async () => {
    const cenario = montar();

    const resposta = await request(cenario.app)
      .post('/jobs/executar')
      .set('Authorization', `Bearer ${JOBS_TOKEN_DO_TESTE}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body.resumo).toHaveLength(5);
  });

  it('responde 401 sem cabeçalho', async () => {
    const resposta = await request(montar().app).post('/jobs/executar');

    expect(resposta.status).toBe(401);
  });

  it('responde 401 com token errado, inclusive de mesmo tamanho', async () => {
    const cenario = montar();

    for (const errado of ['outro-token', JOBS_TOKEN_DO_TESTE.replace(/.$/, 'X')]) {
      const resposta = await request(cenario.app)
        .post('/jobs/executar')
        .set('Authorization', `Bearer ${errado}`);

      expect(resposta.status).toBe(401);
    }
  });

  it('continua aceitando a sessão de GESTOR e responde 403 a perfil sem permissão', async () => {
    const cenario = montar();
    const gestor = await cenario.entrarComo('GESTOR');
    const operador = await cenario.entrarComo('OPERADOR');

    const doGestor = await request(cenario.app)
      .post('/jobs/executar')
      .set('Authorization', gestor.autorizacao);
    const doOperador = await request(cenario.app)
      .post('/jobs/executar')
      .set('Authorization', operador.autorizacao);

    expect(doGestor.status).toBe(200);
    expect(doOperador.status).toBe(403);
  });

  it('sem JOBS_TOKEN configurado, a via por token fica desligada (nunca aceita token vazio)', async () => {
    const cenario = montarCenarioDeCadastros({ agora: () => AGORA_DO_TESTE });

    for (const cabecalho of [`Bearer ${JOBS_TOKEN_DO_TESTE}`, 'Bearer ', 'Bearer']) {
      const resposta = await request(cenario.app)
        .post('/jobs/executar')
        .set('Authorization', cabecalho);

      expect(resposta.status).toBe(401);
    }
  });

  it('não registra o token em log', async () => {
    const cenario = montar();

    await request(cenario.app)
      .post('/jobs/executar')
      .set('Authorization', `Bearer ${JOBS_TOKEN_DO_TESTE}`);

    expect(JSON.stringify(cenario.linhas)).not.toContain(JOBS_TOKEN_DO_TESTE);
  });
});
