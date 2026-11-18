import { avisoDeEdicaoDeRascunho } from './avisoDeRascunho';

const dono = { idOperador: 1, nome: 'ana' };
const base = { status: 'RASCUNHO', responsavel: dono, ultimaAlteracaoDeOutro: null } as const;

describe('aviso de edição de rascunho (UC14 a UC17)', () => {
  it('avisa o responsável de quem alterou o rascunho e quando', () => {
    const aviso = avisoDeEdicaoDeRascunho(
      {
        ...base,
        ultimaAlteracaoDeOutro: { idOperador: 2, nome: 'bia', data: '2026-11-17T14:30:00' },
      },
      1,
    );
    expect(aviso).toBe('Este rascunho foi alterado por bia em 17/11/2026 14:30.');
  });

  it('não avisa o responsável se ninguém mais alterou', () => {
    expect(avisoDeEdicaoDeRascunho(base, 1)).toBeNull();
  });

  it('avisa o outro operador de quem é o rascunho', () => {
    expect(avisoDeEdicaoDeRascunho(base, 2)).toBe(
      'Rascunho de ana. Suas alterações serão informadas a ele.',
    );
  });

  it('só vale para rascunho e com usuário conhecido', () => {
    expect(avisoDeEdicaoDeRascunho({ ...base, status: 'ABERTO' }, 2)).toBeNull();
    expect(avisoDeEdicaoDeRascunho(base, undefined)).toBeNull();
  });
});
