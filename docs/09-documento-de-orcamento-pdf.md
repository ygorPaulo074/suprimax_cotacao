# 9. Estrutura do Documento de Orçamento (PDF)


O PDF de orçamento gerado pelo sistema segue a estrutura abaixo.


| **Seção do documento** | **Informações exibidas** |
|---|---|
| **Cabeçalho — empresa emissora** | Nome da SupriMax, endereço completo, telefone, CNPJ e inscrição estadual. |
| **Cabeçalho — cliente e metadados** | Razão social do cliente, CNPJ, endereço, validade da proposta (30 dias), número sequencial do orçamento (no mínimo cinco dígitos, por exemplo 00001), data de emissão, contato, número da solicitação de compra, condição de pagamento e prazo de entrega. |
| **Corpo — tabela de produtos** | Item, código interno, NCM quando aplicável, descrição com marca e unidade, quantidade, preço unitário, valor do imposto (18%) destacado por item e valor total do item com imposto incluso. |
| **Rodapé — totalizadores e regras** | Valor total dos produtos, valor total de impostos, valor total da proposta com impostos inclusos, regra de frete aplicada (CIF ou FOB, com transportadora quando aplicável), aviso de faturamento mínimo e ressalva de análise de crédito. |
| **Rodapé — avisos e pagamento** | Dados bancários (PIX, agência e conta), instruções de pagamento, incluindo a condição de 100% adiantado na primeira compra ou 50%/50% em caso de crédito reprovado, aviso sobre flutuação de estoque e cláusula de consentimento LGPD. |
| **Anexos automáticos** | Arquivos anexados à cotação, como descritivos técnicos e materiais de apoio/marketing, conforme RF11. |
