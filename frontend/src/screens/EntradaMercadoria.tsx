import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, fornecedoresApi, produtosApi, type SaldoEstoque } from '@/api';
import {
  Alerta,
  BotaoConfirmacao,
  BotaoPrimario,
  BotaoSecundario,
  Campo,
  Cartao,
  mensagemDeErro,
  Modal,
  Pagina,
  Selecao,
} from '@/components/ui';

/** Tela 15 — UC04 – Entrada de mercadoria. Divergência bloqueia o Salvar até a liberação por operador chefe (RF19). */
export default function EntradaMercadoria() {
  const fornecedores = useQuery({ queryKey: ['fornecedores'], queryFn: fornecedoresApi.listar });
  const [idFornecedor, setIdFornecedor] = useState('');
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');
  const [variacao, setVariacao] = useState<SaldoEstoque | null>(null);
  const [cotacao, setCotacao] = useState('');
  const [comprada, setComprada] = useState('');
  const [informada, setInformada] = useState('');
  const [liberando, setLiberando] = useState(false);
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [salvo, setSalvo] = useState(false);

  const variacoes = useQuery({
    queryKey: ['estoque', 'busca', termo],
    queryFn: () => produtosApi.buscarVariacoes(termo),
    enabled: termo !== '' && !variacao,
  });

  const qc = Number(comprada);
  const qi = Number(informada);
  const preenchido =
    !!idFornecedor &&
    !!variacao &&
    Number.isInteger(qc) &&
    qc > 0 &&
    Number.isInteger(qi) &&
    qi > 0;
  const divergente = preenchido && qc !== qi;

  const limpar = () => {
    setVariacao(null);
    setBusca('');
    setTermo('');
    setCotacao('');
    setComprada('');
    setInformada('');
    setUsuario('');
    setSenha('');
  };
  const registrar = useMutation({
    mutationFn: (liberacao?: { usuario: string; senha: string }) =>
      fornecedoresApi.registrarEntrada({
        idFornecedor: Number(idFornecedor),
        idVariacao: (variacao as SaldoEstoque).idVariacao,
        numeroCotacaoCompra: cotacao.trim() || undefined,
        quantidadeComprada: qc,
        quantidadeInformada: qi,
        liberacao,
      }),
    onSuccess: () => {
      setLiberando(false);
      setSalvo(true);
      limpar();
    },
  });

  return (
    <Pagina titulo="Entrada de mercadoria">
      <Cartao className="flex max-w-2xl flex-col gap-4">
        <Selecao
          rotulo="Fornecedor"
          value={idFornecedor}
          onChange={(e) => setIdFornecedor(e.target.value)}
        >
          <option value="">Selecione…</option>
          {fornecedores.data?.map((f) => (
            <option key={f.idFornecedor} value={f.idFornecedor}>
              {f.razaoSocial}
            </option>
          ))}
        </Selecao>

        {variacao ? (
          <div className="flex items-center justify-between rounded-md bg-off-white px-3 py-2 text-sm">
            <span>
              {variacao.produto} · {variacao.marca} · {variacao.tamanhoEmbalagem}
            </span>
            <BotaoSecundario onClick={() => setVariacao(null)}>Trocar</BotaoSecundario>
          </div>
        ) : (
          <div>
            <form
              className="flex items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                setTermo(busca.trim());
              }}
            >
              <div className="flex-1">
                <Campo
                  rotulo="Variação"
                  placeholder="Produto, marca, código ou EAN"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
              <BotaoSecundario type="submit" disabled={!busca.trim()}>
                Buscar
              </BotaoSecundario>
            </form>
            {variacoes.data && (
              <ul className="mt-2 rounded-md border border-gray-200">
                {variacoes.data.length === 0 && (
                  <li className="px-3 py-2 text-sm text-gray-500">Nenhuma variação encontrada.</li>
                )}
                {variacoes.data.map((v) => (
                  <li key={v.idVariacao}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-off-white"
                      onClick={() => setVariacao(v)}
                    >
                      {v.produto} · {v.marca} · {v.tamanhoEmbalagem}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <Campo
          rotulo="Nº da cotação de compra"
          opcional
          value={cotacao}
          onChange={(e) => setCotacao(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Campo
            rotulo="Quantidade comprada"
            type="number"
            min={1}
            value={comprada}
            onChange={(e) => setComprada(e.target.value)}
          />
          <Campo
            rotulo="Quantidade informada"
            type="number"
            min={1}
            value={informada}
            onChange={(e) => setInformada(e.target.value)}
          />
        </div>

        {divergente && (
          <Alerta>
            Divergência entre a quantidade comprada ({qc}) e a informada ({qi}): salvar está
            bloqueado.
          </Alerta>
        )}
        {salvo && (
          <p role="status" className="text-sm text-green-800">
            ✓ Entrada registrada.
          </p>
        )}
        {registrar.isError && !liberando && <Alerta>{mensagemDeErro(registrar.error)}</Alerta>}

        <div className="flex gap-3">
          <BotaoPrimario
            disabled={!preenchido || divergente || registrar.isPending}
            onClick={() => {
              setSalvo(false);
              registrar.mutate(undefined);
            }}
          >
            Salvar
          </BotaoPrimario>
          {divergente && (
            <BotaoSecundario onClick={() => setLiberando(true)}>
              Liberar divergência
            </BotaoSecundario>
          )}
        </div>
      </Cartao>

      {liberando && (
        <Modal
          titulo="Liberação por operador chefe"
          aoFechar={() => setLiberando(false)}
          acoes={
            <>
              <BotaoSecundario onClick={() => setLiberando(false)}>Voltar</BotaoSecundario>
              <BotaoConfirmacao
                disabled={!usuario.trim() || !senha || registrar.isPending}
                onClick={() => registrar.mutate({ usuario: usuario.trim(), senha })}
              >
                Liberar e salvar
              </BotaoConfirmacao>
            </>
          }
        >
          <p className="text-sm text-gray-600">
            Informe o usuário e a senha do operador chefe que autoriza a divergência.
          </p>
          <Campo
            rotulo="Usuário"
            autoComplete="off"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
          />
          <Campo
            rotulo="Senha"
            type="password"
            autoComplete="off"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
          {registrar.isError && (
            <Alerta>
              {registrar.error instanceof ApiError && registrar.error.codigo === 'LIBERACAO_NEGADA'
                ? 'Credenciais sem permissão para liberar a divergência.'
                : mensagemDeErro(registrar.error)}
            </Alerta>
          )}
        </Modal>
      )}
    </Pagina>
  );
}
