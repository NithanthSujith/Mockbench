import type { MockSchemaEnvelope, ResponseCase, Route } from '@mockbench/api-contract'
import type { MockSchema } from '@mockbench/schema-core'
import { Card, PanelHead } from '../../components/ui'
import { ResponsePreview } from '../preview/ResponsePreview'
import { SchemaEditor } from '../schema-builder/SchemaEditor'
import { TryItPanel } from '../try-it/TryItPanel'

// Mounting points owned by this unit and implemented by later ones. The editor passes everything
// they need; they replace these bodies without touching the editor.

/** The Builder tree (BLD-07) and the JSON tab (BLD-09). */
export function SchemaEditorSlot({
  caseId,
  value,
  onChange,
  readOnly,
}: {
  caseId: string
  value: MockSchemaEnvelope
  onChange: (value: MockSchemaEnvelope) => void
  readOnly?: boolean
}) {
  return (
    <Card data-screen="schema-builder/SchemaEditorSlot" data-case-id={caseId}>
      <PanelHead>
        <h3>Response body</h3>
      </PanelHead>
      <SchemaEditor
        value={value as MockSchema}
        onChange={(schema) => onChange(schema as MockSchemaEnvelope)}
        readOnly={readOnly}
        sessionKey={caseId}
      />
    </Card>
  )
}

/** The live preview (BLD-11) with the try-it card (BLD-12) below it. */
export function PreviewSlot(props: { case: ResponseCase; route: Route }) {
  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <ResponsePreview case={props.case} route={props.route} />
      <TryItPanel key={props.case.id} case={props.case} route={props.route} />
    </div>
  )
}
