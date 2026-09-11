# manifest — multi-component retrieve and deploy

Copy [`package.xml.example`](package.xml.example) to `package.xml`, list the
components you want, then:

```bash
sf project retrieve start --manifest manifest/package.xml
sf project deploy start   --manifest manifest/package.xml --dry-run
sf project deploy start   --manifest manifest/package.xml
```

A manifest earns its keep when one change spans several components — a flow plus
the custom fields it reads, say — so they move as one set. For a single flow,
[`scripts/flow.mjs`](../scripts/flow.mjs) is less ceremony and gives you a
preview gate for free.

`<members>*</members>` pulls every component of that type. That is almost always
far more than you want, and on a mature org it is a very slow retrieve.

Your own `package.xml` is gitignored — it names components in your org, which is
your configuration rather than this repo's.
