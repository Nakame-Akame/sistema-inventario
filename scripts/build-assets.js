const fs = require('node:fs');
const path = require('node:path');
const CleanCSS = require('clean-css');
const { minify: minifyJavaScript } = require('terser');

const projectRoot = path.resolve(__dirname, '..');
const sourceDirectory = path.join(projectRoot, 'public');
const outputDirectory = path.join(projectRoot, 'dist', 'public');
const assetDirectory = path.join(outputDirectory, 'assets');
const pageStylesheets = ['ventas', 'facturas', 'reportes', 'compras', 'usuarios', 'modals']
  .map(name => path.join(sourceDirectory, 'styles', `${name}.css`));

function copyPublicFiles(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter: file => !file.endsWith('.map') && file !== path.join(sourceDirectory, 'Script.js'),
  });
}

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(filePath) : [filePath];
  });
}

async function minifyJavaScriptFile(filePath) {
  const result = await minifyJavaScript(fs.readFileSync(filePath, 'utf8'), {
    compress: true,
    mangle: true,
    format: { comments: false },
    sourceMap: false,
  });
  if (!result.code) throw new Error(`No se pudo minificar ${filePath}`);
  fs.writeFileSync(filePath, result.code, 'utf8');
}

function minifyStylesheet(stylesheet) {
  const result = new CleanCSS({ level: 2, sourceMap: false }).minify(stylesheet);
  if (result.errors.length) throw new Error(`No se pudo minificar el CSS: ${result.errors.join('; ')}`);
  return result.styles;
}

async function minifyInlineScripts(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let output = '';
  let previousEnd = 0;
  let match;

  while ((match = scriptPattern.exec(html)) !== null) {
    output += html.slice(previousEnd, match.index);
    if (/\bsrc\s*=/i.test(match[1]) || !match[2].trim()) {
      output += match[0];
    } else {
      const result = await minifyJavaScript(match[2], {
        compress: true,
        mangle: true,
        format: { comments: false },
        sourceMap: false,
      });
      if (!result.code) throw new Error(`No se pudo minificar el script integrado en ${filePath}`);
      output += `<script${match[1]}>${result.code}</script>`;
    }
    previousEnd = scriptPattern.lastIndex;
  }

  output += html.slice(previousEnd);
  fs.writeFileSync(filePath, output, 'utf8');
}

async function build() {
  if (!fs.existsSync(sourceDirectory)) throw new Error(`No existe el directorio de recursos: ${sourceDirectory}`);
  const stylesheetFiles = [path.join(sourceDirectory, 'Style.css'), ...pageStylesheets];
  for (const filePath of stylesheetFiles) {
    if (!fs.existsSync(filePath)) throw new Error(`Falta una hoja requerida: ${filePath}`);
  }

  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outputDirectory), { recursive: true });
  copyPublicFiles(sourceDirectory, outputDirectory);

  const styleParts = [...pageStylesheets, path.join(sourceDirectory, 'Style.css')]
    .map(filePath => fs.readFileSync(filePath, 'utf8'));
  fs.mkdirSync(assetDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(assetDirectory, 'app.min.css'),
    minifyStylesheet(styleParts.join('\n')),
    'utf8',
  );

  const applicationScript = path.join(outputDirectory, 'app.js');
  await minifyJavaScriptFile(applicationScript);
  fs.renameSync(applicationScript, path.join(assetDirectory, 'app.min.js'));

  for (const filePath of walkFiles(outputDirectory)) {
    if (filePath.endsWith('.html')) {
      const isPageFragment = path.dirname(filePath) === path.join(outputDirectory, 'pages');
      if (isPageFragment) {
        const html = fs.readFileSync(filePath, 'utf8')
          .replace(/<link\b(?=[^>]*\bdata-page-style\b)[^>]*>\s*/gi, '');
        fs.writeFileSync(filePath, html, 'utf8');
      } else {
        let html = fs.readFileSync(filePath, 'utf8')
          .replace('href="/Style.css"', 'href="/assets/app.min.css"')
          .replace("application.src = '/app.js'", "application.src = '/assets/app.min.js'");
        fs.writeFileSync(filePath, html, 'utf8');
        await minifyInlineScripts(filePath);
      }
    }
  }

  fs.rmSync(path.join(outputDirectory, 'Style.css'), { force: true });
  fs.rmSync(path.join(outputDirectory, 'Script.js'), { force: true });
  fs.rmSync(path.join(outputDirectory, 'styles'), { recursive: true, force: true });
  console.log(`Recursos web agrupados y minificados en ${path.relative(projectRoot, outputDirectory)}.`);
}

build().catch(error => {
  console.error(`Error al construir recursos de producción: ${error.message}`);
  process.exitCode = 1;
});
