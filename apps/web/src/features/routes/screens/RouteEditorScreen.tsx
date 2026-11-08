import { Card, PanelBody, PanelHead } from '../../../components/ui'
import { Editor, Response } from '../../../shell/columns'
import { ScreenStub } from '../../../shell/screen-stub'

// STUB (FND-13): replaced by BLD-05 (editor), with BLD-11 (preview) and BLD-12 (try-it) in the
// response column. Shown for both /routes/$routeId and /routes/$routeId/cases/$caseId.
export function RouteEditorScreen() {
  return (
    <>
      <Editor>
        <ScreenStub area="routes" name="RouteEditorScreen" unit="BLD-05" />
      </Editor>
      <Response>
        <Card data-screen="preview/ResponsePreview">
          <PanelHead>
            <h3>Response</h3>
          </PanelHead>
          <PanelBody className="text-control text-ink-2">
            Preview column stub (BLD-11, BLD-12).
          </PanelBody>
        </Card>
      </Response>
    </>
  )
}
