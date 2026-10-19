import type { Perfil } from '@/api/types';
import { itensDoMenu, rotaInicial, temAcessoAoSistema2 } from './perfis';

const ids = (perfil: Perfil) => itensDoMenu(perfil).map((i) => i.id);

describe('visibilidade do menu por perfil (docs/10, seção 10.2)', () => {
  it('Operador não vê fornecedores, crédito, dívidas nem usuários', () => {
    expect(ids('OPERADOR')).toEqual([
      'pedidos',
      'orcamentos',
      'respostas',
      'clientes',
      'produtos',
      'entrada',
    ]);
  });

  it('Operador chefe vê tudo, exceto Análise de crédito e Dívidas', () => {
    const chefe = ids('OPERADOR_CHEFE');
    expect(chefe).toHaveLength(8);
    expect(chefe).toEqual(expect.arrayContaining(['fornecedores', 'usuarios']));
    expect(chefe).not.toContain('credito');
    expect(chefe).not.toContain('dividas');
  });

  it('Fiscal só vê Análise de crédito e Financeiro só vê Dívidas', () => {
    expect(ids('FISCAL')).toEqual(['credito']);
    expect(ids('FINANCEIRO')).toEqual(['dividas']);
  });

  it('Vendedor e Gestor não têm acesso ao Sistema 2', () => {
    expect(temAcessoAoSistema2('VENDEDOR')).toBe(false);
    expect(temAcessoAoSistema2('GESTOR')).toBe(false);
    expect(rotaInicial('VENDEDOR')).toBe('/sem-acesso');
  });

  it('a rota inicial é o primeiro item do menu do perfil', () => {
    expect(rotaInicial('OPERADOR')).toBe('/pedidos');
    expect(rotaInicial('FISCAL')).toBe('/credito');
  });
});
