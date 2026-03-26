/**
 * Field — reusable form field wrapper.
 *
 * Usage:
 *   <Field label="Voornaam" required hint="Officiële naam op visitekaartje">
 *     <Input name="first_name" placeholder="Thomas" />
 *   </Field>
 *
 *   <Field label="Type" error={errors.type}>
 *     <Select .../>
 *   </Field>
 */

import { cn } from '@/lib/utils'

interface FieldProps {
  label?:    React.ReactNode
  hint?:     string
  error?:    string | null
  required?: boolean
  className?: string
  children:  React.ReactNode
}

export function Field({ label, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label className="text-[13px] font-semibold text-primary tracking-[0.01em] flex items-center flex-wrap gap-1">
          {label}
          {required && <span className="text-red-500">*</span>}
        </label>
      )}
      {children}
      {hint && !error && (
        <p className="text-xs text-muted leading-relaxed">{hint}</p>
      )}
      {error && (
        <p className="text-xs text-red-500 leading-relaxed">{error}</p>
      )}
    </div>
  )
}

/**
 * TwoCol — responsive two-column grid for fields.
 * Stacks to single column on narrow screens.
 */
export function TwoCol({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 max-sm:grid-cols-1', className)}>
      {children}
    </div>
  )
}

/**
 * FieldSection — titled group of fields inside a card.
 */
export function FieldSection({
  title, icon, children, className,
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('px-5 py-4 border-b border-border last:border-b-0 flex flex-col gap-3', className)}>
      {(title || icon) && (
        <div className="flex items-center gap-1.5">
          {icon && <span className="text-primary/70 flex">{icon}</span>}
          <span className="text-[11px] font-extrabold text-primary uppercase tracking-[0.06em]">
            {title}
          </span>
        </div>
      )}
      {children}
    </div>
  )
}
