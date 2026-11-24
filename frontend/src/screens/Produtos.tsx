import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { produtosApi, type Produto, type ProdutoSalvar } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { formatarBRL, reaisParaCentavos } from '@/lib/dinheiro';
import { ehOperadorChefe } from '@/lib/perfis';
import { camposRecusados, semCaminho, type CamposRecusados } from '@/lib/errosDeCampo';
import {
  caminhoDaFaixa,
  caminhoDaVariacao,
  caminhoDoFardo,
  caminhoDoProduto,
  descreverCampo,
  resumoDosCampos,
} from '@/lib/errosDoProduto';
import { DataState } from '@/components/DataState';
import { AvisoNaoSalvoModal } from '@/components/AvisoNaoSalvoModal';
import { textoNormalizado, useAvisoNaoSalvo } from '@/lib/useAvisoNaoSalvo';
import {
  Alerta,
  BotaoPrimario,
  BotaoSecundario,
  Campo,
  Cartao,
  EstadoVazio,
  mensagemDeErro,
  Pagina,
  Secao,
  Tabela,
  Td,
  Th,
} from '@/components/ui';

interface FormVariacao {
  idVariacao?: number;
  marca: string;
  tamanhoEmbalagem: string;
  quantidadeEstoque: string;
  faixas: { quantidadeMinima: string; preco: string }[];
  fardos: { quantidadeUnidades: string; preco: string }[];
}

/** Maior inteiro das colunas INTEGER do banco; acima disso o backend recusa a quantidade. */
const MAIOR_INTEIRO_DO_BANCO = 2_147_483_647;

const paraTexto = (centavos: number) => (centavos / 100).toFixed(2).replace('.', ',');

function formularioDe(p: Produto | null) {
  return {
    codigoInterno: p?.codigoInterno ?? '',
    descricao: p?.descricao ?? '',
    ncm: p?.ncm ?? '',
    ean: p?.ean ?? '',
    categoria: p?.categoria ?? '',
    ativo: p?.ativo ?? true,
    variacoes: (p?.variacoes ?? []).map((v): FormVariacao => ({
      idVariacao: v.idVariacao,
      marca: v.marca,
      tamanhoEmbalagem: v.tamanhoEmbalagem,
      quantidadeEstoque: String(v.quantidadeEstoque),
      faixas: v.faixasPreco.map((f) => ({
        quantidadeMinima: String(f.quantidadeMinima),
        preco: paraTexto(f.precoUnitario),
      })),
      fardos: v.fardos.map((f) => ({
        quantidadeUnidades: String(f.quantidadeUnidades),
        preco: paraTexto(f.precoFixo),
      })),
    })),
  };
}

/** Preço digitado comparável em centavos (nunca pelo texto formatado); texto inválido fica como está. */
const precoComparavel = (texto: string): number | string => {
  const t = texto.trim();
  if (t === '') return '';
  return reaisParaCentavos(t) ?? `?${t}`;
};

/** Forma canônica do formulário para detectar alteração: espaços, máscara e número vs texto não contam. */
export function formularioComparavel(f: ReturnType<typeof formularioDe>): string {
  return JSON.stringify({
    c: textoNormalizado(f.codigoInterno),
    d: textoNormalizado(f.descricao),
    n: textoNormalizado(f.ncm),
    e: textoNormalizado(f.ean),
    k: textoNormalizado(f.categoria),
    a: f.ativo,
    v: f.variacoes.map((v) => ({
      i: v.idVariacao ?? null,
      m: textoNormalizado(v.marca),
      t: textoNormalizado(v.tamanhoEmbalagem),
      q: Number(v.quantidadeEstoque) || 0,
      f: v.faixas.map((x) => [Number(x.quantidadeMinima) || 0, precoComparavel(x.preco)]),
      r: v.fardos.map((x) => [Number(x.quantidadeUnidades) || 0, precoComparavel(x.preco)]),
    })),
  });
}

function FormularioProduto({
  produto,
  aoFechar,
}: {
  produto: Produto | null;
  aoFechar: () => void;
}) {
  const { sessao } = useAuth();
  const chefe = sessao ? ehOperadorChefe(sessao.perfil) : false;
  const queryClient = useQueryClient();
  const [f, setF] = useState(() => formularioDe(produto));
  // RNF06: base = produto lido ao abrir (ou formulário vazio). Cancelar e salvar fecham o formulário
  // (aoFechar) e desmontam o aviso; só sair da tela com o formulário aberto e alterado avisa.
  const [base] = useState(() => formularioComparavel(formularioDe(produto)));
  const { bloqueio } = useAvisoNaoSalvo(formularioComparavel(f) !== base);
  const [erroPreco, setErroPreco] = useState<string | null>(null);
  // Campos que o backend recusou (detalhes.campos): ficam marcados até a pessoa editar cada um.
  const [recusa, setRecusa] = useState<CamposRecusados | null>(null);

  const salvar = useMutation({
    mutationFn: (dados: ProdutoSalvar) =>
      produto ? produtosApi.atualizar(produto.idProduto, dados) : produtosApi.criar(dados),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['produtos'] });
      aoFechar();
    },
    onError: (erro) => setRecusa(camposRecusados(erro)),
  });

  /** Dica do campo se o backend o recusou; `null` caso contrário. */
  const erroDe = (caminho: string): string | null =>
    recusa?.caminhos.has(caminho) ? descreverCampo(caminho, recusa.codigo).dica : null;
  const editou = (caminho: string) => setRecusa((a) => semCaminho(a, caminho));

  /** `editado` é o campo alterado: ele deixa de aparecer como inválido. */
  const alterarVariacao = (i: number, parcial: Partial<FormVariacao>, editado?: string) => {
    setF((a) => ({
      ...a,
      variacoes: a.variacoes.map((v, idx) => (idx === i ? { ...v, ...parcial } : v)),
    }));
    if (editado) editou(editado);
  };
  // Remover linha ou variação muda as posições: os caminhos recusados deixariam de valer.
  const removerVariacao = (i: number, parcial: Partial<FormVariacao>) => {
    setRecusa(null);
    alterarVariacao(i, parcial);
  };

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    setRecusa(null);
    let invalido = false;
    const variacoes: ProdutoSalvar['variacoes'] = f.variacoes.map((v) => {
      const faixasPreco = v.faixas.map((x) => {
        const preco = reaisParaCentavos(x.preco);
        if (preco === null || !Number(x.quantidadeMinima)) invalido = true;
        return { quantidadeMinima: Number(x.quantidadeMinima), precoUnitario: preco ?? 0 };
      });
      const fardos = v.fardos.map((x) => {
        const preco = reaisParaCentavos(x.preco);
        if (preco === null || !Number(x.quantidadeUnidades)) invalido = true;
        return { quantidadeUnidades: Number(x.quantidadeUnidades), precoFixo: preco ?? 0 };
      });
      return {
        idVariacao: v.idVariacao,
        marca: v.marca.trim(),
        tamanhoEmbalagem: v.tamanhoEmbalagem.trim(),
        quantidadeEstoque: v.idVariacao ? undefined : Number(v.quantidadeEstoque) || 0,
        // Faixas e fardos só seguem para o backend quando o usuário é OPERADOR_CHEFE (RF02/UC04).
        faixasPreco: chefe ? faixasPreco : undefined,
        fardos: chefe ? fardos : undefined,
      };
    });
    if (invalido) {
      setErroPreco('Confira os preços (formato 0,00) e as quantidades das faixas e dos fardos.');
      return;
    }
    setErroPreco(null);
    salvar.mutate({
      codigoInterno: f.codigoInterno.trim(),
      descricao: f.descricao.trim(),
      ncm: f.ncm.trim() || undefined,
      ean: f.ean.trim() || undefined,
      categoria: f.categoria.trim() || undefined,
      ativo: f.ativo,
      variacoes,
    });
  };

  // Com campos recusados, o alerta diz quais corrigir (e some quando todos foram editados); sem eles,
  // vale a mensagem do backend.
  const resumoDoErro = recusa
    ? recusa.caminhos.size > 0
      ? resumoDosCampos(recusa.caminhos, recusa.codigo)
      : null
    : salvar.isError
      ? mensagemDeErro(salvar.error)
      : null;

  return (
    <form onSubmit={enviar} className="mb-6 flex flex-col gap-4">
      <Cartao className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Campo
          rotulo="Código interno"
          required
          value={f.codigoInterno}
          erro={erroDe(caminhoDoProduto('codigoInterno'))}
          onChange={(e) => {
            setF({ ...f, codigoInterno: e.target.value });
            editou(caminhoDoProduto('codigoInterno'));
          }}
        />
        <div className="md:col-span-2">
          <Campo
            rotulo="Descrição"
            required
            value={f.descricao}
            erro={erroDe(caminhoDoProduto('descricao'))}
            onChange={(e) => {
              setF({ ...f, descricao: e.target.value });
              editou(caminhoDoProduto('descricao'));
            }}
          />
        </div>
        <Campo
          rotulo="NCM"
          opcional
          value={f.ncm}
          erro={erroDe(caminhoDoProduto('ncm'))}
          onChange={(e) => {
            setF({ ...f, ncm: e.target.value });
            editou(caminhoDoProduto('ncm'));
          }}
        />
        <Campo
          rotulo="EAN"
          opcional
          value={f.ean}
          erro={erroDe(caminhoDoProduto('ean'))}
          onChange={(e) => {
            setF({ ...f, ean: e.target.value });
            editou(caminhoDoProduto('ean'));
          }}
        />
        <Campo
          rotulo="Categoria"
          opcional
          value={f.categoria}
          erro={erroDe(caminhoDoProduto('categoria'))}
          onChange={(e) => {
            setF({ ...f, categoria: e.target.value });
            editou(caminhoDoProduto('categoria'));
          }}
        />
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={f.ativo}
            onChange={(e) => setF({ ...f, ativo: e.target.checked })}
          />{' '}
          Ativo
        </label>
      </Cartao>

      <Secao titulo="Variações">
        {!chefe && (
          <Alerta className="mb-3">
            Faixas de preço e fardos só podem ser alterados pelo operador chefe ou administrador.
          </Alerta>
        )}
        <div className="flex flex-col gap-3">
          {f.variacoes.map((v, i) => (
            <Cartao key={v.idVariacao ?? `nova-${i}`} className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Campo
                  rotulo="Marca"
                  required
                  value={v.marca}
                  erro={erroDe(caminhoDaVariacao(i, 'marca'))}
                  onChange={(e) =>
                    alterarVariacao(i, { marca: e.target.value }, caminhoDaVariacao(i, 'marca'))
                  }
                />
                <Campo
                  rotulo="Tamanho/embalagem"
                  required
                  value={v.tamanhoEmbalagem}
                  erro={erroDe(caminhoDaVariacao(i, 'tamanhoEmbalagem'))}
                  onChange={(e) =>
                    alterarVariacao(
                      i,
                      { tamanhoEmbalagem: e.target.value },
                      caminhoDaVariacao(i, 'tamanhoEmbalagem'),
                    )
                  }
                />
                <Campo
                  rotulo="Quantidade em estoque"
                  type="number"
                  min={0}
                  max={MAIOR_INTEIRO_DO_BANCO}
                  disabled={!!v.idVariacao}
                  value={v.quantidadeEstoque}
                  erro={erroDe(caminhoDaVariacao(i, 'quantidadeEstoque'))}
                  onChange={(e) =>
                    alterarVariacao(
                      i,
                      { quantidadeEstoque: e.target.value },
                      caminhoDaVariacao(i, 'quantidadeEstoque'),
                    )
                  }
                />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <fieldset disabled={!chefe} className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-semibold">Faixas de preço (avulso)</legend>
                  {v.faixas.map((x, j) => (
                    <div key={j} className="flex items-end gap-2">
                      <Campo
                        rotulo="Qtd. mínima"
                        type="number"
                        min={1}
                        max={MAIOR_INTEIRO_DO_BANCO}
                        value={x.quantidadeMinima}
                        erro={erroDe(caminhoDaFaixa(i, j, 'quantidadeMinima'))}
                        onChange={(e) =>
                          alterarVariacao(
                            i,
                            {
                              faixas: v.faixas.map((y, k) =>
                                k === j ? { ...y, quantidadeMinima: e.target.value } : y,
                              ),
                            },
                            caminhoDaFaixa(i, j, 'quantidadeMinima'),
                          )
                        }
                      />
                      <Campo
                        rotulo="Preço unitário (R$)"
                        inputMode="decimal"
                        value={x.preco}
                        erro={erroDe(caminhoDaFaixa(i, j, 'precoUnitario'))}
                        onChange={(e) =>
                          alterarVariacao(
                            i,
                            {
                              faixas: v.faixas.map((y, k) =>
                                k === j ? { ...y, preco: e.target.value } : y,
                              ),
                            },
                            caminhoDaFaixa(i, j, 'precoUnitario'),
                          )
                        }
                      />
                      <BotaoSecundario
                        onClick={() =>
                          removerVariacao(i, { faixas: v.faixas.filter((_, k) => k !== j) })
                        }
                      >
                        ✕
                      </BotaoSecundario>
                    </div>
                  ))}
                  <div>
                    <BotaoSecundario
                      onClick={() =>
                        alterarVariacao(i, {
                          faixas: [...v.faixas, { quantidadeMinima: '', preco: '' }],
                        })
                      }
                    >
                      Adicionar faixa
                    </BotaoSecundario>
                  </div>
                </fieldset>
                <fieldset disabled={!chefe} className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-semibold">Fardos</legend>
                  {v.fardos.map((x, j) => (
                    <div key={j} className="flex items-end gap-2">
                      <Campo
                        rotulo="Unidades"
                        type="number"
                        min={1}
                        max={MAIOR_INTEIRO_DO_BANCO}
                        value={x.quantidadeUnidades}
                        erro={erroDe(caminhoDoFardo(i, j, 'quantidadeUnidades'))}
                        onChange={(e) =>
                          alterarVariacao(
                            i,
                            {
                              fardos: v.fardos.map((y, k) =>
                                k === j ? { ...y, quantidadeUnidades: e.target.value } : y,
                              ),
                            },
                            caminhoDoFardo(i, j, 'quantidadeUnidades'),
                          )
                        }
                      />
                      <Campo
                        rotulo="Preço fixo (R$)"
                        inputMode="decimal"
                        value={x.preco}
                        erro={erroDe(caminhoDoFardo(i, j, 'precoFixo'))}
                        onChange={(e) =>
                          alterarVariacao(
                            i,
                            {
                              fardos: v.fardos.map((y, k) =>
                                k === j ? { ...y, preco: e.target.value } : y,
                              ),
                            },
                            caminhoDoFardo(i, j, 'precoFixo'),
                          )
                        }
                      />
                      <BotaoSecundario
                        onClick={() =>
                          removerVariacao(i, { fardos: v.fardos.filter((_, k) => k !== j) })
                        }
                      >
                        ✕
                      </BotaoSecundario>
                    </div>
                  ))}
                  <div>
                    <BotaoSecundario
                      onClick={() =>
                        alterarVariacao(i, {
                          fardos: [...v.fardos, { quantidadeUnidades: '', preco: '' }],
                        })
                      }
                    >
                      Adicionar fardo
                    </BotaoSecundario>
                  </div>
                </fieldset>
              </div>
              {!v.idVariacao && (
                <div>
                  <BotaoSecundario
                    onClick={() => {
                      setRecusa(null);
                      setF({ ...f, variacoes: f.variacoes.filter((_, k) => k !== i) });
                    }}
                  >
                    Remover variação
                  </BotaoSecundario>
                </div>
              )}
            </Cartao>
          ))}
          <div>
            <BotaoSecundario
              onClick={() =>
                setF({
                  ...f,
                  variacoes: [
                    ...f.variacoes,
                    {
                      marca: '',
                      tamanhoEmbalagem: '',
                      quantidadeEstoque: '0',
                      faixas: [],
                      fardos: [],
                    },
                  ],
                })
              }
            >
              Adicionar variação
            </BotaoSecundario>
          </div>
        </div>
      </Secao>

      {erroPreco && <Alerta>{erroPreco}</Alerta>}
      {resumoDoErro && <Alerta>{resumoDoErro}</Alerta>}
      <div className="flex gap-3">
        <BotaoPrimario type="submit" disabled={salvar.isPending || f.variacoes.length === 0}>
          Salvar produto
        </BotaoPrimario>
        <BotaoSecundario onClick={aoFechar}>Cancelar</BotaoSecundario>
      </div>
      <AvisoNaoSalvoModal bloqueio={bloqueio}>
        O cadastro do produto não foi salvo. Se sair agora, as alterações serão perdidas.
      </AvisoNaoSalvoModal>
    </form>
  );
}

/** Tela 13 — UC04 – Produtos: cadastro. O ajuste de estoque (tela 14) parte daqui, só para o operador chefe e o administrador. */
export default function Produtos() {
  const { sessao } = useAuth();
  const chefe = sessao ? ehOperadorChefe(sessao.perfil) : false;
  const [q, setQ] = useState('');
  const [termo, setTermo] = useState('');
  const [editando, setEditando] = useState<Produto | 'novo' | null>(null);
  const consulta = useQuery({
    queryKey: ['produtos', 'lista', termo],
    queryFn: () => produtosApi.listar(termo || undefined),
  });

  return (
    <Pagina
      titulo="Produtos"
      acoes={
        <>
          {chefe && (
            <Link to="/estoque" className="text-sm font-semibold text-petroleo underline">
              Ajuste de estoque
            </Link>
          )}
          <BotaoPrimario onClick={() => setEditando('novo')}>Novo produto</BotaoPrimario>
        </>
      }
    >
      {editando && (
        <FormularioProduto
          key={editando === 'novo' ? 'novo' : editando.idProduto}
          produto={editando === 'novo' ? null : editando}
          aoFechar={() => setEditando(null)}
        />
      )}

      <form
        className="mb-4 flex max-w-xl items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setTermo(q.trim());
        }}
      >
        <div className="flex-1">
          <Campo
            rotulo="Buscar"
            placeholder="Descrição, código interno ou EAN"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <BotaoSecundario type="submit">Buscar</BotaoSecundario>
      </form>

      <Cartao className="overflow-hidden p-0">
        <DataState
          consulta={consulta}
          vazio={(d) =>
            d.length === 0 ? (
              <EstadoVazio
                icone="📦"
                titulo="Nenhum produto encontrado"
                acao={
                  <BotaoPrimario onClick={() => setEditando('novo')}>Novo produto</BotaoPrimario>
                }
              />
            ) : null
          }
        >
          {(itens) => (
            <Tabela>
              <thead>
                <tr>
                  <Th>Código</Th>
                  <Th>Descrição</Th>
                  <Th>Variações</Th>
                  <Th>Ativo</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {itens.map((p) => (
                  <tr key={p.idProduto}>
                    <Td>{p.codigoInterno}</Td>
                    <Td>
                      <div className="font-semibold">{p.descricao}</div>
                      <div className="text-xs text-gray-500">
                        {[p.categoria, p.ncm && `NCM ${p.ncm}`, p.ean && `EAN ${p.ean}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </Td>
                    <Td>
                      {p.variacoes.map((v) => (
                        <div key={v.idVariacao} className="text-xs">
                          {v.marca} · {v.tamanhoEmbalagem} — estoque {v.quantidadeEstoque}
                          {v.faixasPreco[0] &&
                            ` — a partir de ${formatarBRL(Math.min(...v.faixasPreco.map((f) => f.precoUnitario)))}`}
                        </div>
                      ))}
                    </Td>
                    <Td>{p.ativo ? '✓ Sim' : '⊘ Não'}</Td>
                    <Td>
                      <BotaoSecundario onClick={() => setEditando(p)}>Editar</BotaoSecundario>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          )}
        </DataState>
      </Cartao>
    </Pagina>
  );
}
