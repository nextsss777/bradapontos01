# Deploy com Netlify + Backend em tempo real

O dashboard precisa de um servidor Node com WebSocket. A Netlify sozinha nao mantém WebSocket ativo, entao use:

- Netlify: arquivos do site
- Render/Railway/VPS: `server.js`

## 1. Subir o backend no Render

1. Envie este projeto para um repositorio Git.
2. No Render, crie um novo **Web Service**.
3. Use estas configuracoes:
   - Root Directory: `Tela Bradesco Pontos`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check Path: `/health`
4. Depois do deploy, copie a URL do Render.

Exemplo:

```txt
https://bradesco-pontos-realtime.onrender.com
```

Para WebSocket, use a mesma URL com `wss://`:

```txt
wss://bradesco-pontos-realtime.onrender.com
```

## 2. Apontar a Netlify para o backend

Abra:

```txt
Tela Bradesco Pontos/realtime-config.js
```

Troque:

```js
window.BRADESCO_WS_URL = "";
```

Por:

```js
window.BRADESCO_WS_URL = "wss://bradesco-pontos-realtime.onrender.com";
```

## 3. Publicar na Netlify

O arquivo `netlify.toml` ja aponta o publish para:

```txt
Tela Bradesco Pontos
```

Depois disso, acesse:

```txt
https://seu-site.netlify.app/clientes.html
```

## Teste rapido

Abra o site em uma aba comum e o dashboard em outra:

- visitante: `https://seu-site.netlify.app/`
- dashboard: `https://seu-site.netlify.app/clientes.html`

O total de acessos e o online agora devem atualizar em tempo real.
