import type { Change, SchemaChange, VersionDiff } from '@mockbench/api-contract'
import { MethodBadge } from '../../components/ui'

// RUN-10: renders a VersionDiff. Added = good, removed = bad, changed = warn (theme tokens only).

type Method = VersionDiff['routes']['added'][number]['method']

const MARK = {
  added: { sign: '+', cls: 'text-good', label: 'Added' },
  removed: { sign: '-', cls: 'text-bad', label: 'Removed' },
  changed: { sign: '~', cls: 'text-warn', label: 'Changed' },
} as const
type Kind = keyof typeof MARK

const show = (v: unknown): string => (v === undefined ? '' : JSON.stringify(v))

function Marker({ kind }: { kind: Kind }) {
  const m = MARK[kind]
  return (
    <span
      className={`mono inline-block w-4 shrink-0 text-center font-semibold ${m.cls}`}
      title={m.label}
      aria-label={m.label}
    >
      {m.sign}
    </span>
  )
}

function Row({ kind, children }: { kind: Kind; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <Marker kind={kind} />
      {children}
    </li>
  )
}

function Fields({ changes }: { changes: Change[] }) {
  return (
    <>
      {changes.map((c) => (
        <Row key={c.field} kind="changed">
          <span className="mono">{c.field}</span>
          <span className="mono text-bad">{show(c.before)}</span>
          <span aria-hidden="true">{'->'}</span>
          <span className="mono text-good">{show(c.after)}</span>
        </Row>
      ))}
    </>
  )
}

function SchemaRows({ changes }: { changes: SchemaChange[] }) {
  return (
    <>
      {changes.map((c) => (
        <Row key={c.path} kind={c.kind}>
          <span className="mono">{c.path}</span>
          {c.before !== undefined ? <span className="mono text-bad">{show(c.before)}</span> : null}
          {c.before !== undefined && c.after !== undefined ? (
            <span aria-hidden="true">{'->'}</span>
          ) : null}
          {c.after !== undefined ? <span className="mono text-good">{show(c.after)}</span> : null}
        </Row>
      ))}
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="m-0 text-small font-semibold text-ink-2">{title}</h4>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-control">{children}</ul>
    </section>
  )
}

function NameSection({
  title,
  diff,
}: {
  title: string
  diff: { added: string[]; removed: string[]; changed: string[] }
}) {
  if (!diff.added.length && !diff.removed.length && !diff.changed.length) return null
  return (
    <Section title={title}>
      {(['added', 'removed', 'changed'] as const).flatMap((kind) =>
        diff[kind].map((name) => (
          <Row key={`${kind}:${name}`} kind={kind}>
            <span className="mono">{name}</span>
          </Row>
        )),
      )}
    </Section>
  )
}

function RouteLabel({ method, path }: { method: Method; path: string }) {
  return (
    <>
      <MethodBadge method={method} />
      <span className="mono">{path}</span>
    </>
  )
}

export function isEmptyDiff(d: VersionDiff): boolean {
  const { added, removed, changed } = d.routes
  const names = (n: VersionDiff['components']) =>
    n.added.length + n.removed.length + n.changed.length
  return (
    d.settings.length === 0 &&
    names(d.components) === 0 &&
    names(d.presets) === 0 &&
    added.length + removed.length + changed.length === 0
  )
}

export function DiffView({ diff }: { diff: VersionDiff }) {
  if (isEmptyDiff(diff)) {
    return <p className="m-0 text-small text-ink-3">No differences</p>
  }
  const { routes } = diff
  return (
    <div className="flex flex-col gap-4">
      {routes.added.length + routes.removed.length + routes.changed.length > 0 ? (
        <Section title="Routes">
          {routes.added.map((r) => (
            <Row key={`a:${r.method} ${r.path}`} kind="added">
              <RouteLabel {...r} />
            </Row>
          ))}
          {routes.removed.map((r) => (
            <Row key={`r:${r.method} ${r.path}`} kind="removed">
              <RouteLabel {...r} />
            </Row>
          ))}
          {routes.changed.map((r) => (
            <li key={`c:${r.method} ${r.path}`}>
              <details>
                <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2">
                  <Marker kind="changed" />
                  <RouteLabel method={r.method} path={r.path} />
                </summary>
                <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 pl-6">
                  <Fields changes={r.fields} />
                  {r.cases.added.map((c) => (
                    <Row key={`ca:${c.name}`} kind="added">
                      <span>{c.name}</span>
                      <span className="mono text-ink-3">{c.statusCode}</span>
                    </Row>
                  ))}
                  {r.cases.removed.map((c) => (
                    <Row key={`cr:${c.name}`} kind="removed">
                      <span>{c.name}</span>
                      <span className="mono text-ink-3">{c.statusCode}</span>
                    </Row>
                  ))}
                  {r.cases.changed.map((c) => (
                    <li key={`cc:${c.name}`}>
                      <details>
                        <summary className="flex cursor-pointer items-baseline gap-x-2">
                          <Marker kind="changed" />
                          <span>{c.name}</span>
                        </summary>
                        <ul className="m-0 mt-1 flex list-none flex-col gap-1 pl-6">
                          <Fields changes={c.fields} />
                          <SchemaRows changes={c.schema} />
                        </ul>
                      </details>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </Section>
      ) : null}
      {diff.settings.length > 0 ? (
        <Section title="Settings">
          <Fields changes={diff.settings} />
        </Section>
      ) : null}
      <NameSection title="Presets" diff={diff.presets} />
      <NameSection title="Components" diff={diff.components} />
      <p className="m-0 text-small text-ink-3">Renames show as remove + add</p>
    </div>
  )
}
