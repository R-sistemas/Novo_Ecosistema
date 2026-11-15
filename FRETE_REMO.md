# Integração de frete Cardápio ↔ REMO

O Cardápio consulta a REMO pelo endpoint servidor `POST /api/cotar-frete`. A chave da REMO e a chave de serviço do Supabase ficam exclusivamente nas funções da Vercel. O navegador recebe somente o valor em centavos.

## Configuração necessária

Na Vercel do Cardápio, configure as variáveis de ambiente:

- `REMO_API_URL`: origem HTTPS do serviço REMO, sem `/api/v1` no final.
- `REMO_API_KEY`: mesma chave configurada como `CENTRAL_LOGISTICA_API_KEY` na REMO.
- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`: credenciais de servidor já usadas pelas funções privadas do Cardápio.

Na REMO, a empresa parceira precisa ter o campo **ID da loja na R Sistemas** preenchido com o UUID da linha da loja em `public.empresas`. A cobrança precisa estar habilitada e ter origem marcada no mapa. Para cotar fora do raio, configure `OSRM_URL` na REMO para que o serviço de rotas calcule os trechos viários.

Antes de testar checkout, aplique a migration `supabase/migrations/202611080041_frete_remo_checkout.sql` ao banco do Cardápio. Ela registra o frete em centavos na entrega e o soma ao total do pedido e ao valor associado ao pagamento na mesma transação.

## Fluxo

1. O Cardápio envia loja e endereço para `/api/cotar-frete`.
2. A função de servidor localiza o UUID da loja no Supabase e envia o destino à REMO usando a chave privada.
3. A REMO calcula e devolve o frete. O cliente vê a taxa e o total com entrega.
4. No checkout, o Cardápio solicita uma cotação nova. Se o valor divergir do exibido, o checkout pede confirmação novamente.
5. O Supabase salva `frete_centavos`, atualiza o total do pedido e, no Pix, o valor da cobrança. Repetições idempotentes não somam o frete outra vez.
