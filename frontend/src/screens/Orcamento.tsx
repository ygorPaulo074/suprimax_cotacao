import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { orcamentosApi } from '@/api';
import { DataState } from '@/components/DataState';
import { ErroRequisicao, Pagina } from '@/components/ui';
import OrcamentoDetalhe from './OrcamentoDetalhe';
import OrcamentoMontagem from './OrcamentoMontagem';

/** /orcamentos/:id — rascunho (e pendente de crédito) abre a montagem; os demais, o detalhe somente leitura. */
export default function Orcamento() {
  const id = Number(useParams().id);
  const consulta = useQuery({
    queryKey: ['orcamentos', id],
    queryFn: () => orcamentosApi.obter(id),
  });
  if (consulta.isError) {
    return (
      <Pagina titulo="Orçamento">
        <ErroRequisicao erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
        <Link className="ml-4 font-semibold text-petroleo underline" to="/orcamentos">
          Voltar para orçamentos
        </Link>
      </Pagina>
    );
  }
  return (
    <DataState consulta={consulta}>
      {(o) =>
        o.status === 'RASCUNHO' || o.status === 'PENDENTE_CREDITO' ? (
          <OrcamentoMontagem key={`${o.idOrcamento}-${o.status}`} orcamento={o} />
        ) : (
          <OrcamentoDetalhe orcamento={o} />
        )
      }
    </DataState>
  );
}
