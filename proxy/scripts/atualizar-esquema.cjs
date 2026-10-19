// Copia o dicionário de dados da documentação para o proxy (fonte do esquema enquanto o proxy
// não descobre a estrutura pelo próprio banco). Uso: npm run esquema:atualizar
const fs = require('node:fs');
const path = require('node:path');

const origem = path.resolve(__dirname, '../../docs/banco-de-dados/dicionario-de-dados.json');
const destino = path.resolve(__dirname, '../src/esquema/dicionario-de-dados.json');
const json = JSON.parse(fs.readFileSync(origem, 'utf8'));
// Só o que o proxy usa: tabelas/colunas e chaves estrangeiras.
const enxuto = {
  colunas: json.colunas.map((c) => ({
    tabela: c.tabela,
    coluna: c.coluna,
    pk: c.pk,
    nullable: c.nullable,
  })),
  chaves_estrangeiras: json.chaves_estrangeiras,
};
fs.writeFileSync(destino, JSON.stringify(enxuto));
console.log(
  `Esquema atualizado: ${enxuto.colunas.length} colunas, ${enxuto.chaves_estrangeiras.length} FKs.`,
);
