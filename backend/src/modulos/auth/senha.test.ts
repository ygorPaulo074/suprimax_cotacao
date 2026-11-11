import { ErroDeValidacao } from '../../erros';
import { CUSTO_DO_BCRYPT_NOS_TESTES } from '../../testing/appDeTeste';
import { ServicoDeSenha } from './senha';

const senhas = new ServicoDeSenha(CUSTO_DO_BCRYPT_NOS_TESTES);
const SENHA = 'Suprimax@2026';

describe('ServicoDeSenha', () => {
  it('gera um hash bcrypt que confere com a senha e não a contém', async () => {
    const hash = await senhas.gerarHash(SENHA);

    expect(hash).toMatch(/^\$2[aby]\$04\$/);
    expect(hash).not.toContain(SENHA);
    expect(await senhas.verificar(SENHA, hash)).toBe(true);
  });

  it('gera hashes diferentes para a mesma senha', async () => {
    expect(await senhas.gerarHash(SENHA)).not.toBe(await senhas.gerarHash(SENHA));
  });

  it.each([
    ['senha errada', 'Suprimax@2027'],
    ['diferença de maiúsculas', 'suprimax@2026'],
    ['senha vazia', ''],
    ['senha acima de 72 bytes', 'a'.repeat(73)],
  ])('não confere: %s', async (_caso, tentativa) => {
    expect(await senhas.verificar(tentativa, await senhas.gerarHash(SENHA))).toBe(false);
  });

  it.each(['', 'nao-e-um-hash', '$2b$04$curto'])(
    'devolve false para hash malformado: "%s"',
    async (hash) => {
      expect(await senhas.verificar(SENHA, hash)).toBe(false);
    },
  );

  it('recusa gerar hash de senha acima de 72 bytes', async () => {
    await expect(senhas.gerarHash('ç'.repeat(37))).rejects.toBeInstanceOf(ErroDeValidacao);
  });

  it('simula uma verificação sem lançar', async () => {
    await expect(senhas.simularVerificacao(SENHA)).resolves.toBeUndefined();
  });
});
