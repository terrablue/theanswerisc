C's `static` keyword has two meanings. With function variables, it denotes
variables maintaining their values across function invocation. When used in
front of function definitions, it delimits the scope of the function to the file
it's defined in. I'm concerned here with the second meaning, which provides a
useful form of encapsulation in C.

However, what happens when you want to have a public facing function, but also
use it in the file it's declared in?

When sharing code between files, you normally declare functions in header files
which can be then used to inform other source files of the functions by
including them. Consider the following example.

In `some-header.h`

```c
int library_string_length(int some_param);
```

Then, in `some-source.c`

```c
int some_header_int_identity_fn(int some_param) {
  return some_param;
}
```

Then, in `another-source.c`

```c
#include "some-header.h"

int main() {
  return some_header_int_identity_fn(0);
}
```

This is all fine and dandy. But consider the case you'd be also using the
`some_header_int_identity_fn` function within `some-source.c` itself.
Namescoping within the file where the function is defined is pretty lengthy
and awkward.

To solve this problem, you can use function pointer binding in C. Consider the
following example from the [Flog][flog] code base.

In `string.h`

```c
size_t flog_string_length(char const string[]);
```

In `string.c`

```c
size_t flog_string_length(char const string[]) {
  size_t length = 0;
  while (string[length] != 0) {
    length++;
  }
  return length;
}
static size_t (* get_length)(char const string[]) = flog_string_length;
```

What happens here is that in your source file, you bind `flog_string_length` to
a local, static symbol. This allows you to use `get_length` inside `string.c`
and `flog_string_length` outside of it (and potentially as part of an external
API). It also means you could have different local `get_length` functions,
bound to different definitions, in different files.

If you find, like me, the order of first declaring the externally visible
function and then binding it to a local function kind of inverted, you can also
do this in another way, the preferable way in Flog. To do this, you need to
change the declaration in `string.h` to that of an `extern` function pointer.

In `string.h`

```c
extern size_t (* flog_string_length)(char const string[]);
```

The `extern` keyword tells C that the `flog_string_length` will be resolved
during linkage.

You then invert the binding in in `string.c`

```c
static size_t get_length(char const string[]) {
  size_t length = 0;
  while (string[length] != 0) {
    length++;
  }
  return length;
}
size_t (* flog_string_length)(char const string[]) = get_length;
```

First, you're declaring a `static` (local) function `get_length`. This is your
black box logic. Then, at some later point (or right away), you bind the
`get_length` to the function pointer `flog_string_length`, making its code
available externally. Personally I find this form better, even if it comes at
the cost of a little bit more verbosity.

Using this technique has many advantages. You separate implementation from
exposure, and have a one-liner dedicated to exposure. You can easily change the
exposed name of a function without influencing its internal usage in the file
it's defined it, and best of all, you can use short names that make sense in a
local file scope, and long, namespaced names that make sense in an external
scope.

[flog]: https://github.com/flogjs/flog
