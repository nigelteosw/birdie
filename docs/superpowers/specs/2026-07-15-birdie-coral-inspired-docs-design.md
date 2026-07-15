# Birdie Coral-Inspired Docs Design

## Goal

Redesign Birdie's existing GitHub Pages documentation as a polished, dark technical-docs experience inspired by Coral's documentation. Preserve the current single-page, anchor-linked architecture and plain static deployment model.

The redesign changes presentation and navigation only. It does not add a documentation framework, split content across routes, or change Birdie's product behavior.

## Visual Direction

Use a restrained, documentation-first aesthetic:

- dark charcoal page and navigation surfaces
- thin, low-contrast borders instead of raised cards or heavy shadows
- muted gray body text with high-contrast headings
- Birdie green as the primary accent for active navigation, links, and focus states
- minimal rounding and decoration
- one subtle mascot banner within the reading column rather than a large marketing hero

The result should feel dense, calm, and technical. It should borrow Coral's information hierarchy without copying Coral's branding or content.

## Typography

Define and use the requested font stacks:

```css
--default-font-family: var(--font-inter), ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
--default-mono-font-family: var(--font-paper-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
```

Load Inter and Paper Mono from a reliable web-font source when the page has network access. The complete fallback stacks must keep the page legible when fonts cannot load.

Use Inter for navigation, headings, and prose. Use Paper Mono for code blocks, inline code, endpoint paths, and small technical labels where appropriate.

## Page Structure

The page remains `docs/index.html` with `docs/styles.css`, `docs/.nojekyll`, and existing static assets.

### Top bar

The compact, sticky top bar contains:

- Birdie mascot and wordmark linked to the top of the page
- a GitHub repository link
- a search-style affordance that opens the navigation on small screens and focuses the page filter on larger screens
- a theme control for dark and light modes

The default experience is dark. Theme preference is stored locally and respects the operating-system preference when no choice has been made.

### Left navigation

The desktop left sidebar is sticky beneath the top bar. It groups anchor links into a small hierarchy:

- Get started
  - Introduction
  - Deploy
  - Connect MCP
- Guides
  - Workflow
- Reference
  - Hosted surfaces
  - Development

The active anchor is highlighted as the reader scrolls. On narrow screens, the sidebar becomes an accessible navigation drawer controlled from the top bar.

### Reading column

The centered reading column holds all existing documentation content. It begins with:

- a small category label
- an `Introduction to Birdie` heading
- a concise product description
- an optional copy-page control
- a wide, understated Birdie banner using the existing mascot asset

Subsequent content uses ordinary documentation sections, numbered steps, prose, lists, callouts, and code blocks. Existing deployment, MCP, workflow, reference, and development information is retained and reorganized rather than expanded into marketing panels.

### Right outline

The desktop right sidebar contains an `On this page` list derived from the major anchors. Its active link follows the reader's current position. It is hidden below desktop widths to protect the reading column.

### Footer

Use a compact footer inside or directly beneath the reading column with the existing Birdie ownership statement and GitHub link. Avoid a full-width promotional band.

## Content Treatment

Preserve the factual content currently in the documentation while editing labels and short introductory sentences for the new hierarchy.

- Convert the current marketing hero into a documentation introduction.
- Convert the three-part summary into a compact `How Birdie works` explanation.
- Keep deployment environment variables and build commands as code blocks.
- Keep the first-start and Claude plugin notes as bordered documentation callouts.
- Keep the four workflow steps, but present them as a vertical numbered sequence.
- Keep the public, authenticated, and MCP surface references in a compact table or definition-list treatment.

No new product claims, endpoints, setup requirements, or architectural guarantees should be introduced.

## Interaction and Accessibility

Use a small, dependency-free script for:

- active-section highlighting through `IntersectionObserver`
- mobile navigation open and close state
- theme preference
- optional in-page navigation filtering or focus behavior

The page must remain usable when JavaScript is unavailable: all anchors remain visible in document flow, the content remains readable, and theme defaults remain valid.

All interactive controls require visible focus states, accessible labels, keyboard operation, and correct expanded-state attributes. Respect `prefers-reduced-motion` and avoid decorative animation beyond subtle color transitions.

## Responsive Behavior

- Desktop: fixed top bar, left navigation, centered content, and right outline.
- Medium widths: hide the right outline while preserving the left navigation.
- Mobile: collapse the left navigation into a top-bar drawer and use a single reading column.
- Code blocks scroll horizontally without widening the page.
- Typography and spacing scale down without turning sections into separate cards.

## Files and Boundaries

Expected implementation scope:

- update `docs/index.html`
- replace or substantially revise `docs/styles.css`
- add `docs/script.js` if interaction cannot remain comfortably inline
- reuse `docs/assets/birdie-mascot.png`

Do not modify the application under `web/` or `backend/`. Do not add a docs build tool, package dependency, client framework, or multi-page routing system.

## Verification

Verify the redesign with:

- `git diff --check`
- `bun run build`
- static inspection of anchors, labels, and fallback behavior
- browser checks at desktop, tablet, and mobile widths
- keyboard checks for navigation, theme, and drawer controls
- confirmation that all previous documentation facts remain represented

Do not use the locally installed `xmllint` result as an HTML5 correctness gate because its parser does not recognize modern semantic elements reliably.

## Success Criteria

The redesign is complete when:

- Birdie reads visually as a polished technical documentation site inspired by Coral
- the page remains a single static, GitHub Pages-compatible document
- both requested font families are wired through the exact fallback stacks
- desktop navigation uses the three-column docs hierarchy
- mobile navigation is accessible and usable
- existing Birdie documentation content and links remain accurate
- the implementation introduces no application or deployment dependencies
