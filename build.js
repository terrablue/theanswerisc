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

const process = (name, json) => {
  const toDate = epoch => new Date(epoch ?? Date.new());
  return {
    title: json.title ?? name,
    // FIX: warn
    date: toDate(json.epoch).toLocaleString(...Object.values(conf.date)),
    author: json.author ?? conf.author,
  };
};

const post = await File.read("layouts/post.html");

// generate posts
const paths = await Promise.all(posts.map(async ({name, html, json}) => {
  const {title, date, author} = process(name, json);

  const replacements = Object.entries({title, date, author})
    .reduce((replaced, [name, value]) =>
      replaced.replace(`\$\{${name}\}`, value),
        post.replace("${content}", html));
  const path = build.join(`${name}.html`);

  await path.file.write(replacements);

  return {name, path: `${path}`, date};
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
