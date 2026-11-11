import { test, expect, waitSaved } from './fixture'
import { createPlace } from '../../src/lib/places'

test.use({ reducedMotion: 'reduce', serviceWorkers: 'block' })
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('prts-boot-seen', '1'))
  expect(
    (
      await page.request.post('/api/auth/login', {
        data: { password: 'prts-e2e-test-password-only' },
      })
    ).ok(),
  ).toBe(true)
  await page.goto('/#places')
})

test('地点收藏支持新增、再访、刷新、归档和日程快照', async ({ page }) => {
  await expect(page.getByRole('heading', { name: '想去', exact: true })).toBeVisible({
    timeout: 2000,
  })
  await page.getByRole('button', { name: '添加地点', exact: true }).click()
  const form = page.getByRole('dialog', { name: '添加地点', exact: true })
  await form.getByLabel('地点名称', { exact: true }).fill('河畔饭馆 · 江边店')
  await form.getByLabel('城市', { exact: true }).fill('成都')
  await form.getByLabel('收藏理由', { exact: true }).fill('想吃砂锅；周末提前预约。')
  await form.getByRole('button', { name: '保存地点', exact: true }).click()
  await expect(form).toHaveCount(0)
  await waitSaved(page)
  await page.getByRole('link', { name: '河畔饭馆 · 江边店', exact: true }).click()
  await expect(page.locator('.place-detail')).toContainText('想吃砂锅')
  await page.getByRole('button', { name: '记录去过', exact: true }).click()
  const visit = page.getByRole('dialog', { name: '记录到访', exact: true })
  await visit.getByLabel('这次的体验', { exact: true }).fill('砂锅很好，下次再来。')
  await visit.getByRole('button', { name: '保存到访', exact: true }).click()
  await waitSaved(page)
  await expect(page.locator('.place-detail')).toContainText('砂锅很好')
  await page.getByRole('switch', { name: '还想再去', exact: true }).click()
  await waitSaved(page)
  await page.reload()
  await expect(page.locator('.place-detail')).toContainText('想再去')
  await page.getByRole('button', { name: '创建日程', exact: true }).click()
  const event = page.getByRole('dialog', { name: '新建日程', exact: true })
  await expect(event.getByLabel('日程标题', { exact: true })).toHaveValue('河畔饭馆 · 江边店')
  await event.getByRole('button', { name: '创建日程', exact: true }).click()
  await waitSaved(page)
  await page.getByRole('button', { name: '归档地点', exact: true }).click()
  await waitSaved(page)
  await expect(page.locator('.place-detail')).toContainText('已归档')
  await page.getByRole('button', { name: '恢复地点', exact: true }).click()
  await waitSaved(page)
  const state = (await (await page.request.get('/api/state')).json()).documents.workspace.value
  expect(state.places).toHaveLength(1)
  expect(state.places[0].visits[0].note).toBe('砂锅很好，下次再来。')
  expect(state.calendarEvents.some((e: { title: string }) => e.title === '河畔饭馆 · 江边店')).toBe(
    true,
  )
})

test('地点地图未配置时提供设置入口，手机和主题保持可操作', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('button', { name: '地图视图', exact: true }).click()
  await expect(page.getByText('配置天地图后查看地点分布', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '配置地图服务', exact: true })).toHaveAttribute(
    'href',
    '#settings/maps',
  )
  const workspace = (await (await page.request.get('/api/state')).json()).documents.workspace
  await page.request.put('/api/state/workspace', {
    data: {
      value: {
        ...workspace.value,
        places: [
          createPlace({
            id: 'river',
            name: '河畔饭馆 · 江边店',
            city: '成都',
            district: '锦江区',
            type: 'restaurant',
            desire: 'high',
            address: '河畔路 18 号',
            tags: ['适合聚餐', '需预约'],
            note: '想试试砂锅。周末去之前，记得提前订位。',
            budget: '人均约 80 元',
          }),
          createPlace({
            id: 'books',
            name: '山间书屋',
            city: '成都',
            type: 'shop',
            tags: ['周末', '独自去'],
            note: '找一个安静的下午，读几页喜欢的书。',
          }),
        ],
      },
      expectedRevision: workspace.revision,
      mutationId: 'places-visual-fixture',
    },
  })
  for (const theme of ['rhodes', 'rhine', 'endfield']) {
    const preferences = (await (await page.request.get('/api/state')).json()).documents.preferences
    const themeSaved = await page.request.put('/api/state/preferences', {
      data: {
        value: {
          ...preferences.value,
          appearance: { portrait: 'amiya', ...preferences.value.appearance, theme },
        },
        expectedRevision: preferences.revision,
        mutationId: `places-theme-${theme}`,
      },
    })
    expect(themeSaved.ok()).toBe(true)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await page.getByRole('button', { name: '清单视图', exact: true }).click()
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width > 600 ? 1000 : 844 })
      expect(
        await page.locator('.places-page').evaluate((e) => e.scrollWidth > e.clientWidth),
      ).toBe(false)
      await page.screenshot({ path: `/tmp/prts-places-${theme}-${width}.png`, fullPage: true })
    }
    await page.getByRole('link', { name: '河畔饭馆 · 江边店', exact: true }).click()
    await page.screenshot({ path: `/tmp/prts-places-detail-${theme}-320.png`, fullPage: true })
    await page.getByRole('button', { name: '返回清单', exact: true }).click()
  }
  expect(errors).toEqual([])
})

test('地图选点在地点表单内搜索，不会误提交收藏，并保留选点坐标', async ({ page }) => {
  // Replace only the third-party SDK boundary; exercise the real form and map component.
  await page.route('https://api.tianditu.gov.cn/api?**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
    (() => {
    window.TMAP_AUTHKEY = new URL(document.currentScript.src).searchParams.get('tk');
    window.TMAP_NORMAL_MAP = 'vector'; window.TMAP_HYBRID_MAP = 'satellite';
    class LngLat { constructor(lng,lat) { this.lng=lng;this.lat=lat } getLng(){return this.lng} getLat(){return this.lat} }
    class Map { constructor(el){this.el=el;this.z=10} centerAndZoom(p,z){this.z=z} setMapType(){} addEventListener(){} removeEventListener(){} checkResize(){} clearOverLays(){} setViewport(){} panTo(){} getZoom(){return this.z} setZoom(z){this.z=z} addOverLay(m){this.el.appendChild(m.el)} removeOverLay(m){m.el.remove()} }
    class Marker { constructor(p,opts){this.el=document.createElement('button');this.el.type='button';this.el.textContent=opts.title} getElement(){return this.el} addEventListener(n,f){this.el.addEventListener(n,f)} removeEventListener(n,f){this.el.removeEventListener(n,f)} }
    class LocalSearch { constructor(map,opts){this.opts=opts} search(){this.opts.onSearchComplete({getPois:()=>[{name:'测试河畔饭馆',address:'河畔路 18 号',lonlat:'104.0665,30.5723'}]})} clearResults(){} setSearchCompleteCallback(cb){this.opts.onSearchComplete=cb} }
    window.T={Map,LngLat,Marker,LocalSearch};
    })();
  `,
    }),
  )
  const preferences = (await (await page.request.get('/api/state')).json()).documents.preferences
  await page.request.put('/api/state/preferences', {
    data: {
      value: {
        ...preferences.value,
        map: {
          apiKey: '0123456789abcdef0123456789abcdef',
          center: { lng: 104, lat: 35 },
          zoom: 4,
          layer: 'vector',
        },
      },
      expectedRevision: preferences.revision,
      mutationId: 'places-map-pick-config',
    },
  })
  await page.reload()
  await page.getByRole('button', { name: '添加地点', exact: true }).click()
  const form = page.getByRole('dialog', { name: '添加地点', exact: true })
  await form.getByLabel('地点名称', { exact: true }).fill('河畔饭馆')
  await form.getByRole('button', { name: '补充更多信息', exact: true }).click()
  await form.getByRole('button', { name: '在天地图选点', exact: true }).click()
  const search = form.getByLabel('在天地图搜索地点', { exact: true })
  await expect(search).toBeEnabled()
  await search.fill('成都 河畔饭馆')
  await search.press('Enter')
  await form.getByRole('button', { name: /测试河畔饭馆.*选用/ }).click()
  await expect(form.getByLabel('经度', { exact: true })).toHaveValue('104.066500')
  await expect(form).toBeVisible()
  await form.getByRole('button', { name: '保存地点', exact: true }).click()
  await waitSaved(page)
  const workspace = (await (await page.request.get('/api/state')).json()).documents.workspace.value
  expect(workspace.places).toHaveLength(1)
  expect(workspace.places[0].coordinates).toEqual({ lng: 104.0665, lat: 30.5723 })
  await page.getByRole('button', { name: '记录去过', exact: true }).click()
  await page.getByRole('button', { name: '保存到访', exact: true }).click()
  await waitSaved(page)
  await page.getByRole('button', { name: '在地图中查看', exact: true }).click()
  await expect(page.getByRole('tab', { name: /^全部/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: '查看地点：河畔饭馆', exact: true })).toBeVisible()
})

test('未保存地点的 Esc 和切换模块会保留草稿，409 不显示成功或丢失输入', async ({ page }) => {
  await page.getByRole('button', { name: '添加地点', exact: true }).click()
  const form = page.getByRole('dialog', { name: '添加地点', exact: true })
  await form.getByLabel('地点名称', { exact: true }).fill('未保存的饭馆')
  await page.keyboard.press('Escape')
  await expect(form.getByText('还有未保存的修改，是否放弃？', { exact: true })).toBeVisible()
  await form.getByRole('button', { name: '继续编辑', exact: true }).click()
  await page.evaluate(() => {
    location.hash = 'tasks'
  })
  await expect(form.getByText('还有未保存的修改，是否放弃？', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/#places/)
  await form.getByRole('button', { name: '继续编辑', exact: true }).click()
  await page.route('**/api/state/workspace', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: '另一个页面修改了工作台，请先保留草稿。' }),
    }),
  )
  await form.getByRole('button', { name: '保存地点', exact: true }).click()
  await expect(form.getByLabel('地点名称', { exact: true })).toHaveValue('未保存的饭馆')
  await expect(form.getByRole('alert').filter({ hasText: '保存未完成' })).toBeVisible()
  await expect(page.getByText('已添加到想去', { exact: true })).toHaveCount(0)
  const state = (await (await page.request.get('/api/state')).json()).documents.workspace.value
  expect(state.places).toEqual([])
})
