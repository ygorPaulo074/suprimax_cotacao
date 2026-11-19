/** Leituras (GET) sem resposta: aviso intermediário aos 15 s e erro de conexão aos 60 s (RNF06). */
export const AVISO_LENTIDAO_MS = 15_000;
/** Maior que o tempo de acordar o proxy e o backend do Render gratuito (~45 s + backend). */
export const LIMITE_LEITURA_MS = 60_000;

let lentas = 0;
let versao = 0;
const ouvintes = new Set<() => void>();

function avisar(): void {
  versao += 1;
  ouvintes.forEach((o) => o());
}

/** Marca uma leitura como "demorando"; devolve quem desfaz a marca. */
export function marcarLeituraLenta(): () => void {
  lentas += 1;
  avisar();
  let desfeita = false;
  return () => {
    if (desfeita) return;
    desfeita = true;
    lentas -= 1;
    avisar();
  };
}

export function haLeituraLenta(): boolean {
  return lentas > 0;
}
export function assinarLentidao(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}
export function versaoDaLentidao(): number {
  return versao;
}
