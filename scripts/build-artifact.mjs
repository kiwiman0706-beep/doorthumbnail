// Produces the single page used when publishing to a sandboxed host (claude.ai
// Artifacts), where the host supplies the <head> and safe-area padding itself.
// Everything else — CSS, JS modules, icons — ships unchanged as sibling files.
import { readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) { console.error('usage: node scripts/build-artifact.mjs <output.html>'); process.exit(1); }

const src = readFileSync('index.html', 'utf8');
const body = src.slice(src.indexOf('<body>') + 6, src.lastIndexOf('</body>')).trim();

const SANDBOX_NOTE = `
        <p class="hint sm" id="sandbox-note" hidden>
          ⚠️ このプレビューはサンドボックス内で動いているため、<b>ファイル保存・共有・印刷がブロックされます</b>。
          保存を押すと画像を表示するので、長押しで保存してください。
          実際に使うときは自分のサーバー（GitHub Pages など）に置いてください。
        </p>`;

const page = `<title>instax ドア年表</title>
<link rel="stylesheet" href="css/app.css">
<style>
  /* The host already pads :root by the safe-area insets — don't add them twice. */
  body{padding-top:0;padding-bottom:0}
</style>

${body.replace(/(\s*)<\/div>\s*<\/div>\s*<\/div>\s*<\/section>\s*<!-- ============ 出力ビュー/,
               `${SANDBOX_NOTE}\n      </div>\n    </div>\n  </div>\n</section>\n\n<!-- ============ 出力ビュー`)}

<script type="module">
  // Sandboxed frames block downloads, Web Share and window.print(); say so up front.
  try {
    if (window.top !== window.self) document.getElementById('sandbox-note').hidden = false;
  } catch { document.getElementById('sandbox-note').hidden = false; }
</script>
<script type="module" src="js/app.js"></script>
`;

writeFileSync(out, page);
console.log(`wrote ${out} (${page.length} bytes)`);
