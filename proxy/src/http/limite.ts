// Contador de janela fixa em memória, por chave (docs/12, seção 12.4). Usado para o limite por
// integrante, aplicado depois da autenticação: a chave é o service_id já validado, nunca um valor
// que o cliente escolhe sem credencial, e o token não entra na chave nem em log.

export class LimitePorChave {
  private readonly contagens = new Map<string, { inicio: number; total: number }>();
  private ultimaLimpeza = 0;

  constructor(
    private readonly janelaMs: number,
    private readonly maximo: number,
    private readonly agora: () => number = Date.now,
  ) {}

  /** Conta uma requisição da chave; devolve false se ela já passou do máximo na janela. */
  permitir(chave: string): boolean {
    const t = this.agora();
    this.limpar(t);
    const atual = this.contagens.get(chave);
    if (!atual || t - atual.inicio >= this.janelaMs) {
      this.contagens.set(chave, { inicio: t, total: 1 });
      return true;
    }
    atual.total += 1;
    return atual.total <= this.maximo;
  }

  private limpar(t: number): void {
    if (t - this.ultimaLimpeza < this.janelaMs) return;
    this.ultimaLimpeza = t;
    for (const [chave, c] of this.contagens) {
      if (t - c.inicio >= this.janelaMs) this.contagens.delete(chave);
    }
  }
}
