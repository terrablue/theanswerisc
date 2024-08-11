*This is a (perhaps slightly cautionary) tale of considerable length. If you
are in a hurry, I suggest you lay it aside and come back at a time of leisure.*

Back after the release of Primate 0.31 in May, I was starting to think about
the next steps. There are many things I want to achieve with Primate,
including [improving the ecosystem] with additional commonly-used modules;
adding the ability to have [reactive server values] (also known as liveview,
of Phoenix Liveview reknown) that originate from database updates and trickle
back down to the client; supporting deployments to different providers, and a
whole lot more. But priorities are mostly dictated by the needs of users, and
one of our early adopters, [chovy], suggested it would be interesting to be
able to create native apps from Primate projects.

His gripe with other approaches out there, such as Tauri, was it that requires
knowing Rust -- certainly not something every developer has the time or will to
learn. Without passing judgment on Tauri here, it's a given that Rust isn't for
everyone. And besides, one of Primate's strong points is flexibility, and if I
added desktop support, it'd be nearing a situation where there's nothing quite
similar out there that offers the same toolbox.

So right on to it, right? Bun, which Primate has [long supported], has the
ability to compile desktop apps, so let's just have it run Primate in compile
mode and voilà, all done.

Well, not so fast.

## A story of two worlds

Web apps and native apps are two completely different beasts. A web app exists
from a user perspective at one locality -- on the server, regardless of whether
it's distributed across the world. Disregarding caching artefacts, every time
you visit a web page, a copy of the app is downloaded onto your device and run.
Native apps are, until updated, installed once, and their permission model,
access to data sources, and many other features, vastly contrast those of web
apps.

|Aspect|Native|Web|
|------|------|---|
|Requires connection|No (unless explicit)|Yes (except for some PWAs)
|Execution|Local|Remote|
|Sandboxing|Operating system|Browser|
|Configuration|User home|Delegated auth (cookies, tokens)|
|Execution locality|Wherever started, changes|On the server, stays same|
|Secrets|Exposable by reverse-engineering|As secure as the server they're on|
|Painted by|GUI library|Browser HTML/CSS engine|

The list goes on and on. So trying to just `bun build --compile` Primate was
obviously not going to cut it. The first challenge was thinking about how to
paint the desktop app.

There are several approaches here, but perhaps the most straightforward one, if
one wishes to keep compatibility with the web, is to use a webview. They're
installed on virtually every operating system and lend themselves well to
packaging a web app into a desktop container.

I was looking around for different webview libraries, and found a minimalistic
[webview] library. Unfortunately, as is all too common today, there were three
different projects to bring this library to Node, Deno and Bun, respectively,
doing almost exactly the same (and more or less borrowing directly from each
other).

I would have probably specifically used the webview-bun project, were it not
missing support for the ability to use it in combination with web workers. This
is the crux of the matter: the GUI process needs to run separately from the
main JavaScript loop running the server, so as to not block it. If I didn't
have a server and simply wanted to create a webview GUI project, this wouldn't
be a concern (and Primate might, in the future, allow for projects with
essentially no server, especially if all the content can be compiled into static
assets during buildtime).

But Primate does have a server -- it's a full-stack framework, after all. So
using that library wasn't an option. And besides, I felt that it would be
*probably* better to use this opportunity to create a proper webview solution
with diverging paths for Node, Deno and Bun, `@rcompat/webview`.

Alright. So before we can have a GUI for Primate, we need to have the ability
to have a GUI in general that's independent of the main process, using web
workers.

## Into the rabbit hole

Creating [@rcompat/webview] for Bun wasn't very hard. It's essentially using
Bun's excellent FFI module to map the C functions that the webview library
exposes to JavaScript so that they can be called from there. In a matter of an
hour or so, I was up and running, doing something to the effect of

```js
import Webview from "@rcompat/webview";

const webview = new Webview();
webview.navigate("https://primatejs.com");
webview.run();
```

This is fairly straightforward. If you have Bun installed on your computer,
then running

```sh
bun init -y && bun install @rcompat/webview && echo \
'import W from "@rcompat/webview"; const w = new W(); w.navigate("https://primatejs.com"); w.run();' \
> app.js && bun app.js
```

Will do the job. You should be able to see a webview window opening and therein
the Primate website. Nice.

But this wasn't the particularly challenging part. The main issue was, as
already mentioned, that if you try to run this piece of code from within a Bun
server, it will block execution. You will see the webview window come up, but
it will be blank. And if you then open your browser and try to access
`http://localhost:6161` (the typical address of a Primate server), it will
stall indefinitely. Yup, it's blocking the main thread.

Fortunately, Bun's support for Workers (or Web Workers) is also excellent,
allowing you to spawn a web worker on another thread, and inside it, you could
run your webview, essentially your web browser client, accessing your backend.
Server and client, two independent threads.

... this was the theory, at least. And like all theories, it's great on paper,
and possibly dreadful in execution. The problem I was facing was that while I
could spawn a new worker thread, this worker -- *particularly* within a compiled
app -- could not access any imports that aren't native to Bun, that is, that are
not prefixed with the `bun:` namespace (like `bun:ffi`).

This puts any kind of code reusability, with `@rcompat/webview` or anything
else, completely out of the question. We can have a wonderfully
runtime-key-diverging `@rcompat/webview`, working all the same for Node, Deno
and Bun behind a uniform API, supporting different platforms, but we *cannot*
use it within a worker that's running in a compiled app.

### Small detour: runtime keys

I had been developing rcompat alongside Primate for quite some time now, and it
went through quite a few iterations, from being called `runtime-compat` to its
current name, from being one package, `rcompat`, with paths to the different
modules, like `rcompat/http` and `rcompat/fs`, then onto a monorepo with
distinct packages like `@rcompat/http` and `@rcompat/fs`, first with barrelled,
then with almost entirely debarrelled imports (more on that later), and in
between a significant port to TypeScript, which would not have become a reality
without the expertise of [r-cyr], for which I cannot be grateful enough. I am
ever humbled to work with people who are more intelligent than I am.

Anyway, between all these twists and turns, I discovered, to my joy,
[this little page concerning runtime keys][runtime keys]. I'd known about
WinterCG for a while, and they're doing solid work, but this eclipses, in my
perception, everything else they do.

To understand why, consider what I had been doing up until then to create
divergent paths between the different runtimes, and how I've seen it done in
the wild

```js
let runtime = "node";

if (typeof Bun !== "undefined")
  runtime = "bun";

if (typeof Deno !== "undefined")
  runtime = "deno";

export default runtime;
```

This would serve as a base function to get the current runtime and diverge
using different implementations:

```js
import runtime from "./runtime.js";
import bun from "./impl/bun.js";
import deno from "./impl/deno.js";
import node from "./impl/node.js";

export default { bun, deno, node }[runtime];
```

Beyond being not particularly pretty code, it's also extremely inefficient: it
means that regardless what runtime you use, *everything* gets pulled in,
because you cannot have distinct entrypoints in your library for the different
runtimes. Not to mention it's also not particularly resistant against someone
modifying the global scope: it would be enough to set
`globalThis.Bun = "not really bun!";` at any time before
the above code is called to fool it into thinking it's running Bun, and
miserably fail later when it tries to use native APIs that do not exist. It's
not smart.

Runtime keys, on the other hand, are any unifier's dream: they allow you to set
up different entrypoint files to your library that will only be used by the
respective runtime -- and even browsers and most notable cloud providers
support them, meaning you can be particularly granular about who you target, and
how.

```json
{
  "exports": {
    ".": {
      "bun": "./src/bun/index.js",
      "deno": "./src/deno/index.js",
      "node": "./src/node/index.js"
    }
  }
}

```

*I had known about the `browser` runtime key, having seen it cleverly used in
Svelte to differentiate between the server-side and the client-side version of
the framework, but I hadn't abstracted its usage -- or known that it was
possible to diverge between different runtimes.*

## More rabbits

Alright, nice! We got our neatly diverging runtime keys in rcompat, the webview
binding implementation looks good, but we're still faced with the problem of
making it all reusable within Primate Native. All this beauty is for nothing if
in the end, we have to duplicate our neatly organised webview code into one
big messy file that can contain nothing but native Bun imports. That kind of
sucks.

But what if *we* don't have to do it -- what if we can comfortably author in
separate files, keeping our codebase clean and modular, and only bundle it for
production? Splitting up code is anyway mostly for the *programmer*'s benefit,
not for the benefit of the computer. And no one ever said you can't bundle
stuff purely for the backend.

So here, the solution was moving up a level by [bundling the worker] to be
published as part of `@rcompat/webview`. In fact, an rcompat user has the
choice of importing webview from `@rcompat/webview`, for normal, blocking usage
-- in case no server is involved; or importing from `@rcompat/webview/worker`,
using the exact same API as before, but guaranteeing that this time, the code
will run in a worker that won't otherwise block execution.

*This goes even further: when you import from `@rcompat/webview/worker`, you
get auto-detection of your platform and thus the right dynamic library loaded.
It's great if you're just testing or writing a program for your operating
system. But for cross-compilation purposes, you can explicitly name the
platform: `@rcompat/webview/worker/linux-x64`. More on that later when we get
to debarrelling the world.*

All things now considered, I had now reached, as far as the GUI was concerned,
my goal: I could import a non-blocking, embeddable worker from
`@rcompat/webview`, which I could use to show the client after our server has
started. Mission accomplished!

Well, only if the mission statement was to be able to show a webview window and
have it access the backend server, showing a plaintext "Hi" response, without
blocking execution, as a sort of futile exercise in "we can run a server and a
GUI client alongside". As it turned out, there was *a lot* more to do before
the entirety of a Primate app could be packaged into a binary.

## Rethinking the build system

Back in Primate 0.31, the world was simple. We had two commands: `npx primate`
to run the app in development mode (with hot reload and other goodies), and
`npx primate serve` to run the app in production mode. In both cases, we
created a `build` directory, which was mostly for the benefit of the bundler to
place the build artefacts there, but also to do a few things that are necessary
during runtime, like compiling non-JS server components (Svelte, JSX) to
JavaScript, which is necessary since the runtime doesn't really import anything
other than `.js` files (at least until [esload] becomes a thing), and a few
other things like transforming buildtime identifiers.

But in all of that, the build directory wasn't imagined as something you could
just copy into another computer and run it from there. Sure, it would have
probably worked somehow with a few adjustments, but it wasn't the stated goal
-- the idea was that you'd run `npx primate serve` on the server, and it would
build and run the app in one.

Adjusting Primate so it can build for native too meant for a chance to
reimagine the build system where it would have two phases, `build` and `serve`:
running `npx primate` would build, and then directly serve, that would remain
the same as before from the user's perspective. But running in production would
be a little different: you'd have to first run `npx primate build`, which would
create everything you need to run the app later out of the `build` directory
using `npx primate serve`, on the same computer you built it on or on another.

This approach lends itself rather well to the idea of build *targets*, because
it can not only be used to differentiate between web and desktop, but also
later extended into specifically adapted builds for cloud providers or static
web pages. This is *somewhat* similar to the idea of adapters in SvelteKit, but
is more fundamental, because SvelteKit cannot be built for the desktop.

So, a new build system it is, then. I was by now slowly easing into the
business of *generating* code (I had already dabbled in that with the webview
worker, but it was mostly throwing the bundler an entrypoint bone and letting
it run its job to completion). The reason why I had to generate code here are
the wholly different semantics Bun uses between running code normally and
compiling apps, mostly as far as imports are concerned. Consider the following
code.

```js
import file from "@rcompat/fs/file";

const index_route = await import("../routes/index.js");
```

This code is basically how Primate used to load routes dynamically from the
`routes` directory, in 0.31. The example loads just one specific route, but the
actual use case is more complex: loading many different routes of different
depths inside the route directory into an object whose keys are the full paths
(starting from `routes` as root), and whose values are the imported files.

This works pretty well for web apps, but for native apps, Bun has two ways to
include imports or assets. The first one are statically analysable imports: if
you have `import file from "@rcompat/fs/file";`, `file` and all its imports
will be included in the compiled app. If you use the `--minify` flag when
compiling, Bun can *even* include dynamic imports, but only if it can analyse
them (this is [not an officially documented feature][dynamic-analysis]).

That means that while `import("../routes/index.js")` would work, a function
that scans the filesystem recursively and produces an array of results wouldn't
be included in the compiled app.

```js
import collect from "@rcompat/fs/collect";

export default async () =>
  // won't be included in the compiled app
  Promise.all((await collect(`${import.meta.dir}/../routes`))
    .map(route => import(/* import the route */)));
```

In addition, non-JS files (HTML, CSS, static assets) are typically loaded from
the filesystem as needed, potentially cached, and then served to the client.
They too need to be included in the compiled binary.

*All these concerns only hold if we want a __truly__ portable app: one that we
can run from any directory, or offer for download to other users. If we always
ran the app from the directory where it was compiled, we wouldn't need to go to
such extents, but that would also make it kind of useless.*

These concerns meant that I needed to generate different code for different
targets. The web target can just load files normally: it will always run from
the build directory, where all its assets are available, relative to itself.
But the native target needs to include *everything* it will ever need within
the executable. Seems like we're in need of diverging paths, again.

Here is an example of how we would diverge on loading an HTML page that we use
to render our components in. The web version is simple:

```js
import file from "@rcompat/fs/file";

const { dir } = import.meta;
const index_html = await file(`${dir}/../pages/index.html`).text();
```

`index_html` now contains the contents of the file that is on disk. Compare
this to the native version:

```js
import file from "@rcompat/fs/file";
import index_html_import from "../pages/index.html" with { type: "file" };

const index_html = await file(index_html).text();
```

What happens in the second example is that Bun replaces the `index_html_import`
import path with an *internal* import path which contains a copy of the
original file. So during runtime, it would be something like

```js
import file from "@rcompat/fs/file";
import index_html_import from "/$bunfs/generated-path-for-index-html";

const index_html = await file(index_html).text();
```

Which is more or less identical with the web target example, with the guarantee
that the import comes from the internal filesystem of the executable and is
always there.

Here we can begin to see why the web and native targets need to *generate*
target-specific code that imports differently. But this isn't limited to code
generation that is completely within our control. Our dependencies too, might
unfortunately contain code that isn't compatible with Bun's strategy of
embedding. One prominent example is the Svelte compiler, available via the
`svelte/compiler` import, which attempts to dynamically load a JSON file and
would thus fail to be included in an executable.

"But hold on -- 'Svelte compiler' you say, why do you need the Svelte compiler
*at all* during runtime? Compiling components to JavaScript has been already
handled during buildtime."

And you'd be perfectly correct in noting that. We don't need any form of
compilation during runtime: all our components have been already converted to a
format understandable by the runtime. We are now confronted with the challenge
that *some* of our dependencies are required at buildtime, others at runtime,
and yet others *may not* be imported at runtime. Hm. Quite the mess, again.

## Return of the runtime keys

Thankfully, we're not completely stranded here. Previously we discussed using
*set* runtime keys, like `bun` for Bun, `deno` for Deno, to create entrypoints
which load native code specific to a runtime. This concept can be extended (in
both Bun and Node, but [not yet in Deno]) to support custom conditions.

```sh
bun --conditions runtime
# or node --conditions runtime
```

Running the runtime with this flag set means it could use the specified
condition, in our case `runtime`, to load our runtime-specific code. For
Primate, this means we can truly separate our build system into a build (normal
`default` condition) and a serve phase (with the `runtime` condition).

This also solves us a related fundamental issue: using the same user-provided
`primate.config.js` file, with different interpretations during buildtime and
runtime. Imagine you're a Svelte user and have this configuration file.

```js
import svelte from "@primate/svelte";

export default {
  modules: [svelte()],
};
```

Normally, if our Primate configuration file were written in JSON, we would
simply parse it during buildtime, change whatever we need to change so
it fits with how it should work during runtime, and stringify it back to the
`build` directory. But being that the Primate configuration file is written in
JavaScript, it cannot be serialised. We need to keep it as is.

Using our `runtime` export condition, we can cleverly manipulate the meaning
of the `@primate/svelte` import. During buildtime, it will load a different
file than in runtime; the former will import `svelte/compiler`, but that won't
end up in our binary. The latter will only include whatever's needed during
runtime to render Svelte components.

*A clarification: in the context of compiling apps, "buildtime" means the phase
where we create everything in our `build` directory, including the generated
target file and "runtime" means feeding `bun build --compile` the target file,
causing it to compile an executable that works as though one called Bun on the
target file.*

```json
{
  "exports": {
    ".": {
      "runtime": "./src/runtime/index.js",
      "default": "./src/default/index.js"
    }
  }
}

```

*Note that in export conditions, order matters. `default` is a catch-all
condition, and needs to be last. That's all why, before, we put `bun` and
`deno` before `node`, because they typically also support the `node` export
condition, for reasons of compatibility.*

Armed with this newfound wisdom, we can now separate all Primate modules into
a buildtime and a runtime part. Some of them won't need both; others will only
perform a few checks during buildtime and bail out if you've done something
wrong (like not having a locale directory but trying to use `@primate/i18n`);
but most of them will contain pro forma entrypoints for both conditions. And we
will benefit tremendously from including just the parts that we really need in
our resulting executable.

... if it weren't for barrel exports.

## Debarrelling the world

This has been already long-winded (and hopefully useful), but we're approaching
the final act, I promise. In between slowly homing in on a solution and
converting all Primate modules to the new runtime-key-based build/serve-dual
format, the problem of barrelled exports (both in rcompat and Primate) came to
light.

Consider the following piece of code.

```js
import { useState } from "react";
```

There is a major flaw with this piece of code, which is not immediately
discernible. It uses a named import from a single entrypoint which exports many
different public-facing functions of the library and is called a barrel export.
Barrel exports are particularly harmful because of their side-effects: in this
case, you're not only importing `useState` and loading it into memory, but also
everything else that that file contains, even though you never explicitly asked
for it.

Beyond blowing up the size of the code you load into memory, barrel exports can
create all other sorts of harms, for instance if any of their imports contains
actual side-effects (i.e., isn't a pure module). Or, in the case of Primate
Native, including a lot of code in the executable that will never be used,
increasing its size unnecessarily.

Thus, in the later phases of working on Primate 0.32, I found myself
debarrelling rcompat and Primate almost completely. Instead of doing something
like

```js
import { file } from "@rcompat/fs";
```

We now have deep imports with

```js
import file from "@rcompat/fs/file";
```

There are a few exceptions, as in `@rcompat/http/mime`, which does not offer
individual entrypoints for the MIME types, i.e.

```js
import { jpg } from "@rcompat/http/mime";
```

But here, there was another consideration: `@rcompat/http/mime` also exports a
`resolve` function that takes a file extension and returns the appropriate
MIME type. In other words, this function already includes all tracked MIME
types, so that I felt it unnecessary to break it down to an extremely granular
level. That goes to say that one doesn't have to debarrel everything, and it
might get absurd at some point -- but it makes sense to debarrel most stuff.

In addition, this has other advantages: having one import per line shows up
neatly in git diffs, and making everything a default export means that you can
call the import whatever you want, without having to resort to use `as` (which
is arguably a cognitive anti-pattern, since it *looks* like destructuring, but
uses different syntax).

To properly debarrel your code, you can make use of the wildcard capabilities
of `package.json`'s `exports` field:

```json
{
  "exports": {
    "./handler/*": "./src/handlers/*.js",
  }
}
```

This type of export means that, if your package's name is `primate`, the
import `primate/handler/view` would load the file at `./src/handlers/view.js`,
and only it.

Alongside debarrelling, on the kind advice of [r-cyr], I converted most of
the Primate and rcompat modules to using private imports.

### Private imports and proper encapsulation

Although it was already introduced in Node 12, package.json `imports` seem to
be rarely used in the wild. They are similar to the `exports` field (in that
they support runtime keys/conditions), but they must begin with `#` (which is
appropriately also the symbol for private fields in classes, in JavaScript)
and are private to the package. This is great if you to want to differentiate
between a private and public part of your library. Consider the following
(simplified) `package.json` file of `@rcompat/fs`.

```json
{
  "imports": {
    "#*": "./lib/private/*/index.js"
    "#native/*": "./lib/native/private/*.js"
  },
  "exports": {
    "./*":  "./lib/default/*/index.js"
  }
```

From anywhere within the package, you can use `#FileRef` to import the FileRef
class, which is located at `./lib/private/FileRef/index.js`. From without the
package, anything you import will come from `./lib/default` -- which mostly
contains reexported private functionality. In some rcompat packages, I've
actually moved to renaming the "default" directory to "public" in order to make
it clear what's exposed and what's not.

Also (neither rcompat nor Primate currently makes use of it), the `imports`
field permits mapping to external packages, potentially allowing you to split
up runtime-divergent implementations into different packages.

## Final act: use only what you own

One last thing, which came up in the wake of the 0.32 release and
necessitated a patch, was a problem that relates to how different package
managers handle the `node_modules` directory.

When you run `npm install`, npm will install all packages, including transitive
dependencies (if hoistable) into `node_modules`. So if package `a` has a
dependency `b`, you will see both `a` and `b` in your `node_modules` directory.

This means that if you then create a `renegade.js` file in your project
directory that, for some reason, imports a transitive dependency (`b`), it
would work.

Other package managers, like pnpm and Deno, work differently: they also place
the user's own, *directly* installed dependencies into `node_modules`, but the
rest is put in a hidden store inside `node_modules/.pnpm` (or
`node_modules/.deno`) that uses symbolic links.

During the target generation, I was first using imports that I did not own
directly, from the perspective of the generated file, which is located in
`build`. Imports such as `@rcompat/fs`, which are used by many Primate packages
but *not* explicitly installed by the user unless needed. This led to a
difference when using npm vs pnpm/Deno: with npm, you didn't need to explicitly
install these transitive dependencies, because they were all hoisted, and with
the other package managers you did, otherwise Primate wouldn't run.

Regardless what behaviour you would consider correct, Primate should work
flawlessly across runtimes and package managers, which has led me to modify the
generated files to only use dependencies that the user installed: in the case
of the `web` target, only `primate`, and in the case of the `desktop` target,
`primate` and `@primate/native`. After that, Primate was running well in all
scenarios.

## Fin

If you benefitted from this post, consider supporting the [rcompat] and
Primate ([website], [github]) projects by starring/watching on Github, using,
filing bug reports or feature requests, or hopping onto chat to talk to us.

[improving the ecosystem]: https://github.com/primatejs/primate/issues/109
[reactive server values]: https://github.com/primatejs/primate/issues/62
[chovy]: https://github.com/ralyodio
[long supported]: https://primatejs.com/blog/release-024
[@rcompat/webview]: https://github.com/rcompat/rcompat/tree/master/packages/webview
[webview]: https://github.com/webview/webview
[r-cyr]: https://github.com/r-cyr
[runtime keys]: https://runtime-keys.proposal.wintercg.org/
[bundling the worker]: https://github.com/rcompat/rcompat/blob/master/packages/webview/build-worker.sh
[esload]: https://github.com/rcompat/esload
[not yet in Deno]: https://github.com/denoland/deno/issues/23757
[website]: https://primatejs.com
[github]: https://github.com/primatejs/primate
[rcompat]: https://github.com/rcompat/rcompat
[react-barrel]: https://github.com/facebook/react/blob/8d74e8c73a5cc5e461bb1413a74c6b058c6be134/packages/react/index.js
[dynamic-analysis]: https://github.com/oven-sh/bun/issues/11732#issuecomment-2156806535
