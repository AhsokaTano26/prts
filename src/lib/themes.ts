export type ThemeId = 'rhodes' | 'rhine' | 'endfield'

export function parseTheme(value: unknown): ThemeId {
  return value === 'rhine' || value === 'endfield' ? value : 'rhodes'
}

/** Public presentation metadata shared by login, shell and installation UI. */
export const themeIdentity = {
  rhodes: {
    brand: 'PRTS',
    terminal: 'PERSONAL TERMINAL',
    index: 'WORKSPACE',
    status: 'SYSTEM OPERATIONAL',
    motto: '思绪有序，自由前行。',
    profile: '罗德岛 · 个人终端',
    workspace: '工作空间',
    footer: 'PERSONAL WORKSPACE',
    logo: '/branding/rhodes-island.png',
    icon: '/icons/rhodes-island-192.png',
    favicon: '/rhodes-island.svg',
    touchIcon: '/icons/rhodes-island-apple-180.png',
    manifest: '/manifest.webmanifest',
    colorScheme: 'dark',
    color: '#111315',
  },
  rhine: {
    brand: 'RHINE LAB',
    terminal: 'ANALYSIS OS',
    index: 'RESEARCH INDEX',
    status: 'RESEARCH IN PROGRESS',
    motto: '让好奇心，抵达更远。',
    profile: '莱茵生命 · 科研终端',
    workspace: '研究工作台',
    footer: 'RHINE LAB / ANALYSIS OS',
    logo: '/branding/rhine-lab.png',
    icon: '/icons/rhine-lab-192.png',
    favicon: '/icons/rhine-lab-192.png',
    touchIcon: '/icons/rhine-lab-180.png',
    manifest: '/manifest-rhine.webmanifest',
    colorScheme: 'light',
    color: '#f0f2ed',
  },
  endfield: {
    brand: 'ENDFIELD',
    terminal: 'INDUSTRIES',
    index: 'OPERATIONS',
    status: 'OPERATIONS ONLINE',
    motto: '开拓前路，构筑日常。',
    profile: '终末地 · 工业终端',
    workspace: '工业工作台',
    footer: 'ENDFIELD / INDUSTRIES',
    logo: '/branding/endfield.svg',
    icon: '/icons/endfield-192.png',
    favicon: '/icons/endfield-192.png',
    touchIcon: '/icons/endfield-180.png',
    manifest: '/manifest-endfield.webmanifest',
    colorScheme: 'light',
    color: '#ecece7',
  },
} as const
