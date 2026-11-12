import type { MockSchemaEnvelope, ResponseCase, Route } from '@mockbench/api-contract'
import type { MockSchema } from '@mockbench/schema-core'
import { Card, PanelHead } from '../../components/ui'
import { ResponsePreview } from '../preview/ResponsePreview'
import { SchemaBuilder } from '../schema-builder/SchemaBuilder'

// Mounting points owned by this unit and implemented by later ones. The editor passes everything
// they need; they replace these bodies without touching the editor.

/** BLD-07 fills this with the Builder tree; BLD-09 adds the JSON tab beside it. */
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
      <SchemaBuilder
        value={value as MockSchema}
        onChange={(schema) => onChange(schema as MockSchemaEnvelope)}
        readOnly={readOnly}
        sessionKey={caseId}
      />
    </Card>
  )
}

/** BLD-11 fills this with the live preview; BLD-12 adds the try-it card below it. */
export function PreviewSlot(props: { case: ResponseCase; route: Route }) {
  return <ResponsePreview case={props.case} route={props.route} />
}
