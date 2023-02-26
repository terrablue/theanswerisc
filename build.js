import {marked} from "marked";
import {File, Path} from "runtime-compat/filesystem";

const conf = {
  base: "content/blog",
  md: ".md",
  json: ".json",
};

// get names of all posts
const names = await Promise.all((
  await Path.list(conf.base, path => path.endsWith(conf.md)))
    .map(({name}) => name.slice(0, -conf.md.length)));

const load = async (path, type, transformer) => {
  try {
    return transformer(await path.file.read());
  } catch (error) {
    console.log(`faulty or missing ${type} file in \`${path}\``);
    console.log(error);
    return undefined;
  }
};

// consider only posts that have both a .md and a .json file; warn about
// missing .json or .md
const posts = (await Promise.all(names.map(async name => {
  const base = new Path(conf.base);
  return {
    name,
    html: await load(base.join(`${name}${conf.md}`), conf.md, marked.parse),
    json: await load(base.join(`${name}${conf.json}`), conf.json, JSON.parse),
  }
}))).filter(({html, json}) => html !== undefined && json !== undefined);

const build = new Path("site");

// recreate build path
if (await build.exists) {
  await build.file.remove();
}
await build.file.create();

const replace = (name, html, json) => {
  const replacements = {
    title: json.title ?? name,
    date: json.epoch ? new Date(json.epoch * 1000) : new Date(), // FIX: warn
    author: json.author ?? "terrablue", // FIX: make dynamic
  };
  return Object.entries(replacements).reduce((replaced, [name, value]) =>
    replaced.replace(`\$\{${name}\}`, value), html);
};

const index = await File.read("static/index.html");
await Promise.all(posts.map(({name, html, json}) =>
  build.join(`${name}.html`).file
    .write(replace(name, index.replace("${content}", html), json))));
