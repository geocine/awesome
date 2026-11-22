# Stars site

Live at https://geocine-awesome.netlify.app/. A searchable React (Vite) site showing every repo in [`../data/stars.json`](../data/stars.json).

```sh
npm install
npm run dev      # copies ../data/stars.json into public/, starts Vite
npm run build    # outputs dist/
```

## Deploy to Netlify

The repo root has a `netlify.toml` (base `site`, command `npm run build`, publish `dist`). In Netlify, choose **Add new site → Import an existing project**, pick `geocine/awesome` and keep the detected settings.

## Refresh the data

From the repo root:

```sh
node scripts/fetch-stars.mjs   # pulls stars + star lists through the gh CLI
node scripts/build-readme.mjs  # rewrites the starred section of README.md
```

`fetch-stars.mjs` reports any stars that aren't in a list or have no description. Add missing descriptions to `data/descriptions.json`.

## Archive

`data/archive.json` holds things you starred or bookmarked before and later unstarred. Each entry has `title`, `url`, `description` and `list` (a star-list slug). GitHub entries get live metadata on the next fetch, and any you star again drop out of the archive automatically.
