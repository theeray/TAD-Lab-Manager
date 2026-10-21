import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { legacyChannels, CUTOFF } from './retire-preview-channels.mjs';

const script = readFileSync(new URL('../canonical-redirect.js', import.meta.url), 'utf8');
function redirect(href, source = script) {
  let destination;
  runInNewContext(source, { URL, window: { location: { href, replace: url => destination = url } } });
  return destination;
}

test('old home links land on the permanent home without loops', () => {
  for (const url of ['https://theeray.github.io/TAD-Lab-Manager', 'https://theeray.github.io/TAD-Lab-Manager/', 'https://tad-lab-manager.firebaseapp.com/']) {
    assert.equal(redirect(url), 'https://tad-lab-manager.web.app/');
  }
  assert.equal(redirect('https://tad-lab-manager.web.app/'), undefined);
});

test('estimator bookmarks and machine QR parameters survive', () => {
  for (const path of ['/projects/index.html', '/maintenance/index.html?machine=cnc-plasma-koike-01#report', '/machine.html?id=forming-formech-fm660', '/tutorials.html?q=metal%20cutting#results']) {
    assert.equal(redirect('https://theeray.github.io/TAD-Lab-Manager' + path), 'https://tad-lab-manager.web.app' + path);
    assert.equal(redirect('https://tad-lab-manager.firebaseapp.com' + path), 'https://tad-lab-manager.web.app' + path);
  }
});

test('unrelated apps, development hosts and Firebase auth remain untouched', () => {
  for (const url of ['https://theeray.github.io/tad-ai/', 'https://theeray.github.io/TAD-Lab-Manager-other/', 'http://localhost:5000/projects/index.html', 'https://tad-lab-manager--future-review-abc.web.app/', 'https://tad-lab-manager.firebaseapp.com/__/auth/action?mode=verifyEmail']) {
    assert.equal(redirect(url), undefined);
  }
  assert.equal(new URL(redirect('https://theeray.github.io/TAD-Lab-Manager//evil.example/?next=https://evil.example')).origin, 'https://tad-lab-manager.web.app');
});

test('all existing HTML entry points include the redirect before app code', () => {
  for (const page of ['index.html', 'machine.html', 'tutorials.html', 'equipment-checkout.html', 'projects/index.html', 'maintenance/index.html']) {
    const html = readFileSync(new URL('../' + page, import.meta.url), 'utf8');
    assert.match(html, /<head><script src="(?:\.\.\/)?canonical-redirect\.js"><\/script>/);
  }
  const fallback = readFileSync(new URL('../404.html', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.equal(redirect('https://theeray.github.io/TAD-Lab-Manager/old/unknown.html?x=1#part', fallback), 'https://tad-lab-manager.web.app/old/unknown.html?x=1#part');
});

test('preview retirement cannot target live or newly created review channels', () => {
  const old = { name: 'sites/tad-lab-manager/channels/pr1-test', createTime: '2026-08-01T00:00:00Z' };
  const live = { ...old, name: 'sites/tad-lab-manager/channels/live' };
  const future = { ...old, name: 'sites/tad-lab-manager/channels/future', createTime: '2026-10-22T00:00:00Z' };
  assert.deepEqual(legacyChannels([old, live, future, {name:'unknown'}]), [old]);
  assert.ok(Date.parse(CUTOFF) > Date.parse(old.createTime));
});

test('temporary deployment credentials and maintenance scripts are not published', () => {
  const config = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
  assert.ok(config.hosting.ignore.includes('**/gha-creds-*.json'));
  assert.ok(config.hosting.ignore.includes('scripts/**'));
  assert.equal(config.hosting.redirects, undefined, 'the production host must not redirect to itself');
});
