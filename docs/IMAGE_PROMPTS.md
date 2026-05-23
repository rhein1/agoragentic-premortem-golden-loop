# Image Generation Prompts

Use these prompts for GitHub social preview, README hero, and documentation images. They follow the Agoragentic brand contract from `DESIGN.md`: serious infrastructure, compact control surfaces, Triptych OS (Agent OS) proof language, deep navy surfaces, warm coral actions, cyan/support status accents, and local proof artifacts.

Keep all text out of the generated image unless the tool renders typography reliably; add labels in the README instead.

Some image generators ignore requested dimensions and return a square canvas. If the visual content passes the no-text and brand gates, crop and resize the final asset to the required aspect ratio instead of accepting a square social card or README hero.

## Acceptance Gate

Reject and regenerate any asset that fails one of these checks:

- `assets/social-card.png` must be wide, ideally 1280x640 or another 2:1 GitHub-social-safe ratio. Do not accept a square social card.
- `assets/readme-hero.png` must be wide, ideally 1600x900 or wider. Do not accept a square README hero.
- `assets/workflow-diagram.png` can be square or landscape, but all labels must be intentionally readable or removed. Do not accept stray generated text.
- `assets/icon.png` should be square and readable at small sizes.
- No generated image should contain hallucinated labels, malformed words, fake code, fake brand text, fake path strings, or invented logos.
- If the model cannot reliably render text, request abstract UI blocks only and overlay real labels later in Markdown, SVG, Figma, or CSS.

## Brand Rules For Every Prompt

- Palette: page background `#0C1222`; panels `#111A2E`, `#131D30`, `#162038`; code/input `#0A1019`, `#0E1628`; primary coral `#E8613A`; coral hover/highlight `#F07A58`; cyan signal `#06B6D4`; success `#22C55E`; warning `#F59E0B`; text `#E2E8F0`, `#94A3B8`, `#64748B`; borders `#263044`, `#3B465C`.
- Typography feel: Space Grotesk for headline-like blocks, Inter for UI/body, JetBrains Mono for terminal, code, receipts, endpoint names, and metadata.
- Visual language: compact deployed-agent control surface, receipts, budgets, policies, proof, audit trail, and local artifacts.
- Shape language: tight 4px-16px radii, thin borders, subtle shadows, dense but readable grids.
- Logo: if a brand mark is needed, leave space for the existing Agoragentic logo/wordmark to be overlaid later. Do not invent a new logo, mascot, badge, coin, or protocol mark.
- Avoid: generic purple gradients, beige/brown palettes, glossy SaaS blobs, decorative background shapes, cyberpunk clutter, humanoid robots, mascots, crypto hype, coins, random lockups, unreadable fake UI text.

## GitHub Social Preview

```text
Create a 1280x640 GitHub social preview image for "Agoragentic Premortem Golden Loop Agent". The final canvas must be 2:1 landscape, not square. Visual style: Agoragentic infrastructure control surface, compact and commercially serious, not a generic AI illustration. Use the Agoragentic palette exactly: #0C1222 background, #111A2E/#131D30/#162038 panels, #E8613A coral primary accents, #F07A58 highlight, #06B6D4 cyan signal, #22C55E success, #F59E0B warning, #E2E8F0 and #94A3B8 UI text blocks.

Scene: a restrained dark control desk with three local artifacts visible as abstract UI panels: a premortem report, a Golden Loop local receipt, and a self-heal plan. Show a tight clockwise loop of status nodes using coral, cyan, green, and amber status lighting. Do not render any readable text, words, letters, code, file paths, or brand name inside the image. Use abstract bars, dots, and blocks only. Leave clean negative space on the left for the real Agoragentic wordmark to be overlaid later.

Must communicate: free local-first OSS, no data sent anywhere by default, proof receipts, owner approval gates. Do not show people, robots, mascots, coins, blockchain visuals, decorative blobs, generic purple gradients, or invented logos.
```

## README Hero Image

```text
Create a wide landscape image showing an abstract developer infrastructure control surface. Deep navy background #0C1222, layered darker panels #111A2E/#131D30/#162038, coral accents #E8613A, cyan lines #06B6D4, green dots #22C55E, amber dots #F59E0B.

CRITICAL: Do NOT include any text, words, letters, numbers, labels, code, JSON, file paths, hex codes, or any readable characters anywhere in the image. Zero text. None.

Show three abstract dark panels with colored bars and dots arranged in rows, representing abstract data. A thin cyan line boundary encloses the panels on the right side, with abstract document icons and folder shapes on the far right as output. On the left, show abstract file shapes entering the boundary. A central panel resembles a terminal with horizontal gray bars of varying lengths and small colored dots as status indicators. Use tight 8px-12px panel radii, thin #263044 borders, subtle shadows. The composition should be wider than it is tall, designed to be cropped to 16:9.

No people, robots, mascots, logos, shields, coins, or decorative shapes. Pure infrastructure aesthetic.
```

## Workflow Diagram Image

```text
Create an isometric diagram of five abstract workstations arranged in a clockwise pentagon inside a dark boundary. Background #0C1222. The boundary platform uses #131D30/#162038 surfaces.

CRITICAL: Do NOT include any text, words, letters, numbers, labels, hex codes, legends, or any readable characters anywhere in the image. Zero text. None. No color legend, no station names, no annotations.

Each workstation is a small isometric desk with abstract colored indicators: station 1 has coral #E8613A elements, station 2 has cyan #06B6D4, station 3 has green #22C55E, station 4 has amber #F59E0B, station 5 has coral again. Connect them with a coral primary path line clockwise. A thin dotted cyan line exits the boundary to a small external beacon shape in the bottom-right corner.

Use precise clean linework, tight radii, subtle depth/shadows, isometric 3D perspective. The boundary should feel like a local machine enclosure. No cartoon characters, mascots, coins, decorative blobs, explosions, gradients, or readable annotations.
```

## Icon Prompt

```text
Create a square app/repo icon for "Agoragentic Premortem Golden Loop Agent" that fits the Agoragentic brand. Background #0C1222. Center mark: a compact coral #E8613A loop around a receipt/document shape on a #131D30 panel, with small success #22C55E and warning #F59E0B status marks and a thin cyan #06B6D4 proof line. Use tight 8px-12px radii, clean vector-like geometry, high contrast, and no readable letters.

The icon should feel like local proof infrastructure, not a chatbot or security badge. Do not invent a new Agoragentic logo, use humanoid robots, mascots, coins, shields, purple gradients, or decorative blobs.
```

## Recommended Asset Names

- `assets/social-card.png`
- `assets/readme-hero.png`
- `assets/workflow-diagram.png`
- `assets/icon.png`
