# FB Group Collector

## Exportar IDs e nomes dos seus grupos

1. No Chrome, abra `chrome://extensions`, ative **Modo do desenvolvedor** e escolha **Carregar sem compactação**. Selecione esta pasta.
2. Entre no Facebook e escolha o perfil ou a Página correta. A lista de grupos pode mudar conforme a identidade ativa.
3. Abra a extensão, clique **Abrir lista de grupos**, espere a página carregar e clique **Coletar esta lista**.
4. Deixe a aba aberta enquanto a extensão rola a lista e tenta resolver IDs de URLs com nome curto. Abra o popup novamente para acompanhar a contagem.
5. Quando aparecer **Concluído**, clique **Baixar grupos em JSON**.

O arquivo é salvo na subpasta configurada no popup, relativa à pasta de downloads do Chrome. O padrão é `burning-man-matchbot/data/raw/facebook/`.

O arquivo é uma lista JSON, por exemplo:

```json
[
  {"id": "123456789012345", "name": "Meu grupo", "url": "https://www.facebook.com/groups/123456789012345/"}
]
```

IDs são strings para preservar todos os dígitos. Se nem a lista nem a página do grupo expuserem o ID numérico, o registro terá `"id": null`. O popup mostra quantos ficaram sem ID. A extensão coleta os grupos carregados na lista da identidade selecionada; o Facebook pode mudar a interface ou limitar o que essa lista mostra. Ela não envia a lista a um servidor externo.

O coletor de posts existente continua disponível na parte inferior do popup.
