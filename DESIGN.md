# PNGToolbox Design Direction

## Thesis

PNGToolbox should feel like a calm native utility, not a marketing template. The conversion or background-removal workspace owns the first viewport; explanations support the task below it.

## Own-world

- Palette: Apple-like monochrome web surfaces (`#f5f5f7`, white, `#1d1d1f`, `#6e6e73`) with one restrained PNGToolbox green action color.
- Typography: the system sans stack for familiar platform rhythm and high legibility.
- Surfaces: white workspaces on a light gray page, thin neutral separators, one soft shadow reserved for the active tool workspace, and the existing transparency checkerboard for image truth.
- Shape: 12px controls, 16-20px major surfaces, pill shape only for compact actions and segmented controls.

## Story

The visitor immediately understands that the site converts WebP files and removes solid backgrounds locally. They choose a task, add a file, adjust the small control rail, compare the result, and download the measured output.

## First viewport

A quiet sticky navigation bar sits above a centered, left-readable headline and one green action. The working tool begins immediately below: upload and settings on the left, queue or preview on the right. On small screens the rail stacks above the result without horizontal overflow.

## Form

Replacement visual world, Apple-inspired web utility surface. No official Apple web component or Liquid Glass package is claimed or used. Motion stays limited to native focus, hover, active, and reduced-motion-safe transitions.
