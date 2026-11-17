import { LimitePorChave } from './limite';

describe('LimitePorChave', () => {
  it('conta por chave e zera ao fim da janela', () => {
    let t = 1000;
    const limite = new LimitePorChave(60_000, 2, () => t);
    expect([limite.permitir('a'), limite.permitir('a'), limite.permitir('a')]).toEqual([
      true,
      true,
      false,
    ]);
    expect(limite.permitir('b')).toBe(true);
    t += 60_000;
    expect(limite.permitir('a')).toBe(true);
  });
});
