Set-Location -LiteralPath 'C:\Users\RAFAEL_C\Documents\ChatGPT\Ecosistema'
$segredo = Read-Host 'Cole o Access Token de TESTE do Mercado Pago' -AsSecureString
try {
    $env:MERCADO_PAGO_TEST_ACCESS_TOKEN = [System.Net.NetworkCredential]::new('', $segredo).Password.Trim()
    node .\mercado-pago-sandbox.mjs
} finally {
    Remove-Item Env:MERCADO_PAGO_TEST_ACCESS_TOKEN -ErrorAction SilentlyContinue
    $segredo.Dispose()
}
Read-Host 'Pressione Enter para fechar'
