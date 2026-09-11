# force-app — your org's metadata, locally

This is the Salesforce source directory declared in
[`sfdx-project.json`](../sfdx-project.json). It is where `sf project retrieve`
lands metadata and where `scripts/flow.mjs` looks for flows to deploy
(`force-app/main/default/flows/<ApiName>.flow-meta.xml`).

**It ships empty on purpose, and its contents are gitignored.** Anything you pull
down here is your own org's configuration — flows, fields, layouts. That is
yours, not this repo's, and it should never end up in a commit or a fork.

## There is no sample flow here, deliberately

A generic example flow would not know your record types, picklist values, field
API names, or naming conventions, so copying one produces metadata that fails to
deploy for reasons that are tedious to debug.

**Retrieve a real flow from your own org and use it as the template instead.**
A flow that already works in your org is a correct-by-construction starting
point:

```bash
node scripts/flow.mjs list --active           # what exists
node scripts/flow.mjs retrieve <ApiName>      # lands in flows/ below
cp force-app/main/default/flows/<ApiName>.flow-meta.xml \
   force-app/main/default/flows/<NewApiName>.flow-meta.xml
```

Then edit the copy — change the `<label>`, the `<interviewLabel>`, and the
logic — and deploy it as a new flow:

```bash
node scripts/flow.mjs deploy <NewApiName>              # dry run, shows the plan
node scripts/flow.mjs deploy <NewApiName> --apply      # creates it, INACTIVE
node scripts/flow.mjs activate <NewApiName> --apply    # turn it on
```

`deploy` handles a flow that does not exist in the org yet — it reports
`currently: (new flow)` — so creating and updating are the same command.

## Why deploying never overwrites

Deploying a flow always creates a **new version**. If the flow is currently
active, the new version lands **inactive** and you activate it explicitly. The
previous version keeps running until you do, which is what makes this safe to
iterate on against production.
