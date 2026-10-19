import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { produtosApi, type Produto, type ProdutoSalvar } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { formatarBRL, reaisParaCentavos } from '@/lib/dinheiro';
import { ehOperadorChefe } from '@/lib/perfis';
import { DataState } from '@/components/DataState';
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
  const [erroPreco, setErroPreco] = useState<string | null>(null);

  const salvar = useMutation({
    mutationFn: (dados: ProdutoSalvar) =>
      produto ? produtosApi.atualizar(produto.idProduto, dados) : produtosApi.criar(dados),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['produtos'] });
      aoFechar();
    },
  });

  const alterarVariacao = (i: number, parcial: Partial<FormVariacao>) =>
    setF((a) => ({
      ...a,
      variacoes: a.variacoes.map((v, idx) => (idx === i ? { ...v, ...parcial } : v)),
    }));

  const enviar = (e: FormEvent) => {
    e.preventDefault();
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

  return (
    <form onSubmit={enviar} className="mb-6 flex flex-col gap-4">
      <Cartao className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Campo
          rotulo="Código interno"
          required
          value={f.codigoInterno}
          onChange={(e) => setF({ ...f, codigoInterno: e.target.value })}
        />
        <div className="md:col-span-2">
          <Campo
            rotulo="Descrição"
            required
            value={f.descricao}
            onChange={(e) => setF({ ...f, descricao: e.target.value })}
          />
        </div>
        <Campo
          rotulo="NCM"
          opcional
          value={f.ncm}
          onChange={(e) => setF({ ...f, ncm: e.target.value })}
        />
        <Campo
          rotulo="EAN"
          opcional
          value={f.ean}
          onChange={(e) => setF({ ...f, ean: e.target.value })}
        />
        <Campo
          rotulo="Categoria"
          opcional
          value={f.categoria}
          onChange={(e) => setF({ ...f, categoria: e.target.value })}
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
            Faixas de preço e fardos só podem ser alterados pelo operador chefe.
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
                  onChange={(e) => alterarVariacao(i, { marca: e.target.value })}
                />
                <Campo
                  rotulo="Tamanho/embalagem"
                  required
                  value={v.tamanhoEmbalagem}
                  onChange={(e) => alterarVariacao(i, { tamanhoEmbalagem: e.target.value })}
                />
                <Campo
                  rotulo="Quantidade em estoque"
                  type="number"
                  min={0}
                  disabled={!!v.idVariacao}
                  value={v.quantidadeEstoque}
                  onChange={(e) => alterarVariacao(i, { quantidadeEstoque: e.target.value })}
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
                        value={x.quantidadeMinima}
                        onChange={(e) =>
                          alterarVariacao(i, {
                            faixas: v.faixas.map((y, k) =>
                              k === j ? { ...y, quantidadeMinima: e.target.value } : y,
                            ),
                          })
                        }
                      />
                      <Campo
                        rotulo="Preço unitário (R$)"
                        inputMode="decimal"
                        value={x.preco}
                        onChange={(e) =>
                          alterarVariacao(i, {
                            faixas: v.faixas.map((y, k) =>
                              k === j ? { ...y, preco: e.target.value } : y,
                            ),
                          })
                        }
                      />
                      <BotaoSecundario
                        onClick={() =>
                          alterarVariacao(i, { faixas: v.faixas.filter((_, k) => k !== j) })
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
                        value={x.quantidadeUnidades}
                        onChange={(e) =>
                          alterarVariacao(i, {
                            fardos: v.fardos.map((y, k) =>
                              k === j ? { ...y, quantidadeUnidades: e.target.value } : y,
                            ),
                          })
                        }
                      />
                      <Campo
                        rotulo="Preço fixo (R$)"
                        inputMode="decimal"
                        value={x.preco}
                        onChange={(e) =>
                          alterarVariacao(i, {
                            fardos: v.fardos.map((y, k) =>
                              k === j ? { ...y, preco: e.target.value } : y,
                            ),
                          })
                        }
                      />
                      <BotaoSecundario
                        onClick={() =>
                          alterarVariacao(i, { fardos: v.fardos.filter((_, k) => k !== j) })
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
                    onClick={() => setF({ ...f, variacoes: f.variacoes.filter((_, k) => k !== i) })}
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
      {salvar.isError && <Alerta>{mensagemDeErro(salvar.error)}</Alerta>}
      <div className="flex gap-3">
        <BotaoPrimario type="submit" disabled={salvar.isPending || f.variacoes.length === 0}>
          Salvar produto
        </BotaoPrimario>
        <BotaoSecundario onClick={aoFechar}>Cancelar</BotaoSecundario>
      </div>
    </form>
  );
}

/** Tela 13 — UC04 – Produtos: cadastro. O ajuste de estoque (tela 14) parte daqui, só para o operador chefe. */
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
