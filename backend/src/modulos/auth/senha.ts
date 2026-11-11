// UC13 (RNF01) — a senha nunca é guardada: só o hash bcrypt vai para `operador.senha_hash`
// (docs/13, seção 13.4, "Senha criptografada").
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { ErroDeValidacao } from '../../erros';

/** Custo do bcrypt (2^12 rodadas). Aumentar deixa o login mais lento e o hash mais resistente. */
export const CUSTO_PADRAO_DO_BCRYPT = 12;

/** O bcrypt só considera os primeiros 72 bytes da senha; acima disso a senha é recusada. */
export const TAMANHO_MAXIMO_DA_SENHA_EM_BYTES = 72;

const BYTES_DA_SENHA_DE_REFERENCIA = 16;
const MENSAGEM_SENHA_LONGA = `A senha deve ter no máximo ${TAMANHO_MAXIMO_DA_SENHA_EM_BYTES} bytes.`;

/** Gera e confere hashes de senha. */
export class ServicoDeSenha {
  private hashDeReferencia?: Promise<string>;

  /** @param custo Custo do bcrypt; os testes usam um valor baixo para rodar rápido. */
  constructor(private readonly custo: number = CUSTO_PADRAO_DO_BCRYPT) {}

  /**
   * Gera o hash a gravar em `senha_hash`. Cada chamada usa um sal novo.
   *
   * @throws {ErroDeValidacao} Se a senha passar de 72 bytes.
   */
  async gerarHash(senha: string): Promise<string> {
    if (!this.cabeNoBcrypt(senha)) {
      throw new ErroDeValidacao({ mensagem: MENSAGEM_SENHA_LONGA });
    }
    return bcrypt.hash(senha, this.custo);
  }

  /** Confere a senha contra o hash. Devolve `false` também para hash malformado. */
  async verificar(senha: string, hash: string): Promise<boolean> {
    if (!this.cabeNoBcrypt(senha)) {
      return false;
    }
    try {
      return await bcrypt.compare(senha, hash);
    } catch {
      return false;
    }
  }

  /**
   * Gasta o mesmo tempo de uma verificação real, sem senha que confira. Usado quando o usuário
   * não existe, para o tempo de resposta não revelar quais usuários estão cadastrados.
   */
  async simularVerificacao(senha: string): Promise<void> {
    this.hashDeReferencia ??= bcrypt.hash(
      randomBytes(BYTES_DA_SENHA_DE_REFERENCIA).toString('hex'),
      this.custo,
    );
    await this.verificar(senha, await this.hashDeReferencia);
  }

  private cabeNoBcrypt(senha: string): boolean {
    return Buffer.byteLength(senha, 'utf8') <= TAMANHO_MAXIMO_DA_SENHA_EM_BYTES;
  }
}
