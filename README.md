# Kuro Sushi — Cardápio online

Aplicação em HTML, Tailwind CSS 3, JavaScript com módulos ES e um servidor Node.js leve, pensada primeiro para smartphones e atendimento no salão.

A direção visual parte de um cardápio de balcão: papel claro texturizado, tinta verde escura, vermelho de carimbo, títulos condensados e pratos numerados. A abertura usa uma fotografia inclinada e composição assimétrica; o catálogo combina um prato em destaque com entradas em lista. As fontes têm alternativas locais e não exigem carregamento externo.

## Executar

Com Node.js 20 ou superior instalado:

```sh
npm start
```

Acesse **http://localhost:3000**. Para identificar a mesa diretamente pelo QR Code, use `http://localhost:3000/?mesa=12`, trocando o número para cada mesa. O painel operacional da equipe fica em **http://localhost:3000/equipe.html**.

## Personalizar

- **`data/config.json`**: nome, moeda e dados gerais do restaurante.
- **`data/config.json > rodizio`**: ativa a modalidade, define o valor por pessoa e informa quais categorias estão incluídas. Bebidas permanecem fora do rodízio por padrão.
- **`data/products.json`**: categorias, produtos e adicionais. Os preços são números em reais (`29.9`), sem símbolo ou vírgula. Cada produto referencia uma categoria e os IDs dos adicionais permitidos. `conflictsWith` impede combinações contraditórias, como retirar e adicionar cream cheese.
- **`src/styles.css`**: estilos originais e diretivas Tailwind. As classes utilitárias usadas no HTML são compiladas localmente.
- **`index.html`**: marca, textos institucionais e estrutura da página. Para alterar a marca, ajuste também o título, rodapé e textos aqui.

Para alterar e compilar os estilos:

```sh
npm install
npm run build:css
```

## Comportamento

- Navegação integrada entre Cardápio, Meu pedido e Atendimento, com identificação persistente da mesa.
- Escolha entre à la carte e rodízio, com quantidade de pessoas, itens inclusos e adicionais cobrados separadamente.
- Categorias com rolagem horizontal e posição fixa durante a rolagem; busca em todo o catálogo, tolerante a acentos.
- Modal com ingredientes opcionais, adicionais pagos, observações e quantidade.
- Carrinho persistido no navegador, com agrupamento de itens de personalização idêntica. Quantidade máxima: 99 por variação.
- Botão flutuante exibe quantidade e subtotal; taxa de entrega e total aparecem no checkout.
- Envio direto do pedido da mesa para a fila da cozinha, com forma de pagamento e observações.
- Chamadas de garçom e solicitações de conta pelo próprio cardápio.
- Painel da equipe com filtros, atualização automática e mudança de status dos atendimentos.
- Teclado, foco, rótulos acessíveis, Escape para fechar modais e preferência por movimento reduzido.
- Imagem local de fallback se uma foto externa não carregar.

O catálogo, os valores, a taxa e os prazos são **demonstrativos**. As fotos são ilustrações externas hospedadas no Unsplash e podem não representar exatamente o produto. Substitua por fotos próprias em `assets/` antes do lançamento. Os textos de marca também são editáveis.

## Verificação

```sh
npm install
npm test
```

Os testes cobrem cálculos em centavos, personalizações, restauração do carrinho e o fluxo de mesa, pedido e atendimento em DOM simulado.

## Publicação

Execute o `server.js` em um ambiente Node.js acessível pela rede do restaurante. O catálogo e o painel precisam usar a mesma origem para compartilhar a fila de atendimento.

Os eventos ficam persistidos em `.runtime/restaurant-events.json`. Para uso em produção, proteja o painel da equipe com autenticação, use HTTPS, faça backups e substitua o arquivo local por um banco de dados adequado ao volume do restaurante. Esta versão não processa pagamentos.
