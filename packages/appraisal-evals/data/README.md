# data/

Empty on purpose. Everything except this file is git-ignored.

No reference dataset is vendored into this repository. Evaluation sets such as
ROBoto2 are published by their own authors under their own licences, and
copying them here would relicense someone else's work by accident and let the
copy drift from the original.

To obtain one:

```bash
node packages/appraisal-evals/scripts/fetch-reference-datasets.mjs --list
node packages/appraisal-evals/scripts/fetch-reference-datasets.mjs roboto2
```

Then record, in a `PROVENANCE.md` you create next to the files:

- the exact source (URL, DOI, or the paper's data-availability statement),
- the licence, quoted or linked,
- the retrieval date,
- the version or commit, if the source has one.

## What may be committed

The fixtures under `../fixtures/` are committed, and they contain only:

- **synthetic text** written for this repository — describing no real study,
  no real participant and no real result; or
- **excerpts from CC-BY (or more permissive) sources**, with the source
  recorded in the item's `provenance` field.

Nothing else. In particular, no article full texts from a local archive, no
user or patient data, no project data, and no logs of model calls. A test in
`../test/fixtures.test.ts` enforces the licence whitelist, so a fixture that
breaks this rule fails CI rather than reaching a reader.
