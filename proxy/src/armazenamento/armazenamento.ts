import { randomUUID } from 'node:crypto';
import { AppError } from '../erros';

// Armazenamento de anexos no Supabase Storage (UC19, RF11; docs/12, seção 12.8.3). O backend nunca
// fala com o Storage: o proxy monta o caminho, guarda o objeto em bucket privado e assina URLs.

export const BUCKET_ANEXOS = 'anexos-orcamento';
export const LIMITE_BYTES = 10 * 1024 * 1024;
export const PREFIXO_CAMINHO = 'orcamento/';
export const EXPIRA_PADRAO_SEGUNDOS = 300;
export const EXPIRA_MAXIMO_SEGUNDOS = 3600;
const TAMANHO_MAXIMO_NOME = 100;

type Fetch = typeof fetch;

/** Remove separadores de caminho, "..", caracteres de controle e limita o tamanho do nome. */
export function sanearNome(nome: string): string {
  // eslint-disable-next-line no-control-regex
  let n = nome.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[/\\]/g, '_');
  n = n.replace(/\.{2,}/g, '.').trim();
  n = n.replace(/^\.+/, '');
  if (n.length > TAMANHO_MAXIMO_NOME) {
    const ponto = n.lastIndexOf('.');
    const ext = ponto > 0 && n.length - ponto <= 10 ? n.slice(ponto) : '';
    n = n.slice(0, TAMANHO_MAXIMO_NOME - ext.length) + ext;
  }
  return n === '' ? 'arquivo' : n;
}

export function caminhoValido(caminho: string): boolean {
  return (
    caminho.startsWith(PREFIXO_CAMINHO) &&
    !caminho.includes('..') &&
    !caminho.includes('\\') &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(caminho)
  );
}

export class Armazenamento {
  private bucketPronto: Promise<void> | null = null;

  constructor(
    private readonly url: string | null,
    private readonly chave: string | null,
    private readonly http: Fetch = (...a) => fetch(...a),
  ) {}

  private base(): { url: string; cab: Record<string, string> } {
    if (!this.url || !this.chave) {
      throw new AppError('INTERNAL_ERROR', undefined, 'Storage nao configurado');
    }
    return {
      url: `${this.url.replace(/\/+$/, '')}/storage/v1`,
      cab: { Authorization: `Bearer ${this.chave}`, apikey: this.chave },
    };
  }

  private falha(acao: string, status: number): AppError {
    return new AppError('INTERNAL_ERROR', undefined, `Storage: ${acao} falhou (HTTP ${status})`);
  }

  private async chamar(url: string, init: RequestInit, acao: string): Promise<Response> {
    try {
      return await this.http(url, init);
    } catch (e) {
      throw new AppError(
        'INTERNAL_ERROR',
        undefined,
        `Storage: ${acao} falhou (${e instanceof Error ? e.message : String(e)})`,
      );
    }
  }

  /** Cria o bucket privado se não existir; a verificação fica em cache na memória. */
  private garantirBucket(): Promise<void> {
    this.bucketPronto ??= this.criarBucket().catch((e: unknown) => {
      this.bucketPronto = null; // tenta de novo na próxima chamada
      throw e;
    });
    return this.bucketPronto;
  }

  private async criarBucket(): Promise<void> {
    const { url, cab } = this.base();
    const existe = await this.chamar(
      `${url}/bucket/${BUCKET_ANEXOS}`,
      { method: 'GET', headers: cab },
      'consulta do bucket',
    );
    if (existe.ok) return;
    const r = await this.chamar(
      `${url}/bucket`,
      {
        method: 'POST',
        headers: { ...cab, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: BUCKET_ANEXOS, name: BUCKET_ANEXOS, public: false }),
      },
      'criacao do bucket',
    );
    // 409 (ou 400 "already exists" do Storage): outra chamada criou antes; é sucesso.
    if (r.ok || r.status === 409) return;
    if (r.status === 400 && /exist/i.test(await r.text().catch(() => ''))) return;
    throw this.falha('criacao do bucket', r.status);
  }

  async salvar(p: {
    idOrcamento: number;
    nomeArquivo: string;
    tipoConteudo: string;
    conteudoBase64: string;
  }): Promise<string> {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(p.conteudoBase64)) {
      throw new AppError('PAYLOAD_INVALIDO', undefined, 'conteudo_base64 invalido');
    }
    const bytes = Buffer.from(p.conteudoBase64, 'base64');
    if (bytes.length === 0) throw new AppError('PAYLOAD_INVALIDO', undefined, 'arquivo vazio');
    if (bytes.length > LIMITE_BYTES) {
      throw new AppError('PAYLOAD_INVALIDO', undefined, 'arquivo acima de 10 MB');
    }
    const caminho = `${PREFIXO_CAMINHO}${p.idOrcamento}/${randomUUID()}-${sanearNome(p.nomeArquivo)}`;
    await this.garantirBucket();
    const { url, cab } = this.base();
    const r = await this.chamar(
      `${url}/object/${BUCKET_ANEXOS}/${caminho.split('/').map(encodeURIComponent).join('/')}`,
      {
        method: 'POST',
        headers: { ...cab, 'Content-Type': p.tipoConteudo, 'x-upsert': 'false' },
        body: bytes,
      },
      'upload',
    );
    if (!r.ok) throw this.falha('upload', r.status);
    return caminho;
  }

  async remover(caminho: string): Promise<void> {
    await this.garantirBucket();
    const { url, cab } = this.base();
    const r = await this.chamar(
      `${url}/object/${BUCKET_ANEXOS}`,
      {
        method: 'DELETE',
        headers: { ...cab, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [caminho] }),
      },
      'remocao',
    );
    if (!r.ok) throw this.falha('remocao', r.status);
  }

  async assinar(
    caminho: string,
    expiraEmSegundos: number,
  ): Promise<{ url: string; expira_em: string }> {
    await this.garantirBucket();
    const { url, cab } = this.base();
    const r = await this.chamar(
      `${url}/object/sign/${BUCKET_ANEXOS}/${caminho.split('/').map(encodeURIComponent).join('/')}`,
      {
        method: 'POST',
        headers: { ...cab, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: expiraEmSegundos }),
      },
      'assinatura',
    );
    if (r.status === 404 || r.status === 400) {
      // O Storage responde 400/404 quando o objeto não existe.
      throw new AppError('NOT_FOUND', undefined, 'Storage: objeto inexistente');
    }
    if (!r.ok) throw this.falha('assinatura', r.status);
    const corpo = (await r.json().catch(() => null)) as { signedURL?: string } | null;
    if (!corpo?.signedURL) throw this.falha('assinatura', 502);
    const rel = corpo.signedURL.startsWith('/') ? corpo.signedURL : `/${corpo.signedURL}`;
    const assinada = /^https?:/.test(corpo.signedURL)
      ? corpo.signedURL
      : `${url}${rel.startsWith('/object') ? rel : `/object${rel}`}`;
    return {
      url: assinada,
      expira_em: new Date(Date.now() + expiraEmSegundos * 1000).toISOString(),
    };
  }
}
