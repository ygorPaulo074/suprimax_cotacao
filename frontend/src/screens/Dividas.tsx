import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientesApi, dividasApi, type Divida } from '@/api';
import { formatarBRL, reaisParaCentavos } from '@/lib/dinheiro';
import { formatarData } from '@/lib/datas';
import { DataState } from '@/components/DataState';
import {
  Alerta,
  Badge,
  BotaoPrimario,
  BotaoSecundario,
  Campo,
  Cartao,
  EstadoVazio,
  mensagemDeErro,
  Modal,
  Pagina,
  Secao,
  Tabela,
  Td,
  Th,
} from '@/components/ui';

function ModalRenegociar({ divida, aoFechar }: { divida: Divida; aoFechar: () => void }) {
  const queryClient = useQueryClient();
  const [data, setData] = useState('');
  const [valor, setValor] = useState('');
  const centavos = reaisParaCentavos(valor);
  // Mesma restrição do banco (CHECK em divida_inadimplencia): pago >= 50% da dívida.
  const abaixoDoMinimo = centavos !== null && centavos * 2 < divida.valorDivida;
  const renegociar = useMutation({
    mutationFn: () =>
      dividasApi.renegociar(divida.idDivida, {
        dataRenegociacao: data,
        valorPago: centavos as number,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dividas'] });
      aoFechar();
    },
  });
  return (
    <Modal
      titulo={`Renegociar dívida — ${divida.cliente}`}
      aoFechar={aoFechar}
      acoes={
        <>
          <BotaoSecundario onClick={aoFechar}>Voltar</BotaoSecundario>
          <BotaoPrimario
            disabled={!data || centavos === null || abaixoDoMinimo || renegociar.isPending}
            onClick={() => renegociar.mutate()}
          >
            Registrar renegociação
          </BotaoPrimario>
        </>
      }
    >
      <p className="text-sm text-gray-600">Valor da dívida: {formatarBRL(divida.valorDivida)}</p>
      <Campo
        rotulo="Data da renegociação"
        type="date"
        value={data}
        onChange={(e) => setData(e.target.value)}
      />
      <Campo
        rotulo="Valor pago (R$)"
        inputMode="decimal"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        erro={valor && centavos === null ? 'Valor inválido. Use o formato 0,00.' : null}
      />
      {abaixoDoMinimo && (
        <Alerta>
          Valor pago inferior a 50% da dívida: a renegociação não pode ser registrada.
        </Alerta>
      )}
      {renegociar.isError && <Alerta>{mensagemDeErro(renegociar.error)}</Alerta>}
    </Modal>
  );
}

/** Tela 12 — UC23 – Dívidas (perfil FINANCEIRO). */
export default function Dividas() {
  const queryClient = useQueryClient();
  const consulta = useQuery({ queryKey: ['dividas'], queryFn: dividasApi.listar });
  const [cnpj, setCnpj] = useState('');
  const [valor, setValor] = useState('');
  const [vencimento, setVencimento] = useState('');
  const [renegociando, setRenegociando] = useState<Divida | null>(null);

  const cliente = useQuery({
    queryKey: ['clientes', 'cnpj', cnpj.replace(/\D/g, '')],
    queryFn: () => clientesApi.buscarPorCnpj(cnpj.replace(/\D/g, '')),
    enabled: cnpj.replace(/\D/g, '').length === 14,
    retry: false,
  });
  const centavos = reaisParaCentavos(valor);
  const registrar = useMutation({
    mutationFn: () =>
      dividasApi.registrar({
        idCliente: cliente.data!.idCliente,
        valorDivida: centavos as number,
        dataVencimentoOriginal: vencimento,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dividas'] });
      setCnpj('');
      setValor('');
      setVencimento('');
    },
  });

  return (
    <Pagina titulo="Dívidas">
      <Secao titulo="Registrar dívida">
        <Cartao>
          <form
            className="grid grid-cols-1 items-start gap-3 md:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              registrar.mutate();
            }}
          >
            <Campo
              rotulo="CNPJ do cliente"
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              erro={cliente.isError ? 'Cliente não encontrado.' : null}
            />
            <Campo
              rotulo="Valor da dívida (R$)"
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              erro={valor && centavos === null ? 'Valor inválido.' : null}
            />
            <Campo
              rotulo="Vencimento original"
              type="date"
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
            />
            <div className="self-end">
              <BotaoPrimario
                type="submit"
                disabled={!cliente.data || centavos === null || !vencimento || registrar.isPending}
              >
                Registrar dívida
              </BotaoPrimario>
            </div>
          </form>
          {cliente.data && (
            <p className="mt-2 text-sm text-gray-600">Cliente: {cliente.data.razaoSocial}</p>
          )}
          {registrar.isError && <Alerta className="mt-3">{mensagemDeErro(registrar.error)}</Alerta>}
        </Cartao>
      </Secao>

      <Cartao className="overflow-hidden p-0">
        <DataState
          consulta={consulta}
          vazio={(d) =>
            d.length === 0 ? <EstadoVazio icone="💰" titulo="Nenhuma dívida registrada" /> : null
          }
        >
          {(itens) => (
            <Tabela>
              <thead>
                <tr>
                  <Th>Cliente</Th>
                  <Th direita>Valor da dívida</Th>
                  <Th>Vencimento original</Th>
                  <Th>Status</Th>
                  <Th>Renegociação</Th>
                  <Th direita>Valor pago</Th>
                  <Th>Protesto</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {itens.map((d) => {
                  const abaixo =
                    d.valorPagoRenegociacao !== null && d.valorPagoRenegociacao * 2 < d.valorDivida;
                  return (
                    <tr key={d.idDivida}>
                      <Td>{d.cliente}</Td>
                      <Td direita>{formatarBRL(d.valorDivida)}</Td>
                      <Td>{formatarData(d.dataVencimentoOriginal)}</Td>
                      <Td>
                        <Badge status={d.status} />
                      </Td>
                      <Td>{formatarData(d.dataRenegociacao)}</Td>
                      <Td direita>
                        {formatarBRL(d.valorPagoRenegociacao)}
                        {abaixo && <div className="text-xs text-orange-800">⚠ abaixo de 50%</div>}
                      </Td>
                      <Td>{formatarData(d.dataProtesto)}</Td>
                      <Td>
                        {d.status === 'EM_ABERTO' && (
                          <BotaoSecundario onClick={() => setRenegociando(d)}>
                            Renegociar
                          </BotaoSecundario>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Tabela>
          )}
        </DataState>
      </Cartao>
      {renegociando && (
        <ModalRenegociar divida={renegociando} aoFechar={() => setRenegociando(null)} />
      )}
    </Pagina>
  );
}
