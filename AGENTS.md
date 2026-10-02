# Repository Guidelines

## Project Overview

- This is a Chinese-language Jekyll site deployed with GitHub Pages.
- Keep the implementation dependency-light: use Liquid, HTML, CSS, and vanilla JavaScript unless the user explicitly requests another stack.
- Never publish device addresses, credentials, private maintenance links, or other operational secrets.

## Repository Structure

- `index.html`: home page and article listing.
- `board.html`: public, `noindex` overview of the embedded-board project.
- `_articles/*.md`: article sources rendered with `_layouts/article.html`.
- `assets/css/base.css`: shared design tokens, themes, and reusable UI styles.
- `assets/css/syntax.css`: code-highlighting colors.
- `assets/js/`: shared browser behavior.
- `scripts/check-site.mjs`: generated-site, metadata, sitemap, link, and image-size checks.
- Do not edit generated `_site/` output.

## Implementation Conventions

- Reuse shared CSS variables and shared scripts instead of duplicating page-specific behavior.
- Use `relative_url` or `absolute_url` Liquid filters for internal assets and links.
- Preserve the theme bootstrap order: `theme.js` must run before `base.css` to prevent a color flash.
- Keep the build-version query on shared theme assets so GitHub Pages cannot serve mismatched cached CSS and JavaScript.
- Maintain keyboard access, visible focus, semantic headings, useful labels, and reduced-motion behavior.
- Preserve responsive layouts and verify both light and dark themes when changing colors or navigation.

## Article Conventions

- Every article must include `layout: article`, `title`, `description`, `date`, `category`, and `tags` in YAML front matter.
- Use `YYYY-MM-DD` dates and concise Chinese descriptions suitable for metadata and feeds.
- Keep exactly one page-level `h1`; article content should begin at `h2`.
- Prefer fenced code blocks with a language identifier and repository-relative internal links.

## Validation

- Full check: `bundle exec jekyll build --strict_front_matter`, then `node scripts/check-site.mjs`.
- Check edited JavaScript with `node --check <file>` and always run `git diff --check`.
- The site checker expects valid metadata, canonical URLs, sitemap entries, a non-empty feed, valid internal references, and raster images no larger than 400 KiB.
- If Ruby/Bundler is unavailable, report that limitation and still run the JavaScript, diff, and relevant browser-preview checks.

## Git Hygiene

- Preserve unrelated user changes and stage only files relevant to the task.
- When a requested change is complete, verified, and limited to intended files, commit it and push the current branch to its configured remote by default so the live result can be reviewed, unless the user asks not to publish.
- Do not auto-publish when validation fails, the remote has diverged, unrelated changes cannot be separated, or the change may expose secrets; report the blocker instead.
