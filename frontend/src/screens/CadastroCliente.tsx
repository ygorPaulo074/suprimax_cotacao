import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientesApi, type EnderecoCliente, type TipoUnidade } from '@/api';
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

const enderecoVazio = (tipo: EnderecoCliente['tipo']): EnderecoCliente => ({
  tipo,
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  cep: '',
});

/** Tela 5 — UC02 – Cadastro de cliente. Salvar fica desabilitado até o aceite LGPD (RF20). */
export default function CadastroCliente() {
  const [params] = useSearchParams();
  const navegar = useNavigate();
  const queryClient = useQueryClient();
  const vendedores = useQuery({ queryKey: ['vendedores'], queryFn: clientesApi.vendedores });

  const [cnpj, setCnpj] = useState(params.get('cnpj') ?? '');
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
      navegar(`/clientes?cnpj=${cliente.cnpj}`);
    },
  });

  const alterarEndereco = (i: number, campo: keyof EnderecoCliente, valor: string) =>
    setEnderecos((lista) => lista.map((e, idx) => (idx === i ? { ...e, [campo]: valor } : e)));

  const cnpjValido = cnpj.replace(/\D/g, '').length === 14;
  const completo =
    cnpjValido &&
    razaoSocial.trim() &&
    nomeContato.trim() &&
    idVendedor &&
    enderecos.every(
      (e) => e.logradouro && e.numero && e.bairro && e.cidade && e.uf.length === 2 && e.cep,
    );

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
              <Cartao key={i} className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <Selecao
                  rotulo="Tipo"
                  value={e.tipo}
                  onChange={(ev) => alterarEndereco(i, 'tipo', ev.target.value)}
                >
                  <option value="CADASTRAL">Cadastral</option>
                  <option value="ENTREGA">Entrega</option>
                </Selecao>
                <div className="md:col-span-2">
                  <Campo
                    rotulo="Logradouro"
                    value={e.logradouro}
                    onChange={(ev) => alterarEndereco(i, 'logradouro', ev.target.value)}
                  />
                </div>
                <Campo
                  rotulo="Número"
                  value={e.numero}
                  onChange={(ev) => alterarEndereco(i, 'numero', ev.target.value)}
                />
                <Campo
                  rotulo="Complemento"
                  opcional
                  value={e.complemento ?? ''}
                  onChange={(ev) => alterarEndereco(i, 'complemento', ev.target.value)}
                />
                <Campo
                  rotulo="Bairro"
                  value={e.bairro}
                  onChange={(ev) => alterarEndereco(i, 'bairro', ev.target.value)}
                />
                <Campo
                  rotulo="Cidade"
                  value={e.cidade}
                  onChange={(ev) => alterarEndereco(i, 'cidade', ev.target.value)}
                />
                <Campo
                  rotulo="UF"
                  maxLength={2}
                  value={e.uf}
                  onChange={(ev) => alterarEndereco(i, 'uf', ev.target.value.toUpperCase())}
                />
                <Campo
                  rotulo="CEP"
                  value={e.cep}
                  onChange={(ev) => alterarEndereco(i, 'cep', ev.target.value)}
                />
                {enderecos.length > 1 && (
                  <div className="md:col-span-4">
                    <BotaoSecundario
                      onClick={() => setEnderecos((l) => l.filter((_, idx) => idx !== i))}
                    >
                      Remover endereço
                    </BotaoSecundario>
                  </div>
                )}
              </Cartao>
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
          <BotaoSecundario onClick={() => navegar('/clientes')}>Cancelar</BotaoSecundario>
        </div>
      </form>
    </Pagina>
  );
}
