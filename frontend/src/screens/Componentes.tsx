import { useState } from 'react';
import {
  Alerta,
  Badge,
  BotaoAtencao,
  BotaoConfirmacao,
  BotaoPrimario,
  BotaoSecundario,
  Campo,
  Cartao,
  EstadoVazio,
  Modal,
  Pagina,
  Secao,
  Selecao,
  SeloAprovacaoHerdada,
  Skeleton,
  Tabela,
  Td,
  Th,
} from '@/components/ui';

const STATUS = {
  Pedido: ['SOLICITADO', 'EM_ANALISE', 'APROVADO', 'NEGADO', 'CANCELADO'],
  Orçamento: [
    'RASCUNHO',
    'PENDENTE_CREDITO',
    'ABERTO',
    'ALTERACAO_SOLICITADA',
    'ACEITO',
    'RECUSADO',
    'CANCELADO',
    'SUBSTITUIDO',
    'EXPIRADO',
  ],
  'Item do orçamento': ['APROVADO', 'NAO_APROVADO'],
  'Tipo de resposta': ['RECUSA', 'ALTERACAO', 'ITENS_NAO_APROVADOS', 'ABAIXO_DO_MINIMO'],
  Cliente: ['ATIVO', 'INATIVO', 'BLOQUEADO'],
  Dívida: ['EM_ABERTO', 'RENEGOCIADA', 'QUITADA', 'PROTESTADA'],
};

/** Tela 18 — Componentes e estados. Biblioteca de referência, disponível só em desenvolvimento (rota /componentes). */
export default function Componentes() {
  const [modal, setModal] = useState(false);
  return (
    <Pagina titulo="Componentes e estados">
      <Secao titulo="Botões">
        <div className="flex flex-wrap gap-3">
          <BotaoPrimario>Primário</BotaoPrimario>
          <BotaoSecundario>Secundário</BotaoSecundario>
          <BotaoConfirmacao>Confirmação</BotaoConfirmacao>
          <BotaoAtencao>Atenção</BotaoAtencao>
          <BotaoPrimario disabled>Desabilitado</BotaoPrimario>
        </div>
      </Secao>
      <Secao titulo="Badges de status">
        <Cartao className="flex flex-col gap-3">
          {Object.entries(STATUS).map(([grupo, valores]) => (
            <div key={grupo} className="flex flex-wrap items-center gap-2">
              <span className="w-40 text-sm font-semibold">{grupo}</span>
              {valores.map((s) => (
                <Badge key={s} status={s} />
              ))}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <span className="w-40 text-sm font-semibold">Selo</span>
            <SeloAprovacaoHerdada />
          </div>
        </Cartao>
      </Secao>
      <Secao titulo="Alerta">
        <Alerta>
          Abaixo do faturamento mínimo: o motivo do bloqueio vem sempre com ícone e texto.
        </Alerta>
      </Secao>
      <Secao titulo="Campos">
        <Cartao className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Campo rotulo="Normal" defaultValue="Texto" />
          <Campo rotulo="Opcional" opcional />
          <Campo rotulo="Com erro" erro="Informe os 14 dígitos." defaultValue="123" />
          <Selecao rotulo="Seleção">
            <option>Opção</option>
          </Selecao>
        </Cartao>
      </Secao>
      <Secao titulo="Tabela">
        <Cartao className="p-0">
          <Tabela>
            <thead>
              <tr>
                <Th>Texto</Th>
                <Th direita>Valor</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>Linha 1</Td>
                <Td direita>R$ 1.000,00</Td>
              </tr>
              <tr>
                <Td>Linha 2 (zebra)</Td>
                <Td direita>R$ 2.500,00</Td>
              </tr>
            </tbody>
          </Tabela>
        </Cartao>
      </Secao>
      <Secao titulo="Modal, carregamento e vazio">
        <div className="mb-4 flex gap-3">
          <BotaoSecundario onClick={() => setModal(true)}>Abrir modal</BotaoSecundario>
        </div>
        <Cartao className="mb-4 flex flex-col gap-2">
          <Skeleton className="h-5" />
          <Skeleton className="h-5 w-2/3" />
        </Cartao>
        <Cartao>
          <EstadoVazio
            titulo="CNPJ não encontrado"
            descricao="Nenhum cliente com este CNPJ."
            acao={<BotaoPrimario>Cadastrar cliente</BotaoPrimario>}
          />
        </Cartao>
      </Secao>
      {modal && (
        <Modal
          titulo="Título do modal"
          aoFechar={() => setModal(false)}
          acoes={
            <>
              <BotaoSecundario onClick={() => setModal(false)}>Voltar</BotaoSecundario>
              <BotaoConfirmacao onClick={() => setModal(false)}>Confirmar</BotaoConfirmacao>
            </>
          }
        >
          <p className="text-sm">
            Largura máxima de 560 px, título em azul petróleo e ações à direita.
          </p>
        </Modal>
      )}
    </Pagina>
  );
}
