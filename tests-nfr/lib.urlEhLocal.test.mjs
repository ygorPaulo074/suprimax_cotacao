import assert from 'node:assert/strict';
import { urlEhLocal } from './lib.mjs';

const aceitos = [
  'postgresql://u:p@localhost:5432/db',
  'postgresql://u:p@127.0.0.1:5432/db',
  'postgresql://u:p@[::1]:5432/db',
];
const recusados = [
  'postgresql://u:p@localhost.exemplo.com:5432/db',
  'postgresql://u:p@x.supabase.co:5432/db',
  'postgresql://u:p@db.exemplo.com:5432/localhost',
  'postgresql://localhost:senha@db.exemplo.com:5432/db',
  'postgresql://u:p@127.0.0.1.exemplo.com:5432/db',
  'isto nao e url',
];
for (const u of aceitos) assert.equal(urlEhLocal(u), true, `deveria aceitar ${u}`);
for (const u of recusados) assert.equal(urlEhLocal(u), false, `deveria recusar ${u}`);
console.log('urlEhLocal: ok');
