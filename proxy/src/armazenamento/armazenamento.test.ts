import {
  Armazenamento,
  BUCKET_ANEXOS,
  BUCKET_DOCUMENTOS_CREDITO,
  caminhoValido,
  sanearNome,
} from './armazenamento';

interface Chamada {
  url: string;
  method: string;
  body?: unknown;
}

function criar(opts: { bucketExiste?: boolean; criarStatus?: number } = {}) {
  const chamadas: Chamada[] = [];
  const http = jest.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    chamadas.push({ url, method, body: init.body });
    if (method === 'GET') return new Response('{}', { status: opts.bucketExiste ? 200 : 404 });
    if (url.endsWith('/storage/v1/bucket'))
      return new Response('{}', { status: opts.criarStatus ?? 200 });
    if (url.includes('/object/sign/'))
      return new Response(JSON.stringify({ signedURL: '/object/sign/x/y?token=abc' }), {
        status: 200,
      });
    return new Response('{}', { status: 200 });
  });
  const a = new Armazenamento('https://x.supabase.co/', 'chave', http as unknown as typeof fetch);
  return { a, chamadas, http };
}

const b64 = (n: number) => Buffer.alloc(n, 1).toString('base64');
const salvar = (a: Armazenamento, nome = 'nota.pdf', conteudo = b64(10)) =>
  a.salvar({
    idOrcamento: 7,
    nomeArquivo: nome,
    tipoConteudo: 'application/pdf',
    conteudoBase64: conteudo,
  });
const criacoes = (c: Chamada[]) =>
  c.filter((x) => x.method === 'POST' && x.url.endsWith('/storage/v1/bucket'));

describe('sanearNome / caminhoValido', () => {
  it('remove separadores, .. e controle', () => {
    expect(sanearNome('../../etc/passwd')).toBe('_._etc_passwd');
    expect(sanearNome('a\\b\u0000c.pdf')).toBe('a_bc.pdf');
    expect(sanearNome('...')).toBe('arquivo');
    expect(sanearNome('')).toBe('arquivo');
  });
  it('limita o tamanho preservando a extensão', () => {
    const n = sanearNome('x'.repeat(300) + '.pdf');
    expect(n.length).toBe(100);
    expect(n.endsWith('.pdf')).toBe(true);
  });
  it('só aceita caminhos de orcamento/ sem ..', () => {
    expect(caminhoValido('orcamento/1/a.pdf')).toBe(true);
    expect(caminhoValido('orcamento/../x')).toBe(false);
    expect(caminhoValido('outro/1/a.pdf')).toBe(false);
  });
  it('aceita também caminhos de analise-credito/ sem ..', () => {
    expect(caminhoValido('analise-credito/1/a.pdf')).toBe(true);
    expect(caminhoValido('analise-credito/../x')).toBe(false);
    expect(caminhoValido('analise-credito' + String.fromCharCode(92) + '1')).toBe(false);
  });
});

describe('Armazenamento', () => {
  it('monta o caminho com id, uuid e nome saneado e cria bucket privado', async () => {
    const { a, chamadas } = criar();
    const caminho = await salvar(a, '../../a/b.pdf');
    expect(caminho).toMatch(/^orcamento\/7\/[0-9a-f-]{36}-_\._a_b\.pdf$/);
    expect(JSON.parse(String(criacoes(chamadas)[0]?.body))).toEqual({
      id: BUCKET_ANEXOS,
      name: BUCKET_ANEXOS,
      public: false,
    });
    expect(chamadas[chamadas.length - 1]?.url).toContain(`/object/${BUCKET_ANEXOS}/orcamento/7/`);
  });

  it('cria o bucket uma única vez', async () => {
    const { a, chamadas } = criar();
    await salvar(a);
    await salvar(a);
    expect(criacoes(chamadas)).toHaveLength(1);
    expect(chamadas.filter((c) => c.method === 'GET')).toHaveLength(1);
  });

  it('não cria o bucket se ele existe; 409 na criação é sucesso', async () => {
    const um = criar({ bucketExiste: true });
    await salvar(um.a);
    expect(criacoes(um.chamadas)).toHaveLength(0);
    const dois = criar({ criarStatus: 409 });
    await expect(salvar(dois.a)).resolves.toContain('orcamento/7/');
  });

  it('rejeita acima de 10 MB e base64 inválido com PAYLOAD_INVALIDO', async () => {
    const { a } = criar();
    await expect(salvar(a, 'a.pdf', b64(10 * 1024 * 1024 + 1))).rejects.toMatchObject({
      codigo: 'PAYLOAD_INVALIDO',
    });
    await expect(salvar(a, 'a.pdf', b64(10 * 1024 * 1024))).resolves.toBeDefined();
    await expect(salvar(a, 'a.pdf', '@@@')).rejects.toMatchObject({ codigo: 'PAYLOAD_INVALIDO' });
  });

  it('falha do Storage vira INTERNAL_ERROR', async () => {
    const falho = criar({ criarStatus: 500 });
    await expect(salvar(falho.a)).rejects.toMatchObject({ codigo: 'INTERNAL_ERROR' });
  });

  it('assina com expiração e devolve url absoluta', async () => {
    const { a, chamadas } = criar({ bucketExiste: true });
    const r = await a.assinar('orcamento/1/a.pdf', 120);
    expect(r.url).toBe('https://x.supabase.co/storage/v1/object/sign/x/y?token=abc');
    expect(new Date(r.expira_em).getTime()).toBeGreaterThan(Date.now());
    const sig = chamadas.find((c) => c.url.includes('/object/sign/'));
    expect(JSON.parse(String(sig?.body))).toEqual({ expiresIn: 120 });
  });

  it('remove por prefixes', async () => {
    const { a, chamadas } = criar({ bucketExiste: true });
    await a.remover('orcamento/1/a.pdf');
    const del = chamadas.find((c) => c.method === 'DELETE');
    expect(JSON.parse(String(del?.body))).toEqual({ prefixes: ['orcamento/1/a.pdf'] });
  });

  describe('documentos de crédito (UC07)', () => {
    const salvarCredito = (a: Armazenamento, nome = 'contrato.pdf') =>
      a.salvar({
        idAnaliseCredito: 4,
        nomeArquivo: nome,
        tipoConteudo: 'application/pdf',
        conteudoBase64: b64(10),
      });

    it('guarda em bucket privado separado, com caminho analise-credito/<id>/', async () => {
      const { a, chamadas } = criar();
      const caminho = await salvarCredito(a, '../x.pdf');
      expect(caminho).toMatch(/^analise-credito\/4\/[0-9a-f-]{36}-_x\.pdf$/);
      expect(JSON.parse(String(criacoes(chamadas)[0]?.body))).toEqual({
        id: BUCKET_DOCUMENTOS_CREDITO,
        name: BUCKET_DOCUMENTOS_CREDITO,
        public: false,
      });
      expect(chamadas[chamadas.length - 1]?.url).toContain(
        `/object/${BUCKET_DOCUMENTOS_CREDITO}/analise-credito/4/`,
      );
    });

    it('cria cada bucket uma vez e separadamente', async () => {
      const { a, chamadas } = criar();
      await salvarCredito(a);
      await salvarCredito(a);
      await salvar(a);
      expect(criacoes(chamadas)).toHaveLength(2);
    });

    it('exige exatamente um dono (orçamento ou análise)', async () => {
      const { a } = criar();
      const base = {
        nomeArquivo: 'a.pdf',
        tipoConteudo: 'application/pdf',
        conteudoBase64: b64(1),
      };
      await expect(a.salvar(base)).rejects.toMatchObject({ codigo: 'PAYLOAD_INVALIDO' });
      await expect(
        a.salvar({ ...base, idOrcamento: 1, idAnaliseCredito: 1 }),
      ).rejects.toMatchObject({ codigo: 'PAYLOAD_INVALIDO' });
    });

    it('escolhe o bucket pelo prefixo ao assinar e remover', async () => {
      const { a, chamadas } = criar({ bucketExiste: true });
      await a.assinar('analise-credito/4/a.pdf', 60);
      await a.remover('analise-credito/4/a.pdf');
      await a.remover('orcamento/1/a.pdf');
      expect(chamadas.find((c) => c.url.includes('/object/sign/'))?.url).toContain(
        `/object/sign/${BUCKET_DOCUMENTOS_CREDITO}/analise-credito/4/a.pdf`,
      );
      const dels = chamadas.filter((c) => c.method === 'DELETE').map((c) => c.url);
      expect(dels[0]).toMatch(new RegExp(`/object/${BUCKET_DOCUMENTOS_CREDITO}$`));
      expect(dels[1]).toMatch(new RegExp(`/object/${BUCKET_ANEXOS}$`));
    });

    it('recusa caminho fora dos prefixos conhecidos', async () => {
      const { a } = criar({ bucketExiste: true });
      await expect(a.remover('outro/1/a')).rejects.toMatchObject({ codigo: 'PAYLOAD_INVALIDO' });
    });
  });
});
