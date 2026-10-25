import type { PortraitId } from './appearance'

export const portraits: Record<
  PortraitId,
  { name: string; english: string; src: string; size: number }
> = {
  amiya: { name: '阿米娅', english: 'AMIYA', src: '/assets/amiya.png', size: 1024 },
  priestess: { name: '普瑞赛斯', english: 'PRIESTESS', src: '/assets/priestess.png', size: 1024 },
  kaltsit: { name: '凯尔希', english: 'KAL’TSIT', src: '/assets/kaltsit.png', size: 2048 },
}
