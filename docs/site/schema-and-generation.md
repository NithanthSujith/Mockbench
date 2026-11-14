# Schema format and generation rules

Both ways of authoring a response, the visual builder and pasted JSON, produce one format called a **MockSchema**: a tree that describes a response and is turned into a body by a generator. It is a generation language, not JSON Schema.

## The format

A schema is an envelope with a root node:

```json
{
  "version": 1,
  "components": {},
  "root": {
    "type": "object",
    "fields": [
      { "key": "id", "node": { "type": "uuid" } },
      { "key": "name", "node": { "type": "string" } },
      { "key": "email", "node": { "type": "email" } },
      { "key": "role", "node": { "type": "string" } },
      { "key": "is_active", "node": { "type": "boolean" } },
      { "key": "branch_list", "node": { "type": "array", "count": 3, "items": { "type": "string" } } },
      {
        "key": "address",
        "node": {
          "type": "object",
          "fields": [
            { "key": "city", "node": { "type": "string" } },
            { "key": "pincode", "node": { "type": "integer" } }
          ]
        }
      },
      {
        "key": "orders",
        "node": {
          "type": "array",
          "count": 2,
          "items": {
            "type": "object",
            "fields": [
              { "key": "order_id", "node": { "type": "uuid" } },
              { "key": "total", "node": { "type": "number" } }
            ]
          }
        }
      }
    ]
  }
}
```

`fields` is an ordered list, so the output keeps your key order. The root can be any node type, so a bare array is a valid response.

### Node types

| Type | Extra attributes | Generates |
| --- | --- | --- |
| `string` | | `"<key>-<n>"` |
| `number` | `min`, `max` | a decimal |
| `integer` | `min`, `max` | an integer |
| `boolean` | | `true` / `false` |
| `null` | | `null` |
| `email` | | `"<key>-<n>@example.com"` |
| `uuid` | | a deterministic UUID v5 |
| `url` | | `"https://example.com/<key>-<n>"` |
| `phone` | | a `+91 90000 000nn` number |
| `date` | | `"YYYY-MM-DD"` |
| `datetime` | | ISO 8601 with a `+05:30` offset |
| `enum` | `values` | one of the values |
| `object` | `fields` (ordered list of `key` and `node`) | a nested object |
| `array` | `items` (a node), `count` (default 3) | a list |
| `ref` | `name` | whatever the named component generates |

Every node also accepts `description`, `nullable` (documentation only: generation never emits `null` because of it), `fixed` and `examples`.

- `fixed` is a literal that overrides generation entirely. It is detected by the key being present, so `""`, `0`, `false` and `null` are valid pins.
- `examples` is a pool of values cycled by position.
- Unknown keys on a node are kept and ignored. The `source` key is reserved for a future feature and is never interpreted.

### Components and `ref`

A component is a named node defined once at project level and used anywhere with `{ "type": "ref", "name": "User" }`, so `GET /users`, `GET /users/:id` and `POST /users` can share one shape. A reference to a missing component, or a cycle of references, is rejected.

### Limits

Depth at most 10, at most 2,000 nodes, `count` at most 1,000 per array, and at most 50,000 generated leaf values per response. A schema over a limit cannot be saved or published.

### Inferring from JSON

Pasting a JSON example builds a schema for you: a string that looks like an email, UUID, date, datetime or URL gets that type; a number without a fraction is an `integer`; an array is inferred from its first element with `count` set to the sample's length; key order is kept. It is a starting point: change `role` from `string` to `enum` yourself.

## Generation rules

One rule produces every value in the default mode: **`value = f(key, type, ordinal)`**, where the ordinal is the 1-based position of the nearest enclosing array element (1 outside any array). The same schema always produces the same body.

The point is legibility: `address.city` is `"city-1"`, so you can tell in a nested payload which field you are looking at.

The schema above generates:

```json
{
  "id": "<a uuid>",
  "name": "name-1",
  "email": "email-1@example.com",
  "role": "role-1",
  "is_active": true,
  "branch_list": ["branch_list-1", "branch_list-2", "branch_list-3"],
  "address": { "city": "city-1", "pincode": 1 },
  "orders": [
    { "order_id": "<a uuid>", "total": 1.5 },
    { "order_id": "<a uuid>", "total": 2.5 }
  ]
}
```

The ordinal increments per array element and flows into every field of that element, which is why `total` is `1.5` then `2.5`. An object that is not inside an array inherits the ordinal of whatever contains it.

| Type | Value at ordinal `n` |
| --- | --- |
| `string` | `<key>-<n>` |
| `email` | `<key>-<n>@example.com` |
| `url` | `https://example.com/<key>-<n>` |
| `integer` | starts at `min` (default 1) and counts up with the ordinal, stopping at `max` |
| `number` | `n + 0.5`, offset from `min` when set |
| `boolean` | `true` when `n` is odd |
| `enum` | `values[(n - 1) mod values.length]` |
| `uuid` | a UUID v5 derived from the project, the position in the schema and `n`: stable across restarts and republishing |
| `date` | a fixed base date plus `n` days |
| `datetime` | the same, at 00:00:00+05:30 |
| `phone` | `+91 90000 ` followed by `n` as five digits |
| `null` | `null` |

### Nested arrays and indexing

By default (`indexing: local`) an array inside an array element restarts its numbering: `users[2].tags` is `["tags-1", "tags-2"]`. With `indexing: path` the path is carried instead: `["users-2-tags-1", "users-2-tags-2"]`. Use `path` when values must be unique across the whole payload.

### Precedence

For each field the first of these that applies wins:

1. `fixed` on the node
2. a preset rule that matches the field
3. the node's `examples`, cycled by ordinal
4. `enum` values, cycled by ordinal
5. the per-type rule above

### Presets

A preset is a named, project-level list of rules. Each rule has a `match` (a field `key`, a `path` such as `$.address.city`, or a `type`; keys may use `*` globs) and exactly one of `value`, `values` (cycled by ordinal) or `pattern`. A pattern supports `{n}`, zero-padded `{n:05}` and `{key}`.

```json
{
  "name": "Shop defaults",
  "priority": 10,
  "rules": [
    { "match": { "key": "role" }, "values": ["admin", "manager", "viewer"] },
    { "match": { "key": "currency" }, "value": "EUR" },
    { "match": { "path": "$.address.city" }, "values": ["Berlin", "Lyon", "Porto"] },
    { "match": { "key": "*_id", "type": "string" }, "pattern": "ID-{n:05}" }
  ]
}
```

The most specific rule wins (an exact `path`, then a `key`, then a bare `type`); ties go to the higher preset `priority`, then the later rule. Only enabled presets are baked into a published version.

### Generation modes

| Mode | Behaviour | When the body is made |
| --- | --- | --- |
| `deterministic` (default) | The rules above | At publish; the server then sends a stored string |
| `seeded` | Realistic-looking words, names and numbers from built-in pools, drawn from a fixed seed so the output never changes | At publish |
| `random` | The same pools with a fresh random source on every request | On every request |

`random` makes assertions in a consumer's tests flaky and puts the generator on the request path. Prefer `deterministic`.
