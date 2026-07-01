# ecom AI Studio

High-fidelity design base for an AI e-commerce media production workbench.

The first release focuses on a mattress and home-furnishing commerce workflow:
import products, analyze competitors, generate images and video, run quality checks,
and feed performance data back into regeneration.

## Deliverables

- `designs/concepts/`: 10 concept images, named from `01-...png` to `10-...png`.
- `designs/brief.md`: visual system, product structure, and official Chinese UI copy.
- `designs/prompts.md`: final prompts used for concept generation.
- `src/`: lightweight Vite/TypeScript design shell for browsing the concept set.

## Commands

```bash
npm install
npm run dev
npm run build
```

## Design Direction

The interface should feel like a dense operational cockpit, not a marketing page:
graphite surfaces, cool gray structure, sage-green panels, lime status accents,
compact cards, a left navigation rail, a central production workspace, and a
right-side task and metrics column.

## Notes

Generated UI images may contain unstable small text. Treat `designs/brief.md` as
the source of truth for copy, structure, and behavior.
