import * as React from 'react';
import { PlasmicCanvasHost } from '@plasmicapp/loader-nextjs';
import { PLASMIC } from '@/plasmic-init';

export default function PlasmicHost() {
  // Use CanvasHost only for dev preview inside Plasmic editor
  if (process.env.NODE_ENV === "development") {
    return <PlasmicCanvasHost />;
  }

  // Production / Vercel: serve actual registered components
  return <PlasmicHost />;
}
