import type { ReactNode } from 'react';
import type { EnderecoCliente } from '@/api';
import { Campo, Cartao, Selecao } from '@/components/ui';

export const enderecoVazio = (tipo: EnderecoCliente['tipo']): EnderecoCliente => ({
  tipo,
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  cep: '',
});

/** Preenchido: os campos obrigatórios presentes, UF com 2 letras (mesma regra do cadastro, UC02). */
export const enderecoCompleto = (e: EnderecoCliente): boolean =>
  Boolean(e.logradouro && e.numero && e.bairro && e.cidade && e.uf.length === 2 && e.cep);

/**
 * Campos de um endereço (UC02), compartilhados pelo cadastro de cliente e pelo "Adicionar
 * endereço de entrega" da ficha. Com `fixarTipo`, o tipo não é editável.
 */
export function EnderecoCampos({
  endereco,
  aoAlterar,
  fixarTipo = false,
  children,
}: {
  endereco: EnderecoCliente;
  aoAlterar: (campo: keyof EnderecoCliente, valor: string) => void;
  fixarTipo?: boolean;
  children?: ReactNode;
}) {
  return (
    <Cartao className="grid grid-cols-1 gap-3 md:grid-cols-4">
      {!fixarTipo && (
        <Selecao
          rotulo="Tipo"
          value={endereco.tipo}
          onChange={(ev) => aoAlterar('tipo', ev.target.value)}
        >
          <option value="CADASTRAL">Cadastral</option>
          <option value="ENTREGA">Entrega</option>
        </Selecao>
      )}
      <div className={fixarTipo ? 'md:col-span-3' : 'md:col-span-2'}>
        <Campo
          rotulo="Logradouro"
          value={endereco.logradouro}
          onChange={(ev) => aoAlterar('logradouro', ev.target.value)}
        />
      </div>
      <Campo
        rotulo="Número"
        value={endereco.numero}
        onChange={(ev) => aoAlterar('numero', ev.target.value)}
      />
      <Campo
        rotulo="Complemento"
        opcional
        value={endereco.complemento ?? ''}
        onChange={(ev) => aoAlterar('complemento', ev.target.value)}
      />
      <Campo
        rotulo="Bairro"
        value={endereco.bairro}
        onChange={(ev) => aoAlterar('bairro', ev.target.value)}
      />
      <Campo
        rotulo="Cidade"
        value={endereco.cidade}
        onChange={(ev) => aoAlterar('cidade', ev.target.value)}
      />
      <Campo
        rotulo="UF"
        maxLength={2}
        value={endereco.uf}
        onChange={(ev) => aoAlterar('uf', ev.target.value.toUpperCase())}
      />
      <Campo
        rotulo="CEP"
        value={endereco.cep}
        onChange={(ev) => aoAlterar('cep', ev.target.value)}
      />
      {children}
    </Cartao>
  );
}
