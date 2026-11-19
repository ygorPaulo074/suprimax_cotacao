/** @jest-environment <rootDir>/src/test/ambienteJsdom.cjs */
import '@testing-library/jest-dom';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';
import CadastroCliente from './CadastroCliente';
import Clientes from './Clientes';
import Fornecedores from './Fornecedores';
import Produtos from './Produtos';
import Usuarios from './Usuarios';
import { renderizarTela } from '@/test/renderizar';

/**
 * RNF06: aviso de alterações não salvas nos formulários de cadastro. Cada tela é testada para:
 * sem digitar nada, sai sem aviso; digitar avisa; voltar ao valor original desfaz o aviso; salvar
 * (ou Cancelar) não avisa. Os valores formatados (máscara, espaços, centavos) não geram falso aviso.
 */

const mockForneced = jest.fn();
const mockFornecedoresListar = jest.fn();
const mockClienteCriar = jest.fn();
const mockProdutosListar = jest.fn();
const mockProdutoAtualizar = jest.fn();
const mockUsuariosListar = jest.fn();
const mockUsuarioCriar = jest.fn();
const mockAdicionarEndereco = jest.fn();

jest.mock('@/api', () => ({
  ApiError: jest.requireActual('@/api/errors').ApiError,
  fornecedoresApi: {
    listar: () => mockFornecedoresListar(),
    criar: (d: unknown) => mockForneced(d),
  },
  clientesApi: {
    vendedores: () => Promise.resolve([{ idOperador: 3, nome: 'joao' }]),
    criar: (d: unknown) => mockClienteCriar(d),
    buscarPorCnpj: () =>
      Promise.resolve({
        idCliente: 3,
        cnpj: '12345678000190',
        razaoSocial: 'Mercado X',
        nomeContato: 'Ana',
        telefoneContato: null,
        emailContato: null,
        tipoUnidade: 'MATRIZ',
        status: 'ATIVO',
        vendedorResponsavel: 'joao',
        enderecos: [],
        dividaEmAberto: 0,
      }),
    orcamentosEmAberto: () => Promise.resolve([]),
    historicoCompras: () => Promise.resolve([]),
    adicionarEndereco: (id: number, d: unknown) => mockAdicionarEndereco(id, d),
  },
  orcamentosApi: { criar: jest.fn() },
  produtosApi: {
    listar: () => mockProdutosListar(),
    atualizar: (id: number, d: unknown) => mockProdutoAtualizar(id, d),
    criar: jest.fn(),
  },
  usuariosApi: {
    listar: () => mockUsuariosListar(),
    criar: (d: unknown) => mockUsuarioCriar(d),
    atualizar: jest.fn(),
  },
}));
jest.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ sessao: { idOperador: 1, perfil: 'OPERADOR_CHEFE' } }),
}));

function Rota() {
  return <span data-testid="rota">{useLocation().pathname}</span>;
}

function abrir(tela: ReactElement, rota = '/') {
  return renderizarTela(
    <>
      {tela}
      <Link to="/pedidos">Ir para Pedidos</Link>
      <Rota />
    </>,
    rota,
  );
}
const sair = () => userEvent.click(screen.getByRole('link', { name: 'Ir para Pedidos' }));
const dialogo = () => screen.queryByRole('dialog', { name: 'Alterações não salvas' });
const beforeUnloadBloqueado = () => {
  const evento = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(evento);
  return evento.defaultPrevented;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFornecedoresListar.mockResolvedValue([]);
  mockProdutosListar.mockResolvedValue([]);
  mockUsuariosListar.mockResolvedValue([]);
});

describe('Fornecedores', () => {
  it('sem digitar, sai sem aviso', async () => {
    abrir(<Fornecedores />);
    expect(beforeUnloadBloqueado()).toBe(false);
    await sair();
    expect(dialogo()).toBeNull();
    expect(screen.getByTestId('rota')).toHaveTextContent('/pedidos');
  });

  it('só espaços não contam; texto avisa; apagar desfaz o aviso', async () => {
    abrir(<Fornecedores />);
    const razao = screen.getByLabelText('Razão social');
    fireEvent.change(razao, { target: { value: '   ' } });
    expect(beforeUnloadBloqueado()).toBe(false);
    fireEvent.change(razao, { target: { value: 'Acme' } });
    expect(beforeUnloadBloqueado()).toBe(true);
    await sair();
    expect(await screen.findByRole('dialog', { name: 'Alterações não salvas' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Ficar na tela' }));
    expect(screen.getByLabelText('Razão social')).toHaveValue('Acme');
    fireEvent.change(razao, { target: { value: '' } });
    await sair();
    expect(dialogo()).toBeNull();
    expect(screen.getByTestId('rota')).toHaveTextContent('/pedidos');
  });

  it('"Sair sem salvar" deixa a tela', async () => {
    abrir(<Fornecedores />);
    await userEvent.type(screen.getByLabelText('Razão social'), 'Acme');
    await sair();
    await userEvent.click(await screen.findByRole('button', { name: 'Sair sem salvar' }));
    await waitFor(() => expect(screen.getByTestId('rota')).toHaveTextContent('/pedidos'));
  });

  it('salvar limpa o formulário e não avisa ao sair', async () => {
    mockForneced.mockResolvedValue({});
    abrir(<Fornecedores />);
    await userEvent.type(screen.getByLabelText('CNPJ'), '12345678000190');
    await userEvent.type(screen.getByLabelText('Razão social'), 'Acme');
    expect(beforeUnloadBloqueado()).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /Cadastrar|Salvar/ }));
    await waitFor(() => expect(mockForneced).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('Razão social')).toHaveValue(''));
    expect(beforeUnloadBloqueado()).toBe(false);
    await sair();
    expect(dialogo()).toBeNull();
  });
});

describe('Cadastro de cliente', () => {
  it('sem digitar, sai sem aviso (mesmo com CNPJ vindo da URL)', async () => {
    abrir(<CadastroCliente />, '/clientes/novo?cnpj=12345678000190');
    expect(screen.getByLabelText('CNPJ')).toHaveValue('12345678000190');
    expect(beforeUnloadBloqueado()).toBe(false);
    await sair();
    expect(dialogo()).toBeNull();
  });

  it('CNPJ com máscara equivalente ao da URL não gera aviso; outro CNPJ gera', async () => {
    abrir(<CadastroCliente />, '/clientes/novo?cnpj=12345678000190');
    const cnpj = screen.getByLabelText('CNPJ');
    fireEvent.change(cnpj, { target: { value: '12.345.678/0001-90' } });
    expect(beforeUnloadBloqueado()).toBe(false);
    fireEvent.change(cnpj, { target: { value: '12345678000191' } });
    expect(beforeUnloadBloqueado()).toBe(true);
    fireEvent.change(cnpj, { target: { value: '12345678000190' } });
    expect(beforeUnloadBloqueado()).toBe(false);
  });

  it('digitar um campo, o aceite LGPD ou um endereço avisa; voltar ao original desfaz', async () => {
    abrir(<CadastroCliente />, '/clientes/novo');
    const razao = screen.getByLabelText('Razão social');
    fireEvent.change(razao, { target: { value: 'Mercado X' } });
    expect(beforeUnloadBloqueado()).toBe(true);
    fireEvent.change(razao, { target: { value: '' } });
    expect(beforeUnloadBloqueado()).toBe(false);

    const lgpd = screen.getByRole('checkbox');
    await userEvent.click(lgpd);
    expect(beforeUnloadBloqueado()).toBe(true);
    await userEvent.click(lgpd);
    expect(beforeUnloadBloqueado()).toBe(false);

    const rua = screen.getByLabelText('Logradouro');
    fireEvent.change(rua, { target: { value: 'Rua A' } });
    expect(beforeUnloadBloqueado()).toBe(true);
    await sair();
    expect(await screen.findByRole('dialog', { name: 'Alterações não salvas' })).toBeVisible();
  });

  it('Cancelar descarta de propósito, sem aviso', async () => {
    abrir(<CadastroCliente />, '/clientes/novo');
    await userEvent.type(screen.getByLabelText('Razão social'), 'Mercado X');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(dialogo()).toBeNull();
    await waitFor(() => expect(screen.getByTestId('rota')).toHaveTextContent('/clientes'));
  });

  it('salvar com sucesso navega sem aviso', async () => {
    mockClienteCriar.mockResolvedValue({ cnpj: '12345678000190' });
    abrir(<CadastroCliente />, '/clientes/novo');
    await userEvent.type(screen.getByLabelText('CNPJ'), '12345678000190');
    await userEvent.type(screen.getByLabelText('Razão social'), 'Mercado X');
    await userEvent.type(screen.getByLabelText('Nome do contato'), 'Ana');
    await userEvent.selectOptions(await screen.findByLabelText('Vendedor responsável'), '3');
    await userEvent.type(screen.getByLabelText('Logradouro'), 'Rua A');
    await userEvent.type(screen.getByLabelText('Número'), '10');
    await userEvent.type(screen.getByLabelText('Bairro'), 'Centro');
    await userEvent.type(screen.getByLabelText('Cidade'), 'Recife');
    await userEvent.type(screen.getByLabelText('UF'), 'PE');
    await userEvent.type(screen.getByLabelText('CEP'), '50000000');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(mockClienteCriar).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('rota')).toHaveTextContent('/clientes'));
    expect(dialogo()).toBeNull();
  });
});

describe('Produtos', () => {
  const PRODUTO = {
    idProduto: 5,
    codigoInterno: 'DET-1',
    descricao: 'Detergente',
    ncm: null,
    ean: null,
    categoria: null,
    ativo: true,
    variacoes: [
      {
        idVariacao: 9,
        marca: 'Limpex',
        tamanhoEmbalagem: '500 ml',
        quantidadeEstoque: 30,
        faixasPreco: [{ quantidadeMinima: 1, precoUnitario: 1050 }],
        fardos: [],
      },
    ],
  };

  async function editar() {
    mockProdutosListar.mockResolvedValue([PRODUTO]);
    abrir(<Produtos />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    return screen.findByLabelText('Descrição');
  }

  it('lista sem formulário aberto: sai sem aviso', async () => {
    abrir(<Produtos />);
    await sair();
    expect(dialogo()).toBeNull();
  });

  it('abrir para editar sem mexer não avisa', async () => {
    await editar();
    expect(beforeUnloadBloqueado()).toBe(false);
    await sair();
    expect(dialogo()).toBeNull();
  });

  it('preço em centavos: máscara e zeros equivalentes não avisam; outro valor avisa', async () => {
    await editar();
    const preco = screen.getByLabelText('Preço unitário (R$)');
    expect(preco).toHaveValue('10,50');
    fireEvent.change(preco, { target: { value: 'R$ 10,5' } });
    expect(beforeUnloadBloqueado()).toBe(false);
    fireEvent.change(preco, { target: { value: '10,51' } });
    expect(beforeUnloadBloqueado()).toBe(true);
    fireEvent.change(preco, { target: { value: '10,50' } });
    expect(beforeUnloadBloqueado()).toBe(false);
  });

  it('editar a descrição avisa; voltar ao texto original (ou com espaços) desfaz', async () => {
    const descricao = await editar();
    fireEvent.change(descricao, { target: { value: 'Detergente Neutro' } });
    await sair();
    expect(await screen.findByRole('dialog', { name: 'Alterações não salvas' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Ficar na tela' }));
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: ' Detergente ' } });
    await sair();
    expect(dialogo()).toBeNull();
    expect(screen.getByTestId('rota')).toHaveTextContent('/pedidos');
  });

  it('novo produto: digitar avisa; Cancelar fecha o formulário e desfaz o aviso', async () => {
    abrir(<Produtos />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Novo produto' })[0]!);
    await userEvent.type(await screen.findByLabelText('Código interno'), 'X-1');
    expect(beforeUnloadBloqueado()).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(beforeUnloadBloqueado()).toBe(false);
    await sair();
    expect(dialogo()).toBeNull();
  });

  it('salvar fecha o formulário e não avisa', async () => {
    mockProdutoAtualizar.mockResolvedValue({});
    const descricao = await editar();
    fireEvent.change(descricao, { target: { value: 'Detergente Neutro' } });
    await userEvent.click(screen.getByRole('button', { name: 'Salvar produto' }));
    await waitFor(() => expect(mockProdutoAtualizar).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByLabelText('Descrição')).toBeNull());
    expect(beforeUnloadBloqueado()).toBe(false);
    await sair();
    expect(dialogo()).toBeNull();
  });
});

describe('Usuários (novo usuário)', () => {
  it('sem digitar, sai sem aviso (o perfil padrão não conta)', async () => {
    abrir(<Usuarios />);
    expect(beforeUnloadBloqueado()).toBe(false);
    await sair();
    expect(dialogo()).toBeNull();
  });

  it('digitar avisa; apagar desfaz; trocar só o perfil não avisa', async () => {
    abrir(<Usuarios />);
    const nome = screen.getAllByLabelText('Usuário')[0]!;
    fireEvent.change(nome, { target: { value: 'carla' } });
    expect(beforeUnloadBloqueado()).toBe(true);
    fireEvent.change(nome, { target: { value: '  ' } });
    expect(beforeUnloadBloqueado()).toBe(false);
    await userEvent.selectOptions(screen.getByLabelText('Perfil'), 'VENDEDOR');
    expect(beforeUnloadBloqueado()).toBe(false);
  });

  it('"Ficar na tela" mantém o texto; "Sair sem salvar" sai', async () => {
    abrir(<Usuarios />);
    await userEvent.type(screen.getByLabelText('E-mail'), 'a@b.com');
    await sair();
    await userEvent.click(await screen.findByRole('button', { name: 'Ficar na tela' }));
    expect(screen.getByLabelText('E-mail')).toHaveValue('a@b.com');
    await sair();
    await userEvent.click(await screen.findByRole('button', { name: 'Sair sem salvar' }));
    await waitFor(() => expect(screen.getByTestId('rota')).toHaveTextContent('/pedidos'));
  });

  it('salvar limpa os campos e não avisa', async () => {
    mockUsuarioCriar.mockResolvedValue({});
    abrir(<Usuarios />);
    await userEvent.type(screen.getAllByLabelText('Usuário')[0]!, 'carla');
    await userEvent.type(screen.getByLabelText('E-mail'), 'carla@suprimax.com');
    await userEvent.click(screen.getByRole('button', { name: /Criar|Cadastrar|Salvar/ }));
    await waitFor(() => expect(mockUsuarioCriar).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('E-mail')).toHaveValue(''));
    expect(beforeUnloadBloqueado()).toBe(false);
    await sair();
    expect(dialogo()).toBeNull();
  });
});

describe('Ficha do cliente (novo endereço de entrega)', () => {
  async function abrirFormulario() {
    abrir(<Clientes />, '/clientes?cnpj=12345678000190');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Adicionar endereço de entrega' }),
    );
    return screen.findByLabelText('Logradouro');
  }

  it('formulário fechado ou aberto sem digitar: sai sem aviso', async () => {
    await abrirFormulario();
    expect(beforeUnloadBloqueado()).toBe(false);
    await sair();
    expect(dialogo()).toBeNull();
  });

  it('digitar avisa; apagar desfaz; Cancelar fecha e desfaz', async () => {
    const rua = await abrirFormulario();
    fireEvent.change(rua, { target: { value: 'Rua B' } });
    expect(beforeUnloadBloqueado()).toBe(true);
    fireEvent.change(rua, { target: { value: ' ' } });
    expect(beforeUnloadBloqueado()).toBe(false);
    fireEvent.change(rua, { target: { value: 'Rua B' } });
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(beforeUnloadBloqueado()).toBe(false);
    await sair();
    expect(dialogo()).toBeNull();
  });

  it('menu "Clientes" (mesmo pathname, sem ?cnpj=) com o formulário sujo avisa', async () => {
    abrir(
      <>
        <Clientes />
        <Link to="/clientes">Clientes</Link>
      </>,
      '/clientes?cnpj=12345678000190',
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Adicionar endereço de entrega' }),
    );
    fireEvent.change(await screen.findByLabelText('Logradouro'), { target: { value: 'Rua B' } });
    await userEvent.click(screen.getByRole('link', { name: 'Clientes' }));
    expect(await screen.findByRole('dialog', { name: 'Alterações não salvas' })).toBeVisible();
    expect(screen.getByLabelText('Logradouro')).toHaveValue('Rua B');
  });

  it('menu "Clientes" com o formulário limpo não avisa', async () => {
    abrir(
      <>
        <Clientes />
        <Link to="/clientes">Clientes</Link>
      </>,
      '/clientes?cnpj=12345678000190',
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Adicionar endereço de entrega' }),
    );
    await screen.findByLabelText('Logradouro');
    await userEvent.click(screen.getByRole('link', { name: 'Clientes' }));
    expect(dialogo()).toBeNull();
    await waitFor(() => expect(screen.queryByLabelText('Logradouro')).toBeNull());
  });

  it('salvar fecha o formulário e não avisa', async () => {
    mockAdicionarEndereco.mockResolvedValue({});
    const rua = await abrirFormulario();
    fireEvent.change(rua, { target: { value: 'Rua B' } });
    await userEvent.type(screen.getByLabelText('Número'), '5');
    await userEvent.type(screen.getByLabelText('Bairro'), 'Centro');
    await userEvent.type(screen.getByLabelText('Cidade'), 'Recife');
    await userEvent.type(screen.getByLabelText('UF'), 'PE');
    await userEvent.type(screen.getByLabelText('CEP'), '50000000');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar endereço' }));
    await waitFor(() => expect(mockAdicionarEndereco).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByLabelText('Logradouro')).toBeNull());
    expect(beforeUnloadBloqueado()).toBe(false);
    await sair();
    expect(dialogo()).toBeNull();
  });
});
