# Dashboard de Acessos (Demonstrativo)

Este projeto adiciona uma página `clientes.html` que mostra um dashboard em tempo real usando um servidor WebSocket local.

Requisitos:
- Node.js 14+ instalado

Como executar localmente:

1. Abra um terminal no diretório do projeto (onde está `package.json`).

2. Instale dependências:

```bash
npm install
```

3. Inicie o servidor:

```bash
npm start
```

4. Abra no navegador:

- `http://localhost:3000/index.html` para o site
- `http://localhost:3000/clientes.html` para o dashboard

Observações:
- O servidor guarda o total de visitas em `visits.json` no mesmo diretório.
- Este sistema é demonstrativo. Para uso em produção, adapte autenticação e segurança.
