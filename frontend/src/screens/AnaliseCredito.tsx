import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { creditoApi, type AnaliseCreditoDetalhe, type TipoDocumentoCredito } from '@/api';
import { formatarBRL } from '@/lib/dinheiro';
import { formatarCnpj, formatarData, formatarNumeroOrcamento } from '@/lib/datas';
import { DataState } from '@/components/DataState';
import {
  Alerta,
  BotaoConfirmacao,
  BotaoSecundario,
  Cartao,
  Dado,
  EstadoVazio,
  mensagemDeErro,
  Pagina,
  Secao,
  Tabela,
  Td,
  Th,
} from '@/components/ui';

const ROTULO_DOCUMENTO: Record<TipoDocumentoCredito, string> = {
  CONTRATO_SOCIAL: 'Contrato social',
  BALANCO_LUCRO: 'Balanço de lucro',
  COMPROVANTE_ENDERECO: 'Comprovante de endereço',
  DOCUMENTO_PROPRIETARIO: 'Documento do proprietário do local',
  NOTA_FISCAL_COMPRA: 'Notas fiscais das últimas cinco compras',
  REFERENCIA_COMERCIAL: 'Referências comerciais',
};

function LinhaDocumento({
  analise,
  tipo,
}: {
  analise: AnaliseCreditoDetalhe;
  tipo: TipoDocumentoCredito;
}) {
  const queryClient = useQueryClient();
  const doc = analise.documentos.find((d) => d.tipoDocumento === tipo);
  const [data, setData] = useState('');
  const registrar = useMutation({
    mutationFn: () => creditoApi.registrarDocumento(analise.idAnalise, tipo, data),
    onSuccess: (nova) => queryClient.setQueryData(['credito', analise.idAnalise], nova),
  });
  return (
    <tr>
      <Td>{ROTULO_DOCUMENTO[tipo]}</Td>
      <Td>{doc?.recebido ? '✓ Recebido' : '○ Pendente'}</Td>
      <Td>{formatarData(doc?.dataRecebimento)}</Td>
      <Td>
        {!doc?.recebido && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label={`Data de recebimento — ${ROTULO_DOCUMENTO[tipo]}`}
              value={data}
              onChange={(e) => setData(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
            <BotaoSecundario
              disabled={!data || registrar.isPending}
              onClick={() => registrar.mutate()}
            >
              Registrar
            </BotaoSecundario>
          </div>
        )}
      </Td>
    </tr>
  );
}

function Detalhe({ idAnalise }: { idAnalise: number }) {
  const queryClient = useQueryClient();
  const consulta = useQuery({
    queryKey: ['credito', idAnalise],
    queryFn: () => creditoApi.obter(idAnalise),
  });
  const resultado = useMutation({
    mutationFn: (r: 'APROVADO' | 'REPROVADO') => creditoApi.registrarResultado(idAnalise, r),
    onSuccess: (nova) => {
      queryClient.setQueryData(['credito', idAnalise], nova);
      void queryClient.invalidateQueries({ queryKey: ['credito', 'lista'] });
    },
  });
  return (
    <DataState consulta={consulta}>
      {(a) => (
        <div className="flex flex-col gap-4">
          <Cartao className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Dado rotulo="Cliente">{a.cliente}</Dado>
            <Dado rotulo="CNPJ">{formatarCnpj(a.cnpj)}</Dado>
            <Dado rotulo="Orçamento">{formatarNumeroOrcamento(a.numeroOrcamento)}</Dado>
            <Dado rotulo="Valor da compra">{formatarBRL(a.valorCompra)}</Dado>
          </Cartao>
          <Secao titulo="Documentos">
            <Cartao className="p-0">
              <Tabela>
                <thead>
                  <tr>
                    <Th>Documento</Th>
                    <Th>Status</Th>
                    <Th>Recebimento</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(ROTULO_DOCUMENTO) as TipoDocumentoCredito[]).map((t) => (
                    <LinhaDocumento key={t} analise={a} tipo={t} />
                  ))}
                </tbody>
              </Tabela>
            </Cartao>
          </Secao>
          <Alerta>
            Os documentos contêm dados sensíveis do proprietário da empresa e são tratados conforme
            a LGPD.
          </Alerta>
          {a.resultado ? (
            <div className="flex flex-col gap-2">
              <div>
                Resultado registrado:{' '}
                <strong>{a.resultado === 'APROVADO' ? '✓ Aprovado' : '⚠ Reprovado'}</strong>
              </div>
              {a.resultado === 'REPROVADO' && (
                <Alerta>
                  Condição alternativa de pagamento: 50% adiantado + 50% após a entrega.
                </Alerta>
              )}
            </div>
          ) : (
            <div className="flex gap-3">
              <BotaoConfirmacao
                disabled={resultado.isPending}
                onClick={() => resultado.mutate('APROVADO')}
              >
                Aprovado
              </BotaoConfirmacao>
              <BotaoSecundario
                disabled={resultado.isPending}
                onClick={() => resultado.mutate('REPROVADO')}
              >
                Reprovado
              </BotaoSecundario>
            </div>
          )}
          {resultado.isError && <Alerta>{mensagemDeErro(resultado.error)}</Alerta>}
        </div>
      )}
    </DataState>
  );
}

/** Tela 11 — UC07 – Análise de crédito (perfil FISCAL). */
export default function AnaliseCredito() {
  const [selecionada, setSelecionada] = useState<number | null>(null);
  const lista = useQuery({ queryKey: ['credito', 'lista'], queryFn: creditoApi.listar });
  return (
    <Pagina titulo="Análise de crédito">
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[360px_1fr]">
        <Cartao className="p-0">
          <DataState
            consulta={lista}
            vazio={(d) =>
              d.length === 0 ? <EstadoVazio icone="📊" titulo="Nenhuma análise pendente" /> : null
            }
          >
            {(itens) => (
              <ul>
                {itens.map((a) => (
                  <li key={a.idAnalise}>
                    <button
                      type="button"
                      onClick={() => setSelecionada(a.idAnalise)}
                      className={`flex w-full flex-col items-start gap-1 border-b border-gray-200 px-4 py-3 text-left text-sm ${selecionada === a.idAnalise ? 'bg-sky-50' : ''}`}
                    >
                      <span className="font-semibold">{a.cliente}</span>
                      <span className="text-xs text-gray-500">
                        {formatarCnpj(a.cnpj)} · solicitada em {formatarData(a.dataSolicitacao)}
                      </span>
                      <span className="text-xs">
                        {a.resultado ? `Resultado: ${a.resultado}` : '⚠ Pendente'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </DataState>
        </Cartao>
        {selecionada === null ? (
          <EstadoVazio
            icone="👈"
            titulo="Selecione uma análise"
            descricao="Escolha uma solicitação na lista para conferir os documentos."
          />
        ) : (
          <Detalhe key={selecionada} idAnalise={selecionada} />
        )}
      </div>
    </Pagina>
  );
}
