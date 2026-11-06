Set-Location -LiteralPath 'C:\Users\RAFAEL_C\Documents\ChatGPT\Ecosistema'
$vercel = Join-Path (npm.cmd prefix -g) 'vercel.cmd'
& $vercel env add MERCADO_PAGO_TEST_ACCESS_TOKEN --environment production --scope r-sistemas
if ($LASTEXITCODE -eq 0) {
    Write-Host 'Agora cole somente a assinatura secreta do webhook de TESTE.'
    & $vercel env add MERCADO_PAGO_TEST_WEBHOOK_SECRET --environment production --scope r-sistemas
}
Read-Host 'Pressione Enter para fechar'
