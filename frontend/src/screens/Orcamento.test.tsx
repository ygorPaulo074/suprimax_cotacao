/** @jest-environment <rootDir>/src/test/ambienteJsdom.cjs */
import '@testing-library/jest-dom';
import { screen } from '@testing-library/react';
import { renderizarTela } from '@/test/renderizar';
import Orcamento from './Orcamento';

const mockObter = jest.fn();

jest.mock('@/api', () => ({
  ApiError: jest.requireActual('@/api/errors').ApiError,
  orcamentosApi: { obter: (id: number) => mockObter(id) },
}));

const { ApiError } = jest.requireActual('@/api/errors');

describe('Orçamento (rota /orcamentos/:id)', () => {
  it('na falha de leitura mostra título, a mensagem, "Tentar novamente" e o link de volta', async () => {
    mockObter.mockRejectedValue(
      new ApiError(0, 'SEM_CONEXAO', 'Sem conexão com o servidor. Tente novamente.'),
    );
    renderizarTela(<Orcamento />, '/');
    expect(await screen.findByText(/Sem conexão com o servidor/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Orçamento' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar para orçamentos' })).toHaveAttribute(
      'href',
      '/orcamentos',
    );
  });
});
