# Examples

Three exported projects and sample request bodies. Each `*.mockbench.json` is a complete project (settings, components, presets, routes and cases) in the export format of `docs/API-CONTRACT.md`.

| File                            | What it shows                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shop-api.mockbench.json`       | A `Product` component shared by several routes through `ref`, a preset (`sku` follows `SKU-00001`, `currency` is `EUR`), an empty-list case, a 404 and a 422 |
| `todo-api.mockbench.json`       | A small CRUD API with `indexing: path`, `POST`, `PATCH` and `DELETE`, a `204` delete with no body                                                            |
| `flaky-payments.mockbench.json` | Error cases for testing client code: `422` card declined, `429` with a `Retry-After` header, `503`, and a case with a 1.5 second delay                       |

`payloads/` holds request bodies to send with `curl --data @...`. Mockbench does not validate what you send; the files just make the calls realistic.

## Import one

Importing creates a new project, with new ids, in a workspace you can edit. It does not publish or deploy anything: publish a version and deploy it before calling the mock.

Import is the control-plane endpoint `POST /api/v1/projects/import`, which takes `{ workspaceId, document }` and optional `slug` and `name` overrides when the slug is taken. It needs a signed-in session cookie and an `X-Mockbench-Client` header on every write. The UI import button is a separate piece of work and is not available yet.

Once a project is imported, published and deployed, for example `todo-api`:

```sh
curl http://localhost:8080/mock/todo-api/todos
curl -X POST http://localhost:8080/mock/todo-api/todos -H 'Content-Type: application/json' --data @examples/payloads/create-todo.json
curl -i -X POST http://localhost:8080/mock/flaky-payments/charges -H 'X-Mock-Case: Rate limited' --data @examples/payloads/create-charge.json
```

The mock endpoints take no authentication: **keep Mockbench on a trusted private network.**
