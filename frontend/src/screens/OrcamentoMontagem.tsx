import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  orcamentosApi,
  produtosApi,
  type BuscaProdutoParams,
  type CondicaoPagamento,
  type OrcamentoDetalhe,
  type OrigemTransportadora,
  type TipoAnexo,
  type VariacaoProduto,
} from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { avisoDeEdicaoDeRascunho } from '@/lib/avisoDeRascunho';
import { formatarBRL, reaisParaCentavos } from '@/lib/dinheiro';
import {
  ehFreteFob,
  PARCELAS_DISPONIVEIS,
  PRAZOS_BOLETO_DIAS,
  ROTULO_CONDICAO_PAGAMENTO,
} from '@/lib/opcoes';
import { Bloqueios, GradeItens, ResumoTotais } from '@/components/orcamento';
import {
  Alerta,
  Badge,
  BotaoAtencao,
  BotaoConfirmacao,
  BotaoPrimario,
  BotaoSecundario,
  Campo,
  CampoTexto,
  Cartao,
  Dado,
  EstadoVazio,
  mensagemDeErro,
  Modal,
  Pagina,
  Secao,
  Selecao,
  SkeletonTabela,
} from '@/components/ui';

/** Mensagens claras para as falhas do envio de anexo (limite de 10 MB; proxy ou armazenamento fora do ar). */
function mensagemDoUpload(erro: unknown): string {
  if (erro instanceof ApiError) {
    if (erro.status === 413) return 'O arquivo é maior que 10 MB. Envie um arquivo menor.';
    if (erro.status === 503)
      return 'O serviço de arquivos está indisponível no momento. Aguarde alguns instantes e tente novamente.';
    if (erro.status >= 500)
      return 'Não foi possível salvar o anexo por um erro interno. Tente novamente.';
  }
  return mensagemDeErro(erro);
}

function descricaoPrecos(v: VariacaoProduto): string {
  const faixas = [...v.faixasPreco].sort((a, b) => a.quantidadeMinima - b.quantidadeMinima);
  const partes = faixas.map((f, i) => {
    const proxima = faixas[i + 1];
    const intervalo = proxima
      ? `${f.quantidadeMinima}–${proxima.quantidadeMinima - 1} un`
      : `${f.quantidadeMinima}+ un`;
    return `${intervalo} = ${formatarBRL(f.precoUnitario)}`;
  });
  v.fardos.forEach((f) =>
    partes.push(`Fardo (${f.quantidadeUnidades} un) = ${formatarBRL(f.precoFixo)}`),
  );
  return partes.join(' · ') || 'Sem preço na tabela do cliente';
}

function LinhaVariacao({
  variacao,
  ocupado,
  aoAdicionar,
}: {
  variacao: VariacaoProduto;
  ocupado: boolean;
  aoAdicionar: (v: VariacaoProduto, granularidade: 'FARDO' | 'AVULSO', quantidade: number) => void;
}) {
  const [quantidade, setQuantidade] = useState('1');
  const n = Number(quantidade);
  const valida = Number.isInteger(n) && n > 0;
  const semEstoque = variacao.saldoDisponivel <= 0;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 py-2 text-sm">
      <div className="min-w-48 flex-1">
        <div className="font-semibold">
          {variacao.marca} · {variacao.tamanhoEmbalagem}
        </div>
        <div className="text-xs text-gray-500">{descricaoPrecos(variacao)}</div>
      </div>
      <div className={semEstoque ? 'font-semibold text-orange-800' : 'text-gray-600'}>
        {semEstoque ? '⚠ Sem estoque' : `Disponível: ${variacao.saldoDisponivel}`}
      </div>
      <input
        type="number"
        min={1}
        aria-label="Quantidade a adicionar"
        value={quantidade}
        onChange={(e) => setQuantidade(e.target.value)}
        className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right"
      />
      <BotaoSecundario
        disabled={ocupado || semEstoque || !valida || variacao.faixasPreco.length === 0}
        onClick={() => aoAdicionar(variacao, 'AVULSO', n)}
      >
        Avulso
      </BotaoSecundario>
      <BotaoSecundario
        disabled={ocupado || semEstoque || !valida || variacao.fardos.length === 0}
        onClick={() => aoAdicionar(variacao, 'FARDO', n)}
      >
        Fardo
      </BotaoSecundario>
    </div>
  );
}

/** Tela 6 — UC01/UC14–UC19 – Orçamento: montagem (rascunho). Todos os valores vêm do backend. */
export default function OrcamentoMontagem({ orcamento }: { orcamento: OrcamentoDetalhe }) {
  const id = orcamento.idOrcamento;
  const navegar = useNavigate();
  const queryClient = useQueryClient();
  // Aviso de troca automática da condição de pagamento: vem só na resposta da mutação, então fica
  // guardado até a próxima resposta (que o substitui).
  const [avisosDeTroca, setAvisosDeTroca] = useState<string[]>([]);
  const aplicar = (novo: OrcamentoDetalhe) => {
    setAvisosDeTroca(novo.condicoes.avisos.map((a) => a.mensagem));
    // O backend grava e troca a condição sozinho (padrão e reversão): os campos acompanham o gravado.
    setPagamento(novo.condicoes.condicaoPagamento ?? novo.condicoes.condicaoPagamentoSugerida);
    if (novo.condicoes.prazoDias !== null) setPrazoDias(String(novo.condicoes.prazoDias));
    if (novo.condicoes.numeroParcelas !== null) {
      setParcelas(String(novo.condicoes.numeroParcelas));
    }
    queryClient.setQueryData(['orcamentos', id], novo);
  };
  const aoFalhar = () => void queryClient.invalidateQueries({ queryKey: ['orcamentos', id] });

  // Cabeçalho
  const [contato, setContato] = useState(orcamento.contato ?? '');
  const [solicitacao, setSolicitacao] = useState(orcamento.numeroSolicitacaoCompra ?? '');
  // Rascunho sem endereço gravado e cliente com um só endereço de entrega: já vem selecionado.
  const entregasDoCliente = orcamento.enderecosEntrega.filter((e) => e.tipo === 'ENTREGA');
  const enderecoUnico =
    entregasDoCliente.length === 1 ? entregasDoCliente[0]?.idEndereco : undefined;
  const [endereco, setEndereco] = useState(
    String(orcamento.idEnderecoEntrega ?? enderecoUnico ?? ''),
  );
  const [prazoEntrega, setPrazoEntrega] = useState(String(orcamento.prazoEntregaDias ?? ''));
  const salvarCabecalho = useMutation({
    mutationFn: () =>
      orcamentosApi.atualizarCabecalho(id, {
        contato: contato.trim() || null,
        numeroSolicitacaoCompra: solicitacao.trim() || null,
        idEnderecoEntrega: endereco ? Number(endereco) : null,
        prazoEntregaDias: prazoEntrega ? Number(prazoEntrega) : null,
      }),
    onSuccess: aplicar,
  });

  // Busca de produtos
  const [filtros, setFiltros] = useState({ q: '', marca: '', tamanhoEmbalagem: '', categoria: '' });
  const [busca, setBusca] = useState<BuscaProdutoParams | null>(null);
  const resultados = useQuery({
    queryKey: ['produtos', 'busca', busca],
    queryFn: () => produtosApi.buscar(busca as BuscaProdutoParams),
    enabled: busca !== null,
  });
  const pesquisar = (e: FormEvent) => {
    e.preventDefault();
    setBusca({ ...filtros, idCliente: orcamento.idCliente });
  };

  // Itens
  const adicionar = useMutation({
    mutationFn: (v: {
      variacao: VariacaoProduto;
      granularidade: 'FARDO' | 'AVULSO';
      quantidade: number;
    }) =>
      orcamentosApi.adicionarItem(id, {
        idVariacao: v.variacao.idVariacao,
        granularidade: v.granularidade,
        idFardo: v.granularidade === 'FARDO' ? v.variacao.fardos[0]?.idFardo : undefined,
        quantidade: v.quantidade,
      }),
    onSuccess: aplicar,
  });
  const alterar = useMutation({
    mutationFn: (v: { idItem: number; quantidade: number }) =>
      orcamentosApi.alterarQuantidade(id, v.idItem, v.quantidade),
    onSuccess: aplicar,
    onError: aoFalhar,
  });
  const remover = useMutation({
    mutationFn: (idItem: number) => orcamentosApi.removerItem(id, idItem),
    onSuccess: aplicar,
  });
  const falhaConsultaEstoque =
    adicionar.error instanceof ApiError &&
    (adicionar.error.semConexao || adicionar.error.codigo === 'ESTOQUE_TIMEOUT');

  // Condições comerciais
  const c = orcamento.condicoes;
  // Sem condição gravada (rascunho anterior à gravação automática), já vem a sugerida pelo backend.
  const [pagamento, setPagamento] = useState<CondicaoPagamento | ''>(
    c.condicaoPagamento ?? c.condicaoPagamentoSugerida,
  );
  const [prazoDias, setPrazoDias] = useState(String(c.prazoDias ?? PRAZOS_BOLETO_DIAS[0]));
  const [parcelas, setParcelas] = useState(String(c.numeroParcelas ?? PARCELAS_DISPONIVEIS[0]));
  const [origem, setOrigem] = useState<OrigemTransportadora>(c.origemTransportadora ?? 'SUPRIMAX');
  const [transportadora, setTransportadora] = useState(c.transportadora ?? '');
  const [valorFrete, setValorFrete] = useState(
    c.valorFrete === null ? '' : (c.valorFrete / 100).toFixed(2).replace('.', ','),
  );
  const freteInvalido = valorFrete.trim() !== '' && reaisParaCentavos(valorFrete) === null;
  // Frete FOB abaixo de R$ 1.500,00 (150000 centavos = CIF, inclusivo), mesmo antes do primeiro
  // salvamento, quando a modalidade ainda não foi gravada: sem isso o operador não escolheria a
  // transportadora e a origem nunca seria enviada.
  const ehFob = ehFreteFob(c.modalidadeFrete, c.valorTotalItens);
  const gravarCondicoes = () =>
    orcamentosApi.atualizarCondicoes(id, {
      condicaoPagamento: pagamento || undefined,
      prazoDias: pagamento === 'BOLETO' ? Number(prazoDias) : undefined,
      numeroParcelas: pagamento === 'PARCELADO' ? Number(parcelas) : undefined,
      origemTransportadora: ehFob ? origem : undefined,
      transportadora: ehFob && transportadora.trim() ? transportadora.trim() : undefined,
      valorFrete:
        ehFob && origem === 'SUPRIMAX' ? (reaisParaCentavos(valorFrete) ?? undefined) : undefined,
    });
  const salvarCondicoes = useMutation({ mutationFn: gravarCondicoes, onSuccess: aplicar });
  // Condição ainda não gravada (só a sugerida está selecionada na tela): o único bloqueio é o de
  // condições incompletas, que a gravação da seleção resolve. Com condição gravada, nada muda.
  const gravarAntesDeEmitir =
    c.condicaoPagamento === null &&
    pagamento !== '' &&
    c.bloqueios.some((b) => b.codigo === 'CONDICOES_INCOMPLETAS');

  // Anexos
  const anexar = useMutation({
    mutationFn: (v: { tipo: TipoAnexo; arquivo: File }) =>
      orcamentosApi.anexar(id, v.tipo, v.arquivo),
    onSuccess: aplicar,
  });
  const abrirAnexo = useMutation({
    mutationFn: (idAnexo: number) => orcamentosApi.urlDoAnexo(id, idAnexo),
    onSuccess: ({ url }) => {
      window.open(url, '_blank', 'noopener');
    },
  });
  const removerAnexo = useMutation({
    mutationFn: (idAnexo: number) => orcamentosApi.removerAnexo(id, idAnexo),
    onSuccess: aplicar,
  });

  // Emissão e cancelamento
  const emitir = useMutation({
    mutationFn: async () => {
      if (gravarAntesDeEmitir) {
        const salvo = await gravarCondicoes();
        // Se a gravação trouxe outros bloqueios (ex.: frete provisório), mostra-os e não emite.
        if (salvo.condicoes.bloqueios.length > 0 || salvo.status !== 'RASCUNHO') return salvo;
      }
      return orcamentosApi.emitir(id);
    },
    onSuccess: (emitido) => {
      aplicar(emitido);
      void queryClient.invalidateQueries({ queryKey: ['orcamentos'] });
      void queryClient.invalidateQueries({ queryKey: ['pedidos'] });
    },
    onError: aoFalhar, // 422 (ex.: estoque insuficiente na emissão): a tela recarrega com os bloqueios atuais
  });
  const [cancelando, setCancelando] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const cancelar = useMutation({
    mutationFn: () => orcamentosApi.cancelar(id, justificativa.trim() || undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orcamentos'] });
      navegar('/orcamentos');
    },
  });

  const ocupado = adicionar.isPending || alterar.isPending || remover.isPending;
  const { sessao } = useAuth();
  const aviso = avisoDeEdicaoDeRascunho(orcamento, sessao?.idOperador);
  const pendenteCredito = orcamento.status === 'PENDENTE_CREDITO';
  const emissaoBloqueada =
    c.bloqueios.some((b) => !(gravarAntesDeEmitir && b.codigo === 'CONDICOES_INCOMPLETAS')) ||
    orcamento.itens.length === 0 ||
    pendenteCredito;

  return (
    <Pagina
      titulo="Orçamento: Montagem"
      acoes={
        <>
          <Badge status={orcamento.status} />
          <BotaoAtencao onClick={() => setCancelando(true)}>Cancelar orçamento</BotaoAtencao>
        </>
      }
    >
      {aviso && <Alerta className="mb-4">{aviso}</Alerta>}
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Cartao>
            <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Dado rotulo="Cliente">{orcamento.cliente}</Dado>
              <Dado rotulo="Pedido de origem">{orcamento.numeroPedido ?? '—'}</Dado>
              <Dado rotulo="Nº do orçamento">
                <span className="font-normal italic text-gray-500">Nº atribuído na emissão</span>
              </Dado>
              <Dado rotulo="Validade">
                <span className="text-orange-800">⏱ Expira em 30 dias sem edição</span>
              </Dado>
            </div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Campo
                rotulo="Nº da solicitação de compra"
                opcional
                value={solicitacao}
                onChange={(e) => setSolicitacao(e.target.value)}
              />
              <Campo
                rotulo="Contato"
                opcional
                value={contato}
                onChange={(e) => setContato(e.target.value)}
              />
              {orcamento.enderecosEntrega.length === 0 ? (
                <Dado rotulo="Endereço de entrega">
                  <span className="text-sm">
                    Este cliente não tem endereço de entrega cadastrado.{' '}
                    <Link
                      className="font-semibold text-petroleo underline"
                      to={`/clientes?cnpj=${orcamento.cnpj.replace(/\D/g, '')}`}
                    >
                      Abrir a ficha para adicionar
                    </Link>
                  </span>
                </Dado>
              ) : (
                <Selecao
                  rotulo="Endereço de entrega"
                  value={endereco}
                  onChange={(e) => setEndereco(e.target.value)}
                >
                  <option value="">Selecione…</option>
                  {orcamento.enderecosEntrega.map((e) => (
                    <option key={e.idEndereco} value={e.idEndereco}>
                      {e.logradouro}, {e.numero} — {e.cidade}/{e.uf}
                    </option>
                  ))}
                </Selecao>
              )}
              <Campo
                rotulo="Prazo de entrega (dias)"
                type="number"
                min={0}
                value={prazoEntrega}
                onChange={(e) => setPrazoEntrega(e.target.value)}
              />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <BotaoSecundario
                disabled={salvarCabecalho.isPending}
                onClick={() => salvarCabecalho.mutate()}
              >
                Salvar dados
              </BotaoSecundario>
              {salvarCabecalho.isError && (
                <span className="text-sm text-orange-800">
                  ⚠ {mensagemDeErro(salvarCabecalho.error)}
                </span>
              )}
            </div>
          </Cartao>

          <Secao titulo="Buscar produtos">
            <Cartao>
              <form
                onSubmit={pesquisar}
                className="grid grid-cols-2 items-end gap-3 xl:grid-cols-5"
              >
                <div className="col-span-2">
                  <Campo
                    rotulo="Descrição, código interno ou EAN"
                    value={filtros.q}
                    onChange={(e) => setFiltros({ ...filtros, q: e.target.value })}
                  />
                </div>
                <Campo
                  rotulo="Marca"
                  opcional
                  value={filtros.marca}
                  onChange={(e) => setFiltros({ ...filtros, marca: e.target.value })}
                />
                <Campo
                  rotulo="Peso/variação"
                  opcional
                  value={filtros.tamanhoEmbalagem}
                  onChange={(e) => setFiltros({ ...filtros, tamanhoEmbalagem: e.target.value })}
                />
                <Campo
                  rotulo="Categoria"
                  opcional
                  value={filtros.categoria}
                  onChange={(e) => setFiltros({ ...filtros, categoria: e.target.value })}
                />
                <BotaoPrimario type="submit">Buscar</BotaoPrimario>
              </form>

              {adicionar.isError && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Alerta>
                    {adicionar.error instanceof ApiError &&
                    adicionar.error.codigo === 'ESTOQUE_INDISPONIVEL'
                      ? `Inclusão bloqueada: ${adicionar.error.message}`
                      : mensagemDeErro(adicionar.error)}
                  </Alerta>
                  {falhaConsultaEstoque && (
                    <BotaoSecundario
                      onClick={() => adicionar.variables && adicionar.mutate(adicionar.variables)}
                    >
                      Tentar novamente
                    </BotaoSecundario>
                  )}
                </div>
              )}

              <div className="mt-3">
                {busca === null ? null : resultados.isPending ? (
                  <SkeletonTabela linhas={3} />
                ) : resultados.isError ? (
                  <Alerta>{mensagemDeErro(resultados.error)}</Alerta>
                ) : resultados.data.length === 0 ? (
                  <EstadoVazio
                    icone="🔎"
                    titulo="Nenhum produto encontrado"
                    descricao="Itens sem preço na tabela do cliente não são exibidos."
                  />
                ) : (
                  resultados.data.map((p) => (
                    <div key={p.idProduto} className="mb-3">
                      <div className="text-sm font-semibold text-petroleo">
                        {p.descricao}{' '}
                        <span className="font-normal text-gray-500">
                          · {p.codigoInterno}
                          {p.ncm ? ` · NCM ${p.ncm}` : ''}
                        </span>
                      </div>
                      {p.variacoes.map((v) => (
                        <LinhaVariacao
                          key={v.idVariacao}
                          variacao={v}
                          ocupado={ocupado}
                          aoAdicionar={(variacao, granularidade, quantidade) =>
                            adicionar.mutate({ variacao, granularidade, quantidade })
                          }
                        />
                      ))}
                    </div>
                  ))
                )}
              </div>
            </Cartao>
          </Secao>

          <Secao titulo="Itens do orçamento">
            <Cartao className="p-0">
              {orcamento.itens.length === 0 ? (
                <EstadoVazio
                  icone="🧾"
                  titulo="Nenhum item adicionado"
                  descricao="Busque um produto acima e adicione a variação desejada."
                />
              ) : (
                <GradeItens
                  itens={orcamento.itens}
                  editavel
                  ocupado={ocupado}
                  aoAlterarQuantidade={(item, quantidade) =>
                    alterar.mutate({ idItem: item.idItem, quantidade })
                  }
                  aoRemover={(item) => remover.mutate(item.idItem)}
                />
              )}
            </Cartao>
            {(alterar.isError || remover.isError) && (
              <Alerta className="mt-2">{mensagemDeErro(alterar.error ?? remover.error)}</Alerta>
            )}
          </Secao>
        </div>

        <aside className="sticky top-4 flex flex-col gap-3">
          <Cartao className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold text-petroleo">Condições comerciais</h2>
            <ResumoTotais condicoes={c} />

            <Selecao
              rotulo="Condição de pagamento"
              value={pagamento}
              onChange={(e) => setPagamento(e.target.value as CondicaoPagamento)}
            >
              <option value="">Selecione…</option>
              {c.condicoesPagamentoPermitidas.map((cp) => (
                <option key={cp} value={cp}>
                  {ROTULO_CONDICAO_PAGAMENTO[cp]}
                </option>
              ))}
            </Selecao>
            {avisosDeTroca.map((mensagem) => (
              <Alerta key={mensagem}>{mensagem}</Alerta>
            ))}
            {pagamento === 'BOLETO' && (
              <Selecao
                rotulo="Prazo do boleto"
                value={prazoDias}
                onChange={(e) => setPrazoDias(e.target.value)}
              >
                {PRAZOS_BOLETO_DIAS.map((d) => (
                  <option key={d} value={d}>
                    {d} dias
                  </option>
                ))}
              </Selecao>
            )}
            {pagamento === 'PARCELADO' && (
              <Selecao
                rotulo="Parcelas"
                value={parcelas}
                onChange={(e) => setParcelas(e.target.value)}
              >
                {PARCELAS_DISPONIVEIS.map((n) => (
                  <option key={n} value={n}>
                    {n}x
                  </option>
                ))}
              </Selecao>
            )}

            {ehFob && (
              <>
                <Selecao
                  rotulo="Transportadora"
                  value={origem}
                  onChange={(e) => setOrigem(e.target.value as OrigemTransportadora)}
                >
                  <option value="SUPRIMAX">Cotada pela SupriMax</option>
                  <option value="CLIENTE">Indicada pelo cliente</option>
                </Selecao>
                <Campo
                  rotulo="Nome da transportadora"
                  value={transportadora}
                  onChange={(e) => setTransportadora(e.target.value)}
                />
                {origem === 'SUPRIMAX' && (
                  <Campo
                    rotulo="Valor do frete cotado (R$)"
                    opcional
                    inputMode="decimal"
                    value={valorFrete}
                    onChange={(e) => setValorFrete(e.target.value)}
                    erro={freteInvalido ? 'Valor inválido. Use o formato 0,00.' : null}
                  />
                )}
              </>
            )}
            <BotaoSecundario
              disabled={salvarCondicoes.isPending || freteInvalido}
              onClick={() => salvarCondicoes.mutate()}
            >
              Aplicar condições
            </BotaoSecundario>
            {salvarCondicoes.isError && <Alerta>{mensagemDeErro(salvarCondicoes.error)}</Alerta>}

            <Dado rotulo="Crédito">
              {
                {
                  NAO_EXIGIDO: 'Não exigido',
                  PENDENTE: '⚠ Análise pendente',
                  APROVADO: '✓ Aprovado',
                  REPROVADO: '⚠ Reprovado',
                }[c.creditoStatus]
              }
            </Dado>

            <div>
              <div className="mb-1 text-xs font-semibold text-gray-500">Anexos</div>
              {orcamento.anexos.map((a) => (
                <div key={a.idAnexo} className="flex items-center justify-between text-sm">
                  <span>
                    {a.nomeArquivo}{' '}
                    <span className="text-xs text-gray-500">
                      ({a.tipoAnexo === 'DESCRITIVO_TECNICO' ? 'descritivo' : 'apoio'})
                    </span>
                  </span>
                  <button
                    type="button"
                    className="mr-3 text-xs underline"
                    disabled={abrirAnexo.isPending}
                    onClick={() => abrirAnexo.mutate(a.idAnexo)}
                  >
                    Abrir
                  </button>
                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={() => removerAnexo.mutate(a.idAnexo)}
                  >
                    remover
                  </button>
                </div>
              ))}
              {(['DESCRITIVO_TECNICO', 'MATERIAL_APOIO'] as const).map((tipo) => (
                <label key={tipo} className="mt-1 block text-xs text-gray-600">
                  {tipo === 'DESCRITIVO_TECNICO' ? 'Descritivo técnico' : 'Material de apoio'}
                  <input
                    type="file"
                    className="mt-0.5 block w-full text-xs"
                    onChange={(e) => {
                      const arquivo = e.target.files?.[0];
                      if (arquivo) anexar.mutate({ tipo, arquivo });
                      e.target.value = '';
                    }}
                  />
                </label>
              ))}
              {anexar.isError && <Alerta className="mt-2">{mensagemDoUpload(anexar.error)}</Alerta>}
              {abrirAnexo.isError && (
                <Alerta className="mt-2">{mensagemDeErro(abrirAnexo.error)}</Alerta>
              )}
            </div>

            <Bloqueios bloqueios={c.bloqueios} />
            {pendenteCredito && !c.bloqueios.some((b) => b.codigo === 'PENDENTE_CREDITO') && (
              <Alerta>Emissão bloqueada: aguardando a análise de crédito.</Alerta>
            )}
            {emitir.isError && <Alerta>{mensagemDeErro(emitir.error)}</Alerta>}
            <BotaoConfirmacao
              disabled={emissaoBloqueada || emitir.isPending}
              onClick={() => emitir.mutate()}
            >
              Emitir orçamento
            </BotaoConfirmacao>
          </Cartao>
        </aside>
      </div>

      {cancelando && (
        <Modal
          titulo="Cancelar orçamento"
          aoFechar={() => setCancelando(false)}
          acoes={
            <>
              <BotaoSecundario onClick={() => setCancelando(false)}>Voltar</BotaoSecundario>
              <BotaoPrimario disabled={cancelar.isPending} onClick={() => cancelar.mutate()}>
                Confirmar cancelamento
              </BotaoPrimario>
            </>
          }
        >
          <CampoTexto
            rotulo="Justificativa"
            opcional
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
          />
          {cancelar.isError && <Alerta>{mensagemDeErro(cancelar.error)}</Alerta>}
        </Modal>
      )}
    </Pagina>
  );
}
