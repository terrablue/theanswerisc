Today I've released the first version of Poly, a fork of Svelte version 4 with
the goal of maintaining long-term support for it and avoiding the nonsense
introduced with Svelte 5. Over time, I may add my own improvements, but the
goal is for the developer to be able to use the excellent developer experience
(DX) offered by Svelte 4 for years to come.

## Why a fork

There is a disease within the JavaScript community. Software authors are in
love with the idea of reinventing stuff. They will happily use the guise of
major versions to not only introduce breaking changes, but essentially modify
the software to the extent that it's something else entirely. That destroys
trust and a lot of developer hours. I hate that, you hate that, it's annoying
and foolish. People should stop doing that.

Authors: You want to break stuff? You want a degree of freedom in authoring?
Then use the 0.x development time to consolidate your software. Take as long as
you need (Good example: Zig), make no promises. But once you've decided to go
major 1, stick to at least a semblance of the path. If you change your mind
radically, create a new tool instead. Don't use the old tool's name to create
something wholly different. You're breaking expectations and letting down a lot
of people. Nobody likes seeing his work become obsolete by someone else's
delusions of grandeur.

We've seen this happen with Angular (1 -> 2) and Vue (2 -> 3), and now this has
happened with Svelte version 4 -> 5.

*Two counters: I know semver isn't binding, but it is good practice; and the
Svelte project does use it, so it's moot in this context. And I know that the
amount of leeway you have within a semver major change is endless. Even so,
the old adage of "just because you can do something doesn't mean you have to do
it" fits here perfectly.*

Svelte 5 introduces so-called runes (a gimmick, really, but OK), that are
essentially no different from React hooks. We don't need another React. React,
for better or worse, has the largest community and best support. People liked
Svelte for being something *else*.

The rationale the Svelte developers provided for introducing runes is that some
aspects of reactivity in Svelte 4 might be confusing or limited. I'm not going
to repeat that here, you can watch the
[original announcement][introducing-runes] yourself.

I essentially agree with the premise of the video, but I cannot share the
conclusion -- Svelte 5 runes. It is too high a price to pay for the great DX in
Svelte 4. You don't improve on great DX by destroying it and replacing it with
terrible DX. You create better DX. Svelte could have gone with introducing a
new keyword in `.svelte` files, `signal`, to denote reactive values. They could,
over a long period of time, deprecate the use of implicit reactive `let` until
most of the community have switched to the explicit keyword. They could modify
the Svelte compiler so it can see the `signal` keyword anywhere within a
`<script>` block of `.svelte` files. It would probably make the Svelte compiler
more complicated, but that's not a real cost here in *use*: the compiler runs
only once (the development cost might be a lot though, but that's *still* not a
justification for runes).

Instead, they chose to shift the burden to the user -- the developer. Why
distinguish between a `$state` and `$derived` rune? A reactive value is, in use,
always the same. There might be a good *technical* explanation for that, but
that's just bad DX. Now a Svelte 5 developer needs to juggle between four runes,
and Svelte will have the same issues React has: a lot of users who don't really
understand how runes work, and a few experts that do. Unmanageable complexity.

In addition, Svelte 5 claims its runes work in `.js` files. They're only
telling you half the truth really, because the runes only work in files
specifically ending with `.svelte.js`. This might be a minor detail, but it
also breaks expectations, because when editing a `.js` file, your editor will
understand it to be a plain JavaScript file. This means a whole lot of tool
rewiring to properly support runes in editors.

So sum up, Svelte 5 adds unnecessary complexity, makes false promises about
where runes can and cannot work, and runs your existing Svelte 4 code in legacy
mode, to be removed at a future time. Poly was forked from Svelte to make sure
that future time never arrives.

## Enter Poly

Poly is a Svelte 4 fork, based on the latest stable version of Svelte 4,
4.2.19, released roughly 5 months ago. Its main goal for now is long-term 
support for Svelte 4: keeping dependencies updated and ensuring you can use
your existing code without fear of future breakage.

Secondary goals are a TypeScript port, and reducing dependencies altogether,
especially if they contain transitive dependencies.

I might *incrementally* add new features, like support for a `signal` keyword
(see above), but that's not planned until a later stage, if at all.

## Migration

If you're using Svelte without any framework, the Poly repo contains an example
on how to run Poly with esbuild under `apps/esbuild`.

If you're a SvelteKit user, I recommend migrating to [Primate]. We've already
published a package for Poly, `@primate/poly`. To run your existing Svelte code 
with it, configure your `primate.config.js` file with

```js
import poly from "@primate/poly";

export default {
  modules: [poly({
    extension: ".svelte",
  })],
};
```

The only thing you'd need to change are Svelte imports inside components.
For example, the following component:

```svelte
<script>
  import { onMount } from "svelte";
</script>
```

Will need to be changed to

```svelte
<script>
  import { onMount } from "poly";
</script>
```

Other than that, you can continue working on your code the same as you've done
before.


[introducing-runes]: https://www.youtube.com/watch?v=RVnxF3j3N8U
[Primate]: https://primatejs.com
