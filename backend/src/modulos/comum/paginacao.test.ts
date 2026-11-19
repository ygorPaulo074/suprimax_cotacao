// Parâmetros da paginação por cursor (docs/frontend-api.md, "Paginação").
import {
  esquemaDeParametrosDePagina,
  LIMITE_MAXIMO_DA_PAGINA,
  LIMITE_PADRAO_DA_PAGINA,
  lerParametrosDePagina,
} from './paginacao';

describe('esquemaDeParametrosDePagina', () => {
  it('aceita a query vazia', () => {
    expect(esquemaDeParametrosDePagina.safeParse({}).success).toBe(true);
  });

  it('converte limite e depois vindos como texto', () => {
    expect(esquemaDeParametrosDePagina.parse({ limite: '25', depois: '40' })).toEqual({
      limite: 25,
      depois: 40,
    });
  });

  it('aceita os limites inclusivos 1 e 200', () => {
    expect(esquemaDeParametrosDePagina.safeParse({ limite: '1' }).success).toBe(true);
    expect(
      esquemaDeParametrosDePagina.safeParse({ limite: String(LIMITE_MAXIMO_DA_PAGINA) }).success,
    ).toBe(true);
  });

  it.each(['0', '-1', '201', '1.5', 'abc'])('rejeita limite %p', (limite) => {
    expect(esquemaDeParametrosDePagina.safeParse({ limite }).success).toBe(false);
  });

  it.each(['0', '-3', '2.5', 'xyz'])('rejeita depois %p', (depois) => {
    expect(esquemaDeParametrosDePagina.safeParse({ depois }).success).toBe(false);
  });
});

describe('lerParametrosDePagina', () => {
  it('devolve null sem limite nem depois (formato antigo)', () => {
    expect(lerParametrosDePagina({})).toBeNull();
  });

  it('usa o limite padrão quando só vem depois', () => {
    expect(lerParametrosDePagina({ depois: 7 })).toEqual({
      limite: LIMITE_PADRAO_DA_PAGINA,
      depois: 7,
    });
  });

  it('não inclui depois quando só vem limite', () => {
    expect(lerParametrosDePagina({ limite: 10 })).toEqual({ limite: 10 });
  });
});
