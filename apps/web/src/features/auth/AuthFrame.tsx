import type { ReactNode } from 'react'
import { Card, PanelBody } from '../../components/ui'
import { BrandMark } from '../../shell/brand'

/** The centred login card from the prototype (.login / .loginbox). */
export function AuthFrame({
  screen,
  subtitle,
  children,
}: {
  screen: string
  subtitle: ReactNode
  children: ReactNode
}) {
  return (
    <div data-screen={screen} className="grid min-h-[70vh] place-items-center px-4 py-10">
      <div className="w-full max-w-92">
        <div className="mb-1.5 flex items-center gap-2 text-title font-bold tracking-tight text-ink">
          <BrandMark />
          Mockbench
        </div>
        <p className="mb-4.5 mt-0 text-control text-ink-2">{subtitle}</p>
        <Card>
          <PanelBody className="p-4">{children}</PanelBody>
        </Card>
      </div>
    </div>
  )
}
