import request from 'supertest';
import { ErroInterno } from '../../erros';
import type { Linha } from '../../testing/bancoFalso';
import { montarCenarioDeCadastros } from '../../testing/cenarioDeCadastros';
import type { ChamadaAoProxy } from '../../testing/proxyClienteFalso';
import { resumoDoTokenDeSenha } from '../auth/tokenDeSenha';

const AGORA = new Date('2026-11-11T15:00:00Z');
const UM_DIA_MS = 24 * 60 * 60 * 1000;

type Cenario = Awaited<ReturnType<typeof montar>>;

async function montar() {
  const cenario = montarCenarioDeCadastros({ agora: () => AGORA });
  const chefe = await cenario.entrarComo('OPERADOR_CHEFE', 'carla');
  const criar = (corpo: unknown, autorizacao = chefe.autorizacao) =>
    request(cenario.app)
      .post('/usuarios')
      .set('Authorization', autorizacao)
      .send(corpo as object);
  const alterar = (id: number | string, corpo: unknown, autorizacao = chefe.autorizacao) =>
    request(cenario.app)
      .patch(`/usuarios/${id}`)
      .set('Authorization', autorizacao)
      .send(corpo as object);
  const listar = (autorizacao = chefe.autorizacao) =>
    request(cenario.app).get('/usuarios').set('Authorization', autorizacao);
  /** Grava `quantidade` clientes na carteira do vendedor. */
  const semearCarteira = (idVendedor: number, quantidade: number, prefixo = 1) => {
    for (let inicio = 0; inicio < quantidade; inicio += 100) {
      cenario.banco.semear(
        'cliente',
        Array.from({ length: Math.min(100, quantidade - inicio) }, (_, i): Linha => ({
          cnpj: String(prefixo * 10_000_000_000_000 + inicio + i),
          razao_social: `Cliente ${inicio + i}`,
          nome_contato: 'Contato',
          tipo_unidade: 'MATRIZ',
          id_operador_vendedor: idVendedor,
          aceite_lgpd: true,
          data_aceite_lgpd: AGORA.toISOString(),
        })),
      );
    }
  };
  const usuarioNoBanco = (id: number) =>
    cenario.banco.linhas('operador').find((linha) => linha.id_operador === id);
  const carteiraDe = (id: number) =>
    cenario.banco.linhas('cliente').filter((linha) => linha.id_operador_vendedor === id).length;
  return { ...cenario, chefe, criar, alterar, listar, semearCarteira, usuarioNoBanco, carteiraDe };
}

describe('GET /usuarios (UC25)', () => {
  it('lista os usuários em ordem alfabética, com o tamanho da carteira de cada um', async () => {
    const { listar, semearUsuario, semearCarteira, chefe } = await montar();
    const idVera = semearUsuario('VENDEDOR', 'vera');
    const idAna = semearUsuario('VENDEDOR', 'ana', 'INATIVO');
    semearCarteira(idVera, 3);

    const resposta = await listar();

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual([
      {
        idOperador: idAna,
        usuario: 'ana',
        email: 'ana@suprimax.com.br',
        perfil: 'VENDEDOR',
        status: 'INATIVO',
        clientesNaCarteira: 0,
      },
      {
        idOperador: chefe.idOperador,
        usuario: 'carla',
        email: 'carla@suprimax.com.br',
        perfil: 'OPERADOR_CHEFE',
        status: 'ATIVO',
        clientesNaCarteira: 0,
      },
      {
        idOperador: idVera,
        usuario: 'vera',
        email: 'vera@suprimax.com.br',
        perfil: 'VENDEDOR',
        status: 'ATIVO',
        clientesNaCarteira: 3,
      },
    ]);
  });

  it('nunca lê nem devolve o hash da senha ou o token de recuperação', async () => {
    const { listar, proxy } = await montar();

    const resposta = await listar();

    expect(resposta.text).not.toContain('hash');
    expect(resposta.text).not.toMatch(/senha|token/i);
    const consultas = proxy
      .chamadasDe('dados.consultar')
      .filter((c) => c.payload.tabela === 'operador');
    expect(consultas.length).toBeGreaterThan(0);
    for (const { payload } of consultas) {
      expect(payload.campos).toEqual(['id_operador', 'usuario', 'email', 'perfil', 'status']);
    }
  });
});

describe('POST /usuarios (UC25)', () => {
  const NOVO = { usuario: 'davi', email: 'Davi@Suprimax.com.br', perfil: 'OPERADOR' };

  it('responde 201 com o usuário ativo e o e-mail em minúsculas', async () => {
    const { criar } = await montar();

    const resposta = await criar({ ...NOVO, usuario: '  davi ' });

    expect(resposta.status).toBe(201);
    expect(resposta.body).toEqual({
      idOperador: 2,
      usuario: 'davi',
      email: 'davi@suprimax.com.br',
      perfil: 'OPERADOR',
      status: 'ATIVO',
      clientesNaCarteira: 0,
    });
  });

  it('grava uma senha aleatória em hash e só o resumo do token, com validade de 24 horas', async () => {
    const { criar, usuarioNoBanco, notificador } = await montar();

    await criar(NOVO);

    const linha = usuarioNoBanco(2);
    const [convite] = notificador.convites;
    expect(linha?.senha_hash).toMatch(/^\$2[aby]\$/);
    expect(convite).toMatchObject({
      idOperador: 2,
      usuario: 'davi',
      email: 'davi@suprimax.com.br',
    });
    expect(convite?.token).toMatch(/^[\w-]{43}$/);
    expect(convite?.validade).toEqual(new Date(AGORA.getTime() + UM_DIA_MS));
    expect(linha?.token_recuperacao_senha).toBe(resumoDoTokenDeSenha(convite?.token ?? ''));
    expect(linha?.token_recuperacao_senha).not.toBe(convite?.token);
    expect(linha?.validade_token).toBe(new Date(AGORA.getTime() + UM_DIA_MS).toISOString());
  });

  it('não devolve nem registra em log o token, o hash ou a senha', async () => {
    const { criar, usuarioNoBanco, notificador, linhas, chefe } = await montar();

    const resposta = await criar(NOVO);

    const segredos = [
      notificador.convites[0]?.token,
      usuarioNoBanco(2)?.senha_hash,
      usuarioNoBanco(2)?.token_recuperacao_senha,
    ] as string[];
    const log = JSON.stringify(linhas);
    for (const segredo of segredos) {
      expect(segredo).toEqual(expect.any(String));
      expect(resposta.text).not.toContain(segredo);
      expect(log).not.toContain(segredo);
    }
    expect(linhas.find((linha) => linha.evento === 'usuario_criado')).toMatchObject({
      idOperador: 2,
      perfil: 'OPERADOR',
      idAutor: chefe.idOperador,
    });
  });

  it('mantém o usuário criado quando o envio do e-mail falha, e registra a falha', async () => {
    const { criar, notificador, banco, linhas } = await montar();
    notificador.falha = new Error('Resend fora do ar');

    const resposta = await criar(NOVO);

    expect(resposta.status).toBe(201);
    expect(banco.linhas('operador')).toHaveLength(2);
    expect(linhas.find((linha) => linha.evento === 'email_falhou')).toMatchObject({
      level: 'error',
      tipo: 'definicao_de_senha',
      idOperador: 2,
    });
  });

  it.each([
    ['o nome de usuário', { usuario: 'carla', email: 'outra@suprimax.com.br' }],
    ['o e-mail', { usuario: 'outra', email: 'carla@suprimax.com.br' }],
    ['o e-mail em outra caixa', { usuario: 'outra', email: 'CARLA@SUPRIMAX.COM.BR' }],
  ])('responde 409 USUARIO_JA_CADASTRADO quando %s já existe', async (_caso, dados) => {
    const { criar, banco, notificador } = await montar();

    const resposta = await criar({ ...dados, perfil: 'OPERADOR' });

    expect(resposta.status).toBe(409);
    expect(resposta.body).toEqual({
      codigo: 'USUARIO_JA_CADASTRADO',
      mensagem: 'Já existe um usuário com este nome de usuário ou e-mail.',
    });
    expect(banco.linhas('operador')).toHaveLength(1);
    expect(notificador.convites).toEqual([]);
  });

  it('responde 409 quando outro cadastro igual chega durante a gravação', async () => {
    const { criar, proxy, semearUsuario } = await montar();
    proxy.responderUmaVez('dados.inserir', () => {
      semearUsuario('OPERADOR', 'davi');
      throw new ErroInterno(new Error('unique violation'));
    });

    const resposta = await criar({ ...NOVO, email: 'davi@suprimax.com.br' });

    expect(resposta.status).toBe(409);
    expect(resposta.body.codigo).toBe('USUARIO_JA_CADASTRADO');
  });

  it.each([
    ['usuário em branco', { usuario: '  ' }, ['usuario']],
    ['usuário acima de 50 caracteres', { usuario: 'u'.repeat(51) }, ['usuario']],
    ['e-mail malformado', { email: 'davi@' }, ['email']],
    ['e-mail acima de 120 caracteres', { email: `${'d'.repeat(110)}@suprimax.com.br` }, ['email']],
    ['perfil desconhecido', { perfil: 'ADMIN' }, ['perfil']],
    ['perfil ausente', { perfil: undefined }, ['perfil']],
  ])('responde 400 com o campo recusado: %s', async (_caso, alteracoes, campos) => {
    const { criar, banco } = await montar();

    const resposta = await criar({ ...NOVO, ...alteracoes });

    expect(resposta.status).toBe(400);
    expect(resposta.body.detalhes).toEqual({ campos });
    expect(banco.linhas('operador')).toHaveLength(1);
  });

  it('ignora uma senha enviada no corpo: a senha só é definida pelo link', async () => {
    const { criar, usuarioNoBanco } = await montar();

    const resposta = await criar({
      ...NOVO,
      senha: 'Suprimax@2026',
      senhaHash: 'x',
      status: 'INATIVO',
    });

    expect(resposta.status).toBe(201);
    expect(resposta.body.status).toBe('ATIVO');
    expect(usuarioNoBanco(2)?.senha_hash).toMatch(/^\$2[aby]\$/);
  });
});

describe('PATCH /usuarios/:id (UC25)', () => {
  it('muda o perfil e encerra as sessões abertas do usuário', async () => {
    const { alterar, entrarComo, usuarioNoBanco, app } = await montar();
    const operador = await entrarComo('OPERADOR', 'otto');

    const resposta = await alterar(operador.idOperador, { perfil: 'FISCAL' });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({
      idOperador: operador.idOperador,
      perfil: 'FISCAL',
      status: 'ATIVO',
    });
    expect(usuarioNoBanco(operador.idOperador)?.perfil).toBe('FISCAL');
    const sessaoAntiga = await request(app)
      .get('/auth/me')
      .set('Authorization', operador.autorizacao);
    expect(sessaoAntiga.status).toBe(401);
  });

  it('inativa e reativa um usuário sem carteira', async () => {
    const { alterar, entrarComo, usuarioNoBanco, app } = await montar();
    const fiscal = await entrarComo('FISCAL', 'fabi');

    const inativacao = await alterar(fiscal.idOperador, { status: 'INATIVO' });
    const sessaoAntiga = await request(app)
      .get('/auth/me')
      .set('Authorization', fiscal.autorizacao);
    const reativacao = await alterar(fiscal.idOperador, { status: 'ATIVO' });

    expect(inativacao.status).toBe(200);
    expect(inativacao.body.status).toBe('INATIVO');
    expect(sessaoAntiga.status).toBe(401);
    expect(reativacao.body.status).toBe('ATIVO');
    expect(usuarioNoBanco(fiscal.idOperador)?.status).toBe('ATIVO');
  });

  it('não grava nada quando o pedido repete o que já está gravado', async () => {
    const { alterar, entrarComo, proxy, app } = await montar();
    const operador = await entrarComo('OPERADOR', 'otto');

    const resposta = await alterar(operador.idOperador, { perfil: 'OPERADOR', status: 'ATIVO' });

    expect(resposta.status).toBe(200);
    expect(proxy.chamadasDe('dados.lote')).toEqual([]);
    const sessao = await request(app).get('/auth/me').set('Authorization', operador.autorizacao);
    expect(sessao.status).toBe(200);
  });

  describe('vendedor com clientes na carteira', () => {
    async function montarComCarteira(clientes = 3) {
      const cenario = await montar();
      const idVera = cenario.semearUsuario('VENDEDOR', 'vera');
      const idNuno = cenario.semearUsuario('VENDEDOR', 'nuno');
      cenario.semearCarteira(idVera, clientes);
      return { ...cenario, idVera, idNuno };
    }

    it('responde 422 NOVO_VENDEDOR_OBRIGATORIO ao inativar sem indicar o novo responsável', async () => {
      const { alterar, idVera, usuarioNoBanco, carteiraDe } = await montarComCarteira();

      const resposta = await alterar(idVera, { status: 'INATIVO' });

      expect(resposta.status).toBe(422);
      expect(resposta.body).toEqual({
        codigo: 'NOVO_VENDEDOR_OBRIGATORIO',
        mensagem: 'Este vendedor tem clientes na carteira. Indique o novo vendedor responsável.',
        detalhes: { clientesNaCarteira: 3 },
      });
      expect(usuarioNoBanco(idVera)?.status).toBe('ATIVO');
      expect(carteiraDe(idVera)).toBe(3);
    });

    it('inativa e transfere a carteira ao novo vendedor em uma única transação', async () => {
      const { alterar, idVera, idNuno, usuarioNoBanco, carteiraDe, proxy, linhas } =
        await montarComCarteira();

      const resposta = await alterar(idVera, { status: 'INATIVO', idNovoVendedor: idNuno });

      expect(resposta.status).toBe(200);
      expect(resposta.body).toMatchObject({
        idOperador: idVera,
        status: 'INATIVO',
        clientesNaCarteira: 0,
      });
      expect(usuarioNoBanco(idVera)?.status).toBe('INATIVO');
      expect(carteiraDe(idVera)).toBe(0);
      expect(carteiraDe(idNuno)).toBe(3);
      expect(proxy.chamadasDe('dados.lote')).toHaveLength(1);
      expect(linhas.find((linha) => linha.evento === 'usuario_alterado')).toMatchObject({
        idOperador: idVera,
        status: 'INATIVO',
        clientesTransferidos: 3,
        idNovoVendedor: idNuno,
      });
    });

    it('transfere uma carteira grande em blocos de até 50 clientes, alterando o usuário por último', async () => {
      const { alterar, idVera, idNuno, carteiraDe, proxy } = await montarComCarteira(120);

      const resposta = await alterar(idVera, { status: 'INATIVO', idNovoVendedor: idNuno });

      expect(resposta.status).toBe(200);
      expect(carteiraDe(idNuno)).toBe(120);
      const [lote] = proxy.chamadasDe('dados.lote');
      const passos = lote?.payload.passos as { id: string; payload: Linha }[];
      expect(passos.map((passo) => passo.id)).toEqual([
        'carteira_0',
        'carteira_1',
        'carteira_2',
        'usuario',
      ]);
      const tamanhos = passos
        .slice(0, 3)
        .map(
          ({ payload }) =>
            ((payload.filtros as { e: [string, string, number[]][] }).e[0]?.[2] ?? []).length,
        );
      expect(tamanhos).toEqual([50, 50, 20]);
    });

    it('divide a transferência em mais de uma transação quando a carteira passa de 950 clientes', async () => {
      const { alterar, idVera, idNuno, carteiraDe, usuarioNoBanco, proxy } =
        await montarComCarteira(1000);

      const resposta = await alterar(idVera, { status: 'INATIVO', idNovoVendedor: idNuno });

      expect(resposta.status).toBe(200);
      expect(carteiraDe(idNuno)).toBe(1000);
      expect(usuarioNoBanco(idVera)?.status).toBe('INATIVO');
      const lotes = proxy
        .chamadasDe('dados.lote')
        .map((lote) => (lote.payload.passos as unknown[]).length);
      expect(lotes).toEqual([20, 1]);
    });

    it('deixa o vendedor ativo quando uma transação da transferência falha', async () => {
      const { alterar, idVera, idNuno, carteiraDe, usuarioNoBanco, proxy, banco, app, sessoes } =
        await montarComCarteira(1000);
      const token = await sessoes.criar({
        idOperador: idVera,
        usuario: 'vera',
        nome: 'vera',
        email: 'vera@suprimax.com.br',
        perfil: 'VENDEDOR',
      });
      let lotes = 0;
      proxy.responder('dados.lote', (chamada: ChamadaAoProxy) => {
        lotes += 1;
        if (lotes === 2) {
          throw new ErroInterno(new Error('banco fora do ar'));
        }
        return banco.atender(chamada);
      });

      const resposta = await alterar(idVera, { status: 'INATIVO', idNovoVendedor: idNuno });

      expect(resposta.status).toBe(500);
      expect(usuarioNoBanco(idVera)?.status).toBe('ATIVO');
      expect(carteiraDe(idVera)).toBe(0);
      expect(carteiraDe(idNuno)).toBe(1000);
      const sessao = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);
      expect(sessao.status).toBe(200);
    });

    it.each([
      ['inexistente', () => 999],
      ['inativo', (c: Cenario) => c.semearUsuario('VENDEDOR', 'ivo', 'INATIVO')],
      ['de outro perfil', (c: Cenario) => c.chefe.idOperador],
      ['o próprio vendedor', (_c: Cenario, idVera: number) => idVera],
    ])('responde 400 quando o novo vendedor é %s', async (_caso, idDe) => {
      const cenario = await montarComCarteira();

      const resposta = await cenario.alterar(cenario.idVera, {
        status: 'INATIVO',
        idNovoVendedor: idDe(cenario, cenario.idVera),
      });

      expect(resposta.status).toBe(400);
      expect(resposta.body).toEqual({
        codigo: 'VALIDATION_ERROR',
        mensagem:
          'O novo vendedor responsável deve ser outro usuário ativo com perfil de vendedor.',
        detalhes: { campos: ['idNovoVendedor'] },
      });
      expect(cenario.usuarioNoBanco(cenario.idVera)?.status).toBe('ATIVO');
      expect(cenario.carteiraDe(cenario.idVera)).toBe(3);
    });

    it('responde 422 VENDEDOR_COM_CARTEIRA ao mudar o perfil sem transferir a carteira', async () => {
      const { alterar, idVera, usuarioNoBanco } = await montarComCarteira();

      const resposta = await alterar(idVera, { perfil: 'OPERADOR' });

      expect(resposta.status).toBe(422);
      expect(resposta.body).toEqual({
        codigo: 'VENDEDOR_COM_CARTEIRA',
        mensagem:
          'Este vendedor tem clientes na carteira. Transfira a carteira antes de mudar o perfil.',
        detalhes: { clientesNaCarteira: 3 },
      });
      expect(usuarioNoBanco(idVera)?.perfil).toBe('VENDEDOR');
    });

    it('muda o perfil quando o novo vendedor é indicado, transferindo a carteira', async () => {
      const { alterar, idVera, idNuno, usuarioNoBanco, carteiraDe } = await montarComCarteira();

      const resposta = await alterar(idVera, { perfil: 'OPERADOR', idNovoVendedor: idNuno });

      expect(resposta.status).toBe(200);
      expect(usuarioNoBanco(idVera)).toMatchObject({ perfil: 'OPERADOR', status: 'ATIVO' });
      expect(carteiraDe(idNuno)).toBe(3);
    });

    it('inativa sem pedir novo responsável o vendedor que não tem clientes', async () => {
      const { alterar, idNuno, usuarioNoBanco } = await montarComCarteira();

      const resposta = await alterar(idNuno, { status: 'INATIVO' });

      expect(resposta.status).toBe(200);
      expect(usuarioNoBanco(idNuno)?.status).toBe('INATIVO');
    });
  });

  it.each([
    ['inativar', { status: 'INATIVO' }],
    ['mudar o perfil de', { perfil: 'OPERADOR' }],
  ])('responde 422 quando o operador chefe tenta %s si mesmo', async (_caso, corpo) => {
    const { alterar, chefe, usuarioNoBanco } = await montar();

    const resposta = await alterar(chefe.idOperador, corpo);

    expect(resposta.status).toBe(422);
    expect(resposta.body).toEqual({
      codigo: 'ALTERACAO_DO_PROPRIO_USUARIO',
      mensagem: 'Você não pode inativar nem mudar o perfil do seu próprio usuário.',
    });
    expect(usuarioNoBanco(chefe.idOperador)).toMatchObject({
      perfil: 'OPERADOR_CHEFE',
      status: 'ATIVO',
    });
  });

  it('responde 404 USUARIO_NAO_ENCONTRADO para um identificador sem usuário', async () => {
    const { alterar } = await montar();

    const resposta = await alterar(999, { status: 'INATIVO' });

    expect(resposta.status).toBe(404);
    expect(resposta.body).toEqual({
      codigo: 'USUARIO_NAO_ENCONTRADO',
      mensagem: 'Usuário não encontrado.',
    });
  });

  it.each([
    ['corpo vazio', 1, {}, ['status']],
    ['só o novo vendedor', 1, { idNovoVendedor: 2 }, ['status']],
    ['status desconhecido', 1, { status: 'BLOQUEADO' }, ['status']],
    ['perfil desconhecido', 1, { perfil: 'ADMIN' }, ['perfil']],
    [
      'novo vendedor não numérico',
      1,
      { status: 'INATIVO', idNovoVendedor: '2' },
      ['idNovoVendedor'],
    ],
    ['identificador não numérico', 'abc', { status: 'INATIVO' }, ['id']],
  ])('responde 400: %s', async (_caso, id, corpo, campos) => {
    const { alterar } = await montar();

    const resposta = await alterar(id, corpo);

    expect(resposta.status).toBe(400);
    expect(resposta.body.detalhes).toEqual({ campos });
  });
});

describe('autorização das rotas de usuários', () => {
  const ROTAS = [
    ['get', '/usuarios'],
    ['post', '/usuarios'],
    ['patch', '/usuarios/1'],
  ] as const;

  it.each(ROTAS)('%s %s responde 401 sem sessão', async (metodo, rota) => {
    const { app } = await montar();

    expect((await request(app)[metodo](rota)).status).toBe(401);
  });

  it.each(ROTAS)('%s %s responde 403 para quem não é operador chefe', async (metodo, rota) => {
    const { app, entrarComo, banco } = await montar();
    const operador = await entrarComo('OPERADOR');

    const requisicao = request(app);
    const resposta = await requisicao[metodo](rota)
      .set('Authorization', operador.autorizacao)
      .send({
        usuario: 'x',
        email: 'x@suprimax.com.br',
        perfil: 'OPERADOR_CHEFE',
        status: 'INATIVO',
      });

    expect(resposta.status).toBe(403);
    expect(resposta.body.codigo).toBe('ACESSO_NEGADO');
    expect(banco.linhas('operador')).toHaveLength(2);
    expect(banco.linhas('operador')[0]).toMatchObject({ status: 'ATIVO' });
  });
});
