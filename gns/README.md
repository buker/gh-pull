# GNS read-only inbox

Bundle the existing gh-pull UI for GNS html-apps (`window.gns` + `fetch` shim to REST).

```bash
npm run build:gns
# optional output path:
node scripts/build-gns-ui.mjs /path/to/pr-review/app/gh-pull.html
```

Ship via **pr-review** manifest view `gh-pull` (see Chess `gns-pr-review`); settings and saved views use `user.*.apps.pr-review.data.gh-pull-*` keys.
