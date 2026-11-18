/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import Login from './Login';
import { renderizarTela } from '@/test/renderizar';

const mockEntrar = jest.fn();
const mockRecuperar = jest.fn();
let mockSessao: unknown = null;

jest.mock('@/api', () => ({
  ApiError: jest.requireActual('@/api/errors').ApiError,
  authApi: { recuperarSenha: (e: string) => mockRecuperar(e) },
}));
jest.mock('@/auth/AuthContext', () => ({
  useAuth: () => ({ sessao: mockSessao, entrar: mockEntrar }),
}));

const { ApiError } = jest.requireActual('@/api/errors');

function abrir() {
  return renderizarTela(
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/pedidos" element={<p>Fila de pedidos</p>} />
      <Route path="/sem-acesso" element={<p>Sem acesso</p>} />
    </Routes>,
    '/login',
  );
}

async function preencher(usuario: string, senha: string) {
  await userEvent.type(screen.getByLabelText('Usuário'), usuario);
  await userEvent.type(screen.getByLabelText('Senha'), senha);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSessao = null;
});

describe('Login', () => {
  it('mantém "Entrar" desabilitado até preencher usuário e senha', async () => {
    abrir();
    const entrar = screen.getByRole('button', { name: 'Entrar' });
    expect(entrar).toBeDisabled();
    await preencher('maria', 'segredo');
    expect(entrar).toBeEnabled();
  });

  it('envia usuário sem espaços e vai para a tela inicial do perfil', async () => {
    mockEntrar.mockResolvedValue({ perfil: 'OPERADOR' });
    abrir();
    await preencher('  maria ', 'segredo');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Fila de pedidos')).toBeInTheDocument();
    expect(mockEntrar).toHaveBeenCalledWith({ usuario: 'maria', senha: 'segredo' });
  });

  it('manda o vendedor para a página sem acesso', async () => {
    mockEntrar.mockResolvedValue({ perfil: 'VENDEDOR' });
    abrir();
    await preencher('joao', 'segredo');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Sem acesso')).toBeInTheDocument();
  });

  it('mostra "Usuário ou senha inválidos." em CREDENCIAIS_INVALIDAS', async () => {
    mockEntrar.mockRejectedValue(new ApiError(401, 'CREDENCIAIS_INVALIDAS', 'x'));
    abrir();
    await preencher('maria', 'errada');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Usuário ou senha inválidos.')).toBeInTheDocument();
  });

  it('avisa do bloqueio temporário da conta', async () => {
    mockEntrar.mockRejectedValue(
      new ApiError(423, 'CONTA_BLOQUEADA', 'x', { bloqueadoAte: '2026-11-18T15:00:00Z' }),
    );
    abrir();
    await preencher('maria', 'errada');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(
      await screen.findByText(/Conta bloqueada temporariamente após 3 tentativas inválidas/),
    ).toBeInTheDocument();
  });

  it('usa mensagem genérica quando o erro não vem do backend', async () => {
    mockEntrar.mockRejectedValue(new Error('boom'));
    abrir();
    await preencher('maria', 'segredo');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(
      await screen.findByText('Não foi possível entrar. Tente novamente.'),
    ).toBeInTheDocument();
  });

  it('já com sessão, redireciona sem mostrar o formulário', () => {
    mockSessao = { perfil: 'OPERADOR' };
    abrir();
    expect(screen.getByText('Fila de pedidos')).toBeInTheDocument();
    expect(screen.queryByLabelText('Senha')).not.toBeInTheDocument();
  });

  it('recuperação de senha: envia o e-mail e confirma, sem revelar se existe', async () => {
    mockRecuperar.mockResolvedValue(undefined);
    abrir();
    await userEvent.click(screen.getByRole('button', { name: 'Esqueci minha senha' }));
    await userEvent.type(screen.getByLabelText('E-mail corporativo'), ' a@b.com ');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar link' }));
    await waitFor(() => expect(mockRecuperar).toHaveBeenCalledWith('a@b.com'));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Se o e-mail estiver cadastrado, enviamos o link de recuperação.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Voltar ao login' }));
    expect(screen.getByLabelText('Senha')).toBeInTheDocument();
  });

  it('recuperação de senha: mostra erro quando o envio falha', async () => {
    mockRecuperar.mockRejectedValue(new Error('x'));
    abrir();
    await userEvent.click(screen.getByRole('button', { name: 'Esqueci minha senha' }));
    await userEvent.type(screen.getByLabelText('E-mail corporativo'), 'a@b.com');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar link' }));
    expect(
      await screen.findByText('Não foi possível enviar o link. Tente novamente.'),
    ).toBeInTheDocument();
  });
});
