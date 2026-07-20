# ChannelShareChart Specification

## Overview

- Target file: `src/components/ChannelShareChart.tsx`
- Reference: FineBI platform achievement horizontal bars
- Interaction model: static horizontal bars with native tooltips

## Data contract

- Share equals channel GMV divided by total GMV.
- Sort descending by share.
- Zero-GMV channels remain visible with a zero-length bar.

## Visual structure

- Platform label at left, track in the center, percentage at right.
- Bar width maps directly to 0-100%, not relative to the largest channel.
- Use a blue-to-cyan gradient and a visible minimum marker for non-zero values.
- Display total GMV and the share definition in the card subtitle.

