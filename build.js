import {marked} from "marked";
import {File, Path} from "runtime-compat/filesystem";
import conf from "./conf.json" assert {type: "json"};

// get names of all posts
const names = await Promise.all((
  await Path.list(conf.path.base, path => path.endsWith(conf.md)))
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
  const base = new Path(conf.path.base);
  return {
    name,
    html: await load(base.join(`${name}${conf.md}`), conf.md, marked.parse),
    json: await load(base.join(`${name}${conf.json}`), conf.json, JSON.parse),
  }
}))).filter(({html, json}) => html !== undefined && json !== undefined);

const build = new Path(conf.path.build);

// recreate build path
if (await build.exists) {
  await build.file.remove();
}
await build.file.create();

const replace = (name, html, json) => {
  const toDate = epoch => new Date(epoch ?? Date.new());
  const replacements = {
    title: json.title ?? name,
    // FIX: warn
    date: toDate(json.epoch).toLocaleString(...Object.values(conf.date)),
    author: json.author ?? conf.author,
  };
  return Object.entries(replacements).reduce((replaced, [name, value]) =>
    replaced.replace(`\$\{${name}\}`, value), html);
};

const post = await File.read("layouts/post.html");

// generate posts
const paths = await Promise.all(posts.map(async ({name, html, json}) => {
  const toDate = epoch => new Date(epoch ?? Date.new());
  const date = toDate(json.epoch);
  const format = {day: "2-digit", month: "2-digit", year: "numeric"};
  const localeDate = date.toLocaleString("en-AU", format).split("/");
  const [day, month, year] = localeDate;

  const yearPath = build.join(year);
  if (!(await yearPath.exists)) {
    await yearPath.file.create();
  }

  const monthPath = yearPath.join(month);
  if (!(await monthPath.exists)) {
    await monthPath.file.create();
  }

  const dayPath = monthPath.join(day);
  if (!(await dayPath.exists)) {
    await dayPath.file.create();
  }

  const path = dayPath.join(`${name}.html`);

  await path.file.write(replace(name, post.replace("${content}", html), json));

  return {name, path: `${path}`, date: `${year}/${month}/${day}`};
}));

// generate index
const index = (await File.read("layouts/index.html"))
  .replace("${author}", conf.author)
  .replace("${content}", () => 
    paths.map(({name, date, path}) =>
      `<p>
         <a href="${path.replace(`${conf.path.build}/`, "")}">${name}</a>
         <i>${date}</i>
      <p>`
    ));

await build.join("index.html").file.write(index);

// copy static asserts
const _static = new Path("static");
const _public = new Path("site/public");
if (await _static.exists) {
  if (await _public.exists) {
    await _public.file.remove();
  }
  await _public.file.create();
  // copy static files to public
  await File.copy(_static, _public);
}
