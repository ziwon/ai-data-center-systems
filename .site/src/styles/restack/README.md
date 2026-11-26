# restack design system tokens

Vendored from [restack-ai/design-system](https://github.com/restack-ai/design-system)
at commit `3a37417`. The site uses the tokens and typefaces only, not the React
components.

| File | Source | Change |
| --- | --- | --- |
| `color.css` | `src/tokens/color.css` | The light face also matches Starlight's `:root[data-theme='light']`. |
| `typography.css` | `src/tokens/typography.css` | None |
| `space.css` | `src/tokens/space.css` | None |
| `fonts.css` | `src/css/fonts.css` | Font URLs point at `./fonts/`. |
| `fonts/*.woff2` | `src/fonts/` | None |
| `assets/restack-mark.png` | `src/assets/restack-mark.png` | None. The site title draws it as a mask; `public/favicon.svg` embeds it. |

`custom.css` maps Starlight's variables onto these roles. To update, copy the
files again from the design system and reapply the changes in the table.

## Licences

- The tokens follow the licence of the restack-ai/design-system repository.
- The restack ai face mark is restack ai's artwork, used here as a restack project.
- DM Sans and IBM Plex Mono are under the SIL Open Font License 1.1
  (`fonts/LICENSE-DMSans.txt`, `fonts/LICENSE-IBMPlexMono.txt`).
