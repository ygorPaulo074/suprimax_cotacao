import { criarLogger } from '../../log';
import { NotificadorDeEmailMudo } from './notificador';

describe('NotificadorDeEmailMudo', () => {
  it('registra que o e-mail não foi enviado, sem o token nem o endereço', async () => {
    const linhas: Record<string, unknown>[] = [];
    const destino = { write: (linha: string) => void linhas.push(JSON.parse(linha)) };
    const notificador = new NotificadorDeEmailMudo(criarLogger({ nivel: 'info', destino }));
    const validade = new Date('2026-11-12T15:00:00Z');

    await notificador.enviarDefinicaoDeSenha({
      idOperador: 9,
      usuario: 'davi',
      email: 'davi@suprimax.com.br',
      token: 'token-secreto-do-link',
      validade,
    });

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      level: 'warn',
      evento: 'email_nao_enviado',
      tipo: 'definicao_de_senha',
      idOperador: 9,
      validade: validade.toISOString(),
    });
    const log = JSON.stringify(linhas);
    expect(log).not.toContain('token-secreto-do-link');
    expect(log).not.toContain('davi@suprimax.com.br');
  });
});
