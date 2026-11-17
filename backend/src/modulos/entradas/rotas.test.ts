// UC04 (passos 6-8) — testes de rota da entrada de mercadoria (divergência e liberação, RF19).
import request from 'supertest';
import {
  montarCenarioDeCadastros,
  type CenarioDeCadastros,
} from '../../testing/cenarioDeCadastros';

let contador = 0;

async function semearChefeComSenha(
  cenario: CenarioDeCadastros,
  usuario: string,
  senha: string,
): Promise<void> {
  const senhaHash = await cenario.senhas.gerarHash(senha);
  cenario.banco.semear('operador', {
    usuario,
    email: `${usuario}@suprimax.com.br`,
    senha_hash: senhaHash,
    perfil: 'OPERADOR_CHEFE',
    status: 'ATIVO',
  });
}

function semearFornecedorEVariacao(cenario: CenarioDeCadastros) {
  contador += 1;
  const [fornecedor] = cenario.banco.semear('fornecedor', {
    cnpj: String(40000000000000 + contador).padStart(14, '0'),
    razao_social: `Fornecedor ${contador}`,
  });
  const [produto] = cenario.banco.semear('produto', {
    codigo_interno: `PROD-ENT-${contador}`,
    descricao: `Produto Entrada ${contador}`,
  });
  const [variacao] = cenario.banco.semear('variacao_produto', {
    id_produto: produto?.id_produto,
    marca: 'MarcaEntrada',
    tamanho_embalagem: '1kg',
    quantidade_estoque: 50,
  });
  return {
    idFornecedor: fornecedor?.id_fornecedor as number,
    idVariacao: variacao?.id_variacao as number,
  };
}

async function montar() {
  const cenario = montarCenarioDeCadastros();
  const operador = await cenario.entrarComo('OPERADOR');
  const { idFornecedor, idVariacao } = semearFornecedorEVariacao(cenario);
  const registrar = (corpo: unknown, autorizacao = operador.autorizacao) =>
    request(cenario.app)
      .post('/entradas-mercadoria')
      .set('Authorization', autorizacao)
      .send(corpo as object);
  return { ...cenario, operador, idFornecedor, idVariacao, registrar };
}

describe('POST /entradas-mercadoria (UC04)', () => {
  it('responde 204 e soma ao estoque quando as quantidades coincidem', async () => {
    const { registrar, idFornecedor, idVariacao, banco } = await montar();

    const resposta = await registrar({
      idFornecedor,
      idVariacao,
      quantidadeComprada: 20,
      quantidadeInformada: 20,
    });

    expect(resposta.status).toBe(204);
    expect(banco.linhas('variacao_produto')[0]).toMatchObject({ quantidade_estoque: 70 });
    expect(banco.linhas('movimentacao_estoque')).toEqual([
      expect.objectContaining({ id_variacao: idVariacao, tipo: 'ENTRADA', quantidade: 20 }),
    ]);
    expect(banco.linhas('entrada_mercadoria')).toEqual([
      expect.objectContaining({
        id_variacao: idVariacao,
        quantidade_comprada: 20,
        quantidade_informada: 20,
        id_operador_liberacao: null,
      }),
    ]);
  });

  it('responde 422 ENTRADA_DIVERGENTE quando as quantidades diferem sem liberação', async () => {
    const { registrar, idFornecedor, idVariacao } = await montar();

    const resposta = await registrar({
      idFornecedor,
      idVariacao,
      quantidadeComprada: 20,
      quantidadeInformada: 18,
    });

    expect(resposta.status).toBe(422);
    expect(resposta.body.codigo).toBe('ENTRADA_DIVERGENTE');
  });

  it('aceita a divergência com a liberação de um operador chefe válida', async () => {
    const cenario = await montar();
    await semearChefeComSenha(cenario, 'chefe-liberador', 'senha-correta-123');

    const resposta = await cenario.registrar({
      idFornecedor: cenario.idFornecedor,
      idVariacao: cenario.idVariacao,
      quantidadeComprada: 20,
      quantidadeInformada: 18,
      liberacao: { usuario: 'chefe-liberador', senha: 'senha-correta-123' },
    });

    expect(resposta.status).toBe(204);
    expect(cenario.banco.linhas('entrada_mercadoria')).toEqual([
      expect.objectContaining({
        quantidade_comprada: 20,
        quantidade_informada: 18,
        id_operador_liberacao: expect.any(Number),
      }),
    ]);
    expect(cenario.banco.linhas('variacao_produto')[0]).toMatchObject({ quantidade_estoque: 68 });
  });

  it('responde 403 LIBERACAO_NEGADA com a senha errada', async () => {
    const cenario = await montar();
    await semearChefeComSenha(cenario, 'chefe-liberador-2', 'senha-correta-123');

    const resposta = await cenario.registrar({
      idFornecedor: cenario.idFornecedor,
      idVariacao: cenario.idVariacao,
      quantidadeComprada: 20,
      quantidadeInformada: 18,
      liberacao: { usuario: 'chefe-liberador-2', senha: 'senha-errada' },
    });

    expect(resposta.status).toBe(403);
    expect(resposta.body.codigo).toBe('LIBERACAO_NEGADA');
  });

  it('responde 403 LIBERACAO_NEGADA quando quem libera não é operador chefe', async () => {
    const cenario = await montar();
    const senhaHash = await cenario.senhas.gerarHash('senha-correta-123');
    cenario.banco.semear('operador', {
      usuario: 'vendedor-tentando-liberar',
      email: 'vendedor-tentando-liberar@suprimax.com.br',
      senha_hash: senhaHash,
      perfil: 'OPERADOR',
      status: 'ATIVO',
    });

    const resposta = await cenario.registrar({
      idFornecedor: cenario.idFornecedor,
      idVariacao: cenario.idVariacao,
      quantidadeComprada: 20,
      quantidadeInformada: 18,
      liberacao: { usuario: 'vendedor-tentando-liberar', senha: 'senha-correta-123' },
    });

    expect(resposta.status).toBe(403);
    expect(resposta.body.codigo).toBe('LIBERACAO_NEGADA');
  });

  it('responde 404 para fornecedor inexistente', async () => {
    const { registrar, idVariacao } = await montar();

    const resposta = await registrar({
      idFornecedor: 999,
      idVariacao,
      quantidadeComprada: 10,
      quantidadeInformada: 10,
    });

    expect(resposta.status).toBe(404);
    expect(resposta.body.codigo).toBe('FORNECEDOR_NAO_ENCONTRADO');
  });

  it('responde 404 para variação inexistente', async () => {
    const { registrar, idFornecedor } = await montar();

    const resposta = await registrar({
      idFornecedor,
      idVariacao: 999,
      quantidadeComprada: 10,
      quantidadeInformada: 10,
    });

    expect(resposta.status).toBe(404);
    expect(resposta.body.codigo).toBe('VARIACAO_NAO_ENCONTRADA');
  });
});

describe('liberação de divergência por ADMIN (UC04, RF19)', () => {
  it('aceita a divergência com usuário e senha de um ADMIN', async () => {
    const cenario = await montar();
    const senhaHash = await cenario.senhas.gerarHash('senha-admin-123');
    cenario.banco.semear('operador', {
      usuario: 'adm-liberador',
      email: 'adm-liberador@suprimax.com.br',
      senha_hash: senhaHash,
      perfil: 'ADMIN',
      status: 'ATIVO',
    });

    const resposta = await cenario.registrar({
      idFornecedor: cenario.idFornecedor,
      idVariacao: cenario.idVariacao,
      quantidadeComprada: 20,
      quantidadeInformada: 18,
      liberacao: { usuario: 'adm-liberador', senha: 'senha-admin-123' },
    });

    expect(resposta.status).toBe(204);
    expect(cenario.banco.linhas('entrada_mercadoria')[0]).toMatchObject({
      id_operador_liberacao: expect.any(Number),
    });
  });
});
