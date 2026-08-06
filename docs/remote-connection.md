# Secure remote connection

Factoru Server stays on loopback. To reach it from another machine, terminate
TLS with a trusted private overlay or reverse proxy on the server host and
forward only the Factoru HTTP/WebSocket endpoint to `127.0.0.1:8787`.

Server configuration:

```sh
FACTORU_HOST=127.0.0.1
FACTORU_PORT=8787
FACTORU_TRUST_PROXY=loopback
FACTORU_REPOSITORY_ROOTS='["/srv/repositories"]'
```

The proxy must:

- present a certificate trusted by the Mac running Factoru Desktop;
- forward normal HTTP requests and WebSocket upgrades;
- set the original protocol to `https` and preserve the original client IP;
- expose no Gas City supervisor/controller, dashboard, or Dolt port.

For example, an HTTPS-capable reverse proxy may route one dedicated hostname to
`127.0.0.1:8787`; WebSocket forwarding must remain enabled. A private overlay's
HTTPS serving feature may provide the same termination. Factoru deliberately
does not manage certificates in Milestone 2.

Create a ten-minute pairing code on the server:

```sh
factoru-server pair
```

In a source checkout, the equivalent after building is:

```sh
pnpm --filter @factoru/server start pair
```

Enter the HTTPS hostname and displayed code in Factoru Desktop. The code is
one-time; the issued device can later be revoked from **Trusted devices**.

Same-machine Desktop setup does not use a pairing code. Choose **This device**
in Desktop; Electron main discovers the running local Server through its private
restart-scoped enrollment file and creates the same revocable device credential
without exposing the proof to the renderer.

In a source checkout on macOS or Linux, install dependencies and start the local
Server with:

```sh
pnpm install
pnpm dev:server
```

The packaged Server installer and Desktop-managed local lifecycle are Milestone
7 work; the source-build instructions above are the currently implemented path.
