/** @jest-environment <rootDir>/src/test/ambienteJsdom.cjs */
import '@testing-library/jest-dom';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Usuarios from './Usuarios';
import { renderizarTela } from '@/test/renderizar';

const mockListar = jest.fn();
const mockCriar = jest.fn();
const mockAtualizar = jest.fn();
const mockVendedores = jest.fn();
let mockPerfil = 'OPERADOR_CHEFE';

jest.mock('@/api', () => ({
  ApiError: jest.requireActual('@/api/errors').ApiError,
  usuariosApi: {
    listar: () => mockListar(),
    criar: (d: unknown) => mockCriar(d),
    atualizar: (id: number, d: unknown) => mockAtualizar(id, d),
  },
  clientesApi: { vendedores: () => mockVendedores() },
}));
jest.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ sessao: { idOperador: 1, perfil: mockPerfil } }),
}));

const { ApiError } = jest.requireActual('@/api/errors');

const MARIA = {
  idOperador: 2,
  usuario: 'maria',
  email: 'maria@suprimax.com',
  perfil: 'OPERADOR',
  status: 'ATIVO',
  clientesNaCarteira: 0,
};
const JOAO = {
  idOperador: 3,
  usuario: 'joao',
  email: 'joao@suprimax.com',
  perfil: 'VENDEDOR',
  status: 'ATIVO',
  clientesNaCarteira: 4,
};

function linha(nome: string) {
  return screen.getByText(nome).closest('tr') as HTMLElement;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPerfil = 'OPERADOR_CHEFE';
  mockListar.mockResolvedValue([MARIA, JOAO]);
  mockVendedores.mockResolvedValue([
    { idOperador: 3, nome: 'joao' },
    { idOperador: 9, nome: 'ana' },
  ]);
});

describe('Usuários', () => {
  it('lista usuários com e-mail, perfil e status', async () => {
    renderizarTela(<Usuarios />);
    expect(await screen.findByText('maria')).toBeInTheDocument();
    expect(linha('joao')).toHaveTextContent('joao@suprimax.com');
  });

  it('mostra estado vazio e erro', async () => {
    mockListar.mockResolvedValueOnce([]);
    const { unmount } = renderizarTela(<Usuarios />);
    expect(await screen.findByText('Nenhum usuário cadastrado')).toBeInTheDocument();
    unmount();
    mockListar.mockRejectedValueOnce(new ApiError(500, 'ERRO', 'Falha ao listar usuários'));
    renderizarTela(<Usuarios />);
    expect(await screen.findByText('Falha ao listar usuários')).toBeInTheDocument();
  });

  it('só oferece o perfil Administrador a quem é ADMIN', async () => {
    const { unmount } = renderizarTela(<Usuarios />);
    await screen.findByText('maria');
    expect(screen.queryByRole('option', { name: 'Administrador' })).not.toBeInTheDocument();
    unmount();
    mockPerfil = 'ADMIN';
    renderizarTela(<Usuarios />);
    await screen.findByText('maria');
    expect(screen.getByRole('option', { name: 'Administrador' })).toBeInTheDocument();
  });

  it('cadastra usuário com dados aparados e limpa o formulário', async () => {
    mockCriar.mockResolvedValue({});
    renderizarTela(<Usuarios />);
    await screen.findByText('maria');
    const cadastrar = screen.getByRole('button', { name: 'Cadastrar' });
    expect(cadastrar).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Usuário'), ' novo ');
    await userEvent.type(screen.getByLabelText('E-mail'), 'novo@x.com');
    await userEvent.click(cadastrar);
    await waitFor(() =>
      expect(mockCriar).toHaveBeenCalledWith({
        usuario: 'novo',
        email: 'novo@x.com',
        perfil: 'OPERADOR',
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('Usuário')).toHaveValue(''));
  });

  it('mostra o erro do servidor ao cadastrar', async () => {
    mockCriar.mockRejectedValue(new ApiError(409, 'USUARIO_JA_CADASTRADO', 'Usuário já existe'));
    renderizarTela(<Usuarios />);
    await screen.findByText('maria');
    await userEvent.type(screen.getByLabelText('Usuário'), 'maria');
    await userEvent.type(screen.getByLabelText('E-mail'), 'm@x.com');
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));
    expect(await screen.findByText('Usuário já existe')).toBeInTheDocument();
  });

  it('inativa um usuário sem carteira direto', async () => {
    mockAtualizar.mockResolvedValue({});
    renderizarTela(<Usuarios />);
    await screen.findByText('maria');
    await userEvent.click(within(linha('maria')).getByRole('button', { name: 'Inativar' }));
    await waitFor(() =>
      expect(mockAtualizar).toHaveBeenCalledWith(2, { status: 'INATIVO', perfil: undefined }),
    );
  });

  it('vendedor com carteira pede o novo responsável antes de inativar', async () => {
    mockAtualizar.mockResolvedValue({});
    renderizarTela(<Usuarios />);
    await screen.findByText('joao');
    await userEvent.click(within(linha('joao')).getByRole('button', { name: 'Inativar' }));
    const modal = await screen.findByRole('dialog', { name: 'Novo vendedor responsável' });
    expect(mockAtualizar).not.toHaveBeenCalled();
    const confirmar = within(modal).getByRole('button', {
      name: 'Inativar e transferir carteira',
    });
    expect(confirmar).toBeDisabled();
    // o próprio vendedor não aparece como opção
    await within(modal).findByRole('option', { name: 'ana' });
    expect(within(modal).queryByRole('option', { name: 'joao' })).not.toBeInTheDocument();
    await userEvent.selectOptions(within(modal).getByLabelText('Novo vendedor responsável'), 'ana');
    await userEvent.click(confirmar);
    await waitFor(() =>
      expect(mockAtualizar).toHaveBeenCalledWith(3, { status: 'INATIVO', idNovoVendedor: 9 }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('abre o modal de transferência quando o servidor devolve NOVO_VENDEDOR_OBRIGATORIO', async () => {
    mockListar.mockResolvedValue([MARIA]);
    mockAtualizar.mockRejectedValue(new ApiError(422, 'NOVO_VENDEDOR_OBRIGATORIO', 'x'));
    renderizarTela(<Usuarios />);
    await screen.findByText('maria');
    await userEvent.click(within(linha('maria')).getByRole('button', { name: 'Inativar' }));
    expect(
      await screen.findByRole('dialog', { name: 'Novo vendedor responsável' }),
    ).toBeInTheDocument();
  });

  it('reativa um usuário inativo', async () => {
    mockListar.mockResolvedValue([{ ...MARIA, status: 'INATIVO' }]);
    mockAtualizar.mockResolvedValue({});
    renderizarTela(<Usuarios />);
    await screen.findByText('maria');
    await userEvent.click(screen.getByRole('button', { name: 'Reativar' }));
    await waitFor(() =>
      expect(mockAtualizar).toHaveBeenCalledWith(2, { status: 'ATIVO', perfil: undefined }),
    );
  });

  it('editar e-mail: salvar só habilita com e-mail novo e envia aparado', async () => {
    mockAtualizar.mockResolvedValue({});
    renderizarTela(<Usuarios />);
    await screen.findByText('maria');
    await userEvent.click(within(linha('maria')).getByRole('button', { name: 'Editar e-mail' }));
    const modal = await screen.findByRole('dialog', { name: 'Editar e-mail de maria' });
    const salvar = within(modal).getByRole('button', { name: 'Salvar' });
    expect(salvar).toBeDisabled(); // igual ao atual
    const campo = within(modal).getByLabelText('E-mail');
    await userEvent.clear(campo);
    expect(salvar).toBeDisabled(); // vazio
    await userEvent.type(campo, ' nova@suprimax.com ');
    await userEvent.click(salvar);
    await waitFor(() =>
      expect(mockAtualizar).toHaveBeenCalledWith(2, { email: 'nova@suprimax.com' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('editar e-mail: 409 mostra a mensagem e mantém o modal aberto', async () => {
    mockAtualizar.mockRejectedValue(new ApiError(409, 'USUARIO_JA_CADASTRADO', 'conflito'));
    renderizarTela(<Usuarios />);
    await screen.findByText('maria');
    await userEvent.click(within(linha('maria')).getByRole('button', { name: 'Editar e-mail' }));
    const modal = await screen.findByRole('dialog');
    await userEvent.type(within(modal).getByLabelText('E-mail'), 'x');
    await userEvent.click(within(modal).getByRole('button', { name: 'Salvar' }));
    expect(
      await within(modal).findByText('Já existe um usuário com este e-mail.'),
    ).toBeInTheDocument();
    await userEvent.click(within(modal).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
