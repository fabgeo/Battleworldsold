// Construit la version solo en un seul fichier HTML (sans serveur) :
//   node tools/build-static.js                 -> docs/ (GitHub Pages : index.html, manifeste, icônes)
//   node tools/build-static.js --fragment f    -> f (contenu de page sans <head>, pour un hébergeur qui ajoute le sien)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const NOTE = '<p class="sub" style="margin-top:18px">Version en ligne : solo contre les bots. Le multijoueur se lance avec le serveur du projet (npm start).</p>\n      <div id="multiBlock" hidden>';
const body = read('public/index.html').match(/<body>([\s\S]*)<\/body>/)[1]
  .replace('<div id="multiBlock">', NOTE)
  .replace(/<script src="[^"]*"><\/script>\s*/g, '');

const content = `<style>
:root { color-scheme: dark; }
${read('public/style.css')}</style>
${body}
<script>
${read('shared/europe-map.js')}
${read('shared/engine.js')}
</script>
<script>
${read('public/client.js')}
</script>
`;

const fragIdx = process.argv.indexOf('--fragment');
if (fragIdx > 0) {
  fs.writeFileSync(process.argv[fragIdx + 1], '<title>Battleworlds</title>\n' + content);
  console.log('Fragment écrit :', process.argv[fragIdx + 1]);
  process.exit(0);
}

const out = path.join(ROOT, 'docs');
fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'public/icons'))) fs.copyFileSync(path.join(ROOT, 'public/icons', f), path.join(out, 'icons', f));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify({
  name: 'Battleworlds',
  short_name: 'Battleworlds',
  description: 'Conquête de territoires contre des bots',
  lang: 'fr',
  start_url: './',
  scope: './',
  display: 'fullscreen',
  orientation: 'any',
  background_color: '#1d2228',
  theme_color: '#1d2228',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
}, null, 2));
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html>
<!-- Généré par tools/build-static.js à partir de public/ et shared/ — ne pas modifier à la main. -->
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>Battleworlds</title>
<meta name="description" content="Conquête de territoires en temps réel contre des bots.">
<meta name="theme-color" content="#1d2228">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Battleworlds">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/icon-180.png">
</head>
<body>
${content}</body>
</html>
`);
console.log('Site statique écrit dans docs/');
