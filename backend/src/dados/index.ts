// Item 2 do backend/TAREFAS.md — camada de acesso a dados. Os demais módulos importam daqui, e
// nenhum deles fala com o proxy por outro caminho (RNF05).
export * from './consultas';
export * from './conversao';
export * from './lote';
export * from './proxyCliente';
export * from './traducaoDeErros';
