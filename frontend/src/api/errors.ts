/** Erro devolvido pelo backend (corpo JSON { codigo, mensagem, detalhes? }) ou falha de rede. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: string,
    mensagem: string,
    public readonly detalhes?: Record<string, unknown>,
  ) {
    super(mensagem);
    this.name = 'ApiError';
  }
  get semConexao(): boolean {
    return this.status === 0;
  }
}
