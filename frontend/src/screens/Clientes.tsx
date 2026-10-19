import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiError, clientesApi, type ClienteFicha } from '@/api';
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
  EstadoVazio,
  Pagina,
  Skeleton,
  Tabela,
  Td,
  Th,
} from '@/components/ui';
import { DataState } from '@/components/DataState';

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

/** Tela 4 — UC03 – Clientes: busca por CNPJ. O CNPJ pesquisado fica na URL (?cnpj=). */
export default function Clientes() {
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const cnpj = (params.get('cnpj') ?? '').replace(/\D/g, '');
  const [texto, setTexto] = useState(params.get('cnpj') ?? '');

  const consulta = useQuery({
    queryKey: ['clientes', 'cnpj', cnpj],
    queryFn: () => clientesApi.buscarPorCnpj(cnpj),
    enabled: cnpj.length === 14,
    retry: false,
  });

  const buscar = (e: FormEvent) => {
    e.preventDefault();
    setParams(texto.trim() ? { cnpj: texto.replace(/\D/g, '') } : {});
  };

  const naoEncontrado = consulta.error instanceof ApiError && consulta.error.status === 404;

  return (
    <Pagina
      titulo="Clientes"
      acoes={
        <BotaoSecundario onClick={() => navegar('/clientes/novo')}>
          Cadastrar cliente
        </BotaoSecundario>
      }
    >
      <form onSubmit={buscar} className="mb-6 flex max-w-xl items-end gap-3">
        <div className="flex-1">
          <Campo
            rotulo="CNPJ"
            placeholder="00.000.000/0000-00"
            inputMode="numeric"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </div>
        <BotaoPrimario type="submit" disabled={texto.replace(/\D/g, '').length !== 14}>
          Buscar
        </BotaoPrimario>
      </form>

      {cnpj.length !== 14 && cnpj.length > 0 && <Alerta>Informe os 14 dígitos do CNPJ.</Alerta>}
      {cnpj.length === 0 && (
        <EstadoVazio
          icone="🏢"
          titulo="Busque um cliente pelo CNPJ"
          descricao="A ficha mostra cadastro, orçamentos em aberto e histórico de compras."
        />
      )}

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
      {consulta.isError && !naoEncontrado && <Alerta>{consulta.error.message}</Alerta>}

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
            {consulta.data.enderecos.map((e, i) => (
              <div key={e.idEndereco ?? i} className="col-span-2">
                <Dado rotulo={`Endereço (${e.tipo === 'CADASTRAL' ? 'Cadastral' : 'Entrega'})`}>
                  {e.logradouro}, {e.numero}
                  {e.complemento ? ` — ${e.complemento}` : ''} · {e.bairro} · {e.cidade}/{e.uf} ·
                  CEP {e.cep}
                </Dado>
              </div>
            ))}
          </Cartao>
          <Abas cliente={consulta.data} />
        </div>
      )}
    </Pagina>
  );
}
