/* Keep old bookmarks and machine QR links on the permanent TAD site. */
(function () {
  'use strict';
  var current = new URL(window.location.href);
  var githubPrefix = '/TAD-Lab-Manager';
  var onGitHub = current.hostname === 'theeray.github.io' &&
    (current.pathname === githubPrefix || current.pathname.indexOf(githubPrefix + '/') === 0);
  var onFirebaseAlias = current.hostname === 'tad-lab-manager.firebaseapp.com';
  if (!onGitHub && !onFirebaseAlias) return;
  // Firebase's reserved authentication handlers must stay on their own origin.
  if (current.pathname.indexOf('/__/') === 0) return;
  var target = new URL('https://tad-lab-manager.web.app/');
  target.pathname = onGitHub ? (current.pathname.slice(githubPrefix.length) || '/') : current.pathname;
  target.search = current.search;
  target.hash = current.hash;
  window.location.replace(target.href);
}());
