# Repository Guidelines

## Project Overview

- This is a Chinese-language Jekyll site deployed with GitHub Pages.
- Keep the implementation dependency-light: use Liquid, HTML, CSS, and vanilla JavaScript unless the user explicitly requests another stack.
- Never publish device addresses, credentials, private maintenance links, or other operational secrets.

## Repository Structure

- `index.html`: home page and article listing.
- `board.html`: public, `noindex` overview of the embedded-board project.
- `_articles/*.md`: article sources rendered with `_layouts/article.html`.
- `projects/ai-asmr/index.html`: procedural Web Audio API binaural ASMR sound lab and Canvas visualizer (architecture & acoustic spec in `docs/ai-asmr-expansion-plan.md`).
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

## AI-ASMR Sound Lab Quality Constraints

When modifying or expanding `projects/ai-asmr/index.html` (see `docs/ai-asmr-expansion-plan.md`), enforce these acoustic invariants:

- **Semantic & Physical Alignment**: UI labels and preset descriptions must match the actual acoustic mechanism (e.g., distinguish sound-generating triggers from acoustic shelters/enclosures; never assign identical modal parameters to distinct materials such as solid stone vs. hollow bamboo).
- **Heterogeneous Physical Topologies (No Pure-Sine Templates)**: Do not use high-gain pure sine-wave sweeps or fixed harmonic chords as the primary body for raindrops or surface taps (which sound like cartoon bubble pops, sonar beeps, or toy xylophones). Build transients from shaped broadband noise bursts plus short, heavily damped inharmonic/cavity modes tailored to each material class (hollow Helmholtz cavity, over-damped fibrous stack, viscoelastic pad with micro-tacky release, or solid mineral slab).
- **Continuous Bed & Shelter Coupling**: Switching an acoustic shelter or environment (e.g., double-glazed window, insulated car cabin, canvas tent, broad leaves) must dynamically update the continuous background bed's lowpass cutoff (`lpScale`), attenuation (`bedGainScale`), and cavity resonance (`peakingFreq` / `Q` / `Gain`), not just droplet transients.
- **Non-Periodic Randomness & Human Micro-Rubato**:
  - Avoid fixed-period single-sine modulation (`Math.sin`) or uniform timer grids. Use incommensurate multi-wave superposition and mean-reverting random walks for wind gusts, filter drift, and density breathing.
  - Model multi-scale natural events (mist/normal/heavy coalesced eave or leaf-tip drips, wind-swept 2–3 drop micro-clusters) and human hand mechanics (5-finger pitch/flesh profiles, center-vs-edge hit-spot variance, single-ear phrase lingering, grace double-taps, and non-uniform rubato finger rolls).
- **Zero-Click & Lowpass Safety**: Every transient must use a soft fade-in ramp (`>= 1.5 ms`) and respect the user/master lowpass ceiling and dynamics limiter.

## Validation

- Full check: `bundle exec jekyll build --strict_front_matter`, then `node scripts/check-site.mjs`.
- Check edited JavaScript with `node --check <file>` (or extract and validate inline `<script>` blocks via `new Function(...)`) and always run `git diff --check`.
- The site checker expects valid metadata, canonical URLs, sitemap entries, a non-empty feed, valid internal references, and raster images no larger than 400 KiB.
- If Ruby/Bundler is unavailable, report that limitation and still run the JavaScript, diff, and relevant browser-preview checks.

## Git Hygiene

- Preserve unrelated user changes and stage only files relevant to the task.
- When a requested change is complete, verified, and limited to intended files, commit it and push the current branch to its configured remote by default so the live result can be reviewed, unless the user asks not to publish.
- Do not auto-publish when validation fails, the remote has diverged, unrelated changes cannot be separated, or the change may expose secrets; report the blocker instead.
