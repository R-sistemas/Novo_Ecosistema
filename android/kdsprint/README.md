# R Sistemas Cozinha para Android

Aplicativo separado do `DoRafaKDSPrint` legado. Abre o KDS publicado em
`https://novo-ecossistema.vercel.app/kds.html` e conecta a ponte JavaScript
`AndroidPrint` à impressora USB Bematech MP-4200 TH. O KDS aceita o pedido no
servidor e imprime uma via da cozinha ao tocar em **Iniciar preparo**. Falha de
impressão não cancela o preparo; o botão **Reimprimir pedido** exige confirmação.

O aplicativo funciona em celular ou tablet Android com USB host e conexão
física/OTG compatível. A Bematech requer autorização USB do Android na primeira
conexão. A versão atual não implementa modo quiosque nem pagamento PagBank.

## Diagnóstico sem criar pedidos

1. **Testar Bematech (APK → USB)** fica na barra inferior nativa. Funciona mesmo
   sem login e sem carregar o KDS. Se esta via não sair, verificar autorização,
   cabo/OTG e impressora antes de investigar o servidor.
2. Depois do login, **Testar KDS → APK → Bematech** imprime uma via identificada
   passando pela ponte JavaScript. Se o primeiro teste funcionar e este falhar,
   investigar a página/ponte. Nenhum teste cria pedido ou pagamento.
3. Por fim, aceitar um pedido real de teste no KDS e confirmar a impressão da
   comanda. O retorno de bytes não prova que o papel saiu: conferir a via física.

## Compilação

Com Android SDK 34 e JDK 17 instalados: `./gradlew :app:assembleDebug`.
O APK de teste aparece em `app/build/outputs/apk/debug/`. O workflow do GitHub
Actions também produz um artefato de teste. A publicação final requer
assinatura própria e teste físico de impressão antes de distribuir o APK.
