import type { Perfil } from '@/api/types';
import {
  ehOperadorChefe,
  itensDoMenu,
  MENU,
  perfisAtribuiveis,
  perfisDoModulo,
  rotaInicial,
  temAcessoAoSistema2,
  temPerfil,
} from './perfis';

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

describe('perfil ADMIN', () => {
  it('vê todos os itens do menu e tem acesso ao Sistema 2', () => {
    expect(ids('ADMIN')).toEqual(MENU.map((i) => i.id));
    expect(temAcessoAoSistema2('ADMIN')).toBe(true);
    expect(rotaInicial('ADMIN')).toBe('/pedidos');
  });

  it('passa em todas as rotas de módulo e nas ações de operador chefe', () => {
    for (const item of MENU) expect(perfisDoModulo(item.id)).toContain('ADMIN');
    expect(ehOperadorChefe('ADMIN')).toBe(true);
    expect(ehOperadorChefe('OPERADOR')).toBe(false);
  });

  it('temPerfil: ADMIN sempre passa; os demais precisam estar na lista', () => {
    expect(temPerfil('ADMIN', [])).toBe(true);
    expect(temPerfil('FISCAL', ['FISCAL'])).toBe(true);
    expect(temPerfil('FISCAL', ['FINANCEIRO'])).toBe(false);
  });

  it('só ADMIN pode atribuir o perfil ADMIN', () => {
    const todos = ['OPERADOR', 'OPERADOR_CHEFE', 'ADMIN'] as const;
    expect(perfisAtribuiveis('OPERADOR_CHEFE', [...todos])).not.toContain('ADMIN');
    expect(perfisAtribuiveis('ADMIN', [...todos])).toContain('ADMIN');
  });
});
