import { initPlasmicLoader } from "@plasmicapp/loader-nextjs";

export const PLASMIC = initPlasmicLoader({
  projects: [
    {
      id: "tmEX5vHKfKXuU2AsyC4mA6",
      token: "4sbixhxKYcLTlwu8uCycMHW8seZlUEBFpIKd1GdX8g2HOVNreoGMDBjVZBO5n1z0ccPvf07A0762xkrT6RQ",
    },
  ],

  // By default Plasmic will use the last published version of your project.
  // For development, you can set preview to true, which will use the unpublished
  // project, allowing you to see your designs without publishing.  Please
  // only use this for development, as this is significantly slower.
  preview: true,
});

// You can register any code components that you want to use here; see
// https://docs.plasmic.app/learn/code-components-ref/
// And configure your Plasmic project to use the host url pointing at
// the /plasmic-host page of your nextjs app (for example,
// http://localhost:3000/plasmic-host).  See
// https://docs.plasmic.app/learn/app-hosting/#set-a-plasmic-project-to-use-your-app-host

// PLASMIC.registerComponent(...);

import { TestPlasmicComponent } from "./components/Test";

PLASMIC.registerComponent(TestPlasmicComponent, {
  name: "Test Plasmic Component",
  props: {
    message: {
      type: "string",
      defaultValue: "Hello from Test Component!",
    },
    className: "string",
  },
});

import { SevenSegmentClock } from "./components/SevenSegmentClock";

PLASMIC.registerComponent(SevenSegmentClock, {
  name: "SevenSegmentClock",
  props: {
    className: "string",

    clockFontFamily: {
      type: "string",
      defaultValue: "monospace",
      description: "Font family for the main clock digits (hours and minutes)",
    },

    ampmFontFamily: {
      type: "string",
      defaultValue: "sans-serif",
      description: "Font family for the AM / PM indicator",
    },
  },
});

    

