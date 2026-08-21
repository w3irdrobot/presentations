import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const presentationsDirectory = path.join(root, "presentations");
const templatesDirectory = path.join(root, "site");
const outputDirectory = path.join(root, "dist");

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const escapeTemplateScript = (value) =>
  value.replace(/<\/script/gi, "<\\/script");

const renderTemplate = (template, values) =>
  template.replace(/{{([A-Z_]+)}}/g, (match, key) => {
    if (!(key in values)) {
      throw new Error(`Missing template value: ${key}`);
    }

    return values[key];
  });

const entries = await readdir(presentationsDirectory, { withFileTypes: true });
const presentations = [];

for (const entry of entries) {
  if (!entry.isDirectory()) continue;

  const source = path.join(presentationsDirectory, entry.name, "presentation.md");

  try {
    presentations.push({
      name: entry.name,
      markdown: await readFile(source, "utf8"),
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

presentations.sort((left, right) => left.name.localeCompare(right.name));

if (presentations.length === 0) {
  throw new Error("No presentations/*/presentation.md files found");
}

const [presentationTemplate, indexTemplate] = await Promise.all([
  readFile(path.join(templatesDirectory, "presentation.html"), "utf8"),
  readFile(path.join(templatesDirectory, "index.html"), "utf8"),
]);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(path.join(outputDirectory, "assets", "reveal", "plugin"), {
  recursive: true,
});

await Promise.all([
  cp(
    path.join(root, "node_modules", "reveal.js", "dist"),
    path.join(outputDirectory, "assets", "reveal", "dist"),
    { recursive: true },
  ),
  cp(
    path.join(root, "node_modules", "reveal.js", "plugin", "markdown"),
    path.join(outputDirectory, "assets", "reveal", "plugin", "markdown"),
    { recursive: true },
  ),
  cp(
    path.join(root, "node_modules", "reveal.js", "plugin", "highlight"),
    path.join(outputDirectory, "assets", "reveal", "plugin", "highlight"),
    { recursive: true },
  ),
  cp(
    path.join(root, "node_modules", "reveal.js", "plugin", "notes"),
    path.join(outputDirectory, "assets", "reveal", "plugin", "notes"),
    { recursive: true },
  ),
  cp(
    path.join(templatesDirectory, "styles"),
    path.join(outputDirectory, "assets", "styles"),
    { recursive: true },
  ),
]);

for (const presentation of presentations) {
  const directory = path.join(outputDirectory, presentation.name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "index.html"),
    renderTemplate(presentationTemplate, {
      TITLE: escapeHtml(presentation.name),
      MARKDOWN: escapeTemplateScript(presentation.markdown),
    }),
  );
}

const links = presentations
  .map(
    ({ name }) =>
      `<li><a href="./${encodeURIComponent(name)}/"><span>${escapeHtml(name)}</span><span aria-hidden="true">Open &rarr;</span></a></li>`,
  )
  .join("\n          ");

await writeFile(
  path.join(outputDirectory, "index.html"),
  renderTemplate(indexTemplate, { PRESENTATION_LINKS: links }),
);
await writeFile(path.join(outputDirectory, ".nojekyll"), "");

console.log(`Built ${presentations.length} presentation(s) in dist/`);
