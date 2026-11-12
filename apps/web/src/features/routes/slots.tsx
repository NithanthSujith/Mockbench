import type { MockSchemaEnvelope, ResponseCase, Route } from '@mockbench/api-contract'
import { Card, PanelBody, PanelHead } from '../../components/ui'

// Mounting points owned by this unit and implemented by later ones. The editor passes everything
// they need; they replace these bodies without touching the editor.

/** BLD-07/09 replace this with the Builder / JSON tabs. */
export function SchemaEditorSlot({
  caseId,
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
      <PanelBody className="text-control text-ink-2">Schema editor (BLD-07, BLD-09).</PanelBody>
    </Card>
  )
}

/** BLD-11 (preview) and BLD-12 (try-it) replace this. */
export function PreviewSlot(props: { case: ResponseCase; route: Route }) {
  return (
    <Card data-screen="preview/ResponsePreview" data-case-id={props.case.id}>
      <PanelHead>
        <h3>Response</h3>
      </PanelHead>
      <PanelBody className="text-control text-ink-2">
        Preview column stub (BLD-11, BLD-12).
      </PanelBody>
    </Card>
  )
}
