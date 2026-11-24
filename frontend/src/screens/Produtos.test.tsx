/** @jest-environment <rootDir>/src/test/ambienteJsdom.cjs */
import '@testing-library/jest-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Produtos from './Produtos';
import { renderizarTela } from '@/test/renderizar';

const mockListar = jest.fn();
const mockCriar = jest.fn();

jest.mock('@/api', () => ({
  ApiError: jest.requireActual('@/api/errors').ApiError,
  produtosApi: {
    listar: (q?: string) => mockListar(q),
    criar: (dados: unknown) => mockCriar(dados),
    atualizar: jest.fn(),
  },
}));
jest.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ sessao: { perfil: 'ADMIN' } }),
}));

const { ApiError } = jest.requireActual('@/api/errors');

const recusa = (codigo: string, status: number, campos?: string[]) =>
  new ApiError(
    status,
    codigo,
    'Os dados enviados são inválidos.',
    campos === undefined ? undefined : { campos },
  );

/** Abre o formulário de novo produto, com uma variação, e preenche o mínimo para poder salvar. */
async function abrirEPreencher() {
  renderizarTela(<Produtos />);
  const novo = (await screen.findAllByRole('button', { name: 'Novo produto' }))[0]!;
  await userEvent.click(novo);
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar variação' }));
  await userEvent.type(screen.getByLabelText('Código interno'), 'DEMO-1');
  await userEvent.type(screen.getByLabelText('Descrição'), 'Produto de teste');
  await userEvent.type(screen.getByLabelText(/^NCM/), '5000');
  await userEvent.type(screen.getByLabelText('Marca'), 'Marca');
  await userEvent.type(screen.getByLabelText('Tamanho/embalagem'), '1 kg');
}

const salvar = () => userEvent.click(screen.getByRole('button', { name: 'Salvar produto' }));

beforeEach(() => {
  jest.clearAllMocks();
  mockListar.mockResolvedValue([]);
});

describe('Produtos — qual dado está inválido', () => {
  it('marca cada campo recusado com a dica e lista os campos no alerta', async () => {
    mockCriar.mockRejectedValue(
      recusa('VALIDATION_ERROR', 400, ['ncm', 'variacoes.0.quantidadeEstoque']),
    );
    await abrirEPreencher();

    await salvar();

    expect(await screen.findByText('O NCM tem 8 dígitos.')).toBeInTheDocument();
    expect(screen.getByText('Número inteiro de 0 a 2.147.483.647.')).toBeInTheDocument();
    expect(
      screen.getByText('Corrija os campos destacados: NCM; Quantidade em estoque (variação 1).'),
    ).toBeInTheDocument();
    // Campos aceitos não são marcados.
    expect(screen.queryByText('Obrigatória, até 60 caracteres.')).not.toBeInTheDocument();
    expect(screen.queryByText('Os dados enviados são inválidos.')).not.toBeInTheDocument();
  });

  it('tira a marca do campo quando a pessoa o edita, e o alerta passa a listar só o que falta', async () => {
    mockCriar.mockRejectedValue(
      recusa('VALIDATION_ERROR', 400, ['ncm', 'variacoes.0.quantidadeEstoque']),
    );
    await abrirEPreencher();
    await salvar();
    await screen.findByText('O NCM tem 8 dígitos.');

    await userEvent.type(screen.getByLabelText(/^NCM/), '1');

    await waitFor(() => expect(screen.queryByText('O NCM tem 8 dígitos.')).not.toBeInTheDocument());
    expect(screen.getByText('Número inteiro de 0 a 2.147.483.647.')).toBeInTheDocument();
    expect(
      screen.getByText('Corrija os campos destacados: Quantidade em estoque (variação 1).'),
    ).toBeInTheDocument();
  });

  it('em produto duplicado, marca código interno e EAN como já cadastrados', async () => {
    mockCriar.mockRejectedValue(recusa('PRODUTO_JA_CADASTRADO', 409, ['codigoInterno', 'ean']));
    await abrirEPreencher();

    await salvar();

    expect(
      await screen.findByText('Já existe um produto com este código interno.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Já existe um produto com este EAN.')).toBeInTheDocument();
  });

  it('sem lista de campos, mostra a mensagem do backend como antes', async () => {
    mockCriar.mockRejectedValue(recusa('VALIDATION_ERROR', 400));
    await abrirEPreencher();

    await salvar();

    expect(await screen.findByText('Os dados enviados são inválidos.')).toBeInTheDocument();
    expect(screen.queryByText(/Corrija os campos destacados/)).not.toBeInTheDocument();
  });
});
