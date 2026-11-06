Set-Location -LiteralPath 'C:\Users\RAFAEL_C\Documents\ChatGPT\Ecosistema'
$vercel = Join-Path (npm.cmd prefix -g) 'vercel.cmd'
Write-Host 'Cole o Access Token de PRODUCAO do Mercado Pago quando aparecer Value?.'
& $vercel env add MERCADO_PAGO_QUIOSQUE_ACCESS_TOKEN --environment production --scope r-sistemas --sensitive
Read-Host 'Pressione Enter para fechar'
