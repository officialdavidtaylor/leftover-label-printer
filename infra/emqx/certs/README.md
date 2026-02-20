# EMQX TLS Certs

Place broker TLS assets in this directory when `EMQX_REQUIRE_TLS=true`.

Expected default files:

1. `ca.crt`
2. `server.crt`
3. `server.key`

You can override file names via `EMQX_TLS_CA_CERT_FILE`, `EMQX_TLS_CERT_FILE`, and `EMQX_TLS_KEY_FILE` in `infra/.env`.
