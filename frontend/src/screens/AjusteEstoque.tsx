import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { produtosApi, type SaldoEstoque } from '@/api';
import { formatarDataHora } from '@/lib/datas';
import { DataState } from '@/components/DataState';
import {
  Alerta,
  Badge,
  BotaoPrimario,
  BotaoSecundario,
  Campo,
  CampoTexto,
  Cartao,
  CartaoIndicador,
  EstadoVazio,
  mensagemDeErro,
  Pagina,
  Secao,
  Tabela,
  Td,
  Th,
} from '@/components/ui';

function Ajuste({ variacao }: { variacao: SaldoEstoque }) {
  const queryClient = useQueryClient();
  const id = variacao.idVariacao;
  const saldo = useQuery({
    queryKey: ['estoque', id],
    queryFn: () => produtosApi.saldo(id),
    initialData: variacao,
  });
  const movimentos = useQuery({
    queryKey: ['estoque', id, 'movimentacoes'],
    queryFn: () => produtosApi.movimentacoes(id),
  });
  const [quantidade, setQuantidade] = useState('');
  const [motivo, setMotivo] = useState('');
  const q = Number(quantidade);
  const valida = quantidade.trim() !== '' && Number.isInteger(q) && q !== 0;
  // Aviso antecipado da regra do banco: o físico não pode ficar abaixo do reservado.
  const abaixoDoReservado = valida && saldo.data.saldoFisico + q < saldo.data.reservado;

  const ajustar = useMutation({
    mutationFn: () => produtosApi.ajustar(id, { quantidade: q, motivo: motivo.trim() }),
    onSuccess: (novo) => {
      queryClient.setQueryData(['estoque', id], novo);
      void queryClient.invalidateQueries({ queryKey: ['estoque', id, 'movimentacoes'] });
      void queryClient.invalidateQueries({ queryKey: ['produtos'] });
      setQuantidade('');
      setMotivo('');
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm font-semibold">
        {saldo.data.produto} · {saldo.data.marca} · {saldo.data.tamanhoEmbalagem}
      </div>
      <div className="flex flex-wrap gap-4">
        <CartaoIndicador rotulo="Saldo físico" valor={saldo.data.saldoFisico} />
        <CartaoIndicador rotulo="Reservado" valor={saldo.data.reservado} atencao />
        <CartaoIndicador rotulo="Disponível" valor={saldo.data.disponivel} />
      </div>

      <Cartao className="flex max-w-xl flex-col gap-3">
        <Campo
          rotulo="Quantidade a somar (+) ou subtrair (−)"
          type="number"
          value={quantidade}
          onChange={(e) => setQuantidade(e.target.value)}
        />
        <CampoTexto
          rotulo="Motivo"
          required
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          erro={valida && !motivo.trim() ? 'O motivo é obrigatório.' : null}
        />
        {abaixoDoReservado && (
          <Alerta>
            Ajuste bloqueado: o estoque físico ficaria abaixo do total reservado (
            {saldo.data.reservado}).
          </Alerta>
        )}
        {ajustar.isError && <Alerta>{mensagemDeErro(ajustar.error)}</Alerta>}
        <div>
          <BotaoPrimario
            disabled={!valida || !motivo.trim() || abaixoDoReservado || ajustar.isPending}
            onClick={() => ajustar.mutate()}
          >
            Registrar ajuste
          </BotaoPrimario>
        </div>
      </Cartao>

      <Secao titulo="Histórico de movimentações">
        <Cartao className="overflow-hidden p-0">
          <DataState
            consulta={movimentos}
            vazio={(d) => (d.length === 0 ? <EstadoVazio titulo="Sem movimentações" /> : null)}
          >
            {(itens) => (
              <Tabela>
                <thead>
                  <tr>
                    <Th>Data</Th>
                    <Th>Tipo</Th>
                    <Th direita>Quantidade</Th>
                    <Th>Usuário</Th>
                    <Th>Motivo</Th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((m) => (
                    <tr key={m.idMovimentacao}>
                      <Td>{formatarDataHora(m.dataMovimentacao)}</Td>
                      <Td>
                        <Badge
                          status={
                            m.tipo === 'ENTRADA'
                              ? 'ATIVO'
                              : m.tipo === 'BAIXA'
                                ? 'EM_ANALISE'
                                : 'ABERTO'
                          }
                        />
                        <span className="ml-1 text-xs">{m.tipo}</span>
                      </Td>
                      <Td direita>{m.quantidade}</Td>
                      <Td>{m.usuario ?? '—'}</Td>
                      <Td>{m.motivo ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            )}
          </DataState>
        </Cartao>
      </Secao>
    </div>
  );
}

/** Tela 14 — UC24 – Ajuste de estoque (somente OPERADOR_CHEFE). */
export default function AjusteEstoque() {
  const [q, setQ] = useState('');
  const [termo, setTermo] = useState('');
  const [escolhida, setEscolhida] = useState<SaldoEstoque | null>(null);
  const busca = useQuery({
    queryKey: ['estoque', 'busca', termo],
    queryFn: () => produtosApi.buscarVariacoes(termo),
    enabled: termo !== '',
  });

  return (
    <Pagina titulo="Ajuste de estoque">
      <form
        className="mb-4 flex max-w-xl items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setTermo(q.trim());
          setEscolhida(null);
        }}
      >
        <div className="flex-1">
          <Campo
            rotulo="Buscar variação"
            placeholder="Produto, marca, código ou EAN"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <BotaoPrimario type="submit" disabled={!q.trim()}>
          Buscar
        </BotaoPrimario>
      </form>

      {termo !== '' && !escolhida && (
        <Cartao className="mb-4 overflow-hidden p-0">
          <DataState
            consulta={busca}
            vazio={(d) =>
              d.length === 0 ? (
                <EstadoVazio icone="🔎" titulo="Nenhuma variação encontrada" />
              ) : null
            }
          >
            {(itens) => (
              <ul>
                {itens.map((v) => (
                  <li
                    key={v.idVariacao}
                    className="flex items-center justify-between border-b border-gray-200 px-4 py-2 text-sm"
                  >
                    <span>
                      {v.produto} · {v.marca} · {v.tamanhoEmbalagem}{' '}
                      <span className="text-gray-500">(físico {v.saldoFisico})</span>
                    </span>
                    <BotaoSecundario onClick={() => setEscolhida(v)}>Selecionar</BotaoSecundario>
                  </li>
                ))}
              </ul>
            )}
          </DataState>
        </Cartao>
      )}

      {escolhida ? (
        <Ajuste key={escolhida.idVariacao} variacao={escolhida} />
      ) : (
        termo === '' && (
          <EstadoVazio
            icone="📦"
            titulo="Busque a variação a ajustar"
            descricao="O ajuste exige a quantidade e o motivo."
          />
        )
      )}
    </Pagina>
  );
}
