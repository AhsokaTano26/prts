export default function AppVersion() {
  const label = `当前版本：${__APP_VERSION__}`
  return (
    <span className="app-version" title={label} aria-label={label}>
      {__APP_VERSION__}
    </span>
  )
}
