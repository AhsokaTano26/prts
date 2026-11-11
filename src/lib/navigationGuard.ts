type NavigationGuard = (nextHash: string) => boolean
const guards = new Set<NavigationGuard>()

export function registerNavigationGuard(guard: NavigationGuard): () => void {
  guards.add(guard)
  return () => {
    guards.delete(guard)
  }
}

/** Ask mounted editors before the app unmounts the current route. */
export function allowWorkspaceNavigation(nextHash: string): boolean {
  for (const guard of guards) if (!guard(nextHash)) return false
  return true
}
