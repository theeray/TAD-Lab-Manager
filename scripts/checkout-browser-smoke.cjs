const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
process.chdir(path.resolve(__dirname, '..'));
fs.mkdirSync('.local', { recursive: true });
const browserRequire = createRequire(path.resolve('.local/package.json'));
const { chromium } = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/playwright') : browserRequire('playwright');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const backendRequire = require('node:module').createRequire(require('node:path').resolve('checkout-functions/package.json'));
const { initializeApp } = backendRequire('firebase-admin/app');
const { getAuth } = backendRequire('firebase-admin/auth');
const { getFirestore, FieldValue } = backendRequire('firebase-admin/firestore');
const { createService, STAFF } = require('../checkout-functions/service');
const app = initializeApp({ projectId: 'demo-tad-checkout' });
const db = getFirestore(app); const auth = getAuth(app);
(async () => {
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-tad-checkout/accounts', { method: 'DELETE' });
  await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-tad-checkout/databases/(default)/documents', { method: 'DELETE' });
  const manager = await auth.createUser({ email: STAFF[0], password: 'Test-password-42!', emailVerified: true });
  const service = createService({ db, auth, FieldValue });
  const req = { auth: { uid: manager.uid, token: { email: manager.email, email_verified: true, firebase: { sign_in_provider: 'password' } } } };
  await service.registerAsset({ ...req, data: { assetId: 'IPAD-PILOT', assetNumber: 'DEMO-ONLY-024', label: 'Illustration iPad', model: 'Emulator fixture only' } });
  await service.configure({ ...req, data: { enabled: true, notificationMode: 'off', spreadsheetId: '' } });
  const http = require('node:http');
  const methods = { checkoutSession: 'session', checkoutSubmit: 'submit', checkoutRecordReturn: 'recordReturn', checkoutDashboard: 'dashboard', checkoutRegisterAsset: 'registerAsset', checkoutConfigure: 'configure' };
  // Local HTTP adapter exercises the actual service and Auth emulator tokens without requiring the Functions emulator's Unix sockets.
  const api = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5000');
    res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,x-firebase-appcheck,firebase-instance-id-token');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Content-Type','application/json');
    if(req.method==='OPTIONS') {res.writeHead(204);res.end();return;}
    try {
      let raw='';for await(const chunk of req) raw+=chunk;
      const token=await auth.verifyIdToken((req.headers.authorization||'').replace(/^Bearer /,''));
      const method=methods[req.url.split('/').pop()];
      const result=await service[method]({auth:{uid:token.uid,token},data:JSON.parse(raw).data});
      res.end(JSON.stringify({result}));
    } catch(e) { res.writeHead(400); res.end(JSON.stringify({error:{status:(e.code||'internal').replaceAll('-','_').toUpperCase(),message:e.message}})); }
  });
  await new Promise(resolve=>api.listen(5001,'127.0.0.1',resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.TAD_CHECKOUT_CHROMIUM || undefined, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if(m.type()==='error') console.log('BROWSER:',m.text().slice(0,300)); });
  const moduleCache = new Map();
  await page.route('https://www.gstatic.com/firebasejs/**', async route => {
    const url = route.request().url();
    if (!moduleCache.has(url)) { const r = await fetch(url); if(!r.ok) throw new Error(`${url} ${r.status}`); moduleCache.set(url, await r.text()); }
    await route.fulfill({ body: moduleCache.get(url), contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto('http://127.0.0.1:5000/equipment-checkout.html?asset=IPAD-PILOT&emulator=1');
  await page.locator('#accountPanel').waitFor({ state: 'visible' });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: '.local/checkout-mobile-signin.png', fullPage: true });
  await page.click('#chooseSignUp');
  await page.fill('#email', 'browser-student@example.test'); await page.fill('#password', 'Test-password-42!');
  await page.click('#accountAction');
  await page.locator('#verifyPanel').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#checkoutPanel').isVisible(), false);
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('Verification email sent'));
  const oob = await (await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-tad-checkout/oobCodes')).json();
  const code = oob.oobCodes.find(c => c.email === 'browser-student@example.test' && c.requestType === 'VERIFY_EMAIL');
  assert.ok(code);
  assert.ok(new URL(code.oobLink).searchParams.get('continueUrl').includes('asset=IPAD-PILOT'));
  // Exercise the email action code with the emulator's actual verification endpoint.
  const verified = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-api-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oobCode: code.oobCode }) });
  assert.equal(verified.ok, true, await verified.text());
  await page.click('#verified');
  await page.waitForFunction(() => !document.querySelector('#submitCheckout').disabled);
  assert.equal(new URL(page.url()).searchParams.get('asset'), 'IPAD-PILOT');
  assert.equal(await page.locator('#borrowerEmail').textContent(), 'browser-student@example.test');
  await page.fill('#borrowerName', 'Browser Test Student'); await page.fill('#course', 'Digital Illustration');
  await page.fill('#purpose', 'Drawing practice for class'); await page.check('[name=accessory][value=Case]');
  await page.check('#agreement');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: '.local/checkout-mobile-form.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.click('#submitCheckout');
  await page.locator('#confirmation').waitFor({ state: 'visible' });
  assert.equal((await db.collection('checkoutEvents').get()).size, 1);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: '.local/checkout-mobile-success.png', fullPage: true });
  await page.click('#signOut'); await page.locator('#accountPanel').waitFor({ state: 'visible' });
  await page.click('#chooseSignIn'); await page.fill('#email', STAFF[0]); await page.fill('#password', 'Test-password-42!');
  await page.click('#accountAction'); await page.locator('#managerNav').waitFor({ state: 'visible' });
  await page.click('#managerNav'); await page.locator('#managerPanel').waitFor({ state: 'visible' });
  assert.ok((await page.locator('#historyRows').textContent()).includes('Browser Test Student'));
  await page.setViewportSize({ width: 320, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: '.local/checkout-manager.png', fullPage: true });
  await page.locator('[data-return]').click(); await page.locator('#returnDialog').waitFor({ state: 'visible' });
  await page.fill('#returnNotes', 'Received all items.'); await page.locator('#returnForm button[type=submit]').click();
  await page.waitForFunction(() => !document.querySelector('#returnDialog').open);
  assert.equal((await db.collection('checkoutEvents').get()).size, 2);
  assert.equal((await db.doc('checkoutAssets/IPAD-PILOT').get()).data().currentLoanId, null);
  await page.click('#signOut'); await page.locator('#accountPanel').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#historyRows').textContent(), '');
  assert.deepEqual(errors, []);
  console.log('PASS: browser signup → email verification → retained asset → checkout → manager history → confirmed return → private data cleared at sign-out');
  await browser.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
