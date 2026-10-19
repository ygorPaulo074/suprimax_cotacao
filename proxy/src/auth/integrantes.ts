import type { Executor } from '../banco/executor';

// Integrantes do proxy (tabela integrantes_proxy, docs/12, seção 12.7). Só o hash do token é guardado.

export interface Integrante {
  id: string;
  nomeSistema: string;
  chaveHash: string;
  escopos: string[];
  ativo: boolean;
  criadoEm: Date;
  expiraEm: Date | null;
}

export interface RepositorioIntegrantes {
  buscarPorId(id: string): Promise<Integrante | null>;
  criar(integrante: Integrante): Promise<void>;
  /** false se o integrante não existe. */
  revogar(id: string): Promise<boolean>;
}

export class RepositorioIntegrantesMemoria implements RepositorioIntegrantes {
  private readonly dados = new Map<string, Integrante>();

  async buscarPorId(id: string): Promise<Integrante | null> {
    const i = this.dados.get(id);
    return i ? { ...i } : null;
  }
  async criar(integrante: Integrante): Promise<void> {
    this.dados.set(integrante.id, { ...integrante });
  }
  async revogar(id: string): Promise<boolean> {
    const i = this.dados.get(id);
    if (!i) return false;
    i.ativo = false;
    return true;
  }
}

interface LinhaIntegrante {
  id: string;
  nome_sistema: string;
  chave_hash: string;
  escopos: string[];
  ativo: boolean;
  criado_em: Date;
  expira_em: Date | null;
}

/** Implementação sobre a tabela integrantes_proxy (a ser criada pelo responsável pelo banco). */
export class RepositorioIntegrantesPg implements RepositorioIntegrantes {
  constructor(private readonly banco: Executor) {}

  async buscarPorId(id: string): Promise<Integrante | null> {
    const { linhas } = await this.banco.consultar({
      texto:
        'SELECT id, nome_sistema, chave_hash, escopos, ativo, criado_em, expira_em FROM integrantes_proxy WHERE id = $1',
      valores: [id],
    });
    const l = linhas[0] as unknown as LinhaIntegrante | undefined;
    return l
      ? {
          id: l.id,
          nomeSistema: l.nome_sistema,
          chaveHash: l.chave_hash,
          escopos: l.escopos,
          ativo: l.ativo,
          criadoEm: l.criado_em,
          expiraEm: l.expira_em,
        }
      : null;
  }

  async criar(i: Integrante): Promise<void> {
    await this.banco.consultar({
      texto:
        'INSERT INTO integrantes_proxy (id, nome_sistema, chave_hash, escopos, ativo, criado_em, expira_em) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      valores: [i.id, i.nomeSistema, i.chaveHash, i.escopos, i.ativo, i.criadoEm, i.expiraEm],
    });
  }

  async revogar(id: string): Promise<boolean> {
    const { contagem } = await this.banco.consultar({
      texto: 'UPDATE integrantes_proxy SET ativo = false WHERE id = $1',
      valores: [id],
    });
    return contagem > 0;
  }
}
