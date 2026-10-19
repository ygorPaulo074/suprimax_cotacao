import type { Perfil } from '@/api/types';

/** Itens do menu e visibilidade por perfil (docs/10, seção 10.2). Ocultar é conveniência: o backend autoriza. */
export type ModuloId =
  | 'pedidos'
  | 'orcamentos'
  | 'respostas'
  | 'clientes'
  | 'produtos'
  | 'entrada'
  | 'fornecedores'
  | 'credito'
  | 'dividas'
  | 'usuarios';

export interface ItemMenu {
  id: ModuloId;
  rotulo: string;
  caminho: string;
}

const OPERADORES: Perfil[] = ['OPERADOR', 'OPERADOR_CHEFE'];

export const MENU: (ItemMenu & { perfis: Perfil[] })[] = [
  { id: 'pedidos', rotulo: 'Pedidos', caminho: '/pedidos', perfis: OPERADORES },
  { id: 'orcamentos', rotulo: 'Orçamentos', caminho: '/orcamentos', perfis: OPERADORES },
  { id: 'respostas', rotulo: 'Respostas pendentes', caminho: '/respostas', perfis: OPERADORES },
  { id: 'clientes', rotulo: 'Clientes', caminho: '/clientes', perfis: OPERADORES },
  { id: 'produtos', rotulo: 'Produtos', caminho: '/produtos', perfis: OPERADORES },
  {
    id: 'entrada',
    rotulo: 'Entrada de mercadoria',
    caminho: '/entrada-mercadoria',
    perfis: OPERADORES,
  },
  {
    id: 'fornecedores',
    rotulo: 'Fornecedores',
    caminho: '/fornecedores',
    perfis: ['OPERADOR_CHEFE'],
  },
  { id: 'credito', rotulo: 'Análise de crédito', caminho: '/credito', perfis: ['FISCAL'] },
  { id: 'dividas', rotulo: 'Dívidas', caminho: '/dividas', perfis: ['FINANCEIRO'] },
  { id: 'usuarios', rotulo: 'Usuários', caminho: '/usuarios', perfis: ['OPERADOR_CHEFE'] },
];

export function itensDoMenu(perfil: Perfil): ItemMenu[] {
  return MENU.filter((item) => item.perfis.includes(perfil)).map(({ id, rotulo, caminho }) => ({
    id,
    rotulo,
    caminho,
  }));
}

/** VENDEDOR e GESTOR não têm menu no Sistema 2: atuam nos Sistemas 1 e 3. */
export function temAcessoAoSistema2(perfil: Perfil): boolean {
  return itensDoMenu(perfil).length > 0;
}

export function rotaInicial(perfil: Perfil): string {
  return itensDoMenu(perfil)[0]?.caminho ?? '/sem-acesso';
}

/** Perfis que podem abrir um módulo (usado nas rotas protegidas). */
export function perfisDoModulo(id: ModuloId): Perfil[] {
  return MENU.find((item) => item.id === id)?.perfis ?? [];
}

/** Ações exclusivas do operador chefe (docs/10, seção 10.2). */
export const ehOperadorChefe = (perfil: Perfil): boolean => perfil === 'OPERADOR_CHEFE';
