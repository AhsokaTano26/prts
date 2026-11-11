export function stepNumberValue(
  value: string,
  direction: 1 | -1,
  options: {
    min?: string | number
    max?: string | number
    step?: string | number
  } = {},
): string {
  const minimum = options.min === undefined ? -Infinity : Number(options.min)
  const maximum = options.max === undefined ? Infinity : Number(options.max)
  const parsedStep = options.step === 'any' ? 0.000001 : Number(options.step ?? 1)
  const step = Number.isFinite(parsedStep) && parsedStep > 0 ? parsedStep : 1
  const base = Number.isFinite(minimum) ? minimum : 0
  const current = value.trim() ? Number(value) : NaN
  const clamp = (number: number) => Math.min(maximum, Math.max(minimum, number))
  if (!Number.isFinite(current)) return String(clamp(0))
  const position = (current - base) / step
  const tolerance = Math.min(0.000001, Number.EPSILON * Math.max(1, Math.abs(position)) * 8)
  const index =
    direction === 1 ? Math.floor(position + tolerance) + 1 : Math.ceil(position - tolerance) - 1
  const decimal = Math.min(12, Math.max(0, -Math.floor(Math.log10(step))) + 4)
  return String(clamp(Number((base + index * step).toFixed(decimal))))
}
