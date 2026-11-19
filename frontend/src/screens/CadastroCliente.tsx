import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientesApi, type EnderecoCliente, type TipoUnidade } from '@/api';
import { AvisoNaoSalvoModal } from '@/components/AvisoNaoSalvoModal';
import { textoNormalizado, useAvisoNaoSalvo } from '@/lib/useAvisoNaoSalvo';
import { EnderecoCampos, enderecoCompleto, enderecoVazio } from '@/components/EnderecoCampos';
import {
  Alerta,
  BotaoPrimario,
  BotaoSecundario,
  Campo,
  Cartao,
  mensagemDeErro,
  Pagina,
  Secao,
  Selecao,
} from '@/components/ui';

/** Tela 5 — UC02 – Cadastro de cliente. Salvar fica desabilitado até o aceite LGPD (RF20). */
export default function CadastroCliente() {
  const [params] = useSearchParams();
  const navegar = useNavigate();
  const queryClient = useQueryClient();
  const vendedores = useQuery({ queryKey: ['vendedores'], queryFn: clientesApi.vendedores });

  const cnpjInicial = params.get('cnpj') ?? '';
  const [cnpj, setCnpj] = useState(cnpjInicial);
  const [razaoSocial, setRazaoSocial] = useState('');
  const [nomeContato, setNomeContato] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [tipoUnidade, setTipoUnidade] = useState<TipoUnidade>('MATRIZ');
  const [idVendedor, setIdVendedor] = useState('');
  const [enderecos, setEnderecos] = useState<EnderecoCliente[]>([enderecoVazio('CADASTRAL')]);
  const [aceiteLgpd, setAceiteLgpd] = useState(false);

  const salvar = useMutation({
    mutationFn: () =>
      clientesApi.criar({
        cnpj: cnpj.replace(/\D/g, ''),
        razaoSocial: razaoSocial.trim(),
        nomeContato: nomeContato.trim(),
        telefoneContato: telefone.trim() || undefined,
        emailContato: email.trim() || undefined,
        tipoUnidade,
        idOperadorVendedor: Number(idVendedor),
        enderecos,
        aceiteLgpd: true,
      }),
    onSuccess: (cliente) => {
      void queryClient.invalidateQueries({ queryKey: ['clientes'] });
      liberar(); // salvou: a saída é de propósito
      navegar(`/clientes?cnpj=${cliente.cnpj}`);
    },
  });

  // RNF06: algo digitado além do que a tela já trazia (CNPJ da URL, matriz, LGPD desmarcado).
  // Compara só os dígitos do CNPJ (a máscara não conta) e ignora espaços.
  const vazio = enderecoVazio('CADASTRAL');
  const sujo =
    cnpj.replace(/\D/g, '') !== cnpjInicial.replace(/\D/g, '') ||
    [razaoSocial, nomeContato, telefone, email].some((v) => textoNormalizado(v) !== '') ||
    tipoUnidade !== 'MATRIZ' ||
    idVendedor !== '' ||
    aceiteLgpd ||
    enderecos.length !== 1 ||
    enderecos.some((e) =>
      (Object.keys(vazio) as (keyof EnderecoCliente)[]).some(
        (k) => k !== 'tipo' && textoNormalizado(e[k] as string | undefined) !== '',
      ),
    );
  const { bloqueio, liberar } = useAvisoNaoSalvo(sujo);

  const alterarEndereco = (i: number, campo: keyof EnderecoCliente, valor: string) =>
    setEnderecos((lista) => lista.map((e, idx) => (idx === i ? { ...e, [campo]: valor } : e)));

  const cnpjValido = cnpj.replace(/\D/g, '').length === 14;
  const completo =
    cnpjValido &&
    razaoSocial.trim() &&
    nomeContato.trim() &&
    idVendedor &&
    enderecos.every(enderecoCompleto);

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (aceiteLgpd && completo) salvar.mutate();
  };

  return (
    <Pagina titulo="Cadastro de cliente">
      <form onSubmit={enviar} className="flex max-w-4xl flex-col gap-4">
        <Cartao className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Campo
            rotulo="CNPJ"
            value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
            erro={cnpj && !cnpjValido ? 'Informe os 14 dígitos.' : null}
            required
          />
          <Campo
            rotulo="Razão social"
            value={razaoSocial}
            onChange={(e) => setRazaoSocial(e.target.value)}
            required
          />
          <Campo
            rotulo="Nome do contato"
            value={nomeContato}
            onChange={(e) => setNomeContato(e.target.value)}
            required
          />
          <Campo
            rotulo="Telefone"
            opcional
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
          />
          <Campo
            rotulo="E-mail"
            opcional
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Selecao
            rotulo="Tipo de unidade"
            value={tipoUnidade}
            onChange={(e) => setTipoUnidade(e.target.value as TipoUnidade)}
          >
            <option value="MATRIZ">Matriz</option>
            <option value="FILIAL">Filial</option>
          </Selecao>
          <Selecao
            rotulo="Vendedor responsável"
            value={idVendedor}
            onChange={(e) => setIdVendedor(e.target.value)}
            required
          >
            <option value="">Selecione…</option>
            {vendedores.data?.map((v) => (
              <option key={v.idOperador} value={v.idOperador}>
                {v.nome}
              </option>
            ))}
          </Selecao>
        </Cartao>

        <Secao titulo="Endereços">
          <div className="flex flex-col gap-3">
            {enderecos.map((e, i) => (
              <EnderecoCampos
                key={i}
                endereco={e}
                aoAlterar={(campo, valor) => alterarEndereco(i, campo, valor)}
              >
                {enderecos.length > 1 && (
                  <div className="md:col-span-4">
                    <BotaoSecundario
                      onClick={() => setEnderecos((l) => l.filter((_, idx) => idx !== i))}
                    >
                      Remover endereço
                    </BotaoSecundario>
                  </div>
                )}
              </EnderecoCampos>
            ))}
            <div>
              <BotaoSecundario
                onClick={() => setEnderecos((l) => [...l, enderecoVazio('ENTREGA')])}
              >
                Adicionar endereço
              </BotaoSecundario>
            </div>
          </div>
        </Secao>

        <Cartao>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={aceiteLgpd}
              onChange={(e) => setAceiteLgpd(e.target.checked)}
            />
            <span>
              <strong>Consentimento LGPD (obrigatório).</strong> O cliente autoriza a SupriMax a
              tratar os dados cadastrais e os documentos enviados para a análise de crédito,
              conforme a Lei Geral de Proteção de Dados.
            </span>
          </label>
        </Cartao>

        {!aceiteLgpd && (
          <Alerta>Salvar está bloqueado: registre o consentimento LGPD do cliente.</Alerta>
        )}
        {salvar.isError && <Alerta>{mensagemDeErro(salvar.error)}</Alerta>}
        <div className="flex gap-3">
          <BotaoPrimario type="submit" disabled={!aceiteLgpd || !completo || salvar.isPending}>
            Salvar
          </BotaoPrimario>
          <BotaoSecundario
            onClick={() => {
              liberar(); // Cancelar descarta de propósito, sem aviso
              navegar('/clientes');
            }}
          >
            Cancelar
          </BotaoSecundario>
        </div>
      </form>
      <AvisoNaoSalvoModal bloqueio={bloqueio}>
        O cadastro do cliente não foi salvo. Se sair agora, o que foi digitado será perdido.
      </AvisoNaoSalvoModal>
    </Pagina>
  );
}
