# SentinelBox website

Source of [sentinelbox.mingchen.dev](https://sentinelbox.mingchen.dev). It was previously a separate repository (`Ming874/sentinel-box-page`) and now lives next to the code it describes.

Vite + React + Tailwind CSS v4, bilingual (zh-TW / en), light and dark themes. The diagrams are inline SVG built in `src/components`; the site loads no external images.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # output in dist/
```

## Data shown on the site

The syscall explorer, profile cards and semantic-feedback examples read copies of the real configuration:

| Copy in `src/data/`        | Source                             |
| -------------------------- | ---------------------------------- |
| `profile-*.json`           | `profiles/*.json`                  |
| `syscall-feedback.json`    | `mappings/syscall_feedback.json`   |

After changing a profile or the mapping, run `npm run sync-data` and commit the result. `npm run build` fails if the copies are out of date (the check is skipped when `website/` is built on its own, as Zeabur does).

## Deployment

Zeabur builds this directory as a static site from `Ming874/mcp-sentinel-box` (`main`, root directory `/website`). Pushing to `main` with changes under `website/` redeploys it.
