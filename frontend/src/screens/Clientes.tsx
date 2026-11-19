import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  clientesApi,
  orcamentosApi,
  type ClienteFicha,
  type EnderecoCliente,
  type StatusCliente,
} from '@/api';
import { EnderecoCampos, enderecoCompleto, enderecoVazio } from '@/components/EnderecoCampos';
import { formatarBRL } from '@/lib/dinheiro';
import { formatarCnpj, formatarData, formatarNumeroOrcamento } from '@/lib/datas';
import {
  Alerta,
  Badge,
  BotaoPrimario,
  BotaoSecundario,
  Campo,
  Cartao,
  Dado,
  ErroRequisicao,
  EstadoVazio,
  mensagemDeErro,
  Pagina,
  Secao,
  Selecao,
  Skeleton,
  Tabela,
  Td,
  Th,
} from '@/components/ui';
import { useAuth } from '@/auth/AuthContext';
import { temPerfil } from '@/lib/perfis';
import { DataState } from '@/components/DataState';
import { AvisoNaoSalvoModal } from '@/components/AvisoNaoSalvoModal';
import { textoNormalizado, useAvisoNaoSalvo } from '@/lib/useAvisoNaoSalvo';

/** UC14: cria o rascunho direto da ficha. O backend autoriza; aqui só se oculta e se explica o bloqueio. */
function NovoOrcamento({ cliente }: { cliente: ClienteFicha }) {
  const navegar = useNavigate();
  const { sessao } = useAuth();
  const criar = useMutation({
    mutationFn: () => orcamentosApi.criar({ idCliente: cliente.idCliente }),
    onSuccess: (orcamento) => navegar(`/orcamentos/${orcamento.idOrcamento}`),
  });
  if (!sessao || !temPerfil(sessao.perfil, ['OPERADOR', 'OPERADOR_CHEFE'])) return null;

  const motivo =
    cliente.status === 'INATIVO'
      ? 'Cliente inativo: não é possível criar orçamento.'
      : cliente.status === 'BLOQUEADO'
        ? 'Cliente bloqueado: não é possível criar orçamento.'
        : cliente.dividaEmAberto > 0
          ? 'Dívida em aberto: novo orçamento bloqueado.'
          : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <BotaoPrimario
          onClick={() => criar.mutate()}
          disabled={motivo !== null || criar.isPending}
          aria-describedby={motivo ? 'motivo-novo-orcamento' : undefined}
        >
          {criar.isPending ? 'Criando…' : 'Novo orçamento'}
        </BotaoPrimario>
        {motivo && (
          <span id="motivo-novo-orcamento" className="text-sm text-gray-500">
            {motivo}
          </span>
        )}
      </div>
      {criar.isError && <Alerta>{mensagemDeErro(criar.error)}</Alerta>}
    </div>
  );
}

function Abas({ cliente }: { cliente: ClienteFicha }) {
  const [aba, setAba] = useState<'abertos' | 'historico'>('abertos');
  const abertos = useQuery({
    queryKey: ['clientes', cliente.idCliente, 'abertos'],
    queryFn: () => clientesApi.orcamentosEmAberto(cliente.idCliente),
    enabled: aba === 'abertos',
  });
  const historico = useQuery({
    queryKey: ['clientes', cliente.idCliente, 'historico'],
    queryFn: () => clientesApi.historicoCompras(cliente.idCliente),
    enabled: aba === 'historico',
  });
  return (
    <Cartao className="p-0">
      <div role="tablist" className="flex border-b border-gray-300">
        {(
          [
            ['abertos', 'Orçamentos em aberto'],
            ['historico', 'Histórico de compras'],
          ] as const
        ).map(([id, rotulo]) => (
          <button
            key={id}
            role="tab"
            aria-selected={aba === id}
            onClick={() => setAba(id)}
            className={`px-5 py-3 text-sm font-semibold ${aba === id ? 'border-b-2 border-petroleo text-petroleo' : 'text-gray-500'}`}
          >
            {rotulo}
          </button>
        ))}
      </div>
      {aba === 'abertos' ? (
        <DataState
          consulta={abertos}
          vazio={(d) =>
            d.length === 0 ? <EstadoVazio titulo="Nenhum orçamento em aberto" /> : null
          }
        >
          {(dados) => (
            <Tabela>
              <thead>
                <tr>
                  <Th>Nº</Th>
                  <Th>Vencimento</Th>
                  <Th direita>Valor total</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {dados.map((o) => (
                  <tr key={o.idOrcamento}>
                    <Td>
                      <Link
                        className="font-semibold text-petroleo underline"
                        to={`/orcamentos/${o.idOrcamento}`}
                      >
                        {formatarNumeroOrcamento(o.numeroOrcamento)}
                      </Link>
                    </Td>
                    <Td>{formatarData(o.dataValidade)}</Td>
                    <Td direita>{formatarBRL(o.valorTotalProposta)}</Td>
                    <Td>
                      <Badge status={o.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          )}
        </DataState>
      ) : (
        <DataState
          consulta={historico}
          vazio={(d) =>
            d.length === 0 ? (
              <EstadoVazio
                titulo="Sem compras anteriores"
                descricao="A primeira compra é 100% adiantada."
              />
            ) : null
          }
        >
          {(dados) => (
            <Tabela>
              <thead>
                <tr>
                  <Th>Orçamento</Th>
                  <Th>Emissão</Th>
                  <Th direita>Valor aceito</Th>
                </tr>
              </thead>
              <tbody>
                {dados.map((c) => (
                  <tr key={c.idOrcamento}>
                    <Td>{formatarNumeroOrcamento(c.numeroOrcamento)}</Td>
                    <Td>{formatarData(c.dataEmissao)}</Td>
                    <Td direita>{formatarBRL(c.valorTotalAceito)}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          )}
        </DataState>
      )}
    </Cartao>
  );
}

const ROTULO_STATUS_CLIENTE: Record<StatusCliente | '', string> = {
  '': 'Todos os status',
  ATIVO: 'Ativo',
  INATIVO: 'Inativo',
  BLOQUEADO: 'Bloqueado',
};
const TAMANHO_DA_PAGINA = 20;

/** UC02-A1: lista os endereços da ficha e permite acrescentar um endereço de entrega. */
function Enderecos({ cliente }: { cliente: ClienteFicha }) {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [novo, setNovo] = useState<EnderecoCliente>(enderecoVazio('ENTREGA'));
  const adicionar = useMutation({
    mutationFn: () =>
      clientesApi.adicionarEndereco(cliente.idCliente, {
        ...novo,
        logradouro: novo.logradouro.trim(),
        numero: novo.numero.trim(),
        complemento: novo.complemento?.trim() || null,
        bairro: novo.bairro.trim(),
        cidade: novo.cidade.trim(),
        cep: novo.cep.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clientes'] });
      void queryClient.invalidateQueries({ queryKey: ['orcamentos'] });
      setNovo(enderecoVazio('ENTREGA'));
      setAberto(false);
    },
  });
  // RNF06: formulário de endereço aberto com algum campo preenchido. Cancelar e salvar fecham o
  // formulário (`aberto` falso), o que desfaz o aviso; o texto do endereço vazio não conta.
  const modelo = enderecoVazio('ENTREGA');
  const sujo =
    aberto &&
    (Object.keys(modelo) as (keyof EnderecoCliente)[]).some(
      (k) => k !== 'tipo' && textoNormalizado(novo[k] as string | undefined) !== '',
    );
  const { bloqueio } = useAvisoNaoSalvo(sujo);
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (enderecoCompleto(novo)) adicionar.mutate();
  };

  return (
    <Secao titulo="Endereços">
      <div className="flex flex-col gap-3">
        {cliente.enderecos.length === 0 && (
          <Alerta>
            Nenhum endereço cadastrado. Sem endereço de entrega não há o que escolher ao montar o
            orçamento.
          </Alerta>
        )}
        {cliente.enderecos.length > 0 && (
          <Cartao className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {cliente.enderecos.map((e, i) => (
              <Dado
                key={e.idEndereco ?? i}
                rotulo={`Endereço (${e.tipo === 'CADASTRAL' ? 'Cadastral' : 'Entrega'})`}
              >
                {e.logradouro}, {e.numero}
                {e.complemento ? ` — ${e.complemento}` : ''} · {e.bairro} · {e.cidade}/{e.uf} · CEP{' '}
                {e.cep}
              </Dado>
            ))}
          </Cartao>
        )}
        {aberto ? (
          <form onSubmit={enviar} className="flex flex-col gap-3">
            <EnderecoCampos
              fixarTipo
              endereco={novo}
              aoAlterar={(campo, valor) => setNovo((n) => ({ ...n, [campo]: valor }))}
            />
            {adicionar.isError && <Alerta>{mensagemDeErro(adicionar.error)}</Alerta>}
            <div className="flex gap-3">
              <BotaoPrimario
                type="submit"
                disabled={!enderecoCompleto(novo) || adicionar.isPending}
              >
                {adicionar.isPending ? 'Salvando…' : 'Salvar endereço'}
              </BotaoPrimario>
              <BotaoSecundario onClick={() => setAberto(false)}>Cancelar</BotaoSecundario>
            </div>
          </form>
        ) : (
          <div>
            <BotaoSecundario onClick={() => setAberto(true)}>
              Adicionar endereço de entrega
            </BotaoSecundario>
          </div>
        )}
      </div>
      <AvisoNaoSalvoModal bloqueio={bloqueio}>
        O endereço novo não foi salvo. Se sair agora, o que foi digitado será perdido.
      </AvisoNaoSalvoModal>
    </Secao>
  );
}

/** Ficha do cliente (busca por CNPJ), com o CNPJ na URL (?cnpj=). */
function Ficha({ cnpj }: { cnpj: string }) {
  const navegar = useNavigate();
  const consulta = useQuery({
    queryKey: ['clientes', 'cnpj', cnpj],
    queryFn: () => clientesApi.buscarPorCnpj(cnpj),
    enabled: cnpj.length === 14,
    retry: false,
  });
  const naoEncontrado = consulta.error instanceof ApiError && consulta.error.status === 404;

  return (
    <>
      {cnpj.length !== 14 && <Alerta>Informe os 14 dígitos do CNPJ.</Alerta>}
      {cnpj.length === 14 && consulta.isPending && <Skeleton className="h-40" />}
      {naoEncontrado && (
        <EstadoVazio
          icone="🔎"
          titulo="CNPJ não encontrado"
          descricao={`Nenhum cliente com o CNPJ ${formatarCnpj(cnpj)}.`}
          acao={
            <BotaoPrimario onClick={() => navegar(`/clientes/novo?cnpj=${cnpj}`)}>
              Cadastrar cliente
            </BotaoPrimario>
          }
        />
      )}
      {consulta.isError && !naoEncontrado && (
        <ErroRequisicao erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
      )}

      {consulta.data && (
        <div className="flex flex-col gap-4">
          {consulta.data.dividaEmAberto > 0 && (
            <Alerta>
              Dívida em aberto de {formatarBRL(consulta.data.dividaEmAberto)}: novo orçamento
              bloqueado para este cliente.
            </Alerta>
          )}
          <Cartao className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Dado rotulo="Razão social">{consulta.data.razaoSocial}</Dado>
            <Dado rotulo="CNPJ">{formatarCnpj(consulta.data.cnpj)}</Dado>
            <Dado rotulo="Tipo">
              {consulta.data.tipoUnidade === 'MATRIZ' ? 'Matriz' : 'Filial'}
            </Dado>
            <Dado rotulo="Status">
              <Badge status={consulta.data.status} />
            </Dado>
            <Dado rotulo="Contato">{consulta.data.nomeContato}</Dado>
            <Dado rotulo="Telefone">{consulta.data.telefoneContato ?? '—'}</Dado>
            <Dado rotulo="E-mail">{consulta.data.emailContato ?? '—'}</Dado>
            <Dado rotulo="Vendedor responsável">{consulta.data.vendedorResponsavel}</Dado>
          </Cartao>
          <Enderecos cliente={consulta.data} />
          <NovoOrcamento cliente={consulta.data} />
          <Abas cliente={consulta.data} />
        </div>
      )}
    </>
  );
}

/**
 * Lista paginada dos clientes (UC03), com busca por razão social, nome fantasia ou CNPJ e filtro
 * de status. Busca, status e página ficam na URL (?q=&status=&pagina=); clicar abre a ficha.
 */
function ListaDeClientes() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const statusParam = params.get('status');
  const status: StatusCliente | '' =
    statusParam === 'ATIVO' || statusParam === 'INATIVO' || statusParam === 'BLOQUEADO'
      ? statusParam
      : '';
  const pagina = Math.max(1, Number(params.get('pagina')) || 1);
  const [texto, setTexto] = useState(q);

  const consulta = useQuery({
    queryKey: ['clientes', 'lista', q, status, pagina],
    queryFn: () =>
      clientesApi.listar({
        q: q || undefined,
        status: status || undefined,
        pagina,
        tamanho: TAMANHO_DA_PAGINA,
      }),
    placeholderData: keepPreviousData,
  });

  const atualizar = (mudancas: { q?: string; status?: string; pagina?: number }) => {
    const proximo = {
      q: mudancas.q ?? q,
      status: mudancas.status ?? status,
      pagina: mudancas.pagina ?? 1,
    };
    setParams({
      ...(proximo.q && { q: proximo.q }),
      ...(proximo.status && { status: proximo.status }),
      ...(proximo.pagina > 1 && { pagina: String(proximo.pagina) }),
    });
  };

  /** Um CNPJ completo abre a ficha (mantém a busca por CNPJ e o ?cnpj= da URL). */
  const buscar = (e: FormEvent) => {
    e.preventDefault();
    const termo = texto.trim();
    const digitos = termo.replace(/\D/g, '');
    if (digitos.length === 14 && /^[\d.\-/\s]+$/.test(termo)) {
      setParams({ cnpj: digitos });
      return;
    }
    atualizar({ q: termo });
  };

  return (
    <>
      <form onSubmit={buscar} className="mb-6 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <Campo
            rotulo="Buscar cliente"
            placeholder="Razão social, nome fantasia ou CNPJ"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </div>
        <Selecao
          rotulo="Status"
          value={status}
          onChange={(e) => atualizar({ status: e.target.value })}
        >
          {(Object.keys(ROTULO_STATUS_CLIENTE) as (StatusCliente | '')[]).map((s) => (
            <option key={s} value={s}>
              {ROTULO_STATUS_CLIENTE[s]}
            </option>
          ))}
        </Selecao>
        <BotaoPrimario type="submit">Buscar</BotaoPrimario>
      </form>

      <Cartao className="p-0">
        <DataState
          consulta={consulta}
          vazio={(d) =>
            d.clientes.length === 0 ? (
              <EstadoVazio
                icone="🔎"
                titulo={
                  q || status ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado ainda'
                }
                descricao={
                  q || status
                    ? 'Ajuste a busca ou o filtro de status.'
                    : 'Cadastre o primeiro cliente para começar.'
                }
                acao={
                  q || status ? undefined : (
                    <Link className="font-semibold text-petroleo underline" to="/clientes/novo">
                      Cadastrar cliente
                    </Link>
                  )
                }
              />
            ) : null
          }
        >
          {(dados) => (
            <>
              <Tabela>
                <thead>
                  <tr>
                    <Th>Razão social</Th>
                    <Th>CNPJ</Th>
                    <Th>Cidade/UF</Th>
                    <Th>Status</Th>
                    <Th>Dívida</Th>
                  </tr>
                </thead>
                <tbody>
                  {dados.clientes.map((c) => (
                    <tr key={c.idCliente}>
                      <Td>
                        <Link
                          className="font-semibold text-petroleo underline"
                          to={`/clientes?cnpj=${c.cnpj}`}
                        >
                          {c.razaoSocial}
                        </Link>
                        {c.nomeFantasia && (
                          <div className="text-xs text-gray-500">{c.nomeFantasia}</div>
                        )}
                      </Td>
                      <Td>{formatarCnpj(c.cnpj)}</Td>
                      <Td>{c.cidade && c.uf ? `${c.cidade}/${c.uf}` : '—'}</Td>
                      <Td>
                        <Badge status={c.status} />
                      </Td>
                      <Td>{c.temDividaEmAberto ? 'Em aberto' : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
              <div className="flex items-center justify-between px-4 py-3 text-sm text-gray-500">
                <span>Página {dados.pagina}</span>
                <div className="flex gap-2">
                  <BotaoSecundario
                    disabled={dados.pagina <= 1}
                    onClick={() => atualizar({ pagina: dados.pagina - 1 })}
                  >
                    Anterior
                  </BotaoSecundario>
                  <BotaoSecundario
                    disabled={!dados.temMais}
                    onClick={() => atualizar({ pagina: dados.pagina + 1 })}
                  >
                    Próxima
                  </BotaoSecundario>
                </div>
              </div>
            </>
          )}
        </DataState>
      </Cartao>
    </>
  );
}

/**
 * Tela 4 — UC03 – Clientes: lista paginada com busca e filtro de status; sem ?cnpj= mostra a
 * lista, com ?cnpj= mostra a ficha do cliente.
 */
export default function Clientes() {
  const [params] = useSearchParams();
  const navegar = useNavigate();
  const cnpjParam = params.get('cnpj');
  const cnpj = (cnpjParam ?? '').replace(/\D/g, '');

  return (
    <Pagina
      titulo="Clientes"
      acoes={
        <div className="flex gap-3">
          {cnpjParam !== null && (
            <BotaoSecundario onClick={() => navegar('/clientes')}>Voltar à lista</BotaoSecundario>
          )}
          <BotaoSecundario onClick={() => navegar('/clientes/novo')}>
            Cadastrar cliente
          </BotaoSecundario>
        </div>
      }
    >
      {cnpjParam !== null ? <Ficha cnpj={cnpj} /> : <ListaDeClientes />}
    </Pagina>
  );
}
