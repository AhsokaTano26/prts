import '../styles/prts-picker.css'

export default function PrtsSwitch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      className="prts-switch-row"
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
    >
      <span className="prts-switch-copy">
        <span>{label}</span>
        {description && <small>{description}</small>}
      </span>
      <span className="prts-switch-track" aria-hidden="true">
        <span />
      </span>
    </button>
  )
}
