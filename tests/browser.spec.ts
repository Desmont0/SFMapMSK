import { test, expect, type Page } from '@playwright/test';
test.beforeEach(async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  (page as any).runtimeErrors=errors;
});
test.afterEach(async({page})=>{expect((page as any).runtimeErrors).toEqual([]);});

async function mapStyle(page:Page){
  await page.route('**/map-cache/styles/*',route=>route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#26382e'}}]}}));
}
async function entries(page:Page){return (await (await page.request.get('/api/participants')).json()).participants as Array<{id:string;name:string;shareId:string;kind:string}>;}

test('direct links hide person coordinate controls, highlight selection and copy place coordinates',async({page})=>{
  await mapStyle(page);const records=await entries(page),person=records.find(p=>p.kind==='person')!;
  await page.addInitScript(()=>{
    (window as any).copied=[];(window as any).shareCalls=0;
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value:string)=>(window as any).copied.push(value)}});
    Object.defineProperty(navigator,'share',{value:async()=>{(window as any).shareCalls++;}});
    // Older Safari must work without this newer convenience API.
    Object.defineProperty(AbortSignal,'timeout',{value:undefined});
  });
  await page.goto('/p/'+person.shareId);
  const card=page.getByRole('article',{name:'Участник '+person.name});await expect(card).toBeVisible();
  // A cold WebKit software renderer in Linux CI can need more than five seconds.
  // Still require successful initialization before the map's 20-second watchdog.
  await expect(page.getByRole('button',{name:'Приблизить карту',exact:true})).toBeEnabled({timeout:15000});
  await card.getByRole('button',{name:'Поделиться',exact:true}).click();
  await expect(card.getByRole('status')).toHaveText('Ссылка скопирована');
  expect(await page.evaluate(()=>(window as any).copied[0])).toBe('http://127.0.0.1:18765/p/'+person.shareId);
  expect(await page.evaluate(()=>(window as any).shareCalls)).toBe(0);
  await expect(card.locator('.public-comment a')).toHaveAttribute('href','https://example.com/test');
  await expect(card.locator('.public-comment img')).toHaveCount(0);
  await expect(card.locator('.public-comment')).toContainText('<img src=x');
  await expect(card.locator('.coordinate-actions')).toHaveCount(0);
  await expect(card.getByRole('link',{name:'Навигация ↗'})).toHaveCount(0);
  const selected=page.locator('.maplibregl-marker.is-selected');
  await expect(selected).toHaveCount(1);await expect(selected).toHaveAttribute('data-entry-id',person.id);
  await expect(selected).toHaveAttribute('aria-pressed','true');await expect(selected).toHaveCSS('outline-style','solid');
  await page.screenshot({path:'test-results/'+test.info().project.name+'-selected-dark.png'});
  await page.getByRole('button',{name:'Включить светлую тему'}).click();
  await expect(selected).toHaveAttribute('data-entry-id',person.id);
  await expect(selected).toHaveCSS('outline-color','rgb(169, 88, 6)');
  await page.screenshot({path:'test-results/'+test.info().project.name+'-selected-light.png'});
  await card.getByRole('button',{name:'Закрыть карточку'}).click();await expect(selected).toHaveCount(0);
  const garage=records.find(p=>p.kind==='garage')!;await page.goto('/p/'+garage.shareId);
  await expect(page.locator('.place-owner a')).toHaveAttribute('href','/p/'+person.shareId);
  await page.getByRole('button',{name:/55.850000, 37.500000/}).click();
  expect(await page.evaluate(()=>(window as any).copied.at(-1))).toBe('55.850000, 37.500000');
  await expect(page.getByRole('link',{name:'Навигация ↗'})).toHaveAttribute('href',/pt=37.5,55.85/);
  await expect(selected).toHaveAttribute('data-entry-id',garage.id);
  await page.getByRole('button',{name:'Закрыть карточку'}).click();await expect(selected).toHaveCount(0);
  const search=page.getByRole('textbox',{name:'Поиск по госномеру, имени или месту'});
  await search.fill(person.name);await page.locator('#plate-results').getByRole('button').click();
  await expect(selected).toHaveAttribute('data-entry-id',person.id);await expect(card).toBeVisible();
  for(const kind of ['service','meetup']){
    const place=records.find(p=>p.kind===kind)!;await page.goto('/p/'+place.shareId);
    await expect(page.getByRole('button',{name:/55.700000, 37.800000/})).toBeVisible();
    await expect(page.getByRole('link',{name:'Навигация ↗'})).toHaveAttribute('href',/pt=37.8,55.7/);
  }
});

test('quick filters, statistics outside click and landscape controls fit the viewport',async({page})=>{
  await mapStyle(page);await page.goto('/');
  await expect(page.getByRole('button',{name:'Приблизить карту',exact:true})).toBeEnabled();
  await expect(page.locator('.maplibregl-marker')).toHaveCount(3);
  await page.getByRole('button',{name:'Гаражи',exact:true}).click();await expect(page.locator('.maplibregl-marker')).toHaveCount(1);
  await expect(page.locator('.maplibregl-marker')).toHaveClass(/kind-garage/);
  await page.getByRole('button',{name:'Участники',exact:true}).click();await expect(page.locator('.maplibregl-marker')).toHaveCount(1);
  await expect(page.locator('.maplibregl-marker')).toHaveClass(/kind-person/);
  await page.getByRole('button',{name:'Все',exact:true}).click();
  await page.getByRole('button',{name:/Статистика/}).click();
  await expect(page.locator('.statistics-totals')).toHaveText('Участников: 1 · Мест: 3');
  expect((await page.locator('.statistics-totals').boundingBox())!.height).toBeLessThan(35);
  await page.locator('.maplibregl-canvas').click({position:{x:5,y:240}});await expect(page.locator('.statistics-panel')).toHaveCount(0);
  await page.setViewportSize({width:844,height:390});
  const logo=(await page.locator('.wordmark').boundingBox())!,search=(await page.locator('.plate-search').boundingBox())!;
  expect(Math.abs(logo.y+logo.height/2-search.y-search.height/2)).toBeLessThan(8);
  for(const selector of ['.zoom-controls','.theme-toggle','.statistics-toggle','.map-filters','.maplibregl-ctrl-scale']){
    const box=(await page.locator(selector).boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(845);expect(box.y+box.height).toBeLessThanOrEqual(391);
  }
  await page.screenshot({path:'test-results/'+test.info().project.name+'-landscape.png'});
  await page.getByRole('button',{name:'Включить светлую тему'}).click();await expect(page.locator('.public-map')).toHaveAttribute('data-theme','light');
  await expect(page.getByRole('button',{name:'Приблизить карту',exact:true})).toBeEnabled();
});

test('a failed style shows recovery while direct cards remain available',async({page})=>{
  const person=(await entries(page)).find(p=>p.kind==='person')!;let fail=true;
  await page.route('**/map-cache/styles/*',route=>fail?route.fulfill({status:503,json:{error:'Unavailable'}}):route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background'}]}}));
  await page.goto('/p/'+person.shareId);await expect(page.getByRole('article')).toBeVisible();
  await expect(page.locator('.map-error')).toContainText('Сервер карты временно недоступен');
  fail=false;await page.getByRole('button',{name:'Повторить',exact:true}).click();
  await expect(page.getByRole('button',{name:'Приблизить карту',exact:true})).toBeEnabled();await expect(page.locator('.map-error')).toHaveCount(0);
  await expect(page.getByRole('article')).toBeVisible();
});

test('admin exposes owner, market, exact coordinates and map settings at tablet width',async({page,context})=>{
  await context.addCookies([{name:'sfmap_session',value:'browser-test-session',url:'http://127.0.0.1:18765/api/admin'}]);
  await page.setViewportSize({width:1000,height:800});await page.goto('/manage-browser-test');
  await expect(page.getByRole('combobox',{name:'Рынок',exact:true})).toBeVisible();
  await expect(page.getByRole('combobox',{name:'КПП',exact:true}).locator('option')).toHaveText(['Не указан','МКПП','АКПП']);
  await page.getByRole('combobox',{name:'Тип записи',exact:true}).selectOption('garage');await expect(page.getByRole('combobox',{name:'Владелец гаража',exact:true})).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Владелец гаража',exact:true}).locator('option')).toHaveCount(2);
  await expect(page.getByLabel('Точная широта',{exact:true})).toBeVisible();
  await page.getByText('Вид кружочков на карте',{exact:true}).click();
  await expect(page.getByRole('button',{name:'Сохранить вид карты'})).toBeEnabled();
});

test('person coordinates move the marker while the district label and hidden coordinate controls remain',async({page,context})=>{
  await context.addCookies([{name:'sfmap_session',value:'browser-test-session',url:'http://127.0.0.1:18765/api/admin'}]);
  const headers={origin:'http://127.0.0.1:18765','x-csrf-token':'browser-test-csrf'};
  const input={kind:'person',name:'Приоритет координат',locationId:'moscow-137',latitude:0,longitude:0};
  const created=await page.request.post('/api/admin/participants',{headers,data:input});
  expect(created.status(),await created.text()).toBe(201);let record=await created.json();
  try{
    await mapStyle(page);await page.goto('/');
    await expect(page.getByRole('button',{name:'Приблизить карту',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Участники',exact:true}).click();
    const marker=page.locator('.maplibregl-marker[data-entry-id="'+record.id+'"]');
    await expect(marker).toBeVisible();const initial=(await marker.boundingBox())!;
    const update=async(exactLatitude:number|null,exactLongitude:number|null)=>{
      const response=await page.request.put('/api/admin/participants/'+record.id,{headers,data:{...input,exactLatitude,exactLongitude,revision:record.revision}});
      expect(response.status()).toBe(200);record=await response.json();
      await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    };
    await update(55.8,37.58);
    await expect.poll(async()=>{const box=await marker.boundingBox();return box?Math.hypot(box.x-initial.x,box.y-initial.y):0;}).toBeGreaterThan(30);
    await marker.click();const card=page.getByRole('article',{name:'Участник '+input.name});
    await expect(card.locator('.city')).toHaveText('Москва, Ясенево');
    await expect(card.locator('.coordinate-actions')).toHaveCount(0);
    await expect(card.getByRole('link',{name:'Навигация ↗'})).toHaveCount(0);
    await update(null,null);
    await expect.poll(async()=>{const box=await marker.boundingBox();return box?Math.hypot(box.x-initial.x,box.y-initial.y):Infinity;}).toBeLessThan(1);
    await expect(card.locator('.city')).toHaveText('Москва, Ясенево');
  }finally{
    const deleted=await page.request.delete('/api/admin/participants/'+record.id,{headers,data:{revision:record.revision}});
    expect(deleted.status()).toBe(200);
  }
});

test('settlement picker distinguishes namesakes and fits a mobile screen',async({page,context})=>{
  await context.addCookies([{name:'sfmap_session',value:'browser-test-session',url:'http://127.0.0.1:18765/api/admin'}]);
  await page.goto('/manage-browser-test');
  const picker=page.getByRole('combobox',{name:/Район или населённый пункт/});
  await picker.fill('Абрамцево Дмитров');
  const options=page.getByRole('listbox',{name:'Подходящие места'});
  await expect(options.getByRole('option')).toHaveCount(2);
  await expect(options).toContainText('рядом с Бунятино');
  await expect(options).toContainText('рядом с Микляево');
  await options.scrollIntoViewIfNeeded();
  const box=(await options.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x+box.width).toBeLessThanOrEqual(391);
  expect(await options.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.screenshot({path:'test-results/'+test.info().project.name+'-settlements.png'});
  await picker.fill('Абрамцево Сергиево');
  const village=options.getByRole('option',{name:'Абрамцево, Сергиево-Посадский городской округ село',exact:true});
  await expect(options.getByRole('option').first()).toHaveText('Абрамцево, Сергиево-Посадский городской округсело');
  await village.click();
  await expect(picker).toHaveValue('Абрамцево, Сергиево-Посадский городской округ');
  await expect(options).toHaveCount(0);
  await picker.fill('Москва Яс');
  await picker.press('ArrowDown');await picker.press('Enter');
  await expect(picker).toHaveValue('Москва, Ясенево');
  await expect(options).toHaveCount(0);
});

test('groups stay absolutely positioned in both themes through zoom changes',async({page})=>{
  await mapStyle(page);
  const records=await (await page.request.get('/api/participants')).json();
  const person=records.participants.find((p:any)=>p.kind==='person');
  await page.route('**/api/participants',route=>route.fulfill({json:{...records,participants:[person,{...person,id:'nearby-person',shareId:'nearby01',name:'Рядом'}]}}));
  await page.goto('/');
  await expect(page.locator('.cluster')).toHaveCount(1);
  await expect(page.locator('.cluster')).toHaveCSS('position','absolute');
  await page.locator('.cluster').click();await expect(page.locator('.cluster')).toHaveClass(/is-selected/);
  await page.locator('.group-members').getByRole('button',{name:new RegExp(person.name)}).click();
  await expect(page.getByRole('article')).toBeVisible();
  await expect(page.locator('.cluster')).toHaveClass(/is-selected/);
  await page.getByRole('button',{name:'Включить светлую тему'}).click();
  await expect(page.locator('.cluster')).toHaveCount(1);
  await expect(page.locator('.cluster')).toHaveCSS('position','absolute');
  await expect(page.locator('.cluster')).toHaveClass(/is-selected/);
  const before=await page.locator('.cluster').boundingBox();
  await page.getByRole('button',{name:'Приблизить карту',exact:true}).click();
  await expect.poll(()=>page.locator('.map-canvas').getAttribute('data-zoom')).not.toBe('9.15');
  await expect(page.locator('.cluster')).toHaveCSS('position','absolute');
  const after=await page.locator('.cluster').boundingBox();
  expect(before).not.toEqual(after);
  await expect(page.locator('.cluster')).toHaveClass(/is-selected/);
  await page.getByRole('button',{name:'Закрыть карточку'}).click();
  await expect(page.getByRole('region',{name:'Участники группы'})).toBeVisible();
  await page.getByRole('button',{name:'Закрыть список'}).click();
  await expect(page.locator('.maplibregl-marker.is-selected')).toHaveCount(0);
});

test('cached TileJSON templates reach the worker as valid absolute URLs',async({page})=>{
  const requests:string[]=[];
  await page.route('**/map-cache/**',route=>{
    const path=new URL(route.request().url()).pathname;requests.push(path);
    if(path.startsWith('/map-cache/styles/'))return route.fulfill({json:{version:8,sources:{tiles:{type:'vector',url:'/map-cache/planet'}},layers:[{id:'background',type:'background'},{id:'test',type:'fill',source:'tiles','source-layer':'test'}]}});
    if(path==='/map-cache/planet')return route.fulfill({json:{tiles:['/map-cache/planet/version/{z}/{x}/{y}.pbf'],maxzoom:12}});
    return route.fulfill({body:Buffer.alloc(0),contentType:'application/x-protobuf'});
  });
  await page.goto('/');await expect(page.getByRole('button',{name:'Приблизить карту',exact:true})).toBeEnabled();
  await expect.poll(()=>requests.some(path=>/^\/map-cache\/planet\/version\/\d+\/\d+\/\d+[.]pbf$/.test(path))).toBe(true);
  expect(requests.some(path=>path.includes('%7B')||path.includes('{'))).toBe(false);
  await expect(page.locator('.map-error')).toHaveCount(0);
});

test('live server cache renders actual map resources',async({page})=>{
  test.skip(process.env.SFMAP_LIVE_MAP!=='true','Optional verification against the public read-only map cache');
  test.setTimeout(90000);
  const failed:string[]=[],tiles:string[]=[];
  await page.route('**/map-cache/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const response=await page.request.get('https://map.sfmsk.ru'+path);
    if(response.status()!==200)failed.push(path+': '+response.status());
    else if(path.endsWith('.pbf')&&path.includes('/planet/'))tiles.push(path);
    await route.fulfill({response});
  });
  await page.goto('/');await expect(page.getByRole('button',{name:'Приблизить карту',exact:true})).toBeEnabled({timeout:30000});
  await expect.poll(()=>tiles.length,{timeout:30000}).toBeGreaterThan(0);
  await expect(page.locator('.map-error')).toHaveCount(0);
  await page.screenshot({path:'test-results/'+test.info().project.name+'-live-map.png'});
  expect(failed).toEqual([]);
});
